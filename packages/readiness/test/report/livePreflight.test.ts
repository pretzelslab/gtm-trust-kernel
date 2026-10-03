/**
 * The live report's preflight (liveReport.ts runPreflight, called by
 * cli.ts before the scan): failures stop the run with one line each and
 * before any record is read or the sampling plan printed; warnings print
 * and the scan runs with the affected metrics not measured. Built on
 * SalesforceAdapter over the in-memory fake API, as cli.ts's --live path
 * builds it. No network.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { MockAdapter } from '@gtm-trust-kernel/adapters/mock.js';
import { installFakeSalesforce, sfId } from '../../../adapters/test/support/fakeSalesforce.js';
import { registerPreflightOrg, type PreflightOrgOptions } from '../../../adapters/test/support/preflightOrg.js';
import { buildLiveReportData, formatRetry, PreflightError, runPreflight } from '../../src/report/liveReport.js';

const ASOF = '2026-09-30T00:00:00.000Z';
const ACC = sfId('001', 1);
const NOTE_METRICS = [
  'note_coverage_rate',
  'substantive_note_rate',
  'median_note_length_chars',
  'outcome_evidence_retention_rate',
  'pii_density',
] as const;

/** A small org that grants whatever `options` doesn't take away. */
function install(options: PreflightOrgOptions = {}) {
  const sf = installFakeSalesforce();
  registerPreflightOrg(sf, options);
  const opp = (n: number, closed: boolean) => ({
    Id: sfId('006', n), AccountId: ACC, Name: 'Deal', Amount: 1000, StageName: closed ? 'Closed Won' : 'Prospecting',
    CloseDate: closed ? '2026-08-01' : '2026-12-01', OwnerId: sfId('005', 1), IsClosed: closed, IsWon: closed,
    ForecastCategoryName: null, NextStep: null, CreatedDate: '2026-01-01T00:00:00.000+0000', SystemModstamp: '2026-09-01T00:00:00.000+0000',
  });
  sf.on(/FROM Opportunity /, [opp(1, false), opp(2, true)]);
  sf.on(/FROM OpportunityContactRole/, []);
  sf.on(/FROM Account WHERE Id IN/, [
    { Id: ACC, Name: 'Acme', Website: null, Industry: null, NumberOfEmployees: null, OwnerId: null, CreatedDate: '2026-01-01T00:00:00.000+0000', SystemModstamp: '2026-01-01T00:00:00.000+0000' },
  ]);
  sf.on(/FROM OpportunityHistory/, []);
  sf.subqueryRows('OpportunityHistories', 'OpportunityId', []);
  sf.subqueryRows('Notes', 'ParentId', [
    { Id: sfId('002', 1), ParentId: sfId('006', 1), Title: 't', Body: 'Discussed pricing and next steps with the buyer.', OwnerId: null, CreatedDate: '2026-09-01T00:00:00.000+0000', SystemModstamp: '2026-09-01T00:00:00.000+0000' },
  ]);
  sf.on(/FROM ContentDocumentLink/, []);
  sf.subqueryRows('Tasks', 'WhatId', []);
  sf.subqueryRows('Events', 'WhatId', []);
  return sf;
}

/** cli.ts's --live sequence: preflight, then the report. */
async function liveRun(options: PreflightOrgOptions = {}) {
  const sf = install(options);
  const log = vi.spyOn(console, 'log').mockImplementation(() => {});
  const warnings: string[] = [];
  const adapter = sf.adapter();
  await runPreflight(adapter, (line) => warnings.push(line));
  const data = await buildLiveReportData(adapter, { showOrg: false, sampling: {}, asOf: ASOF });
  return { sf, data, warnings, log };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('live preflight', () => {
  it('lets a scan run when the org grants every read, with no warnings', async () => {
    const { data, warnings } = await liveRun();
    expect(warnings).toEqual([]);
    for (const metric of NOTE_METRICS) {
      expect(data.metrics.find((m) => m.metric === metric)!.status, metric).not.toBe('not_instrumented');
    }
  });

  it('stops before the sampling plan and any record read, listing each failure on its own line', async () => {
    const sf = install({ unreadable: ['Task'], hiddenFields: { Opportunity: ['Amount'] } });
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const err = await runPreflight(sf.adapter(), () => {}).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(PreflightError);
    expect((err as PreflightError).message).toBe(
      [
        'Salesforce preflight found 2 problems; no records were read. Fix them and run again:',
        "- The Run As user can't read Opportunity.Amount. Give it Read access to that field (field-level security).",
        "- The Run As user can't read Task records. Give it Read access to Task in a permission set.",
      ].join('\n'),
    );
    expect(sf.queries).toEqual([]);
    expect(log).not.toHaveBeenCalled();
  });

  it('words a single failure in the singular', async () => {
    const sf = install();
    sf.tokenAnswers({ status: 400, body: '{"error":"invalid_client","error_description":"invalid client credentials"}' });
    const err = (await runPreflight(sf.adapter(), () => {}).catch((e: unknown) => e)) as PreflightError;
    expect(err.message).toBe(
      [
        'Salesforce preflight found a problem; no records were read. Fix it and run again:',
        "- Salesforce rejected SF_CLIENT_SECRET. Use the connected app's Consumer Secret (salesforce-setup.md).",
      ].join('\n'),
    );
    expect(err.failures).toHaveLength(1);
  });

  it.each([['Note'], ['ContentDocumentLink']])(
    'warns when %s is unreadable and runs the scan with the note metrics not measured (D3)',
    async (object) => {
      const { data, warnings } = await liveRun({ unreadable: [object] });
      expect(warnings).toEqual([
        `Warning: The Run As user can't read ${object} records. Give it Read access to ${object} in a permission set. Until then, note metrics are marked not measured.`,
      ]);
      for (const metric of NOTE_METRICS) {
        expect(data.metrics.find((m) => m.metric === metric)!.status, metric).toBe('not_instrumented');
      }
    },
  );

  it('prints warnings on stderr by default', async () => {
    const sf = install({ unreadable: ['Note'] });
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    await runPreflight(sf.adapter());
    expect(err).toHaveBeenCalledWith(expect.stringMatching(/^Warning: The Run As user can't read Note records\./));
  });

  it('does nothing for an adapter without a preflight', async () => {
    await expect(runPreflight(new MockAdapter('org', {} as never), () => {})).resolves.toBeUndefined();
  });
});

describe('formatRetry', () => {
  it('says why the run paused, for how long, and which attempt is next', () => {
    expect(formatRetry({ reason: '429', attempt: 2, maxAttempts: 4, delayMs: 1500 })).toBe(
      'Salesforce is limiting requests (429); waiting 1.5s before attempt 2 of 4.',
    );
    expect(formatRetry({ reason: '403 REQUEST_LIMIT_EXCEEDED, concurrent requests', attempt: 3, maxAttempts: 4, delayMs: 250 })).toBe(
      'Salesforce is limiting requests (403 REQUEST_LIMIT_EXCEEDED, concurrent requests); waiting 0.3s before attempt 3 of 4.',
    );
    expect(formatRetry({ reason: '503', attempt: 2, maxAttempts: 4, delayMs: 0 })).toBe(
      'Salesforce is unavailable (503); waiting 0.0s before attempt 2 of 4.',
    );
  });
});

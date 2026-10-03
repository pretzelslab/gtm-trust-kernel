/**
 * Redaction canary for the Salesforce-specific text sources added in Phase
 * 3a: Enhanced Note bodies (TextPreview and fetched full text) and Event
 * (meeting) subjects and descriptions. redactionCanary.test.ts covers every
 * canonical text field through the mock adapter; this runs a whole report
 * through SalesforceAdapter on the in-memory fake API, so the canaries enter
 * at the Salesforce mapping layer, and asserts none reaches ReportData
 * (--json), either HTML report, or console output. A positive control
 * proves the canaries do reach the adapter's own output.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { ENHANCED_NOTE_PREVIEW_CAP } from '@gtm-trust-kernel/adapters/salesforce.js';
import { installFakeSalesforce, sfId, sfRef } from '../../../adapters/test/support/fakeSalesforce.js';
import { buildReportData } from '../../src/report/buildReport.js';
import { renderPlainReportHtml } from '../../src/report/plainReport.js';
import { renderReportHtml } from '../../src/report/render.js';
import { buildNarrativeRequest } from '../../src/report/narrativeRequest.js';

const CANARY = {
  notePreview: 'CANARY-sf-note-preview',
  noteFull: 'CANARY-sf-note-fulltext',
  eventSubject: 'CANARY-sf-event-subject',
  eventBody: 'CANARY-sf-event-description',
} as const;

const ASOF = '2026-09-30T00:00:00.000Z';
const OPEN = sfId('006', 1);
const CLOSED = sfId('006', 2);
const ACC = sfId('001', 1);
const NOTE_SHORT = sfId('069', 1);
const NOTE_CAPPED = sfId('069', 2);

function install() {
  const sf = installFakeSalesforce();
  const opp = (id: string, closed: boolean) => ({
    Id: id, AccountId: ACC, Name: 'Deal', Amount: 1000, StageName: closed ? 'Closed Won' : 'Prospecting',
    CloseDate: closed ? '2026-08-01' : '2026-12-01', OwnerId: sfId('005', 1), IsClosed: closed, IsWon: closed,
    ForecastCategoryName: null, NextStep: null, CreatedDate: '2026-01-01T00:00:00.000+0000', SystemModstamp: '2026-09-01T00:00:00.000+0000',
  });
  sf.on(/FROM Opportunity /, [opp(OPEN, false), opp(CLOSED, true)]);
  sf.on(/FROM OpportunityContactRole/, []);
  sf.on(/FROM Account WHERE Id IN/, [
    { Id: ACC, Name: 'Acme', Website: 'acme.example', Industry: null, NumberOfEmployees: null, OwnerId: null, CreatedDate: '2026-01-01T00:00:00.000+0000', SystemModstamp: '2026-01-01T00:00:00.000+0000' },
  ]);
  sf.on(/FROM OpportunityHistory/, []);
  sf.subqueryRows('OpportunityHistories', 'OpportunityId', []);
  sf.subqueryRows('Notes', 'ParentId', []);
  sf.on(/FROM ContentDocumentLink/, (soql) =>
    soql.includes(OPEN)
      ? [
          { ContentDocumentId: NOTE_SHORT, LinkedEntityId: OPEN },
          { ContentDocumentId: NOTE_CAPPED, LinkedEntityId: OPEN },
        ]
      : [],
  );
  sf.on(/FROM ContentNote WHERE Id IN/, [
    { Id: NOTE_SHORT, Title: 't', TextPreview: `short ${CANARY.notePreview}`, OwnerId: null, CreatedDate: '2026-09-01T00:00:00.000+0000' },
    { Id: NOTE_CAPPED, Title: 't', TextPreview: CANARY.notePreview.padEnd(ENHANCED_NOTE_PREVIEW_CAP, 'z'), OwnerId: null, CreatedDate: '2026-09-02T00:00:00.000+0000' },
  ]);
  sf.noteContent(NOTE_CAPPED, `<p>${CANARY.noteFull}</p>`);
  sf.subqueryRows('Tasks', 'WhatId', []);
  sf.subqueryRows('Events', 'WhatId', (parentIds) =>
    parentIds.includes(OPEN)
      ? [
          {
            Id: sfId('00U', 1), WhoId: null, WhatId: OPEN, Subject: CANARY.eventSubject, Description: CANARY.eventBody,
            ActivityDate: null, ActivityDateTime: '2026-09-20T10:00:00.000+0000', CreatedDate: '2026-09-19T00:00:00.000+0000', SystemModstamp: '2026-09-19T00:00:00.000+0000',
          },
        ]
      : [],
  );
  return sf;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('Salesforce Enhanced Note and Event text never reaches report output', () => {
  it('positive control: the canaries reach the adapter output', async () => {
    const sf = install();
    const adapter = sf.adapter();
    const notes = await adapter.getNotesByOpportunity([sfRef('opportunity', OPEN)]);
    const activities = await adapter.getActivitiesByOpportunity([sfRef('opportunity', OPEN)]);
    const text = JSON.stringify([notes.items, activities.items]);
    for (const canary of Object.values(CANARY)) expect(text).toContain(canary);
  });

  it('no canary appears in ReportData, the HTML reports, or console output', async () => {
    const sf = install();
    const logged: unknown[][] = [];
    for (const m of ['log', 'warn', 'error'] as const) {
      vi.spyOn(console, m).mockImplementation((...args: unknown[]) => void logged.push(args));
    }
    const data = await buildReportData(sf.adapter(), undefined, { orgLabel: 'Live Salesforce org', orgDescription: 'fake', asOf: ASOF });
    expect(data.org.openSampleSize + data.org.closedSampleSize).toBeGreaterThan(0);

    const surfaces = {
      json: JSON.stringify(data),
      html: renderReportHtml(data, { mode: 'live' }),
      plain: renderPlainReportHtml(data, { mode: 'live' }),
      console: JSON.stringify(logged),
    };
    for (const [surface, text] of Object.entries(surfaces)) {
      for (const canary of Object.values(CANARY)) {
        expect(text, `${canary} leaked into ${surface}`).not.toContain(canary);
      }
    }
  });
});

describe('Salesforce text, hostname and record ids never reach the narrative request', () => {
  it('the request built from a live-shaped report carries none of them', async () => {
    const sf = install();
    const adapter = sf.adapter();
    vi.spyOn(console, 'log').mockImplementation(() => {});
    // Same orgDescription a live run uses (readiness cli.ts buildLive).
    const data = await buildReportData(adapter, undefined, { orgLabel: 'Live Salesforce org', orgDescription: adapter.orgId, asOf: ASOF });
    expect(JSON.stringify(data)).toContain(adapter.orgId);

    const request = JSON.stringify(buildNarrativeRequest(data, {}));
    for (const canary of Object.values(CANARY)) {
      expect(request, `${canary} leaked into the narrative request`).not.toContain(canary);
    }
    expect(request).not.toContain(adapter.orgId);
    for (const id of [OPEN, CLOSED, ACC, NOTE_SHORT, NOTE_CAPPED]) {
      expect(request, `record id ${id} leaked into the narrative request`).not.toContain(id);
    }
  });
});

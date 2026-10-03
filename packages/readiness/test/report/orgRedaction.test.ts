/**
 * A live report leaves the org's hostname out by default; --show-org puts
 * it back and adds a note saying so. Built through SalesforceAdapter on the
 * in-memory fake API (no network), exactly as cli.ts's --live path builds
 * it, then rendered the way cli.ts renders it. The flag check spawns the
 * report script without --live, so no org is contacted.
 */

import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { installFakeSalesforce, INSTANCE_URL, sfId } from '../../../adapters/test/support/fakeSalesforce.js';
import { buildLiveReportData, HIDDEN_ORG_DESCRIPTION } from '../../src/report/liveReport.js';
import { renderPlainReportHtml } from '../../src/report/plainReport.js';
import { renderReportHtml } from '../../src/report/render.js';
import { ORG_HOST_NOTE } from '../../src/report/shell.js';

const HOST = new URL(INSTANCE_URL).host;
const ASOF = '2026-09-30T00:00:00.000Z';
const ACC = sfId('001', 1);

function install() {
  const sf = installFakeSalesforce();
  const opp = (n: number, closed: boolean) => ({
    Id: sfId('006', n), AccountId: ACC, Name: 'Deal', Amount: 1000, StageName: closed ? 'Closed Won' : 'Prospecting',
    CloseDate: closed ? '2026-08-01' : '2026-12-01', OwnerId: sfId('005', 1), IsClosed: closed, IsWon: closed,
    ForecastCategoryName: null, NextStep: null, CreatedDate: '2026-01-01T00:00:00.000+0000', SystemModstamp: '2026-09-01T00:00:00.000+0000',
  });
  sf.on(/FROM Opportunity /, [opp(1, false), opp(2, true)]);
  sf.on(/FROM OpportunityContactRole/, []);
  sf.on(/FROM Account WHERE Id IN/, [
    { Id: ACC, Name: 'Acme', Website: 'acme.example', Industry: null, NumberOfEmployees: null, OwnerId: null, CreatedDate: '2026-01-01T00:00:00.000+0000', SystemModstamp: '2026-01-01T00:00:00.000+0000' },
  ]);
  sf.on(/FROM OpportunityHistory/, []);
  sf.subqueryRows('OpportunityHistories', 'OpportunityId', []);
  sf.subqueryRows('Notes', 'ParentId', []);
  sf.on(/FROM ContentDocumentLink/, []);
  sf.subqueryRows('Tasks', 'WhatId', []);
  sf.subqueryRows('Events', 'WhatId', []);
  return sf;
}

/** The three files a live run writes: the JSON (with --json) and both HTML reports. */
async function liveSurfaces(showOrg: boolean): Promise<Record<'json' | 'html' | 'plain', string>> {
  vi.spyOn(console, 'log').mockImplementation(() => {});
  const data = await buildLiveReportData(install().adapter(), { showOrg, sampling: {}, asOf: ASOF });
  expect(data.org.openSampleSize + data.org.closedSampleSize).toBeGreaterThan(0);
  return {
    json: JSON.stringify(data, null, 2),
    html: renderReportHtml(data, { mode: 'live', orgHostShown: showOrg }),
    plain: renderPlainReportHtml(data, { mode: 'live', orgHostShown: showOrg }),
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('live report org hostname', () => {
  it('default: no hostname anywhere in the JSON or either HTML report, and no note', async () => {
    const surfaces = await liveSurfaces(false);
    for (const [surface, text] of Object.entries(surfaces)) {
      expect(text, `hostname leaked into ${surface}`).not.toContain(HOST);
      expect(text, `hostname leaked into ${surface}`).not.toContain('my.salesforce.com');
      expect(text).not.toContain('remove --show-org before sharing');
    }
    expect(surfaces.json).toContain(HIDDEN_ORG_DESCRIPTION);
    expect(surfaces.html).toContain(HIDDEN_ORG_DESCRIPTION);
    expect(surfaces.plain).toContain(HIDDEN_ORG_DESCRIPTION);
  });

  it('--show-org: the hostname is in all three, and both HTML reports carry the note', async () => {
    const surfaces = await liveSurfaces(true);
    for (const text of Object.values(surfaces)) expect(text).toContain(HOST);
    expect(ORG_HOST_NOTE).toBe("This report names your Salesforce org's hostname; remove --show-org before sharing.");
    expect(surfaces.html).toContain('This report names your Salesforce org&#39;s hostname; remove --show-org before sharing.');
    expect(surfaces.plain).toContain('This report names your Salesforce org&#39;s hostname; remove --show-org before sharing.');
  });
});

describe('report --show-org without --live', () => {
  it('exits 1 without writing a report or contacting an org', { timeout: 60_000 }, () => {
    const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
    const TSX = path.join(ROOT, 'node_modules', 'tsx', 'dist', 'cli.mjs');
    const CLI = path.join(ROOT, 'packages', 'readiness', 'src', 'report', 'cli.ts');
    const cwd = mkdtempSync(path.join(os.tmpdir(), 'gtm-report-showorg-'));
    try {
      const r = spawnSync(process.execPath, [TSX, '--conditions=source', CLI, '--show-org'], { cwd, encoding: 'utf8' });
      expect(r.status).toBe(1);
      expect(r.stderr).toContain('--show-org only applies with --live');
      expect(existsSync(path.join(cwd, 'out'))).toBe(false);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });
});

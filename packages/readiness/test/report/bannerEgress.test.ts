/**
 * The report banner states what left the machine: nothing beyond the CRM
 * read, or, when the run sent the narrative request, metric values to
 * Anthropic. Both single-org reports from one run say the same thing. The
 * existing wording ("LIVE DATA · read-only", "No real CRM was contacted;
 * nothing leaves this machine.") is kept as the start of each banner.
 */

import { describe, expect, it } from 'vitest';
import { MockAdapter, MockSecondSourceAdapter } from '@gtm-trust-kernel/adapters/mock.js';
import { MOCK_ORG_FIXTURES } from '../../src/fixtures/mockOrgs.js';
import { buildReportData, type ReportData } from '../../src/report/buildReport.js';
import { buildNarrative } from '../../src/report/narrative.js';
import { renderPlainReportHtml } from '../../src/report/plainReport.js';
import { renderReportHtml } from '../../src/report/render.js';
import { NARRATIVE_EGRESS_TEXT, renderBanner } from '../../src/report/shell.js';
import { FakeNarrativeModelClient } from '../support/fakeNarrativeModelClient.js';

async function buildHealthy(): Promise<ReportData> {
  const fixture = MOCK_ORG_FIXTURES.healthy;
  const adapter = new MockAdapter(fixture.orgId, fixture.data, fixture.capabilities);
  const secondSourceAdapter = fixture.secondSource
    ? new MockSecondSourceAdapter(fixture.secondSource.data, fixture.secondSource.capabilities)
    : undefined;
  return buildReportData(adapter, secondSourceAdapter, {
    orgLabel: fixture.label,
    orgDescription: fixture.description,
    asOf: fixture.asOf,
  });
}

describe('renderBanner', () => {
  it.each([
    ['live', false, 'LIVE DATA · read-only. Read from your Salesforce org; nothing else left this machine.'],
    ['live', true, `LIVE DATA · read-only. Read from your Salesforce org; ${NARRATIVE_EGRESS_TEXT}.`],
    ['fixture', false, 'MOCK DATA — fixture: Healthy. No real CRM was contacted; nothing leaves this machine.'],
    ['fixture', true, `MOCK DATA — fixture: Healthy. No real CRM was contacted; ${NARRATIVE_EGRESS_TEXT}.`],
  ] as const)('%s, narrative sent: %s', (mode, narrativeSent, text) => {
    expect(renderBanner(mode, 'Healthy', { narrativeSent })).toContain(`>${text}</div>`);
  });

  it('defaults to "nothing sent" when egress is not given', () => {
    expect(renderBanner('fixture', 'Healthy')).toBe(renderBanner('fixture', 'Healthy', { narrativeSent: false }));
    expect(renderBanner('live', 'x')).toBe(renderBanner('live', 'x', { narrativeSent: false }));
  });

  it('names Anthropic and says no record text was sent', () => {
    expect(NARRATIVE_EGRESS_TEXT).toContain('Anthropic');
    expect(NARRATIVE_EGRESS_TEXT).toContain('no record text');
  });
});

describe('both reports carry the run’s egress', () => {
  it('detailed report: a narrative result (ok or fallback) means sent; none means not sent', async () => {
    const data = await buildHealthy();
    const ok = await buildNarrative(data, FakeNarrativeModelClient.returning({ claims: [] }));
    const failed = await buildNarrative(data, FakeNarrativeModelClient.throwing(new Error('boom')));
    for (const mode of ['fixture', 'live'] as const) {
      expect(renderReportHtml(data, { mode, narrative: ok })).toContain(NARRATIVE_EGRESS_TEXT);
      expect(renderReportHtml(data, { mode, narrative: failed })).toContain(NARRATIVE_EGRESS_TEXT);
      expect(renderReportHtml(data, { mode })).not.toContain(NARRATIVE_EGRESS_TEXT);
    }
  });

  it('plain report: follows narrativeSent', async () => {
    const data = await buildHealthy();
    for (const mode of ['fixture', 'live'] as const) {
      expect(renderPlainReportHtml(data, { mode, narrativeSent: true })).toContain(NARRATIVE_EGRESS_TEXT);
      expect(renderPlainReportHtml(data, { mode, narrativeSent: false })).not.toContain(NARRATIVE_EGRESS_TEXT);
      expect(renderPlainReportHtml(data, { mode })).not.toContain(NARRATIVE_EGRESS_TEXT);
    }
  });
});

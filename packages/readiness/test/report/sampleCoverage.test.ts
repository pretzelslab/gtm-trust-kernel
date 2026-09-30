/**
 * The report's sample-coverage fields and notice: the scan reads the
 * population newest created first, so when it stops before reaching every
 * eligible open deal, the report must say older open deals were excluded.
 */

import { describe, expect, it } from 'vitest';
import { MockAdapter, MockSecondSourceAdapter } from '@gtm-trust-kernel/adapters/mock.js';
import { MOCK_ORG_FIXTURES } from '../../src/fixtures/mockOrgs.js';
import { buildReportData, type ReportData } from '../../src/report/buildReport.js';
import { buildNarrativePromptInput } from '../../src/report/narrativePromptInput.js';
import { renderPlainReportHtml } from '../../src/report/plainReport.js';
import { coverageNoticeText, renderReportHtml } from '../../src/report/render.js';

async function buildHealthy(maxRecordsToScan?: number): Promise<ReportData> {
  const fixture = MOCK_ORG_FIXTURES.healthy;
  const adapter = new MockAdapter(fixture.orgId, fixture.data, fixture.capabilities);
  const secondSourceAdapter = new MockSecondSourceAdapter(fixture.secondSource!.data, fixture.secondSource!.capabilities);
  return buildReportData(adapter, secondSourceAdapter, {
    orgLabel: fixture.label,
    orgDescription: fixture.description,
    asOf: fixture.asOf,
    ...(maxRecordsToScan ? { maxRecordsToScan } : {}),
  });
}

describe('sample coverage in the report', () => {
  it('reports the eligible population, and no exclusion when every open deal was scanned', async () => {
    const data = await buildHealthy();
    const open = MOCK_ORG_FIXTURES.healthy.data.opportunities.filter((o) => !o.isClosed).length;
    expect(data.org.eligibleOpportunities).toBeGreaterThanOrEqual(open);
    expect(data.org.olderOpenDealsExcluded).toBe(0);
    expect(coverageNoticeText(data)).toBeNull();
    expect(renderReportHtml(data)).not.toContain('older open deal');
  });

  it('says older open deals were excluded when the scan stopped first', async () => {
    const data = await buildHealthy(30);
    expect(data.org.recordsScanned).toBe(30);
    expect(data.org.stopReason).toBe('budget_exhausted');
    expect(data.org.olderOpenDealsExcluded).toBeGreaterThan(0);

    const text = coverageNoticeText(data)!;
    expect(text).toBe(
      `Scanned the 30 most recently created of ${data.org.eligibleOpportunities} eligible deals. ` +
        `${data.org.olderOpenDealsExcluded} older open deals were excluded, so this report describes newer deals.`,
    );
    expect(renderReportHtml(data)).toContain(text);
    expect(renderPlainReportHtml(data)).toContain(text);
  });

  it('keeps the population counts out of the narrative payload', async () => {
    const data = await buildHealthy(30);
    const input = buildNarrativePromptInput(data);
    expect('eligibleOpportunities' in input.org).toBe(false);
    expect('olderOpenDealsExcluded' in input.org).toBe(false);
  });
});

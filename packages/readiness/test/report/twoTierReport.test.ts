/**
 * The report's two tiers: list-field metrics over every scanned deal,
 * detailed checks over a seeded per-stratum sample drawn from the scan,
 * closed_deal_count_12m from the adapter's population count, and both sizes
 * (plus the seed) stated in the report.
 */

import { describe, expect, it } from 'vitest';
import { MockAdapter, MockSecondSourceAdapter } from '@gtm-trust-kernel/adapters/mock.js';
import { MOCK_ORG_FIXTURES, type FixtureName } from '../../src/fixtures/mockOrgs.js';
import { buildReportData, SCAN_TIER_METRICS, type BuildReportOptions, type ReportData } from '../../src/report/buildReport.js';
import { renderPlainReportHtml } from '../../src/report/plainReport.js';
import { coverageNoticeText, renderReportHtml, sampleSizeText } from '../../src/report/render.js';
import { buildNarrativePromptInput } from '../../src/report/narrativePromptInput.js';

async function build(name: FixtureName, options: Partial<BuildReportOptions> = {}): Promise<ReportData> {
  const fixture = MOCK_ORG_FIXTURES[name];
  const adapter = new MockAdapter(fixture.orgId, fixture.data, fixture.capabilities);
  const secondSource = fixture.secondSource
    ? new MockSecondSourceAdapter(fixture.secondSource.data, fixture.secondSource.capabilities)
    : undefined;
  return buildReportData(adapter, secondSource, {
    orgLabel: fixture.label,
    orgDescription: fixture.description,
    asOf: fixture.asOf,
    ...options,
  });
}

const row = (data: ReportData, metric: string) => data.metrics.find((m) => m.metric === metric)!;

describe('two-tier report', () => {
  it('puts exactly the list-field metrics on the scan tier', () => {
    expect([...SCAN_TIER_METRICS].sort()).toEqual(
      [
        'amount_fill_rate',
        'close_date_fill_rate',
        'closed_deal_count_12m',
        'contact_linkage_rate',
        'median_days_since_modified',
        'next_step_fill_rate',
        'owner_id_fill_rate',
        'past_due_close_date_rate',
        'round_amount_rate',
        'stage_mapping_coverage',
      ].sort(),
    );
  });

  it('computes scan-tier metrics over every scanned deal and detailed checks over the sample', async () => {
    const data = await build('volume', { hydratePerStratum: 5 });
    const closedInWindow = MOCK_ORG_FIXTURES.volume.data.opportunities.filter((o) => o.isClosed).length;
    expect(data.org.recordsScanned).toBe(data.org.eligibleOpportunities);
    expect(data.org.openSampleSize + data.org.closedSampleSize).toBeLessThanOrEqual(7 * 5);
    expect(row(data, 'stage_mapping_coverage').sampleSize).toBe(data.org.recordsScanned);
    expect(row(data, 'outcome_evidence_retention_rate').sampleSize).toBe(data.org.closedSampleSize);
    expect(row(data, 'closed_deal_count_12m').value).toBe(closedInWindow);
  });

  it('takes closed_deal_count_12m from the population count, even when the scan budget is hit', async () => {
    const data = await build('volume', { maxRecordsToScan: 30 });
    const closedInWindow = MOCK_ORG_FIXTURES.volume.data.opportunities.filter((o) => o.isClosed).length;
    expect(data.org.stopReason).toBe('budget_exhausted');
    expect(row(data, 'closed_deal_count_12m').value).toBe(closedInWindow);
    expect(row(data, 'closed_deal_count_12m').floor).toBe(false);
  });

  it('records the seed and per-stratum size, and states both tiers in both reports', async () => {
    const data = await build('healthy');
    expect(data.org.sampleSeed).toBe('report');
    expect(data.org.hydratePerStratum).toBe(20);
    const text = sampleSizeText(data);
    expect(text).toBe(
      `Scanned ${data.org.recordsScanned} of ${data.org.eligibleOpportunities} eligible deals; ` +
        `detailed checks on ${data.org.openSampleSize + data.org.closedSampleSize} sampled deals ` +
        `(up to 20 per stage, seed "report").`,
    );
    expect(renderReportHtml(data)).toContain('detailed checks on');
    expect(renderPlainReportHtml(data)).toContain('detailed checks on');
  });

  it('draws the same sample for the same seed', async () => {
    const [a, b] = await Promise.all([build('volume', { hydratePerStratum: 5 }), build('volume', { hydratePerStratum: 5 })]);
    expect(b.metrics.map((m) => m.value)).toEqual(a.metrics.map((m) => m.value));
  });

  it('shows the unread notice for a --quick early stop, and not for a full scan', async () => {
    const full = await build('volume', { hydratePerStratum: 5 });
    expect(full.org.eligibleDealsUnread).toBe(0);
    expect(coverageNoticeText(full)).toBeNull();

    const quick = await build('volume', { hydratePerStratum: 5, quick: true });
    expect(quick.org.stopReason).toBe('all_strata_full');
    expect(quick.org.eligibleDealsUnread).toBeGreaterThan(0);
    expect(coverageNoticeText(quick)).not.toBeNull();
  });

  it('shows the unread notice when only closed deals went unread', async () => {
    const base = await build('healthy');
    const data: ReportData = {
      ...base,
      org: { ...base.org, recordsScanned: base.org.eligibleOpportunities - 3, olderOpenDealsExcluded: 0, eligibleDealsUnread: 3 },
    };
    expect(coverageNoticeText(data)).toBe(
      `Scanned the ${data.org.recordsScanned} most recently created of ${data.org.eligibleOpportunities} eligible deals. ` +
        `The 3 oldest were not read, so this report describes newer deals.`,
    );
  });

  it('keeps the seed, per-stratum size and unread count out of the narrative payload', async () => {
    const input = buildNarrativePromptInput(await build('healthy'));
    for (const key of ['sampleSeed', 'hydratePerStratum', 'eligibleDealsUnread']) expect(key in input.org).toBe(false);
  });
});

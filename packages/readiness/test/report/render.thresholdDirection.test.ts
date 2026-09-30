import { describe, expect, it } from 'vitest';
import { MockAdapter, MockSecondSourceAdapter } from '@gtm-trust-kernel/adapters/mock.js';
import { MOCK_ORG_FIXTURES } from '../../src/fixtures/mockOrgs.js';
import { buildReportData, type MetricRow, type ReportData } from '../../src/report/buildReport.js';
import { renderReportHtml } from '../../src/report/render.js';
import { THRESHOLDS } from '../../src/rubric.js';

/**
 * The metrics table's threshold line must follow rubric.ts's `direction`.
 * It used to print `≥` for every metric, so a lower-is-better row read
 * "4.5 d · Viable · viable ≥ 7". Threshold values come from the report
 * data itself; none are restated here.
 */

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

function gradedRow(data: ReportData, metric: MetricRow['metric']): MetricRow {
  const row = data.metrics.find((r) => r.metric === metric);
  expect(row).toBeDefined();
  expect(row!.viableAt).not.toBeNull();
  expect(row!.degradedAt).not.toBeNull();
  return row!;
}

describe('render.ts threshold direction', () => {
  it('prints ≤ for a lower-is-better metric', async () => {
    expect(THRESHOLDS.median_days_since_modified.direction).toBe('lower_is_better');
    const data = await buildHealthy();
    const row = gradedRow(data, 'median_days_since_modified');
    const html = renderReportHtml(data);
    expect(html).toContain(`viable ≤ ${row.viableAt}, degraded ≤ ${row.degradedAt}`);
    expect(html).not.toContain(`viable ≥ ${row.viableAt}, degraded ≥ ${row.degradedAt}`);
  });

  it('still prints ≥ for a higher-is-better metric', async () => {
    expect(THRESHOLDS.close_date_fill_rate.direction).toBe('higher_is_better');
    const data = await buildHealthy();
    const row = gradedRow(data, 'close_date_fill_rate');
    const html = renderReportHtml(data);
    expect(html).toContain(`viable ≥ ${row.viableAt}, degraded ≥ ${row.degradedAt}`);
  });
});

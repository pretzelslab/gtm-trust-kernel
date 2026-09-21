import { describe, expect, it } from 'vitest';
import { MockAdapter } from '@gtm-trust-kernel/adapters/mock.js';
import { MOCK_ORG_FIXTURES, type FixtureName } from '../../src/fixtures/mockOrgs.js';
import { buildReportData, type ReportData } from '../../src/report/buildReport.js';
import { THRESHOLDS } from '../../src/rubric.js';

const D5_METRICS = [
  'contact_identity_resolution_rate',
  'account_resolution_rate',
  'activity_attribution_rate',
  'temporal_anomaly_rate',
] as const;

const D6_D7_METRICS = [
  'substantive_note_rate',
  'median_note_length_chars',
  'pii_density',
  'untrusted_text_ratio',
  'closed_deal_count_12m',
  'win_rate_dispersion',
  'outcome_evidence_retention_rate',
] as const;

async function buildFor(name: FixtureName): Promise<ReportData> {
  const fixture = MOCK_ORG_FIXTURES[name];
  const adapter = new MockAdapter(fixture.orgId, fixture.data, fixture.capabilities);
  return buildReportData(adapter, {
    orgLabel: fixture.label,
    orgDescription: fixture.description,
    asOf: fixture.asOf,
  });
}

describe('buildReportData shape', () => {
  it('produces exactly one metric row per MetricId in THRESHOLDS, each with a valid status and dimension', async () => {
    const data = await buildFor('healthy');
    const metricIds = Object.keys(THRESHOLDS);

    expect(data.metrics).toHaveLength(metricIds.length);
    expect(new Set(data.metrics.map((m) => m.metric))).toEqual(new Set(metricIds));

    for (const row of data.metrics) {
      expect(['ok', 'not_applicable', 'not_instrumented', 'deferred', 'not_implemented']).toContain(row.status);
      expect(row.dimension).toMatch(/^D[1-7]$/);
      expect(typeof row.dimensionLabel).toBe('string');
      expect(Array.isArray(row.gatesCapabilities)).toBe(true);
      // tier is only ever set alongside a computed, non-null value.
      if (row.tier !== null) {
        expect(row.status).toBe('ok');
        expect(row.value).not.toBeNull();
      }
    }
  });

  it('reports all 8 capabilities, each with a verdict and a non-negative blocker count', async () => {
    const data = await buildFor('healthy');
    expect(data.capabilities).toHaveLength(8);
    for (const c of data.capabilities) {
      expect(['viable', 'degraded', 'blocked']).toContain(c.verdict);
      expect(c.blockerCount).toBeGreaterThanOrEqual(0);
    }
  });

  it('shows the 2 explicit deferrals as status "deferred" with a reason', async () => {
    const data = await buildFor('healthy');
    for (const metric of ['close_date_history_enabled', 'median_next_step_age_days'] as const) {
      const row = data.metrics.find((m) => m.metric === metric)!;
      expect(row.status).toBe('deferred');
      expect(row.value).toBeNull();
      expect(row.note).toBeTruthy();
    }
  });

  it('shows all 4 D5 metrics as not_instrumented with "no second source connected"', async () => {
    const data = await buildFor('healthy');
    for (const metric of D5_METRICS) {
      const row = data.metrics.find((m) => m.metric === metric)!;
      expect(row.status).toBe('not_instrumented');
      expect(row.value).toBeNull();
      expect(row.note).toBe('no second source connected');
    }
  });

  it('shows the 7 D6/D7 metrics with no implementation as not_implemented', async () => {
    const data = await buildFor('healthy');
    for (const metric of D6_D7_METRICS) {
      const row = data.metrics.find((m) => m.metric === metric)!;
      expect(row.status).toBe('not_implemented');
      expect(row.value).toBeNull();
    }
  });

  it('org.metricStatusCounts sums to the full 28-metric roster', async () => {
    const data = await buildFor('healthy');
    const c = data.org.metricStatusCounts;
    const total = c.ok + c.not_applicable + c.not_instrumented + c.deferred + c.not_implemented;
    expect(total).toBe(Object.keys(THRESHOLDS).length);
    expect(data.metrics.length).toBe(total);
  });
});

describe('fixture differentiation (the 3 fixtures must not accidentally look identical)', () => {
  it('stage_history_months differs across all 3 fixtures: viable, "no entries yet", and gated off entirely', async () => {
    const [healthy, fresh, legacy] = await Promise.all([buildFor('healthy'), buildFor('fresh'), buildFor('legacy')]);
    const row = (d: ReportData) => d.metrics.find((m) => m.metric === 'stage_history_months')!;

    expect(row(healthy).status).toBe('ok');
    expect(row(healthy).tier).toBe('viable');

    expect(row(fresh).status).toBe('ok');
    expect(row(fresh).value).toBe(0);
    expect(row(fresh).note).toBe('history enabled, no entries yet');

    expect(row(legacy).status).toBe('not_instrumented');

    const statuses = new Set([row(healthy).status, row(fresh).status, row(legacy).status]);
    expect(statuses.size).toBeGreaterThan(1);
  });

  it('duplicate_account_rate differs between the clean fixtures and the messy one', async () => {
    const [healthy, legacy] = await Promise.all([buildFor('healthy'), buildFor('legacy')]);
    const row = (d: ReportData) => d.metrics.find((m) => m.metric === 'duplicate_account_rate')!;

    expect(row(healthy).value).toBe(0);
    expect(row(legacy).value).toBeGreaterThan(0);
  });

  it('legacy has a different, worse capability verdict distribution than healthy', async () => {
    const [healthy, legacy] = await Promise.all([buildFor('healthy'), buildFor('legacy')]);
    expect(legacy.org.capabilityVerdictCounts).not.toEqual(healthy.org.capabilityVerdictCounts);
    expect(legacy.org.capabilityVerdictCounts.blocked).toBeGreaterThanOrEqual(healthy.org.capabilityVerdictCounts.blocked);
  });
});

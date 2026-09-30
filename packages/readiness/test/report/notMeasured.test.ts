import { describe, expect, it } from 'vitest';
import { MockAdapter, MockSecondSourceAdapter } from '@gtm-trust-kernel/adapters/mock.js';
import { MOCK_ORG_FIXTURES } from '../../src/fixtures/mockOrgs.js';
import { buildReportData, gateVerdictOf, type ReportData } from '../../src/report/buildReport.js';
import { validateGrounding } from '../../src/report/narrativeGrounding.js';
import { renderPlainReportHtml } from '../../src/report/plainReport.js';
import { buildExecutiveSummary, buildFullNarrative } from '../../src/report/plainSummary.js';
import { renderReportHtml } from '../../src/report/render.js';
import { THRESHOLDS } from '../../src/rubric.js';

/**
 * The "Not measured" verdict end to end: a gate the tool can't see (here,
 * activity_capture_rate with the adapter's activitySync capability off)
 * makes its capabilities not_measured rather than blocked, and every report
 * surface says so. Built on the healthy fixture so the other gates are real
 * graded readings, not overrides.
 */
async function buildHealthyWithoutActivitySync(): Promise<ReportData> {
  const fixture = MOCK_ORG_FIXTURES.healthy;
  const adapter = new MockAdapter(fixture.orgId, fixture.data, { ...fixture.capabilities, activitySync: false });
  const secondSourceAdapter = fixture.secondSource
    ? new MockSecondSourceAdapter(fixture.secondSource.data, fixture.secondSource.capabilities)
    : undefined;
  return buildReportData(adapter, secondSourceAdapter, {
    orgLabel: fixture.label,
    orgDescription: fixture.description,
    asOf: fixture.asOf,
  });
}

/** Forces one gating metric of pipeline_risk_signals to degraded, keeping the not-measured gate. */
function withDegradedRiskGate(data: ReportData): ReportData {
  return {
    ...data,
    metrics: data.metrics.map((m) =>
      m.metric === 'median_days_since_modified'
        ? { ...m, status: 'ok' as const, tier: 'degraded' as const, value: THRESHOLDS.median_days_since_modified.degradedAt as number }
        : m,
    ),
  };
}

describe('not measured verdict', () => {
  it('marks capabilities gated on an unseen metric not_measured, not blocked', async () => {
    const data = await buildHealthyWithoutActivitySync();
    const row = data.metrics.find((m) => m.metric === 'activity_capture_rate')!;
    expect(row.status).toBe('not_instrumented');
    expect(gateVerdictOf(row)).toBe('not_measured');

    const risk = data.capabilities.find((c) => c.id === 'pipeline_risk_signals')!;
    expect(risk.verdict).toBe('not_measured');
    expect(data.org.capabilityVerdictCounts.not_measured).toBeGreaterThan(0);
  });

  it('keeps missing data (not_applicable) as blocked', () => {
    expect(
      gateVerdictOf({
        metric: 'substantive_note_rate',
        dimension: 'D6',
        dimensionLabel: '',
        status: 'not_applicable',
        value: null,
        sampleSize: 0,
        lowConfidence: false,
        note: null,
        tier: null,
        floor: false,
        unit: 'rate',
        viableAt: null,
        degradedAt: null,
        gatesCapabilities: [],
        notMeasured: false,
        fixHint: null,
      }),
    ).toBe('blocked');
  });

  it('grades D5 gates Blocked when no second source is connected (missing data, not unseen)', async () => {
    const fixture = MOCK_ORG_FIXTURES.healthy;
    const adapter = new MockAdapter(fixture.orgId, fixture.data, fixture.capabilities);
    const data = await buildReportData(adapter, undefined, {
      orgLabel: fixture.label,
      orgDescription: fixture.description,
      asOf: fixture.asOf,
    });
    const temporal = data.metrics.find((m) => m.metric === 'temporal_anomaly_rate')!;
    expect(temporal.status).toBe('not_instrumented');
    expect(temporal.notMeasured).toBe(false);
    expect(gateVerdictOf(temporal)).toBe('blocked');
    expect(data.capabilities.find((c) => c.id === 'autonomous_writeback')!.verdict).toBe('blocked');
  });

  it('grades D5 gates Not measured when a connected second source cannot supply the data', async () => {
    const fixture = MOCK_ORG_FIXTURES.healthy;
    const adapter = new MockAdapter(fixture.orgId, fixture.data, fixture.capabilities);
    const secondSource = fixture.secondSource!;
    const secondSourceAdapter = new MockSecondSourceAdapter(secondSource.data, {
      ...secondSource.capabilities,
      hasActivities: false,
    });
    const data = await buildReportData(adapter, secondSourceAdapter, {
      orgLabel: fixture.label,
      orgDescription: fixture.description,
      asOf: fixture.asOf,
    });
    const temporal = data.metrics.find((m) => m.metric === 'temporal_anomaly_rate')!;
    expect(temporal.status).toBe('not_instrumented');
    expect(temporal.notMeasured).toBe(true);
    expect(gateVerdictOf(temporal)).toBe('not_measured');
  });

  it('shows a Not measured pill and lists degraded gates under a not-measured capability', async () => {
    const data = withDegradedRiskGate(await buildHealthyWithoutActivitySync());
    const html = renderReportHtml(data);
    expect(html).toContain('>Not measured</span>');
    expect(html).toContain('activity_capture_rate (not measured)');
    expect(html).toContain('median_days_since_modified (degraded)');
    expect(html).toContain('viable / degraded / not measured / blocked');
  });

  it("puts a not-measured capability in the plain report's Can't tell yet list", async () => {
    const data = withDegradedRiskGate(await buildHealthyWithoutActivitySync());
    const narrative = buildFullNarrative(data);
    const risk = narrative.notMeasured.find((c) => c.label === 'Pipeline risk alerts');
    expect(risk).toBeDefined();
    expect(risk!.outcome).toContain("This scan can't see how activity is captured in your CRM");
    expect(risk!.outcome).toContain('Of the data it could see, some is thinner than ideal.');
    for (const bucket of [narrative.ready, narrative.caution, narrative.notMeasured, narrative.notReady]) {
      for (const c of bucket) {
        expect(c.outcome).not.toMatch(/\b(viable|degraded|blocked)\b/i);
      }
    }
    expect(renderPlainReportHtml(data)).toContain('Can&#39;t tell yet');
    expect(buildExecutiveSummary(data)).toContain("This scan can't see some of the data behind pipeline risk alerts");
  });

  it("names a blocked capability's reason from the gates it could see, ignoring not-measured ones", async () => {
    // pipeline_risk_signals: activity_capture_rate (D1) not measured, and
    // median_days_since_modified (D2) forced blocked. The only failing gate
    // the scan could see is D2, so the reason is "out of date", not the
    // neutral fallback a D1+D2 split would give.
    const base = await buildHealthyWithoutActivitySync();
    const data: ReportData = {
      ...base,
      metrics: base.metrics.map((m) =>
        m.metric === 'median_days_since_modified' ? { ...m, status: 'ok' as const, tier: 'blocked' as const } : m,
      ),
      capabilities: base.capabilities.map((c) => (c.id === 'pipeline_risk_signals' ? { ...c, verdict: 'blocked' as const } : c)),
    };
    const risk = buildFullNarrative(data).notReady.find((c) => c.label === 'Pipeline risk alerts')!;
    expect(risk.outcome).toContain('Right now, the data on hand is out of date.');
  });

  it("appends the adapter's setting hint when a setting would unlock the use case", async () => {
    const fixture = MOCK_ORG_FIXTURES.healthy;
    const hint = 'Set SF_ACTIVITY_CAPTURE=auto if your team logs activity automatically.';
    const adapter = new MockAdapter(fixture.orgId, fixture.data, {
      ...fixture.capabilities,
      activitySync: false,
      settingHints: { activitySync: hint },
    });
    const secondSourceAdapter = new MockSecondSourceAdapter(fixture.secondSource!.data, fixture.secondSource!.capabilities);
    const data = await buildReportData(adapter, secondSourceAdapter, {
      orgLabel: fixture.label,
      orgDescription: fixture.description,
      asOf: fixture.asOf,
    });
    expect(data.metrics.find((m) => m.metric === 'activity_capture_rate')!.fixHint).toBe(hint);
    const risk = buildFullNarrative(data).notMeasured.find((c) => c.label === 'Pipeline risk alerts')!;
    expect(risk.outcome.endsWith(hint)).toBe(true);
  });

  it('adds no hint when the adapter supplies none', async () => {
    const data = await buildHealthyWithoutActivitySync();
    expect(data.metrics.find((m) => m.metric === 'activity_capture_rate')!.fixHint).toBeNull();
    for (const c of buildFullNarrative(data).notMeasured) expect(c.outcome).not.toMatch(/Set |Turn on/);
  });

  it('keeps a not-measured autonomous write-back in the not-ready list (fail-safe)', async () => {
    const base = await buildHealthyWithoutActivitySync();
    const data: ReportData = {
      ...base,
      capabilities: base.capabilities.map((c) => (c.id === 'autonomous_writeback' ? { ...c, verdict: 'not_measured' as const } : c)),
    };
    const narrative = buildFullNarrative(data);
    const label = 'Fully automatic CRM updates with no human check';
    expect(narrative.notReady.some((c) => c.label === label)).toBe(true);
    expect(narrative.notMeasured.some((c) => c.label === label)).toBe(false);
  });

  it('grounds "not measured" only against a not-measured capability', async () => {
    const data = await buildHealthyWithoutActivitySync();
    const notMeasured = data.capabilities.find((c) => c.verdict === 'not_measured')!;
    const other = data.capabilities.find((c) => c.verdict !== 'not_measured')!;
    expect(validateGrounding([{ text: 'This capability is not measured.', groundedIn: [notMeasured.id] }], data).ok).toBe(true);
    expect(validateGrounding([{ text: 'This capability is not measured.', groundedIn: [other.id] }], data).ok).toBe(false);
    expect(validateGrounding([{ text: 'This capability is blocked.', groundedIn: [notMeasured.id] }], data).ok).toBe(false);
  });
});

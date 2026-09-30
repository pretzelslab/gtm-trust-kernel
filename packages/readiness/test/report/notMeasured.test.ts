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
      }),
    ).toBe('blocked');
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

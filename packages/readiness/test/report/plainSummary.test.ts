import { describe, expect, it } from 'vitest';
import { MockAdapter, MockSecondSourceAdapter } from '@gtm-trust-kernel/adapters/mock.js';
import { MOCK_ORG_FIXTURES, type FixtureName } from '../../src/fixtures/mockOrgs.js';
import { buildReportData, type ReportCapabilityRow, type ReportData } from '../../src/report/buildReport.js';
import { PLAIN_CAPABILITY, buildExecutiveSummary, buildFullNarrative } from '../../src/report/plainSummary.js';
import { THRESHOLDS, type MetricId, type Verdict } from '../../src/rubric.js';

const METRIC_IDS = Object.keys(THRESHOLDS);
const TIER_WORDS = [/\bviable\b/i, /\bdegraded\b/i, /\bblocked\b/i];

/**
 * Synthetic override, not a real fixture outcome: forces exactly 2 blocked
 * capabilities (close_date_realism via D4 only, forecast_assistance via D7
 * only — two distinct single-dimension reasons) on top of a real ReportData
 * used only for shape (org/generatedAt/every other field). Deliberately
 * decoupled from any real metric's computed value — in particular
 * win_rate_dispersion's, once it ships — so these two "2-of-2 split"
 * tie-break tests keep exercising that logic regardless of what any real
 * fixture's real numbers happen to grade to on a given day.
 */
const TWO_BLOCKED_TIER_OVERRIDES: Readonly<Partial<Record<MetricId, Verdict>>> = {
  close_date_fill_rate: 'viable',
  past_due_close_date_rate: 'viable',
  close_date_history_enabled: 'blocked',
  stage_mapping_coverage: 'viable',
  win_rate_dispersion: 'blocked',
  closed_deal_count_12m: 'viable',
  amount_fill_rate: 'viable',
};

function twoBlockedDifferentReasonsFixture(base: ReportData): ReportData {
  const metrics = base.metrics.map((m) => {
    const tier = TWO_BLOCKED_TIER_OVERRIDES[m.metric];
    return tier ? { ...m, status: 'ok' as const, tier } : m;
  });
  // autonomous_writeback stays degraded, not folded into "everything else
  // viable" — its fail-safe is excluded from aggregateReason's own
  // majority count regardless (see plainSummary.ts's genuine/writebackFailSafe
  // split), but the second test below still needs a real degraded fail-safe
  // to exercise, matching its own guard.
  const capabilities = base.capabilities.map((c): ReportCapabilityRow => {
    if (c.id === 'close_date_realism' || c.id === 'forecast_assistance') return { ...c, verdict: 'blocked' };
    if (c.id === 'autonomous_writeback') return { ...c, verdict: 'degraded' };
    return { ...c, verdict: 'viable' };
  });
  return { ...base, metrics, capabilities };
}

function assertNoJargon(text: string): void {
  for (const pattern of TIER_WORDS) {
    expect(text).not.toMatch(pattern);
  }
  for (const metricId of METRIC_IDS) {
    expect(text).not.toContain(metricId);
  }
}

function sentencesOf(text: string): string[] {
  return text.split(/(?<=[.!?])\s+/);
}

async function buildFixture(name: FixtureName): Promise<ReportData> {
  const fixture = MOCK_ORG_FIXTURES[name];
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

describe('buildExecutiveSummary', () => {
  it('contains no tier labels or metric ids (mixed fixture: healthy)', async () => {
    const data = await buildFixture('healthy');
    assertNoJargon(buildExecutiveSummary(data));
  });

  it('is deterministic: same input produces the same output', async () => {
    const data = await buildFixture('healthy');
    expect(buildExecutiveSummary(data)).toBe(buildExecutiveSummary(data));
  });

  it('produces 3-6 sentences and hits 6 for a fully mixed set (healthy: viable + degraded + blocked all present)', async () => {
    const data = await buildFixture('healthy');
    expect(data.org.capabilityVerdictCounts.viable).toBeGreaterThan(0);
    expect(data.org.capabilityVerdictCounts.degraded).toBeGreaterThan(0);
    expect(data.org.capabilityVerdictCounts.blocked).toBeGreaterThan(0);
    const summary = buildExecutiveSummary(data);
    assertNoJargon(summary);
    const count = sentencesOf(summary).length;
    expect(count).toBeGreaterThanOrEqual(3);
    expect(count).toBeLessThanOrEqual(6);
    expect(count).toBe(6); // ready(1) + caution(2 sentences) + not-ready(1) + closing(2)
  });

  it('produces 3 sentences when no capability is ready (legacy: all blocked)', async () => {
    const data = await buildFixture('legacy');
    expect(data.org.capabilityVerdictCounts.viable).toBe(0);
    expect(data.org.capabilityVerdictCounts.degraded).toBe(0);
    const summary = buildExecutiveSummary(data);
    assertNoJargon(summary);
    expect(sentencesOf(summary).length).toBe(3);
  });

  it('produces 3 sentences when every capability is ready (synthetic all-viable)', async () => {
    const base = await buildFixture('legacy');
    const allViable: ReportData = {
      ...base,
      capabilities: base.capabilities.map((c) => ({ ...c, verdict: 'viable' as const })),
    };
    const summary = buildExecutiveSummary(allViable);
    assertNoJargon(summary);
    expect(sentencesOf(summary).length).toBe(3);
  });

  it('produces 4 sentences for exactly two populated buckets (synthetic: ready + not-ready, no caution)', async () => {
    const base = await buildFixture('healthy');
    const twoBucket: ReportData = {
      ...base,
      capabilities: base.capabilities.map((c) => ({
        ...c,
        verdict: c.verdict === 'degraded' ? ('blocked' as const) : c.verdict,
      })),
    };
    expect(twoBucket.capabilities.some((c) => c.verdict === 'degraded')).toBe(false);
    expect(twoBucket.capabilities.some((c) => c.verdict === 'viable')).toBe(true);
    expect(twoBucket.capabilities.some((c) => c.verdict === 'blocked')).toBe(true);
    const summary = buildExecutiveSummary(twoBucket);
    assertNoJargon(summary);
    expect(sentencesOf(summary).length).toBe(4);
  });

  it('never places a degraded, non-writeback capability in the not-ready sentence', async () => {
    const data = await buildFixture('healthy');
    // autonomous_writeback is the one deliberate exception (the fail-safe) — excluded here,
    // covered separately below.
    const degraded = data.capabilities.filter((c) => c.verdict === 'degraded' && c.id !== 'autonomous_writeback');
    expect(degraded.length).toBeGreaterThan(0); // guard: this test is only meaningful if healthy still has degraded capabilities

    const summary = buildExecutiveSummary(data);
    const notReadySentence = sentencesOf(summary).find((s) => s.includes('not ready yet')) ?? '';
    expect(notReadySentence).not.toBe('');
    for (const c of degraded) {
      expect(notReadySentence).not.toContain(PLAIN_CAPABILITY[c.id]);
    }

    // The caution sentence should be the one carrying each degraded capability's phrase instead.
    for (const c of degraded) {
      expect(summary).toContain(PLAIN_CAPABILITY[c.id]);
    }
  });

  it('a degraded autonomous_writeback is bucketed as not-ready (fail-safe), never ready or caution', async () => {
    const data = await buildFixture('healthy');
    const writeback = data.capabilities.find((c) => c.id === 'autonomous_writeback');
    expect(writeback?.verdict).toBe('degraded'); // guard: this test is only meaningful if healthy still grades it degraded

    const narrative = buildFullNarrative(data);
    const expectedLabel = 'Fully automatic CRM updates with no human check';
    expect(narrative.ready.some((c) => c.label === expectedLabel)).toBe(false);
    expect(narrative.caution.some((c) => c.label === expectedLabel)).toBe(false);
    const entry = narrative.notReady.find((c) => c.label === expectedLabel);
    expect(entry).toBeDefined();
    expect(entry!.outcome).toContain('AI should not write to the CRM without a person checking every change yet.');

    // Same override applies to the executive summary: the phrase must not appear in the caution sentence.
    const summary = buildExecutiveSummary(data);
    const cautionSentence = sentencesOf(summary).find((s) => s.includes('treat the output with caution')) ?? '';
    expect(cautionSentence).not.toContain(PLAIN_CAPABILITY.autonomous_writeback);
  });

  it('a 2-of-2 not-ready split with different reasons falls back to neutral wording (no arbitrary tie-break)', async () => {
    const base = await buildFixture('healthy');
    const synthetic = twoBlockedDifferentReasonsFixture(base);
    const notReadyIds = synthetic.capabilities.filter((c) => c.verdict === 'blocked').map((c) => c.id);
    // guard: confirms the synthetic override actually produced the intended
    // 2-of-2 split with genuinely different reasons (D4 vs D7) before
    // asserting on the tie-break behavior that depends on it.
    expect(notReadyIds.sort()).toEqual(['close_date_realism', 'forecast_assistance']);

    const summary = buildExecutiveSummary(synthetic);
    const notReadySentence = sentencesOf(summary).find((s) => s.includes('not ready yet')) ?? '';
    expect(notReadySentence.startsWith("The data doesn't meet the quality bar")).toBe(true);
    expect(notReadySentence).not.toMatch(/^Not enough history/);
    expect(notReadySentence).not.toMatch(/^Not enough closed-deal/);
  });

  it('does not tie the writeback fail-safe clause to a data-quality reason (synthetic: 2-of-2 blocked, different reasons)', async () => {
    const base = await buildFixture('healthy');
    const synthetic = twoBlockedDifferentReasonsFixture(base);
    const writeback = synthetic.capabilities.find((c) => c.id === 'autonomous_writeback');
    expect(writeback?.verdict).toBe('degraded'); // guard: the synthetic override sets this explicitly

    const summary = buildExecutiveSummary(synthetic);
    const writebackClause = 'fully automatic CRM updates stay off until a person checks every change';
    const notReadySentence = sentencesOf(summary).find((s) => s.includes(writebackClause)) ?? '';
    expect(notReadySentence).not.toBe('');

    // Everything from the writeback clause onward must be exactly that fixed clause, carrying no
    // data-quality vocabulary — it must never be presented as caused by a data problem.
    const clauseOnward = notReadySentence.slice(notReadySentence.indexOf(writebackClause)).toLowerCase();
    expect(clauseOnward).not.toContain('quality');
    expect(clauseOnward).not.toContain('history');
    expect(clauseOnward).not.toContain('closed-deal');
    expect(clauseOnward).not.toContain('data');

    // It also must not be counted into the aggregate reason's majority: the synthetic fixture's two
    // genuinely blocked capabilities (close_date_realism, forecast_assistance) split 1-1 on reason
    // (D4 vs D7), which is not a majority of 2 — so the sentence must lead with neutral wording, not
    // either specific one.
    expect(notReadySentence.startsWith("The data doesn't meet the quality bar")).toBe(true);
  });

  it('collapses the wording when a bucket contains every capability', async () => {
    const legacyData = await buildFixture('legacy');
    const total = legacyData.capabilities.length;
    expect(legacyData.capabilities.every((c) => c.verdict === 'blocked')).toBe(true); // guard

    const noneReadySummary = buildExecutiveSummary(legacyData);
    expect(noneReadySummary).toContain(`None of the ${total} AI-assisted sales tools are ready yet.`);

    const allViable: ReportData = {
      ...legacyData,
      capabilities: legacyData.capabilities.map((c) => ({ ...c, verdict: 'viable' as const })),
    };
    const allReadySummary = buildExecutiveSummary(allViable);
    expect(allReadySummary).toContain(`The data can support all ${total} AI-assisted sales tools.`);
  });

  it("all-ready output doesn't contradict itself (no approval-needed language)", async () => {
    const base = await buildFixture('legacy');
    const allViable: ReportData = {
      ...base,
      capabilities: base.capabilities.map((c) => ({ ...c, verdict: 'viable' as const })),
    };
    const summary = buildExecutiveSummary(allViable);
    expect(summary.toLowerCase()).not.toContain('approve');
    expect(summary).toContain("This report only reads your CRM data. It doesn't change anything.");
  });
});

describe('buildFullNarrative', () => {
  it('buckets every capability into exactly one of ready/caution/notReady, all jargon-free', async () => {
    const data = await buildFixture('healthy');
    const narrative = buildFullNarrative(data);
    const total = narrative.ready.length + narrative.caution.length + narrative.notReady.length;
    expect(total).toBe(data.capabilities.length);

    for (const bucket of [narrative.ready, narrative.caution, narrative.notReady]) {
      for (const c of bucket) {
        expect(c.outcome.length).toBeGreaterThan(0);
        assertNoJargon(c.outcome);
        assertNoJargon(c.label);
      }
    }
  });

  it('sentence-cases every capability label', async () => {
    const data = await buildFixture('healthy');
    const narrative = buildFullNarrative(data);
    const allLabels = [...narrative.ready, ...narrative.caution, ...narrative.notReady].map((c) => c.label);
    expect(allLabels.length).toBeGreaterThan(0);
    for (const label of allLabels) {
      expect(label.charAt(0)).toBe(label.charAt(0).toUpperCase());
    }
  });

  it('is deterministic: same input produces the same output', async () => {
    const data = await buildFixture('healthy');
    expect(buildFullNarrative(data)).toEqual(buildFullNarrative(data));
  });

  it('gives every capability a distinct plain-language label', async () => {
    const data = await buildFixture('healthy');
    const narrative = buildFullNarrative(data);
    const labels = [...narrative.ready, ...narrative.caution, ...narrative.notReady].map((c) => c.label);
    expect(new Set(labels).size).toBe(labels.length);
  });
});

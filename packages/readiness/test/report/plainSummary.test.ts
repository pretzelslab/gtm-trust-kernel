import { describe, expect, it } from 'vitest';
import { MockAdapter, MockSecondSourceAdapter } from '@gtm-trust-kernel/adapters/mock.js';
import { MOCK_ORG_FIXTURES, type FixtureName } from '../../src/fixtures/mockOrgs.js';
import { buildReportData, type ReportData } from '../../src/report/buildReport.js';
import { PLAIN_CAPABILITY, buildExecutiveSummary, buildFullNarrative } from '../../src/report/plainSummary.js';
import { THRESHOLDS } from '../../src/rubric.js';

const METRIC_IDS = Object.keys(THRESHOLDS);
const TIER_WORDS = [/\bviable\b/i, /\bdegraded\b/i, /\bblocked\b/i];

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

  it('produces 3-5 sentences and hits 5 for a fully mixed set (healthy: viable + degraded + blocked all present)', async () => {
    const data = await buildFixture('healthy');
    expect(data.org.capabilityVerdictCounts.viable).toBeGreaterThan(0);
    expect(data.org.capabilityVerdictCounts.degraded).toBeGreaterThan(0);
    expect(data.org.capabilityVerdictCounts.blocked).toBeGreaterThan(0);
    const summary = buildExecutiveSummary(data);
    assertNoJargon(summary);
    const count = sentencesOf(summary).length;
    expect(count).toBeGreaterThanOrEqual(3);
    expect(count).toBeLessThanOrEqual(5);
    expect(count).toBe(5); // ready + caution + not-ready + closing (2 sentences)
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

  it('never places a degraded capability in the not-ready sentence', async () => {
    const data = await buildFixture('healthy');
    const degraded = data.capabilities.filter((c) => c.verdict === 'degraded');
    expect(degraded.length).toBeGreaterThan(0); // guard: this test is only meaningful if healthy still has degraded capabilities

    const summary = buildExecutiveSummary(data);
    const notReadySentence = sentencesOf(summary).find((s) => s.includes('not ready yet')) ?? '';
    expect(notReadySentence).not.toBe('');
    for (const c of degraded) {
      expect(notReadySentence).not.toContain(PLAIN_CAPABILITY[c.id]);
    }

    // The caution sentence (the one that isn't the not-ready sentence and isn't the closing/opening)
    // should be the one carrying each degraded capability's phrase instead.
    for (const c of degraded) {
      expect(summary).toContain(PLAIN_CAPABILITY[c.id]);
    }
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

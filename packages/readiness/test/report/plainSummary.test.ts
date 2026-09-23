import { describe, expect, it } from 'vitest';
import { MockAdapter, MockSecondSourceAdapter } from '@gtm-trust-kernel/adapters/mock.js';
import { MOCK_ORG_FIXTURES, type FixtureName } from '../../src/fixtures/mockOrgs.js';
import { buildReportData, type ReportData } from '../../src/report/buildReport.js';
import { buildExecutiveSummary, buildFullNarrative } from '../../src/report/plainSummary.js';
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

function countSentences(text: string): number {
  return (text.match(/[.!?](?:\s|$)/g) ?? []).length;
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

  it('produces 4 sentences for a mixed capability set (healthy: viable + degraded + blocked all present)', async () => {
    const data = await buildFixture('healthy');
    expect(data.org.capabilityVerdictCounts.viable).toBeGreaterThan(0);
    expect(data.org.capabilityVerdictCounts.degraded + data.org.capabilityVerdictCounts.blocked).toBeGreaterThan(0);
    const summary = buildExecutiveSummary(data);
    assertNoJargon(summary);
    expect(countSentences(summary)).toBe(4);
  });

  it('produces 3 sentences when no capability is ready (legacy: all blocked)', async () => {
    const data = await buildFixture('legacy');
    expect(data.org.capabilityVerdictCounts.viable).toBe(0);
    const summary = buildExecutiveSummary(data);
    assertNoJargon(summary);
    expect(countSentences(summary)).toBe(3);
  });

  it('produces 3 sentences when every capability is ready (synthetic all-viable)', async () => {
    const base = await buildFixture('legacy');
    const allViable: ReportData = {
      ...base,
      capabilities: base.capabilities.map((c) => ({ ...c, verdict: 'viable' as const })),
    };
    const summary = buildExecutiveSummary(allViable);
    assertNoJargon(summary);
    expect(countSentences(summary)).toBe(3);
  });
});

describe('buildFullNarrative', () => {
  it('has one non-empty, jargon-free outcome per capability', async () => {
    const data = await buildFixture('healthy');
    const narrative = buildFullNarrative(data);
    expect(narrative.capabilityOutcomes).toHaveLength(data.capabilities.length);
    for (const c of narrative.capabilityOutcomes) {
      expect(c.outcome.length).toBeGreaterThan(0);
      assertNoJargon(c.outcome);
      assertNoJargon(c.label);
    }
  });

  it('is deterministic: same input produces the same output', async () => {
    const data = await buildFixture('healthy');
    expect(buildFullNarrative(data)).toEqual(buildFullNarrative(data));
  });

  it('gives every capability a distinct plain-language label', async () => {
    const data = await buildFixture('healthy');
    const narrative = buildFullNarrative(data);
    const labels = narrative.capabilityOutcomes.map((c) => c.label);
    expect(new Set(labels).size).toBe(labels.length);
  });
});

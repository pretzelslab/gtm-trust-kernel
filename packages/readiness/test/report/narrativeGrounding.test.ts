import { describe, expect, it } from 'vitest';
import { MockAdapter, MockSecondSourceAdapter } from '@gtm-trust-kernel/adapters/mock.js';
import { MOCK_ORG_FIXTURES, type FixtureName } from '../../src/fixtures/mockOrgs.js';
import { buildReportData, type MetricRow, type ReportData } from '../../src/report/buildReport.js';
import { validateGrounding } from '../../src/report/narrativeGrounding.js';
import type { NarrativeClaim } from '../../src/report/narrativeTypes.js';

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

/** A metric row from a real fixture whose value/unit/tier this test can build claim text against, rather than hand-inventing numbers that could drift from rubric.ts. */
function findRow(data: ReportData, predicate: (row: MetricRow) => boolean): MetricRow {
  const row = data.metrics.find(predicate);
  if (!row) throw new Error('expected fixture to contain a matching metric row for this test');
  return row;
}

describe('validateGrounding', () => {
  it('passes a claim that correctly cites an existing metric id with a matching percent value', async () => {
    const data = await buildFixture('healthy');
    const row = findRow(data, (r) => r.unit === 'rate' && r.value !== null && r.tier !== null);
    const percent = (row.value! * 100).toFixed(1);
    const claim: NarrativeClaim = {
      text: `${row.metric} sits at ${percent}%, a ${row.tier} reading.`,
      groundedIn: [row.metric],
    };

    const result = validateGrounding([claim], data);

    expect(result).toEqual({ ok: true, failures: [] });
  });

  it('passes a claim citing a capability id whose tier word matches its verdict', async () => {
    const data = await buildFixture('healthy');
    const capability = data.capabilities[0]!;
    const claim: NarrativeClaim = {
      text: `${capability.label} is currently ${capability.verdict}.`,
      groundedIn: [capability.id],
    };

    const result = validateGrounding([claim], data);

    expect(result).toEqual({ ok: true, failures: [] });
  });

  it('fails a claim with no groundedIn ids at all', async () => {
    const data = await buildFixture('healthy');
    const claim: NarrativeClaim = { text: 'Pipeline hygiene looks fine overall.', groundedIn: [] };

    const result = validateGrounding([claim], data);

    expect(result.ok).toBe(false);
    expect(result.failures).toEqual([{ claimIndex: 0, reason: 'claim cites no metric or capability id' }]);
  });

  it('fails a claim citing an id that does not exist in this report', async () => {
    const data = await buildFixture('healthy');
    const claim: NarrativeClaim = { text: 'Something about a metric that is not real.', groundedIn: ['not_a_real_metric_id' as never] };

    const result = validateGrounding([claim], data);

    expect(result.ok).toBe(false);
    expect(result.failures).toEqual([{ claimIndex: 0, reason: 'cited id "not_a_real_metric_id" does not exist in this report' }]);
  });

  it('fails a claim whose stated percentage is just outside the +/-0.5pp tolerance', async () => {
    const data = await buildFixture('healthy');
    const row = findRow(data, (r) => r.unit === 'rate' && r.value !== null);
    const offPercent = (row.value! * 100 + 0.51).toFixed(2);
    const claim: NarrativeClaim = { text: `${row.metric} reads ${offPercent}%.`, groundedIn: [row.metric] };

    const result = validateGrounding([claim], data);

    expect(result.ok).toBe(false);
    expect(result.failures[0]!.reason).toContain("doesn't match");
  });

  it('passes a claim whose stated percentage is exactly at the +/-0.5pp boundary', async () => {
    const data = await buildFixture('healthy');
    const row = findRow(data, (r) => r.unit === 'rate' && r.value !== null);
    const boundaryPercent = (row.value! * 100 + 0.5).toFixed(2);
    const claim: NarrativeClaim = { text: `${row.metric} reads ${boundaryPercent}%.`, groundedIn: [row.metric] };

    const result = validateGrounding([claim], data);

    expect(result).toEqual({ ok: true, failures: [] });
  });

  it('accepts a bare fraction as equivalent to its percent (0.xx == xx%)', async () => {
    const data = await buildFixture('healthy');
    const row = findRow(data, (r) => r.unit === 'rate' && r.value !== null && r.value > 0 && r.value < 1);
    const claim: NarrativeClaim = { text: `${row.metric} reads ${row.value!.toFixed(3)} on a 0-1 scale.`, groundedIn: [row.metric] };

    const result = validateGrounding([claim], data);

    expect(result).toEqual({ ok: true, failures: [] });
  });

  it('fails a claim citing a non-percent metric with a mismatched number', async () => {
    const data = await buildFixture('healthy');
    const row = findRow(data, (r) => r.unit === 'count' && r.value !== null);
    const claim: NarrativeClaim = { text: `${row.metric} came in at ${row.value! + 1}.`, groundedIn: [row.metric] };

    const result = validateGrounding([claim], data);

    expect(result.ok).toBe(false);
    expect(result.failures[0]!.reason).toContain("doesn't match");
  });

  it('passes a claim with no numeric content beyond a valid id citation (nothing to cross-check)', async () => {
    const data = await buildFixture('healthy');
    const row = findRow(data, (r) => r.value !== null);
    const claim: NarrativeClaim = { text: `${row.metric} was computed for this org.`, groundedIn: [row.metric] };

    const result = validateGrounding([claim], data);

    expect(result).toEqual({ ok: true, failures: [] });
  });

  it('fails a claim using a tier word that mismatches the cited metric\'s actual tier', async () => {
    const data = await buildFixture('healthy');
    const row = findRow(data, (r) => r.tier === 'degraded');
    const claim: NarrativeClaim = { text: `${row.metric} is viable.`, groundedIn: [row.metric] };

    const result = validateGrounding([claim], data);

    expect(result.ok).toBe(false);
    expect(result.failures[0]!.reason).toContain('tier word "viable"');
  });

  it('treats "not ready" as the blocked tier word, distinct from the "ready" it contains', async () => {
    const data = await buildFixture('healthy');
    const row = findRow(data, (r) => r.tier === 'viable');
    const claim: NarrativeClaim = { text: `${row.metric} is not ready yet.`, groundedIn: [row.metric] };

    const result = validateGrounding([claim], data);

    expect(result.ok).toBe(false);
    expect(result.failures[0]!.reason).toContain('tier word "not ready"');
    // "ready" itself must not also be reported as a second, separate mismatch on the consumed span.
    expect(result.failures).toHaveLength(1);
  });

  it('passes a "not ready" claim when the cited metric really is blocked', async () => {
    const data = await buildFixture('legacy');
    const row = findRow(data, (r) => r.tier === 'blocked');
    const claim: NarrativeClaim = { text: `${row.metric} is not ready.`, groundedIn: [row.metric] };

    const result = validateGrounding([claim], data);

    expect(result).toEqual({ ok: true, failures: [] });
  });

  it('fails a claim citing only a bool-unit metric when the text contains a number (unmatched-number rule: bool metrics have no matchable value)', async () => {
    const data = await buildFixture('healthy');
    const row = findRow(data, (r) => r.unit === 'bool' && r.tier !== null);
    const claim: NarrativeClaim = { text: `${row.metric} is ${row.tier}, across 42 sampled records.`, groundedIn: [row.metric] };

    const result = validateGrounding([claim], data);

    expect(result.ok).toBe(false);
    expect(result.failures[0]!.reason).toContain("claim's number doesn't match any cited metric's value");
  });

  it('passes a claim citing a bool-unit metric when the text has no number at all', async () => {
    const data = await buildFixture('healthy');
    const row = findRow(data, (r) => r.unit === 'bool' && r.tier !== null);
    const claim: NarrativeClaim = { text: `${row.metric} is ${row.tier}.`, groundedIn: [row.metric] };

    const result = validateGrounding([claim], data);

    expect(result).toEqual({ ok: true, failures: [] });
  });

  it('fails a claim citing only a capability id when the text contains a number (no metric cited to match it against)', async () => {
    const data = await buildFixture('healthy');
    const capability = data.capabilities[0]!;
    const claim: NarrativeClaim = { text: `${capability.label} affects 2 of 8 dimensions.`, groundedIn: [capability.id] };

    const result = validateGrounding([claim], data);

    expect(result.ok).toBe(false);
    expect(result.failures[0]!.reason).toContain("claim's number doesn't match any cited metric's value");
  });

  it('passes a claim citing both a capability and a metric when the number matches the cited metric (at least one match is enough)', async () => {
    const data = await buildFixture('healthy');
    const capability = data.capabilities[0]!;
    const row = findRow(data, (r) => r.unit === 'count' && r.value !== null);
    const claim: NarrativeClaim = {
      text: `${capability.label} is affected by ${row.metric}, which came in at ${row.value}.`,
      groundedIn: [capability.id, row.metric],
    };

    const result = validateGrounding([claim], data);

    expect(result).toEqual({ ok: true, failures: [] });
  });

  it('reports one failure per offending claim across multiple claims, preserving claimIndex', async () => {
    const data = await buildFixture('healthy');
    const goodRow = findRow(data, (r) => r.value !== null);
    const claims: NarrativeClaim[] = [
      { text: `${goodRow.metric} was computed.`, groundedIn: [goodRow.metric] },
      { text: 'Unsupported claim.', groundedIn: [] },
    ];

    const result = validateGrounding(claims, data);

    expect(result.ok).toBe(false);
    expect(result.failures).toEqual([{ claimIndex: 1, reason: 'claim cites no metric or capability id' }]);
  });
});

import { describe, expect, it } from 'vitest';
import { MockAdapter, type MockOrgData } from '@gtm-trust-kernel/adapters/mock.js';
import type { CanonicalStage, Opportunity, RecordRef } from '@gtm-trust-kernel/adapters/model/canonical.js';
import { CANONICAL_STAGE_ORDER } from '@gtm-trust-kernel/adapters/model/canonical.js';
import {
  CLOSED_WINDOW_MONTHS,
  classifyStratum,
  formatSamplePlan,
  planSample,
  runSample,
  type SampleConfig,
} from '../src/sample.js';

const ORG = 'org-sample-test';
const ASOF = new Date('2026-06-15T00:00:00.000Z');

function ref(objectType: RecordRef['objectType'], id: string): RecordRef {
  return { crm: 'mock', orgId: ORG, objectType, id };
}

function isoDaysBeforeAsOf(days: number): string {
  return new Date(ASOF.getTime() - days * 86_400_000).toISOString();
}

function makeOpenOpportunity(stage: CanonicalStage, id: string, order: number): Opportunity {
  return {
    ref: ref('opportunity', id),
    accountRef: ref('account', 'acc-1'),
    name: `${stage} ${id}`,
    stage,
    stageConfidence: 'mapped',
    vendorStageLabel: stage,
    isClosed: false,
    contactLinks: [],
    createdAt: isoDaysBeforeAsOf(400),
    modifiedAt: isoDaysBeforeAsOf(400 - order),
    concurrencyToken: `tok-${id}`,
  };
}

function makeClosedOpportunity(
  stage: 'closed_won' | 'closed_lost',
  id: string,
  order: number,
  closeDateIso: string,
): Opportunity {
  return {
    ref: ref('opportunity', id),
    accountRef: ref('account', 'acc-1'),
    name: `${stage} ${id}`,
    stage,
    stageConfidence: 'mapped',
    vendorStageLabel: stage,
    isClosed: true,
    isWon: stage === 'closed_won',
    closeDate: closeDateIso,
    contactLinks: [],
    createdAt: closeDateIso,
    modifiedAt: isoDaysBeforeAsOf(400 - order),
    concurrencyToken: `tok-${id}`,
  };
}

/** perStratum opportunities in each of the 5 open stages plus closed_won and closed_lost, all closed deals well inside the 12-month window. */
function buildOrgData(perStratum: number): MockOrgData {
  const opportunities: Opportunity[] = [];
  let order = 0;

  for (const stage of CANONICAL_STAGE_ORDER) {
    for (let i = 0; i < perStratum; i++) {
      order += 1;
      opportunities.push(makeOpenOpportunity(stage, `${stage}-${i}`, order));
    }
  }

  for (const stage of ['closed_won', 'closed_lost'] as const) {
    for (let i = 0; i < perStratum; i++) {
      order += 1;
      opportunities.push(makeClosedOpportunity(stage, `${stage}-${i}`, order, isoDaysBeforeAsOf(60 + i)));
    }
  }

  return {
    accounts: [],
    opportunities,
    contacts: [],
    activities: [],
    notes: [],
    stageHistory: [],
    ownerChanges: [],
    nextStepChanges: [],
  };
}

const baseConfig = {
  perStratumSampleSize: 3,
  maxRecordsToScan: 1_000,
  pageSizeBulk: 2_000,
  pageSizeStandard: 200,
  asOf: ASOF.toISOString(),
} satisfies Omit<SampleConfig, 'seed'>;

const alwaysConfirm = () => true;

function idsByStratum(result: Awaited<ReturnType<typeof runSample>>): readonly (readonly string[])[] {
  if ('cancelled' in result) throw new Error('unexpected cancellation in test');
  return result.strata.map((s) => s.opportunities.map((o) => o.ref.id));
}

describe('runSample determinism', () => {
  it('keeps identical opportunity IDs in identical order per stratum for the same seed', async () => {
    const adapterA = new MockAdapter(ORG, buildOrgData(10));
    const adapterB = new MockAdapter(ORG, buildOrgData(10));
    const config: SampleConfig = { ...baseConfig, seed: 'determinism-seed' };

    const resultA = idsByStratum(await runSample(adapterA, config, alwaysConfirm));
    const resultB = idsByStratum(await runSample(adapterB, config, alwaysConfirm));

    expect(resultB).toEqual(resultA);
  });

  it('produces a different sample for a different seed', async () => {
    const adapterA = new MockAdapter(ORG, buildOrgData(10));
    const adapterB = new MockAdapter(ORG, buildOrgData(10));

    const resultA = idsByStratum(await runSample(adapterA, { ...baseConfig, seed: 'seed-alpha' }, alwaysConfirm));
    const resultB = idsByStratum(await runSample(adapterB, { ...baseConfig, seed: 'seed-beta' }, alwaysConfirm));

    expect(resultB).not.toEqual(resultA);
  });
});

describe('planSample account hydration budget', () => {
  it('computes a worst-case account hydration call count from strata.length * perStratumSampleSize and accountBatchLimit', () => {
    const adapter = new MockAdapter(ORG, buildOrgData(0), { accountBatchLimit: 5 });
    const plan = planSample(adapter, { ...baseConfig, seed: 'budget-seed' });
    // 7 strata * 3 perStratumSampleSize = 21 worst-case refs; ceil(21 / 5) = 5.
    expect(plan.plannedAccountApiCalls).toBe(5);
  });

  it('reflects account hydration in the printed dry-run plan and in the combined quota estimate', () => {
    const adapter = new MockAdapter(ORG, buildOrgData(0), {
      accountBatchLimit: 5,
      rateLimit: { kind: 'daily_quota', value: 100 },
    });
    const plan = planSample(adapter, { ...baseConfig, seed: 'budget-seed' });
    const text = formatSamplePlan(plan);

    expect(plan.plannedApiCalls).toBe(1); // ceil(1000 maxRecordsToScan / 2000 bulk page size)
    expect(text).toContain('Planned account hydration API calls: up to 5');
    // Combined (1 opportunity-scan + 5 account-hydration) against a 100 quota.
    expect(text).toContain('Quota: up to 6.0% of the daily quota of 100');
  });
});

describe('planSample full-run estimate', () => {
  // Salesforce-shaped declaration: 2 counts + 1 org-wide history read per
  // run, a contact-role batch per listing page, 4 unbatched reads per
  // sampled deal, 2 batched Enhanced Note reads per 200 deals, and up to
  // 200 note full-text fetches.
  const estimate = { perRun: 3, perScanPage: 1, perSampledOpportunity: 4, perChildRecordBatch: 2, perRunFetchCap: 200 };

  function salesforceShapedPlan() {
    const adapter = new MockAdapter(ORG, buildOrgData(0), {
      bulkRead: false,
      rateLimit: { kind: 'daily_quota', value: 15_000 },
      apiCallEstimate: estimate,
    });
    return planSample(adapter, { ...baseConfig, perStratumSampleSize: 20, maxRecordsToScan: 5_000, seed: 'budget-seed' });
  }

  it('counts every call the adapter declares, not just the listing pages', () => {
    const plan = salesforceShapedPlan();
    // 25 pages of 200, plus a per-page read each.
    expect(plan.plannedApiCalls).toBe(25);
    expect(plan.plannedScanExtraApiCalls).toBe(25);
    // 7 strata * 20 = 140 sampled deals: 140 * 4 per-deal reads + ceil(140 / 200) * 2 batched reads.
    expect(plan.plannedDetailApiCalls).toBe(562);
    // 3 per run + up to 200 fetches.
    expect(plan.plannedFixedApiCalls).toBe(203);
    // 50 scan + 1 account batch + 562 detailed + 203 fixed.
    expect(plan.plannedTotalApiCalls).toBe(816);
  });

  it('prints each group and bases the quota on the total', () => {
    const text = formatSamplePlan(salesforceShapedPlan());
    expect(text).toContain('Planned scan API calls: up to 50 (25 pages of 200, plus 25 per-page reads; stops earlier when the population runs out)');
    expect(text).toContain('Planned detailed-check API calls: at least 562 (4 per sampled deal across up to 140 deals, plus 2 batched reads; a minimum that excludes extra result pages)');
    expect(text).toContain('Planned fixed API calls: up to 203 (3 per run, plus up to 200 per-record fetches)');
    expect(text).toContain('Planned API calls in total: 816 = up to 254 (scan, account hydration, fixed) + at least 562 (detailed checks, excluding extra result pages)');
    expect(text).toContain('Quota: 5.4% of the daily quota of 15000 = up to 1.7% (scan, account hydration, fixed) + at least 3.7% (detailed checks)');
  });

  it('says so when the adapter declares no estimate, and counts only what it can', () => {
    const adapter = new MockAdapter(ORG, buildOrgData(0), { accountBatchLimit: 5 });
    const plan = planSample(adapter, { ...baseConfig, seed: 'budget-seed' });
    expect(plan.plannedTotalApiCalls).toBe(6);
    expect(formatSamplePlan(plan)).toContain('Detailed-check and fixed API calls: not estimated (the adapter declares no call estimate)');
  });
});

describe('classifyStratum', () => {
  it('excludes a closed deal just outside the 12-month window and includes one just inside it', () => {
    const cutoff = new Date(ASOF);
    cutoff.setUTCMonth(cutoff.getUTCMonth() - CLOSED_WINDOW_MONTHS);
    const justOutside = new Date(cutoff.getTime() - 86_400_000);

    const insideDeal = makeClosedOpportunity('closed_won', 'inside', 0, cutoff.toISOString());
    const outsideDeal = makeClosedOpportunity('closed_won', 'outside', 0, justOutside.toISOString());

    expect(classifyStratum(insideDeal, ASOF)).toBe('closed_won');
    expect(classifyStratum(outsideDeal, ASOF)).toBeNull();
  });
});

describe('runSample closed-stratum window (regression, not just classifyStratum)', () => {
  /**
   * closed_deal_count_12m and outcome_evidence_retention_rate (D7,
   * metric-definitions.md) both trust that every opportunity runSample ever
   * places in the closed_won/closed_lost strata already falls inside
   * CLOSED_WINDOW_MONTHS of asOf, rather than re-deriving that window
   * themselves. classifyStratum's own unit test above proves the
   * classification function is correct in isolation; this proves runSample's
   * actual end-to-end output honors it too, straddling the boundary with a
   * mix of in-window and just-outside-window deals in the same run.
   */
  it('never returns a closed_won/closed_lost opportunity with a closeDate outside CLOSED_WINDOW_MONTHS of asOf', async () => {
    const cutoff = new Date(ASOF);
    cutoff.setUTCMonth(cutoff.getUTCMonth() - CLOSED_WINDOW_MONTHS);
    const justOutside = new Date(cutoff.getTime() - 86_400_000).toISOString();
    const justInside = cutoff.toISOString();

    const data = buildOrgData(0);
    let order = 0;
    for (const stage of ['closed_won', 'closed_lost'] as const) {
      data.opportunities.push(makeClosedOpportunity(stage, `${stage}-inside`, order++, justInside));
      data.opportunities.push(makeClosedOpportunity(stage, `${stage}-outside`, order++, justOutside));
      // A few comfortably-inside deals too, so the reservoir has more than one candidate per stratum.
      for (let i = 0; i < 3; i++) {
        data.opportunities.push(makeClosedOpportunity(stage, `${stage}-mid-${i}`, order++, isoDaysBeforeAsOf(60 + i)));
      }
    }
    const adapter = new MockAdapter(ORG, data);

    const result = await runSample(adapter, { ...baseConfig, perStratumSampleSize: 10, seed: 'window-seed' }, alwaysConfirm);
    if ('cancelled' in result) throw new Error('unexpected cancellation in test');

    const cutoffMs = cutoff.getTime();
    for (const stratumResult of result.strata) {
      if (stratumResult.stratum !== 'closed_won' && stratumResult.stratum !== 'closed_lost') continue;
      for (const o of stratumResult.opportunities) {
        expect(o.ref.id).not.toMatch(/-outside$/);
        expect(new Date(o.closeDate!).getTime()).toBeGreaterThanOrEqual(cutoffMs);
      }
    }
  });
});

/**
 * Two tiers (2026-09-30): the scan reads every eligible deal up to
 * maxRecordsToScan, and the per-stratum sample for detailed checks is drawn
 * uniformly from the whole scan. Stopping once every stratum is full is
 * --quick only (stopWhenStrataFull), off by default.
 */
describe('runSample two tiers', () => {
  const pagedConfig: SampleConfig = { ...baseConfig, seed: 'two-tier', pageSizeBulk: 10, pageSizeStandard: 10 };
  const run = async (config: SampleConfig) => {
    const result = await runSample(new MockAdapter(ORG, buildOrgData(50)), config, alwaysConfirm);
    if ('cancelled' in result) throw new Error('unexpected cancellation in test');
    return result;
  };

  it('scans the whole eligible population by default, even after every stratum is full', async () => {
    const result = await run(pagedConfig);
    expect(result.recordsScanned).toBe(7 * 50);
    expect(result.stopReason).toBe('source_exhausted');
    expect(result.scanned.open).toHaveLength(5 * 50);
    expect(result.scanned.closed).toHaveLength(2 * 50);
    for (const s of result.strata) expect(s.opportunities).toHaveLength(3);
  });

  it('stops once every stratum is full only with stopWhenStrataFull (--quick)', async () => {
    const result = await run({ ...pagedConfig, stopWhenStrataFull: true });
    expect(result.stopReason).toBe('all_strata_full');
    expect(result.recordsScanned).toBeLessThan(7 * 50);
    expect(result.scanned.open.length + result.scanned.closed.length).toBe(result.recordsScanned);
  });

  it('draws the detailed-check sample from the whole scan, not just the newest deals', async () => {
    const quick = await run({ ...pagedConfig, stopWhenStrataFull: true });
    const full = await run(pagedConfig);
    const newest = new Set([...quick.scanned.open, ...quick.scanned.closed].map((o) => o.ref.id));
    const sampled = full.strata.flatMap((s) => s.opportunities.map((o) => o.ref.id));
    expect(sampled.some((id) => !newest.has(id))).toBe(true);
  });

  it('stops at maxRecordsToScan, keeping what it scanned', async () => {
    const result = await run({ ...pagedConfig, maxRecordsToScan: 25 });
    expect(result.stopReason).toBe('budget_exhausted');
    expect(result.scanned.open.length + result.scanned.closed.length).toBe(25);
  });
});

/**
 * The sampling plan against the org's free daily API calls: the quota line
 * names the calls left and the reserve when the adapter reports them (and
 * reads as before when it doesn't), and a run whose plan doesn't fit stops
 * after printing the plan, before any adapter call.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { MockAdapter, type MockOrgData } from '@gtm-trust-kernel/adapters/mock.js';
import type { AdapterCapabilities } from '@gtm-trust-kernel/adapters/types.js';
import { installFakeSalesforce } from '../../adapters/test/support/fakeSalesforce.js';
import { registerPreflightOrg } from '../../adapters/test/support/preflightOrg.js';
import { buildLiveReportData, runPreflight } from '../src/report/liveReport.js';
import { formatSamplePlan, planSample, QuotaError, quotaShortfall, runSample, type SampleConfig } from '../src/sample.js';

const EMPTY: MockOrgData = {
  accounts: [], opportunities: [], contacts: [], activities: [], notes: [], stageHistory: [], ownerChanges: [], nextStepChanges: [],
};

const CONFIG: SampleConfig = {
  seed: 'quota',
  perStratumSampleSize: 3,
  maxRecordsToScan: 1000,
  stopWhenStrataFull: false,
  pageSizeBulk: 2000,
  pageSizeStandard: 200,
  asOf: '2026-09-30T00:00:00.000Z',
};

const ESTIMATE = { perRun: 4, perScanPage: 1, perSampledOpportunity: 0, perChildRecordBatch: 5, perRunFetchCap: 200 };

function adapter(rateLimit: AdapterCapabilities['rateLimit'], withEstimate = false) {
  return new MockAdapter('org', EMPTY, { rateLimit, ...(withEstimate ? { apiCallEstimate: ESTIMATE } : {}) });
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('quota line', () => {
  it('names the calls left, the reserve and the calls free, with an estimate', () => {
    const plan = planSample(adapter({ kind: 'daily_quota', value: 15000, remaining: 14000, reserve: 1500, source: 'org' }, true), CONFIG);
    const ceiling = plan.plannedTotalApiCalls - plan.plannedDetailApiCalls;
    expect(formatSamplePlan(plan)).toContain(
      `  Quota: ${plan.plannedTotalApiCalls} calls planned (up to ${ceiling} + at least ${plan.plannedDetailApiCalls}); ` +
        'your org has 14000 of its 15000 daily calls left and this tool keeps 1500 in reserve, so 12500 are free for this run',
    );
  });

  it('names them without an estimate too', () => {
    const plan = planSample(adapter({ kind: 'daily_quota', value: 5000, remaining: 600, reserve: 500, source: 'org' }), CONFIG);
    expect(formatSamplePlan(plan)).toContain(
      `  Quota: up to ${plan.plannedTotalApiCalls} calls planned; your org has 600 of its 5000 daily calls left and this tool keeps 500 in reserve, so 100 are free for this run`,
    );
  });

  it('reads as before when the calls left are unknown', () => {
    const plan = planSample(adapter({ kind: 'daily_quota', value: 100, source: 'estimate' }), CONFIG);
    const text = formatSamplePlan(plan);
    expect(text).toContain(`Quota: up to ${((100 * plan.plannedTotalApiCalls) / 100).toFixed(1)}% of the daily quota of 100`);
    expect(text).not.toContain('reserve');
  });
});

describe('quotaShortfall and runSample', () => {
  const fitting = (free: number) => {
    const total = planSample(adapter({ kind: 'daily_quota', value: 15000 }), CONFIG).plannedTotalApiCalls;
    return adapter({ kind: 'daily_quota', value: 15000, remaining: 1500 + total + free, reserve: 1500, source: 'org' });
  };

  it('is null when the plan fits exactly, or when the calls left are unknown', () => {
    expect(quotaShortfall(planSample(fitting(0), CONFIG))).toBeNull();
    expect(quotaShortfall(planSample(adapter({ kind: 'daily_quota', value: 1 }), CONFIG))).toBeNull();
  });

  it('refuses a plan one call over, after printing the plan and before any adapter call', async () => {
    const a = fitting(-1);
    const plan = planSample(a, CONFIG);
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const list = vi.spyOn(a, 'listOpportunitiesForSample');
    const count = vi.spyOn(a, 'countOpportunitiesForSample');
    const confirm = vi.fn(() => true);
    const err = await runSample(a, CONFIG, confirm).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(QuotaError);
    expect((err as QuotaError).message).toBe(
      `Not starting: this run plans ${plan.plannedTotalApiCalls} API calls, but your org has ${1500 + plan.plannedTotalApiCalls - 1} of its 15000 daily calls left ` +
        `and this tool keeps 1500 in reserve, so only ${plan.plannedTotalApiCalls - 1} are free. Nothing was read. Try again once the daily limit frees up.`,
    );
    expect(log).toHaveBeenCalledTimes(1);
    expect(confirm).not.toHaveBeenCalled();
    expect(list).not.toHaveBeenCalled();
    expect(count).not.toHaveBeenCalled();
  });

  it('runs a plan that fits', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const result = await runSample(fitting(0), CONFIG, () => true);
    expect('cancelled' in result).toBe(false);
  });
});

describe('live run near the daily limit (fake Salesforce)', () => {
  it('passes preflight but refuses the scan when the plan needs more than the free calls', async () => {
    const sf = installFakeSalesforce();
    registerPreflightOrg(sf);
    // Preflight's 10 counted calls leave 1690 of 15000: above the 1500 reserve, 190 free.
    sf.apiUsage(13300);
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const a = sf.adapter();
    await runPreflight(a, () => {});
    const queriesBefore = sf.queries.length;
    const err = await buildLiveReportData(a, { showOrg: false, sampling: {}, asOf: '2026-09-30T00:00:00.000Z' }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(QuotaError);
    expect((err as QuotaError).message).toMatch(/^Not starting: this run plans \d+ API calls, but your org has 1690 of its 15000 daily calls left and this tool keeps 1500 in reserve, so only 190 are free\./);
    expect(sf.queries.length).toBe(queriesBefore);
    expect(log.mock.calls.flat().join('\n')).toContain('so 190 are free for this run');
  });
});

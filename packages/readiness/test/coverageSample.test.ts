import { describe, expect, it } from 'vitest';
import { MockAdapter, type MockFaults, type MockOrgData } from '@gtm-trust-kernel/adapters/mock.js';
import type { AdapterCapabilities } from '@gtm-trust-kernel/adapters/types.js';
import type {
  Account,
  CanonicalStage,
  Opportunity,
  RecordRef,
  StageHistoryEntry,
} from '@gtm-trust-kernel/adapters/model/canonical.js';
import { buildCoverageSample, hydrateAccounts, hydrateStageHistory } from '../src/coverageSample.js';
import { SAMPLE_STRATA, type SamplePlan, type SampleResult, type SampleStratum, type StratumSampleResult } from '../src/sample.js';

const ORG = 'org-coverage-sample-test';

function ref(objectType: RecordRef['objectType'], id: string): RecordRef {
  return { crm: 'mock', orgId: ORG, objectType, id };
}

function opp(id: string, stage: CanonicalStage, accountId: string): Opportunity {
  return {
    ref: ref('opportunity', id),
    accountRef: ref('account', accountId),
    name: `Deal ${id}`,
    stage,
    stageConfidence: 'mapped',
    vendorStageLabel: stage,
    isClosed: stage === 'closed_won' || stage === 'closed_lost',
    contactLinks: [],
    createdAt: '2026-01-01T00:00:00.000Z',
    modifiedAt: '2026-01-01T00:00:00.000Z',
    concurrencyToken: `tok-${id}`,
  };
}

function account(id: string): Account {
  return {
    ref: ref('account', id),
    name: `Account ${id}`,
    createdAt: '2026-01-01T00:00:00.000Z',
    modifiedAt: '2026-01-01T00:00:00.000Z',
  };
}

function stageHistoryEntry(id: string, opportunityId: string, changedAt: string): StageHistoryEntry {
  return {
    ref: ref('stage_history', id),
    opportunityRef: ref('opportunity', opportunityId),
    toStage: 'discovery',
    changedAt,
  };
}

function fakePlan(): SamplePlan {
  return {
    seed: 'test-seed',
    strata: SAMPLE_STRATA,
    perStratumSampleSize: 3,
    maxRecordsToScan: 1000,
    effectivePageSize: 200,
    plannedApiCalls: 5,
    plannedAccountApiCalls: 1,
    rateLimit: { kind: 'none', value: 0 },
  };
}

function stratumResult(stratum: SampleStratum, opportunities: readonly Opportunity[]): StratumSampleResult {
  return { stratum, target: 3, opportunities, underfilled: opportunities.length < 3 };
}

function makeSampleResult(overrides: Partial<Record<SampleStratum, readonly Opportunity[]>>): SampleResult {
  const strata = SAMPLE_STRATA.map((s) => stratumResult(s, overrides[s] ?? []));
  return { plan: fakePlan(), apiCallsConsumed: 1, recordsScanned: 10, strata, stopReason: 'all_strata_full' };
}

const CAPABILITIES: AdapterCapabilities = {
  stageHistory: true,
  ownerHistory: true,
  activitySync: true,
  incrementalSync: true,
  bulkRead: true,
  writeGranularity: 'field',
  nativeConcurrencyCheck: false,
  rateLimit: { kind: 'none', value: 0 },
  stageMap: {},
  accountBatchLimit: 200,
};

function makeAdapter(
  accounts: Account[],
  caps: Partial<AdapterCapabilities> = {},
  faults: MockFaults = {},
  stageHistory: StageHistoryEntry[] = [],
) {
  const data: MockOrgData = {
    accounts,
    opportunities: [],
    contacts: [],
    activities: [],
    notes: [],
    stageHistory,
    ownerChanges: [],
  };
  return new MockAdapter(ORG, data, caps, faults);
}

describe('buildCoverageSample', () => {
  it('splits open and closed strata into openOpportunities/closedOpportunities, leaving each list otherwise unchanged', () => {
    const result = makeSampleResult({
      discovery: [opp('open-1', 'discovery', 'acc-1'), opp('open-2', 'discovery', 'acc-2')],
      closed_won: [opp('closed-1', 'closed_won', 'acc-1')],
      closed_lost: [opp('closed-2', 'closed_lost', 'acc-2')],
    });

    const sample = buildCoverageSample(result, CAPABILITIES);

    expect(sample.openOpportunities.map((o) => o.ref.id)).toEqual(['open-1', 'open-2']);
    expect(sample.closedOpportunities.map((o) => o.ref.id)).toEqual(['closed-1', 'closed-2']);
  });

  it('defaults accountsByRef/missingAccountCount/accountsHydrated to unhydrated placeholders', () => {
    const result = makeSampleResult({ discovery: [opp('open-1', 'discovery', 'acc-1')] });
    const sample = buildCoverageSample(result, CAPABILITIES);

    expect(sample.accountsHydrated).toBe(false);
    expect(sample.accountsByRef.size).toBe(0);
    expect(sample.missingAccountCount).toBe(0);
  });

  it('counts opportunities with no usable accountRef (absent or empty/whitespace id) separately from missingAccountCount', () => {
    const result = makeSampleResult({
      discovery: [opp('open-1', 'discovery', 'acc-1'), opp('open-2', 'discovery', '')],
      closed_won: [opp('closed-1', 'closed_won', '   ')],
    });

    const sample = buildCoverageSample(result, CAPABILITIES);

    expect(sample.oppsWithoutAccountRef).toBe(2);
    expect(sample.missingAccountCount).toBe(0); // that's hydrateAccounts's concern, not the builder's
  });
});

describe('hydrateAccounts', () => {
  it('dedupes opportunities that share an account into a single accountsByRef entry', async () => {
    const result = makeSampleResult({
      discovery: [opp('open-1', 'discovery', 'acc-1'), opp('open-2', 'discovery', 'acc-1')],
    });
    const adapter = makeAdapter([account('acc-1')]);
    const sample = buildCoverageSample(result, adapter.capabilities());

    const { sample: hydrated } = await hydrateAccounts(sample, adapter);

    expect(hydrated.accountsByRef.size).toBe(1);
    expect(hydrated.accountsByRef.get('acc-1')?.ref.id).toBe('acc-1');
  });

  it('counts an unresolvable accountRef as missing rather than throwing', async () => {
    const result = makeSampleResult({
      discovery: [opp('open-1', 'discovery', 'acc-1'), opp('open-2', 'discovery', 'acc-missing')],
    });
    const adapter = makeAdapter([account('acc-1')]);
    const sample = buildCoverageSample(result, adapter.capabilities());

    const { sample: hydrated } = await hydrateAccounts(sample, adapter);

    expect(hydrated.missingAccountCount).toBe(1);
    expect(hydrated.accountsByRef.size).toBe(1);
  });

  it('flips accountsHydrated from false to true', async () => {
    const result = makeSampleResult({ discovery: [opp('open-1', 'discovery', 'acc-1')] });
    const adapter = makeAdapter([account('acc-1')]);
    const sample = buildCoverageSample(result, adapter.capabilities());
    expect(sample.accountsHydrated).toBe(false);

    const { sample: hydrated } = await hydrateAccounts(sample, adapter);
    expect(hydrated.accountsHydrated).toBe(true);
  });

  it('produces identical, ref.id-sorted account order regardless of opportunity insertion order (seed determinism)', async () => {
    const resultA = makeSampleResult({
      discovery: [opp('open-1', 'discovery', 'acc-b'), opp('open-2', 'discovery', 'acc-a')],
    });
    const resultB = makeSampleResult({
      discovery: [opp('open-2', 'discovery', 'acc-a'), opp('open-1', 'discovery', 'acc-b')],
    });
    const adapterA = makeAdapter([account('acc-a'), account('acc-b')]);
    const adapterB = makeAdapter([account('acc-a'), account('acc-b')]);

    const { sample: hydratedA } = await hydrateAccounts(buildCoverageSample(resultA, adapterA.capabilities()), adapterA);
    const { sample: hydratedB } = await hydrateAccounts(buildCoverageSample(resultB, adapterB.capabilities()), adapterB);

    expect([...hydratedA.accountsByRef.keys()]).toEqual(['acc-a', 'acc-b']);
    expect([...hydratedB.accountsByRef.keys()]).toEqual(['acc-a', 'acc-b']);
  });

  it('rejects, with no partial sample and no failed chunk counted as missing, when a chunk fails partway through', async () => {
    const result = makeSampleResult({
      discovery: [
        opp('open-1', 'discovery', 'acc-1'),
        opp('open-2', 'discovery', 'acc-2'),
        opp('open-3', 'discovery', 'acc-3'),
        opp('open-4', 'discovery', 'acc-4'),
        opp('open-5', 'discovery', 'acc-5'),
      ],
    });
    const accounts = ['acc-1', 'acc-2', 'acc-3', 'acc-4', 'acc-5'].map(account);
    // accountBatchLimit: 2 over 5 distinct accounts -> 3 chunks ([acc-1,acc-2], [acc-3,acc-4], [acc-5]). Fault the 2nd call.
    const adapter = makeAdapter(accounts, { accountBatchLimit: 2 }, { failGetAccountsOnCall: { n: 2, kind: 'network' } });
    const sample = buildCoverageSample(result, adapter.capabilities());

    await expect(hydrateAccounts(sample, adapter)).rejects.toThrow();
  });
});

describe('hydrateStageHistory', () => {
  it('finds the earliest changedAt across the org, independent of insertion order', async () => {
    const result = makeSampleResult({ discovery: [opp('open-1', 'discovery', 'acc-1')] });
    const adapter = makeAdapter([], { stageHistory: true }, {}, [
      stageHistoryEntry('sh-2', 'open-1', '2025-06-01T00:00:00.000Z'),
      stageHistoryEntry('sh-1', 'open-1', '2024-01-15T00:00:00.000Z'),
      stageHistoryEntry('sh-3', 'open-1', '2025-12-01T00:00:00.000Z'),
    ]);
    const sample = buildCoverageSample(result, adapter.capabilities());

    const { sample: hydrated } = await hydrateStageHistory(sample, adapter);

    expect(hydrated.stageHistoryEarliestChangedAt).toBe('2024-01-15T00:00:00.000Z');
  });

  it('returns null when the org has zero stage-history entries', async () => {
    const result = makeSampleResult({ discovery: [opp('open-1', 'discovery', 'acc-1')] });
    const adapter = makeAdapter([], { stageHistory: true }, {}, []);
    const sample = buildCoverageSample(result, adapter.capabilities());

    const { sample: hydrated } = await hydrateStageHistory(sample, adapter);

    expect(hydrated.stageHistoryEarliestChangedAt).toBeNull();
  });

  it('returns null when the adapter reports no stageHistory capability, relying on the adapter contract rather than duplicating the check', async () => {
    const result = makeSampleResult({ discovery: [opp('open-1', 'discovery', 'acc-1')] });
    const adapter = makeAdapter([], { stageHistory: false }, {}, [
      stageHistoryEntry('sh-1', 'open-1', '2024-01-15T00:00:00.000Z'),
    ]);
    const sample = buildCoverageSample(result, adapter.capabilities());

    const { sample: hydrated } = await hydrateStageHistory(sample, adapter);

    expect(hydrated.stageHistoryEarliestChangedAt).toBeNull();
  });

  it('flips stageHistoryHydrated from false to true', async () => {
    const result = makeSampleResult({ discovery: [opp('open-1', 'discovery', 'acc-1')] });
    const adapter = makeAdapter([], { stageHistory: true }, {}, []);
    const sample = buildCoverageSample(result, adapter.capabilities());
    expect(sample.stageHistoryHydrated).toBe(false);

    const { sample: hydrated } = await hydrateStageHistory(sample, adapter);
    expect(hydrated.stageHistoryHydrated).toBe(true);
  });
});

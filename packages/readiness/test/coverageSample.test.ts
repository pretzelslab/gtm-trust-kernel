import { describe, expect, it } from 'vitest';
import { MockAdapter, type MockFaults, type MockOrgData } from '@gtm-trust-kernel/adapters/mock.js';
import { AdapterError, type AdapterCapabilities } from '@gtm-trust-kernel/adapters/types.js';
import type {
  Account,
  Activity,
  CanonicalStage,
  Contact,
  Note,
  Opportunity,
  RecordRef,
  StageHistoryEntry,
} from '@gtm-trust-kernel/adapters/model/canonical.js';
import { TrustTier, tag } from '@gtm-trust-kernel/adapters/model/trust.js';
import {
  buildCoverageSample,
  hydrateAccounts,
  hydrateActivities,
  hydrateContacts,
  hydrateNotes,
  hydrateStageHistory,
} from '../src/coverageSample.js';
import { activityCaptureRate } from '../src/metrics/coverage.js';
import { stageActivityContradictionRate } from '../src/metrics/consistency.js';
import { SAMPLE_STRATA, type SamplePlan, type SampleResult, type SampleStratum, type StratumSampleResult } from '../src/sample.js';

const ORG = 'org-coverage-sample-test';

function ref(objectType: RecordRef['objectType'], id: string): RecordRef {
  return { crm: 'mock', orgId: ORG, objectType, id };
}

function opp(id: string, stage: CanonicalStage, accountId: string, contactIds: readonly string[] = []): Opportunity {
  return {
    ref: ref('opportunity', id),
    accountRef: ref('account', accountId),
    name: `Deal ${id}`,
    stage,
    stageConfidence: 'mapped',
    vendorStageLabel: stage,
    isClosed: stage === 'closed_won' || stage === 'closed_lost',
    contactLinks: contactIds.map((contactId, i) => ({ contactRef: ref('contact', contactId), isPrimary: i === 0 })),
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

function contact(id: string, email?: string): Contact {
  return {
    ref: ref('contact', id),
    name: `Contact ${id}`,
    email,
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

function note(id: string, opportunityId: string, createdAt: string): Note {
  return {
    ref: ref('note', id),
    relatedTo: [ref('opportunity', opportunityId)],
    createdAt,
    body: tag(TrustTier.UserAuthored, `Note body for ${id}`, { recordId: `note:${id}`, field: 'body', capturedAt: createdAt }),
  };
}

function activity(id: string, opportunityId: string, occurredAt: string): Activity {
  return {
    ref: ref('activity', id),
    relatedTo: [ref('opportunity', opportunityId)],
    kind: 'call',
    direction: 'outbound',
    occurredAt,
    participantIds: [],
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
    plannedScanExtraApiCalls: 0,
    plannedDetailApiCalls: 0,
    plannedFixedApiCalls: 0,
    plannedTotalApiCalls: 6,
    apiCallEstimate: null,
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
  closeDateHistory: true,
  nextStepHistory: true,
  activitySync: true,
  incrementalSync: true,
  bulkRead: true,
  writeGranularity: 'field',
  nativeConcurrencyCheck: false,
  rateLimit: { kind: 'none', value: 0 },
  stageMap: {},
  accountBatchLimit: 200,
  contactBatchLimit: 200,
  childRecordBatchLimit: 200,
  notesPerOpportunityLimit: 200,
  activitiesPerOpportunityLimit: 200,
  historyPerOpportunityLimit: 200,
};

function makeAdapter(
  accounts: Account[],
  caps: Partial<AdapterCapabilities> = {},
  faults: MockFaults = {},
  stageHistory: StageHistoryEntry[] = [],
  notes: Note[] = [],
  activities: Activity[] = [],
  contacts: Contact[] = [],
) {
  const data: MockOrgData = {
    accounts,
    opportunities: [],
    contacts,
    activities,
    notes,
    stageHistory,
    ownerChanges: [],
    nextStepChanges: [],
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

  it('carries each closed stratum\'s underfilled flag through independently, defaulting true when a stratum is absent', () => {
    const result = makeSampleResult({
      // stratumResult's own target is 3 — exactly 3 items means the reservoir is full (underfilled: false).
      closed_won: [
        opp('won-1', 'closed_won', 'acc-1'),
        opp('won-2', 'closed_won', 'acc-1'),
        opp('won-3', 'closed_won', 'acc-1'),
      ],
      closed_lost: [opp('lost-1', 'closed_lost', 'acc-1')],
      // discovery is left absent entirely — open strata must not affect either closed flag.
    });

    const sample = buildCoverageSample(result, CAPABILITIES);

    expect(sample.closedWonUnderfilled).toBe(false);
    expect(sample.closedLostUnderfilled).toBe(true);
  });

  it('defaults both closed strata to underfilled: true when the sample has no closed opportunities at all', () => {
    const result = makeSampleResult({ discovery: [opp('open-1', 'discovery', 'acc-1')] });
    const sample = buildCoverageSample(result, CAPABILITIES);

    expect(sample.closedWonUnderfilled).toBe(true);
    expect(sample.closedLostUnderfilled).toBe(true);
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

    const err = await hydrateAccounts(sample, adapter).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AdapterError);
    expect((err as AdapterError).kind).toBe('network');
  });
});

describe('hydrateContacts', () => {
  it('dedupes opportunities that share a contactLink into a single contactsByRef entry', async () => {
    const result = makeSampleResult({
      discovery: [opp('open-1', 'discovery', 'acc-1', ['con-1']), opp('open-2', 'discovery', 'acc-1', ['con-1'])],
    });
    const adapter = makeAdapter([], {}, {}, [], [], [], [contact('con-1', 'dana@example.com')]);
    const sample = buildCoverageSample(result, adapter.capabilities());

    const { sample: hydrated } = await hydrateContacts(sample, adapter);

    expect(hydrated.contactsByRef.size).toBe(1);
    expect(hydrated.contactsByRef.get('con-1')?.ref.id).toBe('con-1');
  });

  it('counts an unresolvable contact ref as missing rather than throwing', async () => {
    const result = makeSampleResult({
      discovery: [opp('open-1', 'discovery', 'acc-1', ['con-1', 'con-missing'])],
    });
    const adapter = makeAdapter([], {}, {}, [], [], [], [contact('con-1')]);
    const sample = buildCoverageSample(result, adapter.capabilities());

    const { sample: hydrated } = await hydrateContacts(sample, adapter);

    expect(hydrated.missingContactCount).toBe(1);
    expect(hydrated.contactsByRef.size).toBe(1);
  });

  it('flips contactsHydrated from false to true', async () => {
    const result = makeSampleResult({ discovery: [opp('open-1', 'discovery', 'acc-1', ['con-1'])] });
    const adapter = makeAdapter([], {}, {}, [], [], [], [contact('con-1')]);
    const sample = buildCoverageSample(result, adapter.capabilities());
    expect(sample.contactsHydrated).toBe(false);

    const { sample: hydrated } = await hydrateContacts(sample, adapter);
    expect(hydrated.contactsHydrated).toBe(true);
  });

  it('leaves an opportunity with no contactLinks contributing nothing (not an error)', async () => {
    const result = makeSampleResult({ discovery: [opp('open-1', 'discovery', 'acc-1')] });
    const adapter = makeAdapter([], {}, {}, [], [], [], []);
    const sample = buildCoverageSample(result, adapter.capabilities());

    const { sample: hydrated } = await hydrateContacts(sample, adapter);

    expect(hydrated.contactsByRef.size).toBe(0);
    expect(hydrated.missingContactCount).toBe(0);
  });

  it('rejects, with no partial sample and no failed chunk counted as missing, when a chunk fails partway through', async () => {
    const result = makeSampleResult({
      discovery: [
        opp('open-1', 'discovery', 'acc-1', ['con-1']),
        opp('open-2', 'discovery', 'acc-1', ['con-2']),
        opp('open-3', 'discovery', 'acc-1', ['con-3']),
      ],
    });
    const contacts = ['con-1', 'con-2', 'con-3'].map((id) => contact(id));
    const adapter = makeAdapter([], { contactBatchLimit: 2 }, { failGetContactsOnCall: { n: 2, kind: 'network' } }, [], [], [], contacts);
    const sample = buildCoverageSample(result, adapter.capabilities());

    const err = await hydrateContacts(sample, adapter).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AdapterError);
    expect((err as AdapterError).kind).toBe('network');
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

describe('hydrateNotes', () => {
  it('populates notesByOpportunity, keyed by opportunity ref.id, sorted by createdAt', async () => {
    const result = makeSampleResult({
      discovery: [opp('open-1', 'discovery', 'acc-1'), opp('open-2', 'discovery', 'acc-1')],
    });
    const adapter = makeAdapter(
      [],
      {},
      {},
      [],
      [note('note-2', 'open-1', '2026-01-02T00:00:00.000Z'), note('note-1', 'open-1', '2026-01-01T00:00:00.000Z')],
    );
    const sample = buildCoverageSample(result, adapter.capabilities());

    const { sample: hydrated } = await hydrateNotes(sample, adapter);

    expect(hydrated.notesByOpportunity.get('open-1')?.map((n) => n.ref.id)).toEqual(['note-1', 'note-2']);
    expect(hydrated.notesByOpportunity.has('open-2')).toBe(false);
  });

  it("picks up the adapter's notesComplete as it stands after the notes are read", async () => {
    // The Salesforce adapter only knows notes are incomplete once it has
    // found Enhanced Notes it can't read, so the snapshot taken before
    // hydration can't be trusted for this one field.
    class LearnsDuringRead extends MockAdapter {
      private read = false;
      override capabilities(): AdapterCapabilities {
        return { ...super.capabilities(), notesComplete: !this.read };
      }
      override async getNotesByOpportunity(...args: Parameters<MockAdapter['getNotesByOpportunity']>) {
        this.read = true;
        return super.getNotesByOpportunity(...args);
      }
    }
    const result = makeSampleResult({ discovery: [opp('open-1', 'discovery', 'acc-1')] });
    const adapter = new LearnsDuringRead(ORG, {
      accounts: [], opportunities: [], contacts: [], activities: [], notes: [], stageHistory: [], ownerChanges: [], nextStepChanges: [],
    });
    const sample = buildCoverageSample(result, adapter.capabilities());
    expect(sample.capabilities.notesComplete).toBe(true);

    const { sample: hydrated } = await hydrateNotes(sample, adapter);
    expect(hydrated.capabilities.notesComplete).toBe(false);
  });

  it('leaves an opportunity with no related notes absent from the map (not an error)', async () => {
    const result = makeSampleResult({ discovery: [opp('open-1', 'discovery', 'acc-1')] });
    const adapter = makeAdapter([]);
    const sample = buildCoverageSample(result, adapter.capabilities());

    const { sample: hydrated } = await hydrateNotes(sample, adapter);

    expect(hydrated.notesByOpportunity.size).toBe(0);
  });

  it('populates notes regardless of capabilities — notes are always readable, not gated', async () => {
    const result = makeSampleResult({ discovery: [opp('open-1', 'discovery', 'acc-1')] });
    const adapter = makeAdapter([], { activitySync: false, stageHistory: false, ownerHistory: false }, {}, [], [
      note('note-1', 'open-1', '2026-01-01T00:00:00.000Z'),
    ]);
    const sample = buildCoverageSample(result, adapter.capabilities());

    const { sample: hydrated } = await hydrateNotes(sample, adapter);

    expect(hydrated.notesByOpportunity.get('open-1')).toHaveLength(1);
  });
});

describe('hydrateActivities', () => {
  it('populates activitiesByOpportunity, keyed by opportunity ref.id, sorted by occurredAt', async () => {
    const result = makeSampleResult({
      discovery: [opp('open-1', 'discovery', 'acc-1'), opp('open-2', 'discovery', 'acc-1')],
    });
    const adapter = makeAdapter(
      [],
      {},
      {},
      [],
      [],
      [activity('act-2', 'open-1', '2026-01-02T00:00:00.000Z'), activity('act-1', 'open-1', '2026-01-01T00:00:00.000Z')],
    );
    const sample = buildCoverageSample(result, adapter.capabilities());

    const { sample: hydrated } = await hydrateActivities(sample, adapter);

    expect(hydrated.activitiesByOpportunity.get('open-1')?.map((a) => a.ref.id)).toEqual(['act-1', 'act-2']);
    expect(hydrated.activitiesByOpportunity.has('open-2')).toBe(false);
  });

  it('populates activities even when activitySync is false — that capability governs interpretation (silence isn\'t reliable), not readability', async () => {
    const result = makeSampleResult({ discovery: [opp('open-1', 'discovery', 'acc-1')] });
    const adapter = makeAdapter([], { activitySync: false }, {}, [], [], [activity('act-1', 'open-1', '2026-01-01T00:00:00.000Z')]);
    const sample = buildCoverageSample(result, adapter.capabilities());

    const { sample: hydrated } = await hydrateActivities(sample, adapter);

    expect(hydrated.activitiesByOpportunity.get('open-1')).toHaveLength(1);
  });
});

describe('activitySync capability gate survives real hydration', () => {
  it('activityCaptureRate still returns not_instrumented when activitySync is false, even though hydrateActivities populated real activity data', async () => {
    const result = makeSampleResult({ discovery: [opp('open-1', 'discovery', 'acc-1')] });
    const adapter = makeAdapter([], { activitySync: false }, {}, [], [], [activity('act-1', 'open-1', '2026-06-15T00:00:00.000Z')]);
    let sample = buildCoverageSample(result, adapter.capabilities());
    sample = (await hydrateActivities(sample, adapter)).sample;

    expect(sample.activitiesByOpportunity.get('open-1')).toHaveLength(1); // hydration genuinely ran and found data

    const reading = activityCaptureRate(sample, { asOf: '2026-06-15T00:00:00.000Z' });
    expect(reading.status).toBe('not_instrumented');
    expect(reading.value).toBeNull();
  });

  it('stageActivityContradictionRate still returns not_instrumented when activitySync is false, even though hydrateActivities populated real activity data', async () => {
    const result = makeSampleResult({ negotiation: [opp('open-1', 'negotiation', 'acc-1')] });
    const adapter = makeAdapter([], { activitySync: false }, {}, [], [], [activity('act-1', 'open-1', '2026-06-15T00:00:00.000Z')]);
    let sample = buildCoverageSample(result, adapter.capabilities());
    sample = (await hydrateActivities(sample, adapter)).sample;

    const reading = stageActivityContradictionRate(sample, { asOf: '2026-06-15T00:00:00.000Z' });
    expect(reading.status).toBe('not_instrumented');
    expect(reading.value).toBeNull();
  });
});

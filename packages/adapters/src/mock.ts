/**
 * In-memory mock adapter.
 *
 * Exists so CI never depends on network or vendor quota, and so the contract
 * suite has a reference implementation to check itself against. It is also the
 * substrate for the pathology corpus generator: the eval harness seeds a mock
 * org with deliberately broken data and measures what the system flags.
 *
 * It implements the concurrency and idempotency semantics faithfully. A mock
 * that is more forgiving than the real vendor is worse than no mock.
 */

import type {
  Account,
  Activity,
  Contact,
  NextStepChange,
  Note,
  Opportunity,
  OwnerChange,
  RecordRef,
  StageHistoryEntry,
} from './model/canonical.js';
import type {
  AdapterCapabilities,
  CrmAdapter,
  FieldWrite,
  GetAccountsResult,
  GetChildRecordsResult,
  GetContactsResult,
  GetSecondSourceRecordsResult,
  SecondSourceAccount,
  SecondSourceActivity,
  SecondSourceAdapter,
  SecondSourceCapabilities,
  SecondSourceContact,
  SecondSourceRef,
  SamplePage,
  SamplePopulation,
  SamplePopulationCount,
  SampleWindow,
  SyncPage,
  SyncWindow,
  WriteOutcome,
} from './types.js';

/**
 * Mirrors SamplePopulation: every open opportunity, and closed ones whose
 * close date falls within the window before asOf. A record that is closed
 * by only one of flag or stage is kept (a superset; the sampler re-checks).
 */
function inSamplePopulation(o: Opportunity, p: SamplePopulation): boolean {
  const closed = o.isClosed && (o.stage === 'closed_won' || o.stage === 'closed_lost');
  if (!closed) return true;
  if (!o.closeDate) return false;
  const close = Date.parse(o.closeDate);
  const asOf = new Date(p.asOf);
  const cutoff = new Date(asOf);
  cutoff.setUTCMonth(cutoff.getUTCMonth() - p.closedWithinMonths);
  return close >= cutoff.getTime() && close <= asOf.getTime();
}

export interface MockOrgData {
  accounts: Account[];
  opportunities: Opportunity[];
  contacts: Contact[];
  activities: Activity[];
  notes: Note[];
  stageHistory: StageHistoryEntry[];
  ownerChanges: OwnerChange[];
  nextStepChanges: NextStepChange[];
}

export interface MockFaults {
  /** Fail the nth call to any list method with this error kind. */
  failListOnCall?: { n: number; kind: 'rate_limit' | 'auth' | 'network' };
  /** Fail the nth call to getAccounts with this error kind. Separate from failListOnCall — getAccounts is a batch read, not a list method. */
  failGetAccountsOnCall?: { n: number; kind: 'rate_limit' | 'auth' | 'network' };
  /** Fail the nth call to getContactsByRef with this error kind. Separate counter from getAccounts, same reasoning. */
  failGetContactsOnCall?: { n: number; kind: 'rate_limit' | 'auth' | 'network' };
  /** Simulate a concurrent edit by bumping tokens before the next write. */
  driftTokensBeforeWrite?: boolean;
  /** Simulate record deletion between read and apply. */
  deleteBeforeWrite?: Set<string>;
}

export class MockAdapter implements CrmAdapter {
  readonly vendor = 'mock' as const;
  private listCalls = 0;
  private getAccountsCalls = 0;
  private getContactsCalls = 0;
  private appliedKeys = new Map<string, WriteOutcome>();

  constructor(
    readonly orgId: string,
    private data: MockOrgData,
    private caps: Partial<AdapterCapabilities> = {},
    private faults: MockFaults = {},
  ) {}

  capabilities(): AdapterCapabilities {
    return {
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
      ...this.caps,
    };
  }

  async health() {
    return { ok: true };
  }

  private page<T extends { modifiedAt?: string; createdAt?: string; occurredAt?: string; changedAt?: string }>(
    items: readonly T[],
    w: SyncWindow,
  ): SyncPage<T> {
    this.listCalls += 1;
    const f = this.faults.failListOnCall;
    if (f && f.n === this.listCalls) {
      const { AdapterError } = require('./types.js') as typeof import('./types.js');
      throw new AdapterError(`mock fault: ${f.kind}`, f.kind, f.kind !== 'auth', 1000);
    }
    const ts = (x: T) => x.modifiedAt ?? x.occurredAt ?? x.changedAt ?? x.createdAt ?? '';
    const filtered = w.since ? items.filter((x) => ts(x) >= w.since!) : items.slice();
    const sorted = [...filtered].sort((a, b) => ts(a).localeCompare(ts(b)));
    const start = w.cursor ? Number(w.cursor) : 0;
    const slice = sorted.slice(start, start + w.limit);
    const next = start + w.limit < sorted.length ? String(start + w.limit) : undefined;
    const watermark = slice.length ? ts(slice[slice.length - 1]!) : (w.since ?? '1970-01-01T00:00:00Z');
    return { items: slice, nextCursor: next, watermark, apiCallsConsumed: 1 };
  }

  async listAccounts(w: SyncWindow) { return this.page(this.data.accounts, w); }
  async listOpportunities(w: SyncWindow) { return this.page(this.data.opportunities, w); }

  async listOpportunitiesForSample(w: SampleWindow): Promise<SamplePage<Opportunity>> {
    this.listCalls += 1;
    const f = this.faults.failListOnCall;
    if (f && f.n === this.listCalls) {
      const { AdapterError } = require('./types.js') as typeof import('./types.js');
      throw new AdapterError(`mock fault: ${f.kind}`, f.kind, f.kind !== 'auth', 1000);
    }
    const sorted = this.data.opportunities
      .filter((o) => inSamplePopulation(o, w))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.ref.id.localeCompare(a.ref.id));
    const start = w.cursor ? Number(w.cursor) : 0;
    const items = sorted.slice(start, start + w.limit);
    const next = start + w.limit < sorted.length ? String(start + w.limit) : undefined;
    return { items, nextCursor: next, apiCallsConsumed: 1 };
  }

  async countOpportunitiesForSample(p: SamplePopulation): Promise<SamplePopulationCount> {
    const population = this.data.opportunities.filter((o) => inSamplePopulation(o, p));
    const open = population.filter((o) => !o.isClosed).length;
    return { open, closedInWindow: population.length - open, apiCallsConsumed: 1 };
  }
  async listContacts(w: SyncWindow) { return this.page(this.data.contacts, w); }
  async listActivities(w: SyncWindow) { return this.page(this.data.activities, w); }
  async listNotes(w: SyncWindow) { return this.page(this.data.notes, w); }

  async getAccounts(refs: readonly RecordRef[]): Promise<GetAccountsResult> {
    if (refs.length === 0) {
      return { items: [], apiCallsConsumed: 0 };
    }

    this.getAccountsCalls += 1;
    const f = this.faults.failGetAccountsOnCall;
    if (f && f.n === this.getAccountsCalls) {
      const { AdapterError } = require('./types.js') as typeof import('./types.js');
      throw new AdapterError(`mock fault: ${f.kind}`, f.kind, f.kind !== 'auth', 1000);
    }

    const idSet = new Set(refs.map((r) => r.id));
    const found = this.data.accounts.filter((a) => idSet.has(a.ref.id));
    const sorted = [...found].sort((a, b) => a.ref.id.localeCompare(b.ref.id));
    return { items: sorted, apiCallsConsumed: 1 };
  }

  async getContactsByRef(refs: readonly RecordRef[]): Promise<GetContactsResult> {
    if (refs.length === 0) {
      return { items: [], apiCallsConsumed: 0 };
    }

    this.getContactsCalls += 1;
    const f = this.faults.failGetContactsOnCall;
    if (f && f.n === this.getContactsCalls) {
      const { AdapterError } = require('./types.js') as typeof import('./types.js');
      throw new AdapterError(`mock fault: ${f.kind}`, f.kind, f.kind !== 'auth', 1000);
    }

    const idSet = new Set(refs.map((r) => r.id));
    const found = this.data.contacts.filter((c) => idSet.has(c.ref.id));
    const sorted = [...found].sort((a, b) => a.ref.id.localeCompare(b.ref.id));
    return { items: sorted, apiCallsConsumed: 1 };
  }

  private getChildRecordsByOpportunity<T>(
    allRecords: readonly T[],
    oppRefs: readonly RecordRef[],
    matchesOpportunity: (item: T, oppId: string) => boolean,
    dateOf: (item: T) => string,
    perOpportunityLimit: number,
  ): GetChildRecordsResult<T> {
    if (oppRefs.length === 0) {
      return { items: [], truncatedOpportunityIds: new Set(), apiCallsConsumed: 0 };
    }

    // A repeated ref is processed once, not duplicated — same dedupe rule as getAccounts.
    const dedupedIds: string[] = [];
    const seen = new Set<string>();
    for (const r of oppRefs) {
      if (!seen.has(r.id)) {
        seen.add(r.id);
        dedupedIds.push(r.id);
      }
    }

    const items: T[] = [];
    const truncatedOpportunityIds = new Set<string>();

    for (const oppId of dedupedIds) {
      const related = allRecords.filter((item) => matchesOpportunity(item, oppId));
      const sorted = [...related].sort((a, b) => dateOf(a).localeCompare(dateOf(b)));
      if (sorted.length > perOpportunityLimit) {
        truncatedOpportunityIds.add(oppId);
      }
      // Truncate oldest-first: keep the newest perOpportunityLimit records
      // (the tail of the ascending-sorted array), not the oldest — a
      // trailing-window reader (activity_capture_rate's 30 days,
      // stage_activity_contradiction_rate's 21) needs recent records more
      // than old ones. The kept slice stays ascending-sorted, matching the
      // contract's "sorted by ... date ascending" for returned items.
      items.push(...sorted.slice(Math.max(0, sorted.length - perOpportunityLimit)));
    }

    return { items, truncatedOpportunityIds, apiCallsConsumed: 1 };
  }

  private static matchesRelatedTo(item: { relatedTo: readonly RecordRef[] }, oppId: string): boolean {
    return item.relatedTo.some((r) => r.objectType === 'opportunity' && r.id === oppId);
  }

  async getNotesByOpportunity(oppRefs: readonly RecordRef[]): Promise<GetChildRecordsResult<Note>> {
    return this.getChildRecordsByOpportunity(
      this.data.notes,
      oppRefs,
      MockAdapter.matchesRelatedTo,
      (n) => n.createdAt,
      this.capabilities().notesPerOpportunityLimit,
    );
  }

  async getActivitiesByOpportunity(oppRefs: readonly RecordRef[]): Promise<GetChildRecordsResult<Activity>> {
    return this.getChildRecordsByOpportunity(
      this.data.activities,
      oppRefs,
      MockAdapter.matchesRelatedTo,
      (a) => a.occurredAt,
      this.capabilities().activitiesPerOpportunityLimit,
    );
  }

  async getStageHistoryByOpportunity(oppRefs: readonly RecordRef[]): Promise<GetChildRecordsResult<StageHistoryEntry>> {
    // Gated the same as listStageHistory, since both read the same
    // underlying stageHistory capability — unlike getActivitiesByOpportunity,
    // where activitySync governs interpretation, not read access.
    if (!this.capabilities().stageHistory) {
      return { items: [], truncatedOpportunityIds: new Set(), apiCallsConsumed: 0 };
    }
    return this.getChildRecordsByOpportunity(
      this.data.stageHistory,
      oppRefs,
      (s, oppId) => s.opportunityRef.id === oppId,
      (s) => s.changedAt,
      this.capabilities().historyPerOpportunityLimit,
    );
  }

  async getNextStepHistoryByOpportunity(oppRefs: readonly RecordRef[]): Promise<GetChildRecordsResult<NextStepChange>> {
    if (!this.capabilities().nextStepHistory) {
      return { items: [], truncatedOpportunityIds: new Set(), apiCallsConsumed: 0 };
    }
    return this.getChildRecordsByOpportunity(
      this.data.nextStepChanges,
      oppRefs,
      (c, oppId) => c.opportunityRef.id === oppId,
      (c) => c.changedAt,
      this.capabilities().historyPerOpportunityLimit,
    );
  }

  async listStageHistory(w: SyncWindow) {
    if (!this.capabilities().stageHistory) {
      return { items: [], watermark: w.since ?? '', apiCallsConsumed: 0 };
    }
    return this.page(this.data.stageHistory, w);
  }

  async listOwnerChanges(w: SyncWindow) {
    if (!this.capabilities().ownerHistory) {
      return { items: [], watermark: w.since ?? '', apiCallsConsumed: 0 };
    }
    return this.page(this.data.ownerChanges, w);
  }

  async getOpportunity(ref: RecordRef) {
    return this.data.opportunities.find((o) => o.ref.id === ref.id) ?? null;
  }

  async applyFieldWrite(w: FieldWrite): Promise<WriteOutcome> {
    const key = `${w.ref.id}:${w.field}:${w.expectedConcurrencyToken}:${String(w.newValue)}`;
    const prior = this.appliedKeys.get(key);
    if (prior) return prior; // idempotency

    if (this.faults.deleteBeforeWrite?.has(w.ref.id)) {
      return { status: 'not_found' };
    }

    const idx = this.data.opportunities.findIndex((o) => o.ref.id === w.ref.id);
    if (idx < 0) return { status: 'not_found' };
    const current = this.data.opportunities[idx]!;

    const effectiveToken = this.faults.driftTokensBeforeWrite
      ? current.concurrencyToken + '-drifted'
      : current.concurrencyToken;

    if (effectiveToken !== w.expectedConcurrencyToken) {
      return {
        status: 'conflict',
        currentValue: (current as unknown as Record<string, string | number | null>)[w.field] ?? null,
        currentToken: effectiveToken,
      };
    }

    const newToken = `${effectiveToken}+1`;
    this.data.opportunities[idx] = {
      ...current,
      [w.field]: w.newValue,
      concurrencyToken: newToken,
      modifiedAt: new Date().toISOString(),
    } as Opportunity;

    const outcome: WriteOutcome = { status: 'applied', newConcurrencyToken: newToken };
    this.appliedKeys.set(key, outcome);
    return outcome;
  }
}

/**
 * In-memory mock second-source adapter (D5 cross-system joinability).
 * Design locked in packages/readiness/docs/second-source-adapter-design.md.
 *
 * No fault injection (MockFaults-equivalent) — deliberately deferred, see
 * that design note / packages/readiness/docs/STATUS.md. Does not enforce
 * capabilities().maxSampleSizePerType: that cap is caller-enforced by
 * design (D5 orchestration), not the adapter's job — see the type's
 * docblock in types.ts.
 */
export interface MockSecondSourceOrgData {
  contacts: SecondSourceContact[];
  accounts: SecondSourceAccount[];
  activities: SecondSourceActivity[];
}

export class MockSecondSourceAdapter implements SecondSourceAdapter {
  constructor(
    private data: MockSecondSourceOrgData,
    private caps: Partial<SecondSourceCapabilities> = {},
  ) {}

  capabilities(): SecondSourceCapabilities {
    return {
      kind: 'engagement',
      hasContacts: true,
      hasAccounts: true,
      hasActivities: true,
      refBatchLimit: 200,
      activitiesPerRefLimit: 200,
      maxSampleSizePerType: 500,
      ...this.caps,
    };
  }

  private page<T>(items: readonly T[], w: SyncWindow, ts: (x: T) => string): SyncPage<T> {
    const filtered = w.since ? items.filter((x) => ts(x) >= w.since!) : items.slice();
    const sorted = [...filtered].sort((a, b) => ts(a).localeCompare(ts(b)));
    const start = w.cursor ? Number(w.cursor) : 0;
    const slice = sorted.slice(start, start + w.limit);
    const next = start + w.limit < sorted.length ? String(start + w.limit) : undefined;
    const watermark = slice.length ? ts(slice[slice.length - 1]!) : (w.since ?? '1970-01-01T00:00:00Z');
    return { items: slice, nextCursor: next, watermark, apiCallsConsumed: 1 };
  }

  async listContacts(w: SyncWindow): Promise<SyncPage<SecondSourceContact>> {
    if (!this.capabilities().hasContacts) {
      return { items: [], watermark: w.since ?? '', apiCallsConsumed: 0 };
    }
    return this.page(this.data.contacts, w, (c) => c.modifiedAt);
  }

  async listAccounts(w: SyncWindow): Promise<SyncPage<SecondSourceAccount>> {
    if (!this.capabilities().hasAccounts) {
      return { items: [], watermark: w.since ?? '', apiCallsConsumed: 0 };
    }
    return this.page(this.data.accounts, w, (a) => a.modifiedAt);
  }

  async listActivities(w: SyncWindow): Promise<SyncPage<SecondSourceActivity>> {
    if (!this.capabilities().hasActivities) {
      return { items: [], watermark: w.since ?? '', apiCallsConsumed: 0 };
    }
    return this.page(this.data.activities, w, (a) => a.lastModifiedAt);
  }

  private getByRef<T extends { ref: SecondSourceRef }>(
    allRecords: readonly T[],
    refs: readonly SecondSourceRef[],
    has: boolean,
  ): GetSecondSourceRecordsResult<T> {
    if (refs.length === 0 || !has) {
      return { items: [], truncatedRefIds: new Set(), apiCallsConsumed: refs.length === 0 ? 0 : 1 };
    }
    const idSet = new Set(refs.map((r) => r.id));
    const found = allRecords.filter((r) => idSet.has(r.ref.id));
    const sorted = [...found].sort((a, b) => a.ref.id.localeCompare(b.ref.id));
    return { items: sorted, truncatedRefIds: new Set(), apiCallsConsumed: 1 };
  }

  async getContactsByRef(refs: readonly SecondSourceRef[]): Promise<GetSecondSourceRecordsResult<SecondSourceContact>> {
    return this.getByRef(this.data.contacts, refs, this.capabilities().hasContacts);
  }

  async getAccountsByRef(refs: readonly SecondSourceRef[]): Promise<GetSecondSourceRecordsResult<SecondSourceAccount>> {
    return this.getByRef(this.data.accounts, refs, this.capabilities().hasAccounts);
  }

  async getActivitiesByRef(refs: readonly SecondSourceRef[]): Promise<GetSecondSourceRecordsResult<SecondSourceActivity>> {
    if (refs.length === 0 || !this.capabilities().hasActivities) {
      return { items: [], truncatedRefIds: new Set(), apiCallsConsumed: refs.length === 0 ? 0 : 1 };
    }

    // A repeated ref is processed once, not duplicated — same dedupe rule as getAccounts.
    const dedupedRefs: SecondSourceRef[] = [];
    const seen = new Set<string>();
    for (const r of refs) {
      if (!seen.has(r.id)) {
        seen.add(r.id);
        dedupedRefs.push(r);
      }
    }

    const limit = this.capabilities().activitiesPerRefLimit;
    const items: SecondSourceActivity[] = [];
    const truncatedRefIds = new Set<string>();

    for (const parentRef of dedupedRefs) {
      const related = this.data.activities.filter((a) =>
        parentRef.objectType === 'contact' ? a.contactRef?.id === parentRef.id : a.accountRef?.id === parentRef.id,
      );
      const sorted = [...related].sort((a, b) => a.occurredAt.localeCompare(b.occurredAt));
      if (sorted.length > limit) {
        truncatedRefIds.add(parentRef.id);
      }
      // Keep-newest, drop-oldest — same truncation order as
      // CrmAdapter.getActivitiesByOpportunity, and for the same reason:
      // callers of this window (activity_attribution_rate) care about
      // recency more than completeness.
      items.push(...sorted.slice(Math.max(0, sorted.length - limit)));
    }

    return { items, truncatedRefIds, apiCallsConsumed: 1 };
  }
}

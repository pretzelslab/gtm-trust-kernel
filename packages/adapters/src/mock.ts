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
  SyncPage,
  SyncWindow,
  WriteOutcome,
} from './types.js';

export interface MockOrgData {
  accounts: Account[];
  opportunities: Opportunity[];
  contacts: Contact[];
  activities: Activity[];
  notes: Note[];
  stageHistory: StageHistoryEntry[];
  ownerChanges: OwnerChange[];
}

export interface MockFaults {
  /** Fail the nth call to any list method with this error kind. */
  failListOnCall?: { n: number; kind: 'rate_limit' | 'auth' | 'network' };
  /** Fail the nth call to getAccounts with this error kind. Separate from failListOnCall — getAccounts is a batch read, not a list method. */
  failGetAccountsOnCall?: { n: number; kind: 'rate_limit' | 'auth' | 'network' };
  /** Simulate a concurrent edit by bumping tokens before the next write. */
  driftTokensBeforeWrite?: boolean;
  /** Simulate record deletion between read and apply. */
  deleteBeforeWrite?: Set<string>;
}

export class MockAdapter implements CrmAdapter {
  readonly vendor = 'mock' as const;
  private listCalls = 0;
  private getAccountsCalls = 0;
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
      activitySync: true,
      incrementalSync: true,
      bulkRead: true,
      writeGranularity: 'field',
      nativeConcurrencyCheck: false,
      rateLimit: { kind: 'none', value: 0 },
      stageMap: {},
      accountBatchLimit: 200,
      childRecordBatchLimit: 200,
      notesPerOpportunityLimit: 200,
      activitiesPerOpportunityLimit: 200,
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

  private getChildRecordsByOpportunity<T extends { relatedTo: readonly RecordRef[] }>(
    allRecords: readonly T[],
    oppRefs: readonly RecordRef[],
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
      const related = allRecords.filter((item) => item.relatedTo.some((r) => r.objectType === 'opportunity' && r.id === oppId));
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

  async getNotesByOpportunity(oppRefs: readonly RecordRef[]): Promise<GetChildRecordsResult<Note>> {
    return this.getChildRecordsByOpportunity(this.data.notes, oppRefs, (n) => n.createdAt, this.capabilities().notesPerOpportunityLimit);
  }

  async getActivitiesByOpportunity(oppRefs: readonly RecordRef[]): Promise<GetChildRecordsResult<Activity>> {
    return this.getChildRecordsByOpportunity(
      this.data.activities,
      oppRefs,
      (a) => a.occurredAt,
      this.capabilities().activitiesPerOpportunityLimit,
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

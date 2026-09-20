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
  /** Simulate a concurrent edit by bumping tokens before the next write. */
  driftTokensBeforeWrite?: boolean;
  /** Simulate record deletion between read and apply. */
  deleteBeforeWrite?: Set<string>;
}

export class MockAdapter implements CrmAdapter {
  readonly vendor = 'mock' as const;
  private listCalls = 0;
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
      incrementalSync: true,
      bulkRead: true,
      writeGranularity: 'field',
      nativeConcurrencyCheck: false,
      rateLimit: { kind: 'none', value: 0 },
      stageMap: {},
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

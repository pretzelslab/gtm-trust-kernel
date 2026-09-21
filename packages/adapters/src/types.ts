/**
 * CRM adapter interface and capability matrix.
 *
 * The seam is proven by test/contract/adapter.contract.ts, which every adapter
 * must pass identically. That suite is the real portfolio artifact: it is what
 * makes "CRM-agnostic" a claim rather than a hope.
 *
 * Design rule: the app degrades by declared capability. It never assumes a
 * feature exists and catches the failure. If an adapter cannot report field
 * history, the signals that need field history are suppressed with a stated
 * reason, not silently wrong.
 */

import type {
  Account,
  Activity,
  Contact,
  CanonicalStage,
  Note,
  Opportunity,
  OwnerChange,
  RecordRef,
  StageHistoryEntry,
  CrmVendor,
} from './model/canonical.js';

export interface AdapterCapabilities {
  /** Can report stage transition history (Salesforce OpportunityHistory). */
  readonly stageHistory: boolean;
  /** Can report owner change history. */
  readonly ownerHistory: boolean;
  /**
   * Auto-captures activities via email/calendar sync (e.g. Salesforce
   * Einstein Activity Capture), rather than relying on manual logging.
   * Gates activity_capture_rate: without it, silence isn't a reliable signal.
   */
  readonly activitySync: boolean;
  /** Supports change-data-capture or a modified-since watermark for deltas. */
  readonly incrementalSync: boolean;
  /** Supports bulk read for backfill. */
  readonly bulkRead: boolean;
  /** Write granularity the vendor supports. */
  readonly writeGranularity: 'field' | 'record' | 'none';
  /** Vendor enforces optimistic concurrency natively (else we compare tokens). */
  readonly nativeConcurrencyCheck: boolean;
  /** Rate limit shape, used by the scheduler to plan sync. */
  readonly rateLimit: {
    readonly kind: 'daily_quota' | 'per_second' | 'none';
    readonly value: number;
  };
  /** Maps vendor stage labels onto the canonical ladder. */
  readonly stageMap: Readonly<Record<string, CanonicalStage>>;
  /**
   * Max refs per getAccounts() call, declared by the adapter for callers to
   * plan batches against (e.g. Salesforce SOQL "WHERE Id IN (...)" practice).
   * Advisory only: the adapter itself does not enforce or truncate at this
   * limit — chunking to it is the caller's responsibility.
   */
  readonly accountBatchLimit: number;
}

export interface SyncWindow {
  /** ISO timestamp. Adapter returns records modified at or after this. */
  readonly since?: string;
  readonly limit: number;
  readonly cursor?: string;
}

export interface SyncPage<T> {
  readonly items: readonly T[];
  readonly nextCursor?: string;
  /** High-water mark to persist for the next incremental run. */
  readonly watermark: string;
  /** Vendor API calls consumed by this page, for quota telemetry. */
  readonly apiCallsConsumed: number;
}

/**
 * Result of a batched by-ref account read (CrmAdapter.getAccounts). Not a
 * SyncPage: this is a bounded batch read, not a cursor-paginated stream.
 */
export interface GetAccountsResult {
  /**
   * Accounts found, at most one entry per distinct requested ref (a
   * repeated ref in the request yields one entry, not a repeat), sorted by
   * ref.id ascending — deterministic and independent of backend/storage
   * order. Refs that don't resolve are simply absent; never throws for a
   * not-found ref.
   */
  readonly items: readonly Account[];
  /** Vendor API calls consumed by this call. 0 for an empty refs array. */
  readonly apiCallsConsumed: number;
}

/**
 * A single-field write, always scoped to one record and gated by the proposal
 * kernel. There is deliberately no "update record" method taking an arbitrary
 * object: the narrow surface is the safety property.
 */
export interface FieldWrite {
  readonly ref: RecordRef;
  readonly field: string;
  readonly newValue: string | number | null;
  /** Value read at proposal time, used to build the inverse patch. */
  readonly previousValue: string | number | null;
  /** Concurrency token captured at read. Apply refuses if drifted. */
  readonly expectedConcurrencyToken: string;
}

export type WriteOutcome =
  | { readonly status: 'applied'; readonly newConcurrencyToken: string }
  | { readonly status: 'conflict'; readonly currentValue: string | number | null; readonly currentToken: string }
  | { readonly status: 'not_found' }
  | { readonly status: 'rejected'; readonly reason: string };

export interface CrmAdapter {
  readonly vendor: CrmVendor;
  readonly orgId: string;
  capabilities(): AdapterCapabilities;

  /** Cheap liveness and auth check. Must not consume meaningful quota. */
  health(): Promise<{ ok: boolean; detail?: string }>;

  listAccounts(w: SyncWindow): Promise<SyncPage<Account>>;
  listOpportunities(w: SyncWindow): Promise<SyncPage<Opportunity>>;
  listContacts(w: SyncWindow): Promise<SyncPage<Contact>>;
  listActivities(w: SyncWindow): Promise<SyncPage<Activity>>;
  listNotes(w: SyncWindow): Promise<SyncPage<Note>>;

  /**
   * Batched by-ref account read, for hydrating accounts related to an
   * already-sampled set of opportunities without a full listAccounts()
   * scan. refs beyond capabilities().accountBatchLimit in one call are NOT
   * rejected or truncated — respecting that limit is the caller's job.
   */
  getAccounts(refs: readonly RecordRef[]): Promise<GetAccountsResult>;

  /** Must return empty (not throw) when capabilities().stageHistory is false. */
  listStageHistory(w: SyncWindow): Promise<SyncPage<StageHistoryEntry>>;
  /** Must return empty (not throw) when capabilities().ownerHistory is false. */
  listOwnerChanges(w: SyncWindow): Promise<SyncPage<OwnerChange>>;

  getOpportunity(ref: RecordRef): Promise<Opportunity | null>;

  /**
   * Apply exactly one field write. Implementations MUST:
   *  - return 'conflict' when the stored token differs from expected
   *  - return 'not_found' when the record is gone
   *  - be idempotent for a repeated identical call with the same token
   */
  applyFieldWrite(w: FieldWrite): Promise<WriteOutcome>;
}

export class AdapterError extends Error {
  constructor(
    message: string,
    readonly kind:
      | 'auth'
      | 'rate_limit'
      | 'network'
      | 'schema'
      | 'permission'
      | 'unknown',
    readonly retryable: boolean,
    readonly retryAfterMs?: number,
  ) {
    super(message);
    this.name = 'AdapterError';
  }
}

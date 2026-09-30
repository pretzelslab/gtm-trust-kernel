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
  NextStepChange,
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
   * Can report a change history for the Close Date field, sufficient to
   * detect slip. Not necessarily the same mechanism as stageHistory/
   * ownerHistory: on Salesforce this is backed by the same always-on
   * OpportunityHistory object as stageHistory (confirmed against docs and a
   * live query — see docs/metric-definitions.md's close_date_history_enabled
   * entry), not the admin-gated Field History Tracking feature that
   * ownerHistory genuinely needs. Other adapters may need a different,
   * genuinely gated mechanism — don't assume this one's availability
   * pattern generalizes.
   */
  readonly closeDateHistory: boolean;
  /**
   * Can report a change history for the Next Step field (when it was last
   * edited, not its value). Unlike closeDateHistory, Salesforce has no
   * always-on equivalent for this field — it genuinely needs the
   * admin-gated Field History Tracking feature, same as ownerHistory.
   */
  readonly nextStepHistory: boolean;
  /**
   * Auto-captures activities via email/calendar sync (e.g. Salesforce
   * Einstein Activity Capture), rather than relying on manual logging.
   * Gates activity_capture_rate: without it, silence isn't a reliable signal.
   */
  readonly activitySync: boolean;
  /**
   * Optional, per capability: one plain-English sentence telling the user
   * how to turn that capability on for this adapter (a setting, not a CRM
   * change), shown in the readiness report when the capability is off.
   * Adapter-authored static text only, never org data. Omit when no user
   * setting can turn the capability on.
   */
  readonly settingHints?: {
    readonly activitySync?: string;
  };
  /**
   * Optional: one plain-English sentence telling the user how to map stages
   * this adapter doesn't recognise, shown in the readiness report only when
   * the scan found an unmapped stage. Adapter-authored static text only,
   * never a stage label or other org data.
   */
  readonly stageMapHint?: string;
  /**
   * Optional: the API calls this adapter makes for a readiness report run,
   * beyond the listing pages and account batches every adapter shares, so
   * the printed plan can state the whole run's worst case. Omit when the
   * adapter's calls don't count against a quota.
   */
  readonly apiCallEstimate?: {
    /** Fixed calls per run, whatever the org's size (e.g. population counts). */
    readonly perRun: number;
    /** Extra calls per listing page (e.g. a batch of child records loaded with each page). */
    readonly perScanPage: number;
    /** Unbatched calls per sampled opportunity during the detailed checks. */
    readonly perSampledOpportunity: number;
    /** Batched calls per childRecordBatchLimit sampled opportunities during the detailed checks. */
    readonly perChildRecordBatch: number;
    /** Most per-record fetches a run may make on top of the above (a cap, not an estimate). */
    readonly perRunFetchCap: number;
  };
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
  /**
   * Max refs per getContactsByRef() call. Advisory only, same contract as
   * accountBatchLimit — a different field because contacts and accounts
   * are different ref types, not because the limit itself differs (same
   * reasoning childRecordBatchLimit got its own field).
   */
  readonly contactBatchLimit: number;
  /**
   * Max opportunity refs per getNotesByOpportunity()/getActivitiesByOpportunity()
   * call. Advisory only, same contract as accountBatchLimit — the adapter
   * does not enforce or truncate at this limit; chunking to it is the
   * caller's job. Shared by both methods since both batch on the same kind
   * of ref (an opportunity, the parent of the records being read).
   */
  readonly childRecordBatchLimit: number;
  /**
   * Max Notes returned per opportunity by a single getNotesByOpportunity()
   * call. Unlike accountBatchLimit/childRecordBatchLimit, this ONE the
   * adapter does enforce: an opportunity with more related notes than this
   * has its result capped, and its ref.id reported in
   * GetChildRecordsResult.truncatedOpportunityIds so the count is never
   * silently undercounted as exact. When capping, an adapter MUST truncate
   * oldest-first — keep the newest notesPerOpportunityLimit records, drop
   * the oldest — never the reverse. Readers of these records care about
   * recency (activity_capture_rate's trailing 30 days,
   * stage_activity_contradiction_rate's trailing 21), so an adapter that
   * truncates newest-first would silently make truncation worse than no
   * cap at all for exactly the callers who need recent data most.
   */
  readonly notesPerOpportunityLimit: number;
  /** Same contract as notesPerOpportunityLimit, for getActivitiesByOpportunity(). */
  readonly activitiesPerOpportunityLimit: number;
  /**
   * Max StageHistoryEntry/NextStepChange records returned per opportunity by
   * a single getStageHistoryByOpportunity()/getNextStepHistoryByOpportunity()
   * call. Shared by both methods, unlike notesPerOpportunityLimit/
   * activitiesPerOpportunityLimit getting their own fields — those track
   * potentially-large free-text collections; these two track small,
   * inherently bounded history sequences (pipeline depth; Next Step edit
   * count), the same "one shared field" reasoning childRecordBatchLimit
   * already uses for ref-batch size. Same enforcement/truncation contract as
   * notesPerOpportunityLimit where it applies (keep-newest, drop-oldest).
   */
  readonly historyPerOpportunityLimit: number;
}

export interface SyncWindow {
  /** ISO timestamp. Adapter returns records modified at or after this. */
  readonly since?: string;
  readonly limit: number;
  readonly cursor?: string;
}

/**
 * The opportunities a readiness sample can use: every open opportunity, and
 * closed ones whose close date falls within `closedWithinMonths` before
 * `asOf` (inclusive of both ends). A superset is allowed at the edges (the
 * caller re-checks each record); a record inside this definition must
 * never be left out.
 */
export interface SamplePopulation {
  /** ISO timestamp: the sample's reference "now". */
  readonly asOf: string;
  readonly closedWithinMonths: number;
}

export interface SampleWindow extends SamplePopulation {
  readonly limit: number;
  readonly cursor?: string;
}

export interface SamplePage<T> {
  readonly items: readonly T[];
  readonly nextCursor?: string;
  readonly apiCallsConsumed: number;
}

export interface SamplePopulationCount {
  /** Open opportunities in the population. */
  readonly open: number;
  /** Closed opportunities in the population's close-date window. */
  readonly closedInWindow: number;
  readonly apiCallsConsumed: number;
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
 * Result of a batched by-ref contact read (CrmAdapter.getContactsByRef).
 * Same contract shape as GetAccountsResult, for the same reason: a contact
 * ref resolves to at most one Contact.
 */
export interface GetContactsResult {
  readonly items: readonly Contact[];
  /** Vendor API calls consumed by this call. 0 for an empty refs array. */
  readonly apiCallsConsumed: number;
}

/**
 * Result of a batched by-opportunity-ref child-record read
 * (CrmAdapter.getNotesByOpportunity / getActivitiesByOpportunity). Not a
 * SyncPage: a bounded batch read, not a cursor-paginated stream. Named
 * "byOpportunity" and parameterized "oppRefs" to make clear the refs are
 * the PARENTS being queried, not the records themselves — an opportunity
 * ref maps to zero or more child records, unlike getAccounts' one-ref-to-
 * at-most-one-account shape.
 */
export interface GetChildRecordsResult<T> {
  /**
   * Every resolvable requested opportunity ref's related records, sorted
   * by the owning opportunity's ref.id (in the order requested refs were
   * given), then by the record's own date field (createdAt for Notes,
   * occurredAt for Activities) ascending within that opportunity. An
   * opportunity with zero related records contributes zero items — not an
   * error, and not distinguishable in this array from an unresolvable
   * opportunity ref, which also contributes zero items and never throws.
   * A ref repeated in the request is processed once, not duplicated.
   */
  readonly items: readonly T[];
  /**
   * ref.ids of opportunities whose related-record count was capped at the
   * adapter's per-opportunity advisory limit (notesPerOpportunityLimit /
   * activitiesPerOpportunityLimit) — more records exist than were
   * returned for that opportunity. Callers must treat that opportunity's
   * count as "at least N", never exact, and should surface the
   * truncation rather than silently undercounting. When an opportunity is
   * truncated, the surviving records MUST be the newest
   * notesPerOpportunityLimit/activitiesPerOpportunityLimit, not the
   * oldest — see notesPerOpportunityLimit's docblock (AdapterCapabilities)
   * for why.
   */
  readonly truncatedOpportunityIds: ReadonlySet<string>;
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
  /**
   * The sample population (see SamplePopulation), newest created first,
   * ties broken by id descending, so a scan that stops early has read the
   * most recently created deals. Deterministic paging; contactLinks
   * populated as in listOpportunities.
   */
  listOpportunitiesForSample(w: SampleWindow): Promise<SamplePage<Opportunity>>;
  /** Sizes of the sample population, so a report can say how much of it a scan covered. */
  countOpportunitiesForSample(p: SamplePopulation): Promise<SamplePopulationCount>;
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

  /**
   * Batched by-ref contact read, for hydrating contacts related to an
   * already-sampled set of opportunities (via their contactLinks) without a
   * full listContacts() scan. Same contract as getAccounts: refs beyond
   * capabilities().contactBatchLimit in one call are NOT rejected or
   * truncated — chunking is the caller's job.
   */
  getContactsByRef(refs: readonly RecordRef[]): Promise<GetContactsResult>;

  /**
   * Batched by-opportunity-ref Note read, for hydrating notes related to an
   * already-sampled set of opportunities without a full listNotes() scan —
   * listNotes has no ref filter, only a since-window, the same gap
   * getAccounts closed for accounts. oppRefs beyond
   * capabilities().childRecordBatchLimit in one call are NOT rejected or
   * truncated — respecting that limit is the caller's job. Not gated on any
   * capability: notes are always readable regardless of activitySync
   * (that flag is about auto-capture of Activities, unrelated to Notes).
   * Per-opportunity truncation at capabilities().notesPerOpportunityLimit
   * IS enforced by the adapter, oldest-first — see that field's docblock.
   */
  getNotesByOpportunity(oppRefs: readonly RecordRef[]): Promise<GetChildRecordsResult<Note>>;

  /**
   * Same contract as getNotesByOpportunity, for Activity records. Also not
   * gated on activitySync itself — that capability governs how
   * activity_capture_rate INTERPRETS the presence or absence of activities
   * (silence isn't reliable without auto-capture), not whether Activity
   * records can be read at all. Manually-logged activities can exist and
   * be readable even when activitySync is false.
   */
  getActivitiesByOpportunity(oppRefs: readonly RecordRef[]): Promise<GetChildRecordsResult<Activity>>;

  /**
   * Same by-ref batch shape as getNotesByOpportunity, for full per-opportunity
   * stage-transition sequences (win_rate_dispersion needs every stage a
   * closed deal passed through, not just listStageHistory's one org-wide
   * earliest entry). Must return empty (not throw) when
   * capabilities().stageHistory is false — same gate listStageHistory
   * already has for this same capability. Unlike
   * getActivitiesByOpportunity/activitySync, stageHistory already governs
   * read access itself, not just interpretation of absence.
   */
  getStageHistoryByOpportunity(oppRefs: readonly RecordRef[]): Promise<GetChildRecordsResult<StageHistoryEntry>>;

  /**
   * Same by-ref batch shape as getNotesByOpportunity, for NextStepChange
   * records (median_next_step_age_days needs the latest Next-Step change
   * per sampled opportunity). Must return empty (not throw) when
   * capabilities().nextStepHistory is false.
   */
  getNextStepHistoryByOpportunity(oppRefs: readonly RecordRef[]): Promise<GetChildRecordsResult<NextStepChange>>;

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

/**
 * Second source (D5 cross-system joinability): an engagement tool or a
 * billing/product system, connected alongside the CRM adapter. Design
 * locked in packages/readiness/docs/second-source-adapter-design.md —
 * see that doc for the decisions behind this shape. Deliberately a
 * separate interface from CrmAdapter/AdapterCapabilities, not an
 * extension: a different object model, and a connection lifecycle where
 * it may not exist at all (unlike a CRM capability flag being false).
 */

export type SecondSourceObjectType = 'contact' | 'account' | 'activity';

/**
 * Opaque, second-source-qualified record ref. Not RecordRef: RecordRef.crm
 * is typed CrmVendor ('salesforce' | 'hubspot' | 'mock'), a closed union
 * of CRM vendors that doesn't fit a non-CRM source. `source` is an open
 * string since no real second-source vendor is implemented yet.
 */
export type SecondSourceRef = {
  readonly source: string;
  readonly orgId: string;
  readonly objectType: SecondSourceObjectType;
  readonly id: string;
};

export interface SecondSourceCapabilities {
  /** Informational, may drive report copy. */
  readonly kind: 'engagement' | 'billing';
  /**
   * Per-record-type availability. A metric gates on the specific flag(s)
   * it needs (e.g. account_resolution_rate only needs hasAccounts), not
   * on "is a second source connected" alone. When a flag is false, the
   * corresponding list-or-get-by-ref method returns empty rather than
   * throwing — callers MUST gate on the flag itself and MUST NOT infer
   * capability from an empty result (same reasoning as activitySync:
   * without checking the flag, silence isn't a reliable signal).
   */
  readonly hasContacts: boolean;
  readonly hasAccounts: boolean;
  readonly hasActivities: boolean;
  /**
   * Max refs per getContactsByRef()/getAccountsByRef()/
   * getActivitiesByRef() call. Advisory only, same contract as
   * CrmAdapter's childRecordBatchLimit — the adapter does not enforce or
   * truncate at this limit; chunking is the caller's job.
   */
  readonly refBatchLimit: number;
  /**
   * Max Activity records returned per contact/account ref by a single
   * getActivitiesByRef() call. Enforced by the adapter, same contract as
   * CrmAdapter's notesPerOpportunityLimit/activitiesPerOpportunityLimit:
   * truncation keeps the newest records and drops the oldest, and the
   * truncated ref is reported rather than silently undercounted.
   */
  readonly activitiesPerRefLimit: number;
  /**
   * Hard cap on total records pulled per record type across an entire D5
   * run's listContacts()/listAccounts()/listActivities() pagination.
   * Applies independently per type. Unlike activitiesPerRefLimit, this is
   * caller-enforced, not adapter-enforced: the caller (D5 orchestration)
   * MUST stop paging once it reaches this many items for a type, even if
   * nextCursor is still present — never stream to the end of the second
   * source's table. Not enforced by the mock; part 2 must test that
   * orchestration enforces it.
   */
  readonly maxSampleSizePerType: number;
}

export interface SecondSourceContact {
  readonly ref: SecondSourceRef;
  readonly email: string | null;
  readonly modifiedAt: string;
}

export interface SecondSourceAccount {
  readonly ref: SecondSourceRef;
  readonly domain: string | null;
  readonly modifiedAt: string;
}

export interface SecondSourceActivity {
  readonly ref: SecondSourceRef;
  readonly contactRef: SecondSourceRef | null;
  readonly accountRef: SecondSourceRef | null;
  readonly occurredAt: string;
  readonly kind: 'call' | 'email' | 'meeting' | 'other';
  readonly createdAt: string;
  readonly lastModifiedAt: string;
}

/**
 * Result of a batched by-ref second-source read. Not a SyncPage: a
 * bounded batch read, not a cursor-paginated stream. Shared across all
 * three getXByRef methods for shape consistency with GetChildRecordsResult;
 * truncatedRefIds is only ever non-empty for getActivitiesByRef (contacts
 * and accounts have no per-ref collection to truncate — one ref resolves
 * to at most one record, same as CrmAdapter's GetAccountsResult).
 */
export interface GetSecondSourceRecordsResult<T> {
  /**
   * Records found, sorted by ref.id ascending — deterministic and
   * independent of backend/storage order. Refs that don't resolve are
   * simply absent; never throws for a not-found ref. A ref repeated in
   * the request is processed once, not duplicated.
   */
  readonly items: readonly T[];
  /**
   * ref.ids whose related-activity count was capped at
   * activitiesPerRefLimit — more records exist than were returned for
   * that ref. Same "at least N, never exact" contract as
   * GetChildRecordsResult.truncatedOpportunityIds, including the
   * keep-newest/drop-oldest truncation-order requirement.
   */
  readonly truncatedRefIds: ReadonlySet<string>;
  /** Vendor API calls consumed by this call. 0 for an empty refs array. */
  readonly apiCallsConsumed: number;
}

export interface SecondSourceAdapter {
  capabilities(): SecondSourceCapabilities;

  /**
   * Since-window + cursor pagination, same shape as CrmAdapter's
   * listNotes/listActivities. capabilities().maxSampleSizePerType is
   * caller-enforced, not checked by these methods. Returns empty (not
   * throwing) when the corresponding has* capability is false.
   */
  listContacts(w: SyncWindow): Promise<SyncPage<SecondSourceContact>>;
  listAccounts(w: SyncWindow): Promise<SyncPage<SecondSourceAccount>>;
  listActivities(w: SyncWindow): Promise<SyncPage<SecondSourceActivity>>;

  /**
   * Same contract as CrmAdapter.getAccounts: missing refs are absent from
   * the result, never thrown; results sorted by ref.id. Returns empty
   * (not throwing) when capabilities().hasContacts/hasAccounts is false.
   */
  getContactsByRef(refs: readonly SecondSourceRef[]): Promise<GetSecondSourceRecordsResult<SecondSourceContact>>;
  getAccountsByRef(refs: readonly SecondSourceRef[]): Promise<GetSecondSourceRecordsResult<SecondSourceAccount>>;

  /**
   * Per-ref batch read with enforced per-ref truncation — same contract
   * shape as CrmAdapter.getActivitiesByOpportunity, but keyed by a
   * contact or account ref instead of an opportunity ref (matched on
   * whichever the given ref's objectType is). Returns empty (not
   * throwing) when capabilities().hasActivities is false.
   */
  getActivitiesByRef(refs: readonly SecondSourceRef[]): Promise<GetSecondSourceRecordsResult<SecondSourceActivity>>;
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

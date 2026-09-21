# Second-source adapter — design note (decisions locked, not implemented)

Motivated by D5 (`packages/readiness/docs/metric-definitions.md`)
cross-system joinability metrics. This note's design decisions are locked
(2026-09-21) — every open question raised in the first draft has been
resolved below. Nothing here is implemented: no adapter code, no mock, no
tests exist yet. Per `CLAUDE.md` rule 4, the actual interface/
implementation change based on this note still needs its own
plan-and-wait pass before writing (see the separate D5-part-1 plan for
that).

## Scope

D5's four metrics (`contact_identity_resolution_rate`,
`account_resolution_rate`, `activity_attribution_rate`,
`temporal_anomaly_rate`) need a second source — an engagement tool or a
billing/product system — connected alongside the CRM adapter. This note
specifies what that second source's adapter contract looks like, modeled
on `packages/adapters/src/types.ts`'s existing `CrmAdapter` conventions:
by-ref batch reads, list-with-cursor reads, advisory-vs-enforced limits,
and truncation reporting.

## Decisions (locked)

1. **Separate `SecondSourceAdapter` interface, not an extension of
   `CrmAdapter`.** Own `SecondSourceCapabilities` type, own object model.
   Reasoning: the scope doc (`claude/gtm-readiness-scope.md`) treats the
   second source as a genuinely distinct system — a different object
   model (no `Opportunity`/`Stage`), a connection lifecycle where it may
   not be configured at all, and D5's gate-off case (`not_instrumented`,
   see `metric-definitions.md`) reads more naturally as "this adapter is
   absent" than as "this capability flag is false" on the CRM adapter.
   **Tradeoff accepted:** two adapter interfaces for the orchestration
   layer to wire through instead of one.

2. **Add `list*` methods** (`listContacts`/`listAccounts`/
   `listActivities`), same since-window + cursor shape as `CrmAdapter`'s
   `listNotes`/`listActivities` (`SyncWindow`/`SyncPage<T>`), **plus a
   hard per-type sample cap.** The caller MUST stop paging once it hits
   that cap for a given record type, even if `nextCursor` is still
   present — never stream to the end of the second source's table, same
   "never full-scan a production org" rule `getAccounts` (D3 part 2a) was
   built to satisfy. By-ref reads alone (below) can match records but
   can't populate `activity_attribution_rate`'s/`temporal_anomaly_rate`'s
   "sampled second-source records" denominators — `list*` closes that
   gap.

3. **Timezone/timestamp-precision consistency is explicitly NOT folded
   into `temporal_anomaly_rate`.** Doing so would require pairing a CRM
   record with its second-source counterpart per comparison, which
   conflicts with `temporal_anomaly_rate`'s pooled, unpaired denominator
   (`metric-definitions.md`: "the sum of both sources' sampled records...
   a record from either source can independently trip the numerator").
   Recorded as a **known gap** against the original scope doc's D5
   "temporal alignment" bullet (`claude/gtm-readiness-scope.md:94`) — a
   possible future metric, not scoped into D5 v0.1 and not implied by
   anything already committed.

4. **Adapters return raw records; hashing happens at the readiness
   package's ingestion boundary, which drops the raw fields immediately
   after hashing.** `SecondSourceAdapter` itself never hashes — it's a
   thin data-access contract, reusable regardless of what a caller does
   with the data. The orchestration layer (D5's run loop) is the one
   place raw email/domain values exist in memory, only until each is
   hashed, per the per-run-salt/discard-at-end-of-run rule already in
   `metric-definitions.md`. **New requirement carried into
   implementation:** a test asserting no raw email or domain value
   appears anywhere in `ReportData` or `--json` output — this closes the
   loop on "raw emails are never materialized in this tool"
   (`gtm-readiness-scope.md:96`/`:260`) with an actual assertion, not
   just doc language. To be written as part of D5 part 1 or whichever
   phase first produces real `ReportData` from second-source input.

5. **Per-record-type capability flags** (`hasContacts`/`hasAccounts`/
   `hasActivities`) on `SecondSourceCapabilities`, not a single
   all-or-nothing adapter-presence check. Each D5 metric gates on the
   specific flag(s) it needs (e.g. `account_resolution_rate` only needs
   `hasAccounts`) rather than on "is a second source connected" alone —
   a billing system with accounts but no activity log can still
   instrument `account_resolution_rate` while `activity_attribution_rate`
   correctly falls back to `not_instrumented`.
   **`has*: false` behavior (locked):** the corresponding `list*`/
   `get*ByRef` method returns empty rather than throwing — same contract
   as `CrmAdapter.listStageHistory`'s "must return empty (not throw) when
   capabilities().stageHistory is false." Callers MUST gate on the flag
   itself before deciding a record type is unavailable, and MUST NOT
   infer capability from an empty result — an empty page can just as
   validly mean "flag is true, but this org genuinely has zero records of
   this type," same reasoning as `activitySync`: without checking the
   flag, silence isn't a reliable signal.

## Sketch: types

Illustrative only — names and the split across files are still open to
change when this is actually planned/implemented; only the shapes and
rules above are locked.

```ts
// packages/adapters/src/types.ts (proposed addition — NOT implemented)

// Correction (found while drafting part 1's plan, before any code was
// written): the sketch below originally reused RecordRef for second-source
// objects. RecordRef.crm is typed CrmVendor ('salesforce' | 'hubspot' |
// 'mock') — a closed union of CRM vendors — which doesn't fit a non-CRM
// source. SecondSourceRef mirrors RecordRef's shape with an open `source`
// string instead, since no real second-source vendor is implemented yet
// (unlike CrmVendor's enumerated three).
export type SecondSourceObjectType = 'contact' | 'account' | 'activity';

export type SecondSourceRef = {
  readonly source: string;
  readonly orgId: string;
  readonly objectType: SecondSourceObjectType;
  readonly id: string;
};

export interface SecondSourceCapabilities {
  /** "engagement" | "billing" — informational, may drive report copy. */
  readonly kind: 'engagement' | 'billing';

  // Decision 5: per-record-type gates. A metric checks the specific
  // flag(s) it needs, not adapter presence alone.
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
   * Max Activity records returned per contact/account by a single
   * getActivitiesByRef() call. Enforced by the adapter, same contract as
   * CrmAdapter's notesPerOpportunityLimit/activitiesPerOpportunityLimit:
   * truncation keeps the newest records and drops the oldest, and the
   * truncated ref is reported rather than silently undercounted.
   */
  readonly activitiesPerRefLimit: number;
  /**
   * Decision 2: hard cap on total records pulled per record type across
   * an entire D5 run's listContacts()/listAccounts()/listActivities()
   * pagination. Applies independently per type. The caller MUST stop
   * paging once it reaches this many items for that type, even if
   * nextCursor is still present — never stream to the end of the
   * second source's table.
   */
  readonly maxSampleSizePerType: number;
}

export interface SecondSourceContact {
  readonly ref: SecondSourceRef;
  readonly email: string | null;
}

export interface SecondSourceAccount {
  readonly ref: SecondSourceRef;
  readonly domain: string | null;
}

export interface SecondSourceActivity {
  readonly ref: SecondSourceRef;
  readonly contactRef: SecondSourceRef | null;
  readonly accountRef: SecondSourceRef | null;
  readonly occurredAt: string; // ISO timestamp
  readonly kind: 'call' | 'email' | 'meeting' | 'other';
  readonly createdAt: string;
  readonly lastModifiedAt: string;
}

export interface SecondSourceAdapter {
  capabilities(): SecondSourceCapabilities;

  // Decision 2: since-window + cursor, same shape as CrmAdapter's
  // listNotes/listActivities. Reuses the existing SyncWindow/SyncPage<T>
  // types — caller enforces capabilities().maxSampleSizePerType by
  // stopping pagination, the method itself doesn't know about the cap.
  listContacts(w: SyncWindow): Promise<SyncPage<SecondSourceContact>>;
  listAccounts(w: SyncWindow): Promise<SyncPage<SecondSourceAccount>>;
  listActivities(w: SyncWindow): Promise<SyncPage<SecondSourceActivity>>;

  /**
   * Same contract shape as CrmAdapter.getAccounts: missing refs are
   * absent from the result, never thrown; results sorted by ref.id.
   */
  getContactsByRef(
    refs: readonly SecondSourceRef[],
  ): Promise<GetSecondSourceRecordsResult<SecondSourceContact>>;

  getAccountsByRef(
    refs: readonly SecondSourceRef[],
  ): Promise<GetSecondSourceRecordsResult<SecondSourceAccount>>;

  /**
   * Per-ref batch read with enforced per-ref truncation — same contract
   * shape as CrmAdapter.getActivitiesByOpportunity, but keyed by a
   * contact or account ref instead of an opportunity ref.
   */
  getActivitiesByRef(
    refs: readonly SecondSourceRef[],
  ): Promise<GetSecondSourceRecordsResult<SecondSourceActivity>>;
}

export interface GetSecondSourceRecordsResult<T> {
  readonly items: readonly T[];
  /**
   * Same truncation contract as CrmAdapter's GetChildRecordsResult:
   * keep-newest, drop-oldest, reported here rather than silently
   * undercounted.
   */
  readonly truncatedRefIds: ReadonlySet<string>;
  readonly apiCallsConsumed: number;
}
```

## Status

All open questions from the first draft of this note are closed (see
Decisions, above). Nothing in this file is implemented — see the D5 part
1 plan for the proposed build sequence.

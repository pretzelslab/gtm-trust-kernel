# Second-source adapter — design note (draft, not implemented)

Motivated by D5 (`packages/readiness/docs/metric-definitions.md`)
cross-system joinability metrics. This is a draft interface sketch and
open-questions list only — no code exists yet, nothing here is
implemented. Per `CLAUDE.md` rule 4, any actual interface or
implementation change based on this note needs its own plan-and-wait pass
before writing, same as every other multi-file change in this repo.

## Scope

D5's four metrics (`contact_identity_resolution_rate`,
`account_resolution_rate`, `activity_attribution_rate`,
`temporal_anomaly_rate`) need a second source — an engagement tool or a
billing/product system — connected alongside the CRM adapter. This note
drafts what that second source's adapter contract could look like,
modeled on `packages/adapters/src/types.ts`'s existing `CrmAdapter`
conventions: by-ref batch reads, advisory-vs-enforced limits, and
truncation reporting.

## Top open question: separate interface, not an extension of `CrmAdapter`

Decided this session (2026-09-21), not derived from prior precedent —
flagging as the one interface-shape call made without an explicit spec:
this note assumes a **separate `SecondSourceAdapter` interface**, with its
own `SecondSourceCapabilities` type, rather than extending `CrmAdapter`/
`AdapterCapabilities`.

Reasoning: the scope doc (`claude/gtm-readiness-scope.md`) treats the
second source as a genuinely distinct system — a different object model
(no `Opportunity`/`Stage`), a connection lifecycle where it may not be
configured at all, and D5's gate-off case (`not_instrumented`, see
`metric-definitions.md`) reads more naturally as "this adapter is absent"
than as "this capability flag is false" on the CRM adapter. Revisit if the
readiness package's sampling/hydration orchestration
(`coverageSample.ts`/`sample.ts`) ends up wanting to treat both sources
through one unified interface — that would argue for merging them
instead.

## Sketch: types

Illustrative only — names, shapes, and the split across files are all
undecided.

```ts
// packages/adapters/src/types.ts (proposed addition — NOT implemented)

export interface SecondSourceCapabilities {
  /** "engagement" | "billing" — informational, may drive report copy. */
  readonly kind: 'engagement' | 'billing';
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
}

export interface SecondSourceContact {
  readonly ref: RecordRef;
  readonly email: string | null;
}

export interface SecondSourceAccount {
  readonly ref: RecordRef;
  readonly domain: string | null;
}

export interface SecondSourceActivity {
  readonly ref: RecordRef;
  readonly contactRef: RecordRef | null;
  readonly accountRef: RecordRef | null;
  readonly occurredAt: string; // ISO timestamp
  readonly kind: 'call' | 'email' | 'meeting' | 'other';
  readonly createdAt: string;
  readonly lastModifiedAt: string;
}

export interface SecondSourceAdapter {
  capabilities(): SecondSourceCapabilities;

  /**
   * Same contract shape as CrmAdapter.getAccounts: missing refs are
   * absent from the result, never thrown; results sorted by ref.id.
   */
  getContactsByRef(
    refs: readonly RecordRef[],
  ): Promise<GetSecondSourceRecordsResult<SecondSourceContact>>;

  getAccountsByRef(
    refs: readonly RecordRef[],
  ): Promise<GetSecondSourceRecordsResult<SecondSourceAccount>>;

  /**
   * Per-ref batch read with enforced per-ref truncation — same contract
   * shape as CrmAdapter.getActivitiesByOpportunity, but keyed by a
   * contact or account ref instead of an opportunity ref.
   */
  getActivitiesByRef(
    refs: readonly RecordRef[],
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

## Other open questions

- **Independent sampling/listing, not just by-ref lookups.** The ask for
  this note specified by-ref batch reads (CRM contact/account ->
  second-source record), which covers *matching*. But
  `activity_attribution_rate`'s denominator is "sampled engagement-tool
  activities" and `temporal_anomaly_rate`'s denominator is "sum of both
  sources' sampled records" — both need the second source's *own*
  independent sample, not records looked up by a CRM ref. That likely
  needs a `list*`-style stream method (mirroring `CrmAdapter.listNotes`/
  `listActivities`'s since-window cursor pattern), not sketched above.
  Flagging as unresolved: the by-ref reads sketched here are necessary
  but not sufficient for D5's full denominators.
- **Timezone/timestamp-precision consistency.** The original scope doc
  (`claude/gtm-readiness-scope.md:94`) lists "temporal alignment: timezone
  and timestamp-precision consistency across sources" as its own D5
  bullet. `metric-definitions.md`'s `temporal_anomaly_rate` covers
  ordering anomalies and future-dated timestamps, but not timezone or
  precision mismatches directly — unclear whether that's intentionally
  folded in or a gap. Not resolved here.
- **Where the hashing/salt lifecycle lives.**
  `contact_identity_resolution_rate`'s SHA-256-with-per-run-salt hashing
  (`metric-definitions.md`) is readiness-package orchestration, not part
  of this adapter contract — the adapter returns raw (unhashed)
  contact/account records, and the caller hashes before comparing. Worth
  confirming this split holds once real implementation starts.
- **Capability granularity.** `SecondSourceCapabilities` above is a single
  flat object; unclear whether a real second source might support
  contacts but not activities (e.g. a billing system with no activity
  log), which would need per-record-type availability flags rather than
  a single all-or-nothing adapter presence check.

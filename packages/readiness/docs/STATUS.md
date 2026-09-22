# Phase C ("readiness") — status and handoff state

Not the build runbook. That's `claude/RUNBOOK.md` (repo root) — the
step-by-step build process, including the Phase C "one metric per session"
loop `metric-definitions.md` cross-references. This file is a point-in-time
state snapshot for resuming `packages/readiness` cold; it doesn't replace
either `claude/RUNBOOK.md` or `claude/gtm-readiness-scope.md` (the original
scope doc — see its section 3 for the seven-dimension metric list this
whole package implements against).

Working state for continuing `packages/readiness` across sessions. Read this
before `metric-definitions.md` when picking the work back up cold.

Governing rules: `CLAUDE.md` at the repo root (protected `rubric.ts`, no
threshold guessing, plan-before-multi-file-change, pure deterministic
signals, `npm run ci` before declaring anything done). Those rules are not
repeated here.

---

## Status as of 2026-09-21

| Metric group | State | Commit |
|---|---|---|
| D1 coverage, original 6 (`close_date_fill_rate`, `amount_fill_rate`, `next_step_fill_rate`, `activity_capture_rate`, `contact_linkage_rate`, `note_coverage_rate`) | Done, tested | `9200b08` |
| D1 `owner_id_fill_rate` | Done, tested. **Report-only** — not wired into any `CapabilitySpec`'s gates | this session, see git log |
| D2 `median_days_since_modified` | Done, tested | `1590803` |
| D2 `past_due_close_date_rate` | Done, tested | `1590803` |
| D2 `median_next_step_age_days` | **Deferred** — not implemented | doc-only in `031ad35` |
| D3 `stage_activity_contradiction_rate`, `round_amount_rate` | Done, tested | prior session, see git log |
| D3 `stage_mapping_coverage`, `duplicate_account_rate` | **Done, tested.** D3 is now fully implemented (all 4 metrics) | this session ("D3 part 2b"), see git log |
| D4 `owner_history_enabled`, `stage_history_months` | Done, tested | this session ("D4 part 1"), see git log |
| D4 `close_date_history_enabled` | **Deferred** — not implemented | doc-only, this session |
| D5 part 1: `SecondSourceAdapter` contract + `MockSecondSourceAdapter` + fixtures | Done, tested. **No D5 metric code** — adapter/mock/contract-test/fixture scaffolding only | this session ("D5 part 1"), see git log |
| D5 part 2a: joinability orchestration (independent second-source sampling, hashing at ingestion, contact/account resolution) | Done, tested | prior session ("D5 part 2a"), see git log |
| D5 part 2b: the 4 D5 metrics + `buildReportData`/`cli.ts`/`--json` wiring | **Done, tested. D5 is now fully implemented** — all 4 metrics live in the report, no longer greyed out | this session ("D5 part 2b"), see git log |
| D6 (4 metrics), D7's `closed_deal_count_12m`/`outcome_evidence_retention_rate` | **Scoped and locked** in `metric-definitions.md` this session — no code written, ready for implementation | doc-only, this session |
| D7 `win_rate_dispersion` | **Deferred** — blocked on a new adapter method (per-opportunity stage history), bundled with the two D2/D4 deferrals below into one adapter-contract change | doc-only, this session |

`notesByOpportunity`/`activitiesByOpportunity` hydration — the gap flagged
when the visual report shipped (`note_coverage_rate`,
`activity_capture_rate`, `stage_activity_contradiction_rate` were running
over permanently-empty maps) — was fixed last session. This session
additionally consumes the truncation info that fix's adapter methods
already computed but discarded: `MetricResult` gained `floor`, surfaced
as a visible badge in the report. See "Cross-package" and the new
decisions below.

D5 doc decisions are locked (`metric-definitions.md`'s D5 section rewritten, gating fixed to `not_instrumented`) and the second-source adapter design note (`packages/readiness/docs/second-source-adapter-design.md`) is locked, all open questions closed. D5 part 1 (prior session) implemented `SecondSourceAdapter`/`SecondSourceCapabilities`/`SecondSourceRef` and friends (`packages/adapters/src/types.ts`), `MockSecondSourceAdapter` (`packages/adapters/src/mock.ts`), a shared contract suite (`packages/adapters/test/contract/secondSource.contract.ts`) run against the mock, a mock-only truncation suite (`test/mock.secondSource.test.ts`), and `healthy`/`legacy`/`fresh` second-source fixture data (`packages/readiness/src/fixtures/mockOrgs.ts`).

D5 part 2a (prior session) added the joinability orchestration layer on top of that: independent second-source sampling (`src/secondSource/sample.ts`), SHA-256+per-run-salt hashing at the ingestion boundary (`src/secondSource/hash.ts`), and contact/account resolution (`src/secondSource/resolve.ts`).

**This session (D5 part 2b) is the payoff: D5 is fully implemented.** `src/metrics/joinability.ts` (new) has all 4 metrics as pure `(sample, config) => MetricResult` functions, exactly like every other dimension — `contactIdentityResolutionRate`, `accountResolutionRate`, `activityAttributionRate`, `temporalAnomalyRate`. `buildReportData` now takes a second `secondSourceAdapter: SecondSourceAdapter | undefined` parameter, hydrates contacts and resolves the second source only when one is provided (skips both entirely otherwise — no wasted I/O), and threads the result through a new `MetricConfig.secondSourceResolution?: SecondSourceResolution` field. `cli.ts` constructs a `MockSecondSourceAdapter` from `fixture.secondSource` when present. The old `D5_METRICS` not-implemented fallback in `buildReport.ts` is deleted — D5 rows now go through the same `IMPLEMENTED` map as everything else, gating internally on `config.secondSourceResolution` the same way `activityCaptureRate` gates on `sample.capabilities.activitySync`. No `render.ts` changes were needed: row styling is purely `status`-driven, so `ok` rows render live automatically.

Verified end to end against a real `cli.ts --fixture healthy --json` run (not just unit tests): `contact_identity_resolution_rate` 0.867 (viable), `account_resolution_rate` 0.867 (degraded), `activity_attribution_rate` 1.0 (viable), `temporal_anomaly_rate` 0.031 (degraded) — and the full JSON output contains zero raw second-source emails. See "Decisions" for the judgment calls this required and "Cross-package" for a legacy-fixture bug this surfaced.

No fault injection (`MockFaults`-equivalent) on `MockSecondSourceAdapter` — deliberately deferred (confirmed D5 part 1, not an oversight). Revisit if a D5-part-2b+ test needs to exercise a second-source failure path.

`SecondSourceCapabilities.maxSampleSizePerType` is caller-enforced by design, not adapter-enforced — `MockSecondSourceAdapter`'s `list*` methods still do not cap themselves. **Now tested** (`test/secondSource/sample.test.ts`, "pagination cap" block): `sampleSecondSource` (`src/secondSource/sample.ts`) stops paging once it hits the cap for each record type independently, even when `nextCursor` is still present — closes the gap D5 part 1 flagged as missing.

`stage_fill_rate` does not exist and never will — `Opportunity.stage` is
required/non-nullable, so there's no "missing" state to measure. See
metric-definitions.md's D1 header for the full explanation. This was the
other half of the "open question" this doc used to carry; it's resolved.

Files:
- `src/metrics/coverage.ts` — D1 (all 7 metrics, including `owner_id_fill_rate`).
- `src/metrics/freshness.ts` — D2 (two of three; see deferral below).
- `src/metrics/consistency.ts` — D3, **all 4 metrics done**: `stage_activity_contradiction_rate`, `round_amount_rate`, `stage_mapping_coverage`, `duplicate_account_rate`.
- `src/metrics/history.ts` — D4, **2 of 3 metrics done** (added this session, D4 part 1): `owner_history_enabled`, `stage_history_months`. `close_date_history_enabled` deferred, see below — not in this file.
- `src/metrics/shared.ts` — helpers used across families, including `hasQualifyingActivity` (see below), `normalizeDomain`, `DEFAULT_SHARED_PROVIDER_DENYLIST` (D3 part 2b), `wholeCalendarMonthsBetween` (D4 part 1), `applyTruncationFloor` (new this session).
- `src/metrics/types.ts` — `MetricResult`, `CoverageSample`, `MetricConfig` (gained optional `sharedProviderDenylist` in D3 part 2b; `CoverageSample` gained `stageHistoryEarliestChangedAt`/`stageHistoryHydrated` in D4 part 1, `notesTruncatedOpportunityIds`/`activitiesTruncatedOpportunityIds` in a prior session, `contactsByRef`/`contactsHydrated`/`missingContactCount` in D5 part 2a; `MetricResult` gained optional `floor` in a prior session; `MetricConfig` gained optional `secondSourceResolution` this session, D5 part 2b — see "Decisions").
- `src/coverageSample.ts` — builds `CoverageSample` from a `SampleResult` (`buildCoverageSample`) and hydrates it: accounts (`hydrateAccounts`), contacts (`hydrateContacts`, new this session — see below), org-wide earliest stage-history entry (`hydrateStageHistory`), and per-opportunity notes/activities (`hydrateNotes`, `hydrateActivities`) — the latter two now also carry forward each `GetChildRecordsResult`'s `truncatedOpportunityIds`, unioned across chunks; see decisions below.
- `src/secondSource/hash.ts`, `sample.ts`, `resolve.ts` (D5 part 2a); `sample.ts` gained `contactsTruncated`/`accountsTruncated` and `resolve.ts` gained `SecondSourceResolution.capabilities` this session (D5 part 2b — see "Decisions").
- `src/metrics/joinability.ts` (new, D5 part 2b) — all 4 D5 metrics: `contactIdentityResolutionRate`, `accountResolutionRate`, `activityAttributionRate`, `temporalAnomalyRate`, plus the shared `candidateOpportunities` join helper the latter two use.
- `test/fixtures/*.ts`, `test/metrics/*.test.ts` — one golden-fixture file per metric, one test file per metric family. `test/metrics/shared.test.ts` is the exception (added D3 part 2b) — it tests `normalizeDomain`/`wholeCalendarMonthsBetween`/`applyTruncationFloor` directly since those are helpers, not metrics, and have no fixture file of their own. `test/fixtures/joinability.ts` (new, D5 part 2b) is a second, deliberate exception: one shared fixture-builder file for all 4 D5 metrics rather than 4 separate ones — D5 fixtures need both a `CoverageSample` and a `SecondSourceResolution` built together, and that boilerplate wasn't worth duplicating 4x.
- `test/coverageSample.test.ts` — builder + hydration tests (not per-metric, so it doesn't follow the `test/fixtures/` + `test/metrics/` split above). Gained `hydrateNotes`/`hydrateActivities` describe blocks last session, plus an integration-style block proving the `activitySync` capability gate survives real hydration.
- `src/report/buildReport.ts`/`render.ts` — `buildReportData` calls `hydrateNotes`/`hydrateActivities` as part of its orchestration (caveat-note logic removed a prior session, since these 3 metrics now compute over real data); `render.ts` shows a visible "FLOOR" badge (plus a `≥` value prefix) when a row's `floor` is true, in both the single-report table and the `--all` comparison matrix. This session (D5 part 2b): `buildReportData` gained a `secondSourceAdapter` parameter and now conditionally hydrates contacts/resolves the second source (see "Decisions"); the 4 D5 metrics joined `IMPLEMENTED`; the `D5_METRICS` not-implemented fallback was deleted. `render.ts` untouched — no changes needed.
- `src/report/cli.ts` — `buildOne` constructs a `MockSecondSourceAdapter` from `fixture.secondSource` when present, passes it to `buildReportData` (D5 part 2b).
- `src/fixtures/mockOrgs.ts` — `healthy`'s `opp-0` now seeds 205 notes and 205 activities (over the 200 default per-opportunity cap), this session, so the report's floor badge has something real to show, not just unit-test fixtures. This session additionally added an optional `MockOrgFixture.secondSource` field (`{ capabilities, data }`, mirroring `capabilities`/`data`'s existing shape — not a pre-built adapter, so a future caller constructs `MockSecondSourceAdapter` the same way `cli.ts` already constructs `MockAdapter`): `healthy` gets good overlap (13 of 15 accounts/contacts resolve), `legacy` gets poor overlap (1 of 6, `hasActivities: false`), `fresh` gets no second source at all (`secondSource` omitted — the actual D5 gate-off case, layered onto `fresh`'s existing "newly onboarded" framing rather than a 4th fixture name). **D5 part 2b found and fixed a real bug in this data**, not just wired against it: `legacy`'s opportunity `contactRefs` were keyed by `con-${n % accounts.length}`, and the `n % 3 === 0` condition gating whether an opportunity got a contact link meant `n % 6` (accounts.length is 6) always landed on `con-0` or `con-3` — the exact two contacts deliberately seeded with no email. This structurally zeroed `contact_identity_resolution_rate`'s denominator for `legacy` regardless of sampling, not a sampling-luck issue. Fixed by shifting to `con-${(n + 1) % accounts.length}` (same 1-in-3 linkage frequency, spread across contacts that do have an email) — caught by the new D5 fixture-differentiation test in `test/report/buildReport.test.ts`, not by inspection.

Cross-package: `packages/adapters` gained `CrmAdapter.getAccounts(refs)`
(D3 part 2a) and `getNotesByOpportunity(oppRefs)` /
`getActivitiesByOpportunity(oppRefs)` (last session, `src/types.ts`,
`src/mock.ts`, plus coverage in `test/contract/adapter.contract.ts` and a
mock-only truncation suite, `test/mock.childRecords.test.ts`) — the same
kind of cross-package addition D1's `activitySync`/`contactLinks` were.
`AdapterCapabilities` gained 3 fields last session: `childRecordBatchLimit`
(advisory ref-batch limit, shared by both new methods, same contract as
`accountBatchLimit`), `notesPerOpportunityLimit`, `activitiesPerOpportunityLimit`
(advisory per-opportunity truncation caps — the mock DOES enforce these
two, reporting a capped opportunity in `GetChildRecordsResult.truncatedOpportunityIds`,
now actually consumed downstream as of this session).

Cross-package, D5 part 2a: `CrmAdapter.getContactsByRef(refs)` added
(`packages/adapters/src/types.ts`, `src/mock.ts`) — same reason `getAccounts`
was added in D3 part 2a: `listContacts` has no ref filter, only a
since-window stream, and hydrating a bounded sample's contacts through it
would mean scanning the whole table. Not something the D5-part-2a plan
originally listed — found while grounding the plan (no CRM contact
hydration path existed at all; `contact_identity_resolution_rate` needs
CRM-side contact emails to hash), confirmed with the user before writing.
`AdapterCapabilities.contactBatchLimit` (new field, default 200) is
advisory-only, same contract as `accountBatchLimit` — kept as its own
field rather than reusing `accountBatchLimit`, same reasoning
`childRecordBatchLimit` got its own field (different ref type, not a
different limit value). `MockFaults.failGetContactsOnCall` added,
mirroring `failGetAccountsOnCall`. Contract-suite coverage added to
`adapter.contract.ts`'s existing shared suite ("batch contact read"),
`ContractHarness` gained `knownContactId`.

`packages/readiness`: `coverageSample.ts` gained `hydrateContacts`,
identical shape to `hydrateAccounts` — derives the distinct contact-ref
set from `sample.openOpportunities`/`closedOpportunities`'s
`contactLinks` (not an independent contact sample), chunks at
`capabilities().contactBatchLimit`, same all-or-nothing chunk-failure
contract. `CoverageSample` gained `contactsByRef`/`contactsHydrated`/
`missingContactCount` (`metrics/types.ts`), same "empty and meaningless
until hydrated" convention as `accountsByRef`/`accountsHydrated`. This
required touching every existing golden-fixture file under
`test/fixtures/*.ts` plus `test/coverageSample.test.ts` and
`src/fixtures/mockOrgs.ts` (17 files) to add the two new required fields
to their hand-built `AdapterCapabilities`/`CoverageSample` object
literals — mechanical, no fixture's existing scenario/expected-value
changed.

`src/secondSource/` (new package-internal module, D5 part 2a):
- `hash.ts` — `generateRunSalt()` (`crypto.randomBytes`, real randomness
  — deliberately NOT `sample.ts`'s deterministic mulberry32/xfnv1a
  stratified-sampling seed, which would defeat "salt differs across
  runs") and `hashEmail(raw, salt)` (`crypto.createHash('sha256')`, same
  idiom `packages/kernel/src/audit/ledger.ts` already uses for the audit
  ledger — no new dependency).
- `sample.ts` — `sampleSecondSource(adapter, salt)`: independently pages
  `listContacts`/`listAccounts`/`listActivities`, each capped at
  `capabilities().maxSampleSizePerType` (enforced here, in orchestration
  — the adapter itself doesn't, see D5 part 1). **Hashing/normalizing
  happens here, per-page, as each record arrives** — this session's one
  change to the plan the user approved before implementation: emails are
  hashed and domains normalized immediately on receipt, never carried
  raw into the returned `SecondSourceSampleResult`. `HashedContact`
  (`emailHash: string | null`) and `NormalizedAccount`
  (`normalizedDomain: string | null`) replace the adapter's raw
  `SecondSourceContact`/`SecondSourceAccount` shapes in the result;
  `SecondSourceActivity` passes through unmodified (no PII field exists
  on that type). Does not pre-check `has*` capability flags before
  calling `list*` — same precedent as `hydrateStageHistory` trusting the
  adapter's own empty-not-throw contract.
- `resolve.ts` — `resolveSecondSource(sample, adapter)`: the actual
  matching step. Throws if `sample.contactsHydrated`/`accountsHydrated`
  is false (an orchestration precondition violation, not a metric's
  gate-off — deliberately not `not_instrumented`, since this isn't a
  metric and there's no graceful degradation to fall back to; a caller
  that hasn't hydrated first has a bug). Generates one salt via
  `generateRunSalt()`, calls `sampleSecondSource` with it, then hashes
  every CRM contact's email (`sample.contactsByRef`) with the *same*
  salt and normalizes every CRM account's domain
  (`sample.accountsByRef`) with the existing `normalizeDomain` — same
  salt across both sides is what makes the hashes comparable. Returns
  `contactMatches`/`accountMatches`: `ReadonlyMap<string /* CRM ref.id
  */, readonly SecondSourceRef[]>` — refs only, never a merged record.
  See "Decisions" for the matching-count semantics.

`npm run ci` green at handoff (D5 part 2b, this session): adapters 59 (unchanged this session), kernel 22 (unchanged), readiness 266 (231 at D5-part-2a handoff + 29 `joinability.test.ts` + 4 new `sample.test.ts` truncated-flag tests + 2 new `resolve.test.ts` capabilities tests).

Cross-package, D5 part 1: `packages/adapters` gained a wholly separate
`SecondSourceAdapter` interface (`src/types.ts`) — `SecondSourceRef`
(not `RecordRef`: `RecordRef.crm` is typed `CrmVendor`, a closed CRM
union that doesn't fit a non-CRM source), `SecondSourceCapabilities`
(per-record-type `hasContacts`/`hasAccounts`/`hasActivities` flags, plus
`refBatchLimit`/`activitiesPerRefLimit`/`maxSampleSizePerType`),
`SecondSourceContact`/`Account`/`Activity`, `GetSecondSourceRecordsResult<T>`,
`listContacts`/`listAccounts`/`listActivities` (since-window + cursor,
same shape as `CrmAdapter`'s `list*`) and `getContactsByRef`/
`getAccountsByRef`/`getActivitiesByRef` (by-ref batch reads, the last one
with enforced keep-newest/drop-oldest truncation, same contract as
`getActivitiesByOpportunity`). `MockSecondSourceAdapter` (`src/mock.ts`)
is the only implementation; no fault injection (see above). Package
exports gained `./test/contract/secondSource.contract.js`
(`package.json`). `test/fixtures.ts` gained `makeSecondSourceOrgData`/
`makeMockSecondSourceAdapter` plus exported `ORG`/`SECOND_SOURCE`
constants (previously `ORG` was file-private) so the contract-wiring test
can build matching refs without duplicating the literal.

Cross-package, D3 part 2b: `tldts` (`7.4.13`, exact-pinned) added as a
`packages/readiness` dependency — the only domain-normalization library in
the tree, used solely by `normalizeDomain`.

---

## Decisions and conventions established so far

These are not written down anywhere else — re-derive them from the commits
above if this doc ever drifts, but treat this list as authoritative for
*why*, not just *what*.

- **Every metric is `(sample: CoverageSample, config: MetricConfig) => MetricResult`.** Pure function, no exceptions. `CoverageSample` is reused across D1 and D2 even where a metric doesn't need all of its fields (e.g. D2's two metrics ignore `notesByOpportunity`/`activitiesByOpportunity`) — a narrower per-family sample type was considered and deliberately rejected to avoid type proliferation for no behavioral gain.
- **Capability gate-off → `not_instrumented`, never a computed score.** Established for `activity_capture_rate` (gated on `AdapterCapabilities.activitySync`). Confirmed this session for `stage_history_months` (D4), which is gated the same way. **Did not transfer to `owner_history_enabled` (D4)** — it's a pure capability-matrix *read*, not a rate computed *from* a capability gate, so there's no gate to fail: it always returns `'ok'` with `value: 1` or `value: 0`. The distinction: a gated metric needs the capability to compute something else; a capability-check metric's answer *is* the capability value, true or false either way.
- **`activity_capture_rate` qualifying-activity definition** (metric-definitions.md D1, negotiated over several rounds — do not re-derive from first principles): `occurredAt` within `[asOf - 30d, asOf]` inclusive on both ends, and not before the opportunity's own `createdAt`. No completion-status filter (the model has no such field). No `ActivityKind` restriction — every kind qualifies, including `'other'`, because there is no separate `Task` representation in the canonical model.
- **`activity_capture_rate` denominator exclusion:** opportunities created within the trailing **7 days** of `asOf` are excluded from the denominator entirely (not just failed) — they haven't had time to accrue activity. This was originally written as 30 days in the doc; the doc was wrong, not the code — corrected in the D1 commit.
- **Filtered-sample `sampleSize` convention:** when a metric's real denominator is a filtered subset of the raw sample (not the full `openOpportunities` list), `sampleSize` in the `MetricResult` reports the *filtered* count, not the raw sample size. Established by `activity_capture_rate` (denominator = eligible opportunities after the 7-day exclusion) and carried into `past_due_close_date_rate` (denominator = opportunities with non-null `closeDate`).
- **Empty-denominator handling is `not_applicable`, with a note describing *why* it's empty**, not a generic "no data" string — `rateOverOpportunities` in `shared.ts` takes an optional `emptyNote` so a metric can distinguish "no open opportunities in sample" from a more specific cause (e.g. `past_due_close_date_rate` distinguishes that from "no open opportunities with a non-null close date in sample" when the raw sample is non-empty but every close date is null).
- **`amount_fill_rate`:** `amount === 0` counts as unfilled, same as `null` — not treated as "filled with a zero value."
- **`next_step_fill_rate`:** whitespace-only or single-character values (`"-"`, `"."`) count as unfilled — `str.trim().length > 1`.
- **`note_coverage_rate`:** presence only, no length/content judgment — that's `substantive_note_rate`'s job (D6), don't conflate them.
- **`past_due_close_date_rate`:** past-due is `closeDate < asOf`, strict — exactly-`asOf` is not past-due (mirrors `close_date_fill_rate`'s existing exactly-`asOf`-counts-as-filled edge case). Null `closeDate` excluded from both numerator and denominator (that gap belongs to `close_date_fill_rate`, don't double-penalize it).
- **`owner_id_fill_rate`:** empty-string and whitespace-only `ownerId` count as unfilled, same as `undefined` — `(ownerId?.trim().length ?? 0) > 0`, not a bare non-null check (same shape as `next_step_fill_rate`'s edge case, different field). Deliberately **not** added to any `CapabilitySpec.gates` in `rubric.ts` — report-only for now. If a capability should eventually gate on it, that's a separate decision, not implied by this metric existing.
- **`shared.ts`** (`src/metrics/shared.ts`) holds `rateOverOpportunities` (the share-of-denominator-with-a-predicate pattern used by most D1 metrics and by `past_due_close_date_rate`), `median()`, and `DAY_MS`. Originally lived only in `coverage.ts`; extracted when D2 needed the same shape. `coverage.ts`'s behavior/output did not change in that extraction — confirm this stays true if you touch either file.
- **Canonical model additions made to support D1** (not just Phase C internals — these are cross-package changes, already committed in `9200b08`): `AdapterCapabilities.activitySync: boolean` (`packages/adapters/src/types.ts`), and `OpportunityContactLink` + `Opportunity.contactLinks: readonly OpportunityContactLink[]` (`packages/adapters/src/model/canonical.ts`). Both went through full interface review before being written — see git history on those files if the rationale is needed again.
- **`stage_activity_contradiction_rate`:** the qualifying-activity predicate is imported, not copied, from `activity_capture_rate` — extracted into `hasQualifyingActivity` (`shared.ts`), parameterized on window start/`asOf` so each caller supplies its own window length. This metric's window is **21 days**, not `activity_capture_rate`'s 30 — a late-stage deal implies more frequent expected touchpoints. "Late-stage" = `CANONICAL_STAGE_ORDER.slice(-2)` (today: `proposal`, `negotiation`), derived rather than hardcoded so it tracks the canonical ladder if it changes. Gated on `AdapterCapabilities.activitySync`, same as `activity_capture_rate` (same underlying activity data) — `not_instrumented` with the same note text when the gate is off.
- **`round_amount_rate`:** denominator excludes null and zero amount, mirroring `amount_fill_rate`'s zero-exclusion and `past_due_close_date_rate`'s null-exclusion pattern — amount = 0 is already counted as unfilled by `amount_fill_rate`, not double-counted here. **Negative amounts are left in the denominator** and evaluated by the same `% 1000 === 0` rule as any other amount (e.g. -5000 counts as round) — this is an **open question for v0.2**, not resolved this session; flag it if negative amounts turn out to be common enough to matter (they generally shouldn't occur in a real CRM, but nothing currently rejects them upstream).
- **Excluded-count reporting (`round_amount_rate`, and now `stage_mapping_coverage`):** `MetricResult` has no dedicated field for "count excluded from the denominator" (or, for `stage_mapping_coverage`, the mapped/inferred/unmapped split), so both surface it via `note` on the `'ok'` path, built by calling `rateOverOpportunities` and then overwriting `note`. **This is now the second use of the pattern** (D3 part 2b, this session) — per the original tech-debt call: **a third metric needing this should stop reusing `note` and add a structured field (`excludedCount` or similar) to `MetricResult` instead.** `duplicate_account_rate`'s note (below) is related but heavier — it packs five distinct counts into one string — and is itself a candidate for that structured field if a third "plain" excluded-count case doesn't show up first.
- **`CrmAdapter.getAccounts(refs)`** (D3 part 2a, `packages/adapters`): added because `listAccounts` has no ref filter — only a since-window, cursor-paginated stream — and using it to hydrate accounts for an already-sampled set of opportunities would mean paging the whole account table regardless of sample size, in tension with the scope doc's "never full-scan a production org" rule. `AdapterCapabilities.accountBatchLimit` (default 200 in the mock, matching Salesforce SOQL `IN` practice) is **advisory only** — the adapter does not enforce or truncate at it; chunking to it is the caller's (`hydrateAccounts`'s) job. Missing refs are absent from the result, never thrown; a ref repeated in one request collapses to one result entry; results are sorted by `ref.id`, independent of backend order. `MockFaults.failGetAccountsOnCall` is a separate fault hook from the existing `listCalls`-based `failListOnCall` — `getAccounts` is a batch read, not a list method, and isn't wired into the `listCalls` counter.
- **`buildCoverageSample`/`hydrateAccounts` split** (`src/coverageSample.ts`): `buildCoverageSample` is pure/sync (wires up `openOpportunities`/`closedOpportunities` from a `SampleResult`); `hydrateAccounts` is the only impure/async step (fetches accounts via the adapter), mirroring `runSample` already being the impure orchestrator while `CoverageSample` and the metrics stay pure. `accountsByRef`/`missingAccountCount` are placeholder empty/zero until `hydrateAccounts` runs; `accountsHydrated: boolean` (false → true) is the explicit signal of that transition. **Any metric that reads `accountsByRef` (i.e. `duplicate_account_rate`, in 2b) must return `not_instrumented` when `accountsHydrated` is false** — the same gate-off-means-`not_instrumented` rule established for `AdapterCapabilities.activitySync`, applied here to a build-order precondition rather than a capability.
- **Account hydration determinism:** the distinct `accountRef` set (deduped by `ref.id` across `openOpportunities + closedOpportunities`) is sorted by `ref.id` before chunking, so `accountsByRef`'s insertion order is always globally `ref.id`-sorted — independent of opportunity order or which opportunities happened to reference which accounts. `missingAccountCount = distinctRefs.length - accountsByRef.size`, only ever computed after every chunk succeeds.
- **Hydration failure is all-or-nothing:** `hydrateAccounts` does not catch, retry, or partially apply — a rejected `getAccounts` call on any chunk propagates as-is out of `hydrateAccounts`. No partial `CoverageSample` is ever returned, and a failed chunk's refs are never counted in `missingAccountCount` (that field only exists on a fully successful hydration).
- **`oppsWithoutAccountRef`:** opportunities with no usable `accountRef` (absent, or `ref.id` empty/whitespace-only — `accountRef` is non-optional in the canonical model, but this guards real adapter data the same way `owner_id_fill_rate` guards `ownerId`) are skipped entirely by both `buildCoverageSample`'s counting and `hydrateAccounts`'s ref derivation. Counted separately from `missingAccountCount`, which is only about refs that *were* requested but didn't resolve.
- **Dry-run budget now includes account hydration:** `SamplePlan.plannedAccountApiCalls` is a worst-case ceiling — `Math.ceil((SAMPLE_STRATA.length * perStratumSampleSize) / accountBatchLimit)`, i.e. as if every sampled opportunity resolved to a distinct account. Real orgs share accounts across opportunities, so actual hydration calls are almost always lower; this is a budget ceiling for the confirmation prompt, not a typical-case estimate — same framing `plannedApiCalls` already uses. `formatRateLimit`'s quota percentage/seconds estimate now uses `plannedApiCalls + plannedAccountApiCalls` (understating it would defeat the point of the quota-discipline display).
- **`stage_mapping_coverage` (D3 part 2b):** denominator is `[...openOpportunities, ...closedOpportunities]`; numerator is `stageConfidence` in `{mapped, inferred}` — only `unmapped` counts against coverage. Uses `rateOverOpportunities` directly (no new helper needed, opportunities are already the right shape). `note` on the `'ok'` path reports the mapped/inferred/unmapped split.
- **`normalizeDomain` (`src/metrics/shared.ts`, D3 part 2b):** the only domain-normalization function in the codebase — every domain-based metric must import it, not re-derive normalization. Implemented as a thin wrapper around `tldts`'s `getDomain(raw, { allowPrivateDomains: true })`, not a hand-rolled trim/lowercase/strip-protocol/strip-www/strip-path/strip-port/strip-trailing-dot pipeline — probed `tldts` directly against the full test table before writing the function and confirmed its default behavior already performs every one of those steps, so duplicating them would have been dead code. `allowPrivateDomains: true` is a deliberate choice (this session, per explicit instruction): without it, PSL private-section hosts (`herokuapp.com`, `github.io`, `blogspot.com`, etc.) collapse every tenant's subdomain down to the shared host domain, which would manufacture false-positive `duplicate_account_rate` groups for unrelated companies both hosted on e.g. Heroku. With it, `acme.herokuapp.com` and `beta.herokuapp.com` normalize to two different values. Covered by `test/metrics/shared.test.ts`'s table, which carries a header comment marking it as `normalizeDomain`'s behavioral contract: a `tldts` version bump that changes any row's expected output must be reviewed and the row updated deliberately, never auto-updated to match new library output.
- **`DEFAULT_SHARED_PROVIDER_DENYLIST` (`src/metrics/shared.ts`) / `MetricConfig.sharedProviderDenylist` (D3 part 2b):** 11 default consumer/free-mail domains (gmail.com, googlemail.com, outlook.com, hotmail.com, live.com, yahoo.com, icloud.com, aol.com, proton.me, protonmail.com, gmx.com). `MetricConfig.sharedProviderDenylist`, when supplied, **replaces** the default rather than merging with it (same `??` pattern as `DEFAULT_SAMPLE_CONFIG` elsewhere in this package) — an org that wants to add one domain must currently repeat the full list; not treated as a problem worth solving until an actual caller needs it. Every denylist entry (default or config-supplied) is itself passed through `normalizeDomain` before comparison, so a config entry like `" Gmail.COM "` still matches a sampled account's `"gmail.com"` — verified by a dedicated test (`duplicateAccountRateConfigDenylistFixture`).
- **`duplicate_account_rate` (D3 part 2b):** gated on `CoverageSample.accountsHydrated` (a build-order precondition, not an `AdapterCapabilities` flag) — `not_instrumented` when false, without reading `accountsByRef`, same rule as `CoverageSample`'s own docblock already specified for this metric. Operates over `sample.accountsByRef.values()` (the distinct hydrated accounts, one row per account — **not** `openOpportunities`/`closedOpportunities`), since the doc's "sampled accounts" language means accounts, not opportunities. Each account's `domain` goes through `normalizeDomain`; accounts with a `null` result, or a denylisted result, are excluded from the denominator and counted separately (`excludedNullDomain`, `excludedDenylisted`). Two `not_applicable` notes are distinguished: `"no hydrated accounts in sample"` (accountsByRef itself is empty) vs. `"no accounts with a resolvable, non-denylisted domain in sample"` (accounts exist but all were excluded) — same "distinguish the empty-denominator cause" convention `past_due_close_date_rate` established. **Group-counting decision (confirmed with the user this session, doc was silent — did not pick unilaterally):** every account in a duplicate group (size >= 2) counts toward the numerator, including the first-created member — not just members beyond the first. The `note` on the `'ok'` path additionally reports the duplicate-group count, so the alternate "beyond first" count (denominator members in groups minus group count) is derivable without a second metric or a rubric.ts change. Does not reuse `rateOverOpportunities` (it's typed to `Opportunity[]`; this is the first Account-shaped metric) — written inline rather than genericizing that helper for a single caller.
- **`owner_history_enabled` (D4 part 1, `src/metrics/history.ts`):** pure `sample.capabilities.ownerHistory` read, first `unit: 'bool'` metric implemented — `value: 1` when true, `value: 0` when false, per the new cross-cutting rule in `metric-definitions.md`. Never `not_instrumented`: the capability read itself is the metric, so there's no gate to fail. **`sampleSize`/`lowConfidence` were not derived mechanically** from `LOW_CONFIDENCE_SAMPLE_SIZE` — both `owner_history_enabled` and `stage_history_months` report `sampleSize: 0` and hardcode `lowConfidence: false`, because neither is a statistical sample of records; mechanically applying `sampleSize < 30` would mark every result "low confidence" forever, which carries no differentiating information for these two metrics. This wasn't specified — flagging as a judgment call, worth revisiting if the report layer treats `lowConfidence` as an actionable warning rather than informational.
- **`stage_history_months` (D4 part 1, `src/metrics/history.ts`):** scope ambiguity resolved this session — **org-wide**, not scoped to the sample's opportunities (see `metric-definitions.md`'s updated D4 entry for the reasoning: answerable in one bounded ascending `listStageHistory` page, `limit: 1`, no `since`; a sample-scoped version would need a new by-ref batched history method or an unbounded scan). Three-level gate cascade: `capabilities.stageHistory` false → `not_instrumented` (standard capability gate); `stageHistoryHydrated` false → `not_instrumented` (build-order precondition, same rule as `duplicate_account_rate`'s `accountsHydrated` gate); `stageHistoryEarliestChangedAt` null (hydrated, zero entries) → `ok`, `value: 0`, `note: "history enabled, no entries yet"` (this session's explicit decision — a freshly-enabled org isn't the same as a missing capability). Otherwise → `ok`, `value: wholeCalendarMonthsBetween(earliest, config.asOf)`.
- **`wholeCalendarMonthsBetween` (`src/metrics/shared.ts`, D4 part 1):** whole calendar months between two ISO timestamps, partial months dropped — standard "age in whole months" rule (raw month difference, minus one if the later date's day-of-month is earlier than the earlier date's), same as most date libraries' `diff('months')`. Floored at 0. Month-end/leap-year behavior is a deliberate choice, not an oversight: Jan 31 → Feb 28 is 0 months (Feb has no 31st); Feb 29, 2028 → Feb 28, 2029 is 11, not 12 (2029 has no 29th) — both pinned by tests in `test/metrics/shared.test.ts`, same "behavioral contract" framing as `normalizeDomain`'s table.
- **`hydrateStageHistory` (`src/coverageSample.ts`, D4 part 1):** minimal glue — one `adapter.listStageHistory({ limit: 1 })` call, no `since`, relying on the method's own ascending-sort contract so the first (and only) returned item is the org's earliest entry. Does **not** special-case `capabilities.stageHistory` itself — relies on `CrmAdapter.listStageHistory`'s existing contract ("must return empty, not throw, when the capability is false") rather than duplicating that check in two places; `stage_history_months` still gates on the capability before trusting the hydrated field. **No new adapter method added** (per this session's explicit scope) and **not wired into the dry-run budget** (`SamplePlan.plannedAccountApiCalls`-equivalent) — this session scoped the glue as CoverageSample-only, not a budget-system update; worth doing if this ships for real quota planning, since account hydration's budget integration (D3 part 2a) didn't get a stage-history counterpart.
- **`CrmAdapter.getNotesByOpportunity(oppRefs)` / `getActivitiesByOpportunity(oppRefs)`** (this session, `packages/adapters`): added for the same reason `getAccounts` was — `listNotes`/`listActivities` are since-window streams with no ref filter, so hydrating a bounded sample's notes/activities through them would mean scanning the whole table regardless of sample size. Both return `GetChildRecordsResult<T>` (`items` flat, sorted by owning opportunity ref.id then by date; `truncatedOpportunityIds`; `apiCallsConsumed`) rather than one-ref-to-one-record like `GetAccountsResult`, since an opportunity maps to zero or more notes/activities, not at most one. Neither method special-cases `AdapterCapabilities.activitySync` — that flag governs whether *absence* of activity is a reliable signal (interpretation), not whether Activity *records* can be read at all; manually-logged activities exist and are readable regardless. Grouping a flat `items` array back into a per-opportunity map (`groupByOpportunity`, `coverageSample.ts`) reads each record's `relatedTo` array, which is multi-valued in the canonical model — a record related to more than one opportunity legitimately appears in more than one bucket.
- **Per-opportunity truncation is real, unlike `accountBatchLimit`/`childRecordBatchLimit`:** `notesPerOpportunityLimit`/`activitiesPerOpportunityLimit` ARE enforced by the adapter (the mock caps each opportunity's returned records and flags it in `truncatedOpportunityIds`) — the one capability-limit pair in this whole family that isn't purely advisory. Callers must treat a truncated opportunity's count as "at least N," never exact. **Now consumed** (this session, see the `applyTruncationFloor`/`CoverageSample.notesTruncatedOpportunityIds`/`activitiesTruncatedOpportunityIds` decisions below) — was flagged as an open item last session, closed this one.
- **`CoverageSample.notesTruncatedOpportunityIds` / `activitiesTruncatedOpportunityIds`** (this session): `hydrateNotes`/`hydrateActivities` now union `GetChildRecordsResult.truncatedOpportunityIds` across every chunk and carry the result forward on `CoverageSample`, instead of discarding it. Placeholder empty `Set()` until the corresponding hydration step runs, same pattern as every other hydrated field.
- **`applyTruncationFloor` (`src/metrics/shared.ts`, this session):** the only place `MetricResult.floor` is ever set. Checks a metric's *actual computed denominator* (not the raw sample — e.g. `activity_capture_rate`'s 7-day-exclusion-filtered `eligible` list, `stage_activity_contradiction_rate`'s late-stage-filtered `lateStage` list) against the truncated-id set, so an opportunity truncated but excluded from THIS metric's denominator anyway (confirmed with the healthy fixture's `opp-0`: truncated for both notes and activities, but `stage_activity_contradiction_rate` correctly shows `floor: false` since `opp-0` is `prospecting`-stage, outside that metric's late-stage denominator) doesn't wrongly flag it. No-op when status isn't `'ok'` or nothing in the denominator was truncated. Wired into the 3 affected metrics: `note_coverage_rate`, `activity_capture_rate` (`coverage.ts`), `stage_activity_contradiction_rate` (`consistency.ts`). **Flags regardless of whether truncation could plausibly change the value** — none of these 3 is count-based (all are presence/rate checks, and the per-opportunity cap defaults to 200, so a truncated opportunity's presence answer is never actually wrong) — this is a deliberate, general data-completeness signal for any reader of the result, not a correction to a wrong number.
- **Report layer (`buildReport.ts`/`render.ts`, this session):** `MetricRow` gained a non-optional `floor: boolean` (always `false` for deferred/D5/not-implemented rows, `result.floor ?? false` otherwise). `render.ts` shows a `≥` prefix on the formatted value plus a distinct "FLOOR" pill (own color, hover tooltip) in both the single-report metrics table and the `--all` comparison matrix. The `healthy` fixture (`src/fixtures/mockOrgs.ts`) now seeds `opp-0` with 205 notes and 205 activities — comfortably over the 200 default per-opportunity cap — specifically so a real report run demonstrates the badge, not just unit-test fixtures. Verified end to end: `note_coverage_rate`/`activity_capture_rate` show `floor: true` on the healthy report; `stage_activity_contradiction_rate` correctly does not.
- **Mock truncation order fixed: oldest-first, not newest-first** (`packages/adapters/src/mock.ts`, this session). `getChildRecordsByOpportunity` previously sorted ascending and kept the FIRST `perOpportunityLimit` items — the oldest ones, dropping the newest. Fixed to keep the LAST `perOpportunityLimit` items of the ascending-sorted array instead (still returned in ascending order, per the contract) — i.e. truncation now drops old records first, keeping recent ones. This matters concretely, not just cosmetically: `activity_capture_rate`'s 30-day and `stage_activity_contradiction_rate`'s 21-day trailing windows are exactly the callers most likely to need the newest records and least likely to care about old ones — the previous behavior could silently drop a genuinely-qualifying recent activity while keeping stale ones nobody asked about. Documented as a MUST on both `AdapterCapabilities.notesPerOpportunityLimit`'s docblock and `GetChildRecordsResult.truncatedOpportunityIds`'s, so a future real adapter (Salesforce, HubSpot) implements the same order, not an arbitrary one — the contract suite doesn't force a specific truncation-selection order (forcing an actual truncation scenario needs adapter-specific seeded data, same reasoning as why the numeric cap itself isn't tested at the shared-contract level), so this is enforced by written contract + the mock's own tests, not by `adapter.contract.ts`.
- **`hydrateNotes`/`hydrateActivities` (`src/coverageSample.ts`, this session):** same shape as `hydrateStageHistory` — chunk the sorted, deduped opportunity-ref set at `capabilities().childRecordBatchLimit`, call the adapter, group results back by opportunity. **Deliberately no new `notesHydrated`/`activitiesHydrated` boolean or gate on `CoverageSample`** (a live option, given `accountsHydrated`'s precedent) — decided against it: `notesByOpportunity`/`activitiesByOpportunity` were never documented with `accountsByRef`'s "empty and meaningless until hydrated" caveat, `note_coverage_rate` has no capability to gate on (presence-of-notes is unconditionally meaningful), and `activity_capture_rate`/`stage_activity_contradiction_rate` already gate on `capabilities.activitySync` *before* ever reading the map — a second gate would be redundant, not additive. Verified directly: a dedicated test (`coverageSample.test.ts`, "activitySync capability gate survives real hydration") hydrates real activity data with `activitySync: false` and confirms both metrics still return `not_instrumented`, not a computed value.
- **`buildReport.ts`'s 3 caveat notes (D1 gap, flagged when the visual report shipped) are removed**, not just silenced — the code that added `"Known gap: CoverageSample does not yet hydrate notes/activities..."` to `note_coverage_rate`/`activity_capture_rate`/`stage_activity_contradiction_rate`'s rows is deleted, since `buildReportData` now calls `hydrateNotes`/`hydrateActivities` for real. Rerunning the report against `healthy`/`fresh` now shows real coverage numbers (e.g. `note_coverage_rate` ~0.8 instead of a caveat) instead of the placeholder 0%/caveat pairing; `legacy` (which seeds no notes) correctly still shows 0%, now for a real reason.
- **`SecondSourceAdapter` (D5 part 1, `packages/adapters/src/types.ts`):** separate interface from `CrmAdapter`, confirmed with the user before implementation (design note). `has*: false` → the corresponding method returns empty, never throws, same contract as `CrmAdapter.listStageHistory` — confirmed with the user, then verified by a dedicated contract-suite describe block (`secondSource.contract.ts`'s "capability gate-off"), not just documented. `SecondSourceCapabilities.maxSampleSizePerType` is caller-enforced, not adapter-enforced — `MockSecondSourceAdapter`'s `list*` methods don't cap themselves; flagged in "Next steps" as untested until D5's orchestration phase exists.
- **Two corrections found while implementing D5 part 1, not caught during the design-note review** (both fixed in the design note before writing any code, then implemented per the corrected sketch): (1) the design note originally reused `RecordRef` for second-source objects; `RecordRef.crm` is typed `CrmVendor` (`'salesforce' | 'hubspot' | 'mock'`), a closed CRM-only union, so it doesn't type-check for a non-CRM source — introduced `SecondSourceRef` (`source: string`, open-ended, instead of `crm: CrmVendor`) instead. (2) `SecondSourceContact`/`SecondSourceAccount` originally had no timestamp field; `listContacts`/`listAccounts`' `SyncWindow.since` filter and `SyncPage.watermark` need one to filter/sort by, so both gained `modifiedAt: string`. `SecondSourceActivity` already had timestamps and needed no change. Neither correction changes any of the five locked decisions (interface separation, `list*` + cap, timezone/precision scope, hashing-at-boundary, per-type capability flags) — both are structural fixes to make the locked shape actually compile and function.
- **`GetSecondSourceRecordsResult<T>.truncatedRefIds` is shared across all three `getXByRef` methods but only ever non-empty for `getActivitiesByRef`** — a contact/account ref resolves to at most one record (same one-ref-to-at-most-one shape as `CrmAdapter.getAccounts`), so there's nothing to truncate there. Not a bug, just an always-empty field on 2 of 3 call sites — flagged as a possible later cleanup (e.g. a narrower `GetSecondSourceByRefResult<T>` without the field for those two), not fixed this session since it doesn't block correctness.
- **Second-source fixture overlap is illustrative, not calibrated** — `healthy`'s 13/15 and `legacy`'s 1/6 match ratios were chosen for "good" vs. "poor" contrast, not derived from any real-org benchmark. Revisit once D5 metrics exist and their thresholds (`rubric.ts`) need realistic fixture behavior to validate against.
- **D5 part 2a: matching-count semantics** (confirmed with the user, doc was silent — same pattern as `duplicate_account_rate`'s group-counting decision in D3 part 2b): a CRM contact/account counts as resolved if it matches **at least one** second-source record by hashed email / normalized domain — no dedup beyond that. If multiple second-source records share a hash/domain (e.g. duplicates in the second source), the CRM record still counts once, but `SecondSourceResolution.contactMatches`/`accountMatches` preserve **every** matching `SecondSourceRef` in an array (not just one arbitrarily chosen), so D5 part 2b's `activity_attribution_rate` can look up activities against any of them without re-deriving the match. Documented in `metric-definitions.md`'s `contact_identity_resolution_rate`/`account_resolution_rate` entries.
- **D5 part 2a: hashing/normalizing happens in `sampleSecondSource`, not `resolveSecondSource`** — a mid-implementation change from the originally-approved plan (user caught it before code was written): `SecondSourceSampleResult` must never hold a raw email or domain, so the transform happens per-page, at the moment each record arrives from the adapter, not later when matching runs. The salt is generated once by `resolveSecondSource` (the only caller) and passed into `sampleSecondSource`, so `sampleSecondSource` itself never generates its own salt — every hash it produces is guaranteed comparable against whatever else that run hashes with the same salt.
- **D5 part 2a: `resolveSecondSource` throws on `contactsHydrated`/`accountsHydrated` false, rather than returning an empty/`not_instrumented`-shaped result.** This isn't a metric, so there's no `MetricStatus` to degrade into — an orchestration caller invoking it before hydration has a bug, and a thrown error surfaces that immediately rather than silently returning an empty resolution that would look identical to "genuinely zero matches." Confirmed as the right shape during D5-part-2a planning, not silently assumed.
- **`AdapterCapabilities.contactBatchLimit`** (D5 part 2a, cross-package, `packages/adapters`): new field, not a reuse of `accountBatchLimit` — same reasoning `childRecordBatchLimit` got its own field over reusing `accountBatchLimit` (different ref type, not actually a different limit value in the mock, but kept distinct for real adapters where the two could legitimately differ). Confirmed with the user before implementation, since this is a cross-package adapter-contract change.
- **"No raw PII in `ReportData`/`--json`" — re-verified against real output, D5 part 2b. RESOLVED, no longer an open item.** D5 part 2a's version of this test covered `SecondSourceResolution` only (an approved stand-in, since nothing wired D5 into the report yet). This session added `test/report/buildReport.test.ts`'s "D5 no-raw-PII" block, asserting no raw second-source email appears in `JSON.stringify(ReportData)` for the `healthy` fixture — the actual `ReportData`/`--json` requirement `second-source-adapter-design.md` decision 4 named. Also spot-checked by hand against a real `cli.ts --fixture healthy --json` run.
- **`activity_attribution_rate`'s gate, locked with the user before implementation:** `hasActivities` AND (`hasContacts` OR `hasAccounts`) — both contact and account data absent means `not_instrumented` ("no contact or account data in second source to attribute through"), never a rate quietly degraded toward zero. This is deliberately stricter/different from `temporal_anomaly_rate`, which gates on `hasActivities` alone — `temporal_anomaly_rate` can still meaningfully run its created-after-modified and future-dated checks with zero contact/account resolution (only its close-date check needs attribution, and that check just doesn't fire for an unattributable activity rather than blocking the whole metric), whereas attribution *is* `activity_attribution_rate`'s entire purpose, so no attribution possible really does mean nothing to measure. Flagging the asymmetry explicitly since it isn't obvious from the metric names alone.
- **`activity_attribution_rate`/`temporal_anomaly_rate`'s "at least one candidate opportunity" attribution rule** (`src/metrics/joinability.ts`'s `candidateOpportunities`): a second-source activity's matched contact/account can link to more than one sampled CRM opportunity (e.g. several open deals on one account). An activity attributes/anomaly-checks against *any* candidate whose window/close-date condition it satisfies — same "at least one, no dedup" style as the resolution matching itself (D5 part 2a), not "exactly one" or "the most recent one." Confirmed with the user, then locked in `metric-definitions.md`'s `activity_attribution_rate` entry.
- **`temporal_anomaly_rate`'s pooled-denominator scope, locked with the user and written into `metric-definitions.md`:** CRM Opportunities + CRM Activities + second-source Activities only — CRM and second-source Contacts/Accounts are excluded entirely. Per-record-type check applicability differs (CRM `Activity` has no `createdAt`/`modifiedAt` at all, so created-after-modified can't apply to it; `closeDate` is excluded from every future-dated check, since a forecasted future close date on an open deal is expected, not an anomaly) — see the doc entry for the full per-type breakdown, not repeated here.
- **Floor extended uniformly to all 4 D5 metrics, not just `activity_attribution_rate`/`temporal_anomaly_rate` as first scoped.** Confirmed with the user: `SecondSourceSampleResult` gained `contactsTruncated`/`accountsTruncated` alongside the already-planned `activitiesTruncated` (`src/secondSource/sample.ts`, same keep-newest-style truncation signal as the rest of D5 — computed by `paginate`'s existing loop, not a new mechanism). Applied per which inputs each metric actually reads: `contact_identity_resolution_rate` → `contactsTruncated`; `account_resolution_rate` → `accountsTruncated`; `activity_attribution_rate` → any of the three (it reads activities AND the contact/account matches used to attribute them); `temporal_anomaly_rate` → `activitiesTruncated` only (per the scope lock above, it never reads second-source contacts/accounts at all, so their truncation is irrelevant to it). Same "general data-completeness signal, not a proven-direction correction" philosophy `applyTruncationFloor` established for D1 — `src/metrics/joinability.ts`'s local `withFloorIf` generalizes that to a plain per-type boolean instead of a per-record truncated-id set, since D5's truncation signal isn't per-record.
- **`MetricConfig.secondSourceResolution?: SecondSourceResolution`** (`metrics/types.ts`, D5 part 2b): threads the D5 orchestration output into every metric function via the existing `(sample, config) => MetricResult` signature, unchanged for every other metric. Deliberately not added to `CoverageSample` — keeps `CoverageSample` CRM-only, same architectural split as `SecondSourceRef` staying separate from `RecordRef` (D5 part 1). Creates a type-only circular import between `metrics/types.ts` and `secondSource/resolve.ts` (each references the other's type) — confirmed this compiles cleanly (`import type` is erased before runtime, so there's no actual circular value dependency), not a design smell to fix.
- **`buildReportData(adapter, secondSourceAdapter, options)`** (D5 part 2b, `report/buildReport.ts`): new second positional parameter, `SecondSourceAdapter | undefined` — not folded into `BuildReportOptions`, matching how `adapter` itself is already separate from options. `hydrateContacts`/`resolveSecondSource` are only called when `secondSourceAdapter` is provided — skipped entirely otherwise, so the no-second-source path costs zero extra I/O (unlike `hydrateAccounts`/`hydrateNotes`/`hydrateActivities`, which run unconditionally regardless of capability gates, because D1-D4 metrics that always run depend on them; nothing depends on `hydrateContacts` except D5, so there's no equivalent reason to pay for it when D5 can't use it). `cli.ts` constructs `MockSecondSourceAdapter` from `fixture.secondSource.data`/`.capabilities` when present. The `D5_METRICS` fallback set and its branch in `buildReportData` are deleted — dead code once D5 joined `IMPLEMENTED`. No `render.ts` changes: row styling is purely `status`-driven, so `ok` D5 rows render live automatically.
- **D6/D7 scoping session (doc-only, no code): six decisions locked into `metric-definitions.md`, full rationale there, summarized here.** (1) `substantive_note_rate`/`median_note_length_chars` are scoped to open **and** closed sampled opportunities' notes, not open-only — `note_coverage_rate`'s own denominator is open-only, but `substantive_note_rate` gates `enablement_answer_engine`, which reasons over closed-won/lost history, so open-only would have measured the wrong population. (2) `pii_density` now names its population precisely: Note `body`, Activity `subject`/`body`, and Opportunity `nextStep`, counted **per record** (a record with multiple matching fields still counts once), denominator excludes records with no candidate field set at all; card-like matches require a Luhn check, not just a digit-count pattern; the result must report counts only, never a matched value, and the existing D5 no-raw-PII test must be extended to cover it. (3) `untrusted_text_ratio` is no longer capability-gated — it reads `TrustedText.tier === TrustTier.ExternallySourced` directly (Note `body` + Activity `subject`/`body`, not `nextStep`), since every `TrustedText` is guaranteed a `tier` at ingestion; the old "adapter can't distinguish origin → `not_instrumented`" framing described a gate that can't occur in this model and was removed. Its output must caveat that it reflects the adapter's own ingestion-time tier assignment, not verified ground truth. (4) `closed_deal_count_12m` trusts `sample.ts`'s existing `CLOSED_WINDOW_MONTHS` window rather than re-deriving it, and gets a new `floor: true` path: it must be set whenever either the `closed_won` or `closed_lost` reservoir stratum is full (`underfilled: false`), since a full reservoir means `closedOpportunities.length` is a sample-size ceiling, not the org's true volume. This needs two new `CoverageSample` fields carrying both strata's `underfilled` flags forward — `buildCoverageSample` currently discards them. (5) `outcome_evidence_retention_rate` ships as scoped and shares decision 4's window-trust reasoning, but — reversing this session's own first pass — does **not** get `applyTruncationFloor`: truncation can't change its ≥1-record answer, the same fact true of `note_coverage_rate`/`activity_capture_rate` too, but for this metric that's reason enough to skip the floor rather than apply it as a general signal anyway; a policy call, not a logical necessity, made the other way for the other two. (6) `win_rate_dispersion` is **blocked, not shipped** — see "Deferred" below.
- **Why `win_rate_dispersion` is deferred, not scoped-and-ready like the other 6:** it needs win rate grouped by every canonical stage a *closed* deal passed through, but a closed `Opportunity.stage` only ever holds `closed_won`/`closed_lost` — intermediate stages only exist in `StageHistoryEntry`, and there is no by-opportunity-ref adapter method to fetch them (`listStageHistory` is an unfiltered stream; D4's `hydrateStageHistory` only fetches one org-wide earliest entry). Confirmed this requires a new `getStageHistoryByOpportunity(oppRefs)` adapter method — cross-package, plan-and-wait, same as the two existing deferrals. Bundled with them below rather than scoped as a third standalone deferral.

---

## Deferred: `median_next_step_age_days`

Not implemented. Root cause: no adapter can report a per-field "Next Step
last changed" timestamp. `Opportunity` has only one whole-record
`modifiedAt`; `TrustedText.source.capturedAt` (the closest-looking
candidate, on `nextStep`) is documented as citation/audit provenance, not a
field-change date, and using it as a stand-in would silently overload its
meaning.

`metric-definitions.md` now specifies (as of `031ad35`): no fallback to
`LastModifiedDate`/`approximate: true` — this metric returns
`not_instrumented` until a real `nextStepHistory` adapter capability exists
(field-history backed, the same shape as `stageHistory`/`ownerHistory`).

To unblock: this needs a canonical-model / adapter-contract change first
(new capability flag + presumably a new history record type, or a field on
`Opportunity`), which is a multi-file, cross-package change — show the plan
and wait for approval before writing any of it, same process as
`OpportunityContactLink`.

**Bundled this session** with `close_date_history_enabled` and D7's
`win_rate_dispersion` (see below) into one adapter-contract change, rather
than three separate plan-and-wait sessions — all three need a new
history-tracking capability/method added to `packages/adapters`.

---

## Deferred: `close_date_history_enabled`

Not implemented. Same fix shape as `median_next_step_age_days` above. Root
cause: no adapter capability represents "field-history tracking on Close
Date" today. `AdapterCapabilities.stageHistory`/`ownerHistory` don't cover
it, and `StageHistoryEntry.closeDateAtChange` (a snapshot of the close
date *at a stage change*, not field-history on Close Date itself) is
explicitly disallowed as a stand-in by this metric's own definition in
`metric-definitions.md` — using it would be exactly the "infer from
whether history records happen to exist" that entry's own rule forbids.

To unblock: needs a new `AdapterCapabilities` field (shape TBD — a boolean
flag at minimum, and depending on how `rubric.ts`'s slip-detection use
case evolves, possibly a new history record type mirroring
`StageHistoryEntry`/`OwnerChange`), which is a multi-file, cross-package
change — show the plan and wait for approval before writing any of it,
same process as `OpportunityContactLink` and the `nextStepHistory`
capability above.

Already wired as a gate in one of `rubric.ts`'s `CapabilitySpec`s
(alongside `close_date_fill_rate` and `past_due_close_date_rate`) — the
threshold entry exists and is unaffected by this deferral; only the
metric's implementation is blocked.

**Bundled this session** with `median_next_step_age_days` above and D7's
`win_rate_dispersion` below into one adapter-contract change — see that
metric's entry for why.

---

## Deferred: `win_rate_dispersion`

Not implemented (D7, scoped this session — see `metric-definitions.md`).
Root cause: a closed `Opportunity.stage` is only ever
`closed_won`/`closed_lost` — the canonical model retains no field for which
intermediate pipeline stages (`prospecting` → ... → `negotiation`) a deal
passed through before closing. That information only exists in
`StageHistoryEntry.toStage`, keyed by `opportunityRef` (D4's
`stageHistory` capability). `CrmAdapter.listStageHistory` is a
since-window/cursor stream with no ref filter — the same shape gap
`getAccounts`/`getContactsByRef`/`getNotesByOpportunity` were each added to
close for accounts/contacts/notes — and D4's existing `hydrateStageHistory`
glue (`coverageSample.ts`) only fetches one org-wide earliest entry, which
is all `stage_history_months` needs but nowhere near a full per-opportunity
transition sequence for every sampled closed deal. Scanning
`listStageHistory` unfiltered and matching client-side against sampled refs
would violate the "never full-scan a production org" rule that justified
the earlier by-ref additions, so that's not an option either.

To unblock: needs a new `getStageHistoryByOpportunity(oppRefs)` method on
`CrmAdapter` (`packages/adapters`), same shape as `getNotesByOpportunity` —
a cross-package, multi-file change. Show the plan and wait for approval
before writing any of it, same process as `OpportunityContactLink`.

**Bundled this session** with the two D2/D4 deferrals above into one
adapter-contract change covering three additions to `packages/adapters` at
once: `getStageHistoryByOpportunity` (this metric), a `nextStepHistory`
capability (`median_next_step_age_days`), and a `closeDateHistory`-shaped
capability (`close_date_history_enabled`). Scoped together because all
three are "add a history-tracking capability + adapter method" changes to
the same package — one plan-and-wait session, not three.

---

## Open questions, not yet resolved

- **`round_amount_rate` and negative amounts.** Currently left in the
  denominator and evaluated by the same `% 1000 === 0` rule as any other
  amount (e.g. -5000 counts as round). Not resolved this session — deferred
  to v0.2. Revisit if negative amounts turn out to be common enough in real
  data to matter; nothing upstream currently rejects them.
- **`duplicate_account_rate`, "beyond first" group-counting variant.** This
  session's decision counts every member of a duplicate group toward the
  numerator (see decisions above). If a future consumer wants the "members
  beyond the first" count instead (e.g. for a remediation-effort estimate —
  "N accounts need merging" reads differently from "N accounts are
  involved"), it's derivable from the existing `note`'s duplicate-group
  count without changing the metric; only becomes a real question if
  something needs it as a first-class number rather than derived from a
  string.
- **`duplicate_account_rate` and cross-TLD dedupe.** `acme.com` and
  `acme.io` are never linked as duplicates in v0.1 — out of scope, per
  `metric-definitions.md`. Revisit if this undercounts duplication enough
  to matter in practice.
- **`duplicate_account_rate` and regional shared-provider domains.**
  `DEFAULT_SHARED_PROVIDER_DENYLIST` has no regional variants (`yahoo.co.uk`,
  etc.) in v0.1 — addable per-org via `MetricConfig.sharedProviderDenylist`,
  which currently *replaces* the default rather than merging with it (see
  decisions above). Revisit if an org needs "default plus a few extras"
  often enough to justify a merge option.
- **`owner_history_enabled`/`stage_history_months` and `lowConfidence`.**
  Both hardcode `sampleSize: 0`/`lowConfidence: false` rather than deriving
  it from `LOW_CONFIDENCE_SAMPLE_SIZE` (see decisions above) — a judgment
  call, not specified by the user. Revisit if the report layer wants some
  other signal for "this number rests on very little underlying data"
  (e.g. `stage_history_months` found its answer from exactly one boundary
  record).
- **`stage_history_months` and the dry-run budget.** `hydrateStageHistory`'s
  one `listStageHistory` call is not reflected in `SamplePlan`'s planned
  API call estimate or the confirmation-prompt display, unlike account
  hydration (D3 part 2a). Minor (it's exactly one bounded call, not a
  chunked scan) but inconsistent with the existing quota-discipline
  display; revisit if this ships for real quota planning.
- **`hydrateNotes`/`hydrateActivities` and the dry-run budget.** Same gap
  as above, but larger in practice — these two calls scale with the
  number of `childRecordBatchLimit`-sized chunks of sampled opportunities,
  not a single bounded call. Not reflected in `SamplePlan` at all yet.
- **`hydrateContacts` and the dry-run budget, `sampleSecondSource` and the
  dry-run budget (D5 part 2a).** Same unresolved gap as the two items
  above, now with two more callers: neither is reflected in `SamplePlan`.
  Not addressed this session — consistent with prior sessions treating
  this as a recurring, deliberately deferred item, not solved once and
  forgotten for the next hydration step.

(The `metric-definitions.md` "runbook" reference and the
`stage_fill_rate`/`owner_id_fill_rate` question that used to live here are
both resolved — the runbook reference now points at `claude/RUNBOOK.md`,
added to the repo and confirmed to match: its Step 7 is exactly the
"one metric per session" prompt loop the doc describes.)

---

## Next steps (not started, no plan agreed yet)

- **D1, D3, D5 are fully implemented as of this session. D2 and D4 each
  have one deferred metric** (2 of 3 done, not 3 of 3): D2's
  `median_next_step_age_days` and D4's `close_date_history_enabled` are
  both blocked on a new adapter capability (see the two "Deferred"
  sections below) — neither is "complete," just as complete as v0.1 gets
  without that cross-package change. D4's other two
  (`owner_history_enabled`/`stage_history_months`) are done. **D5 is
  done** (part 1: adapter/mock/contract/fixtures; part 2a:
  sampling/hashing/resolution orchestration; part 2b, this session: the 4
  metrics + report wiring), the only dimension besides D1/D3 with zero
  deferrals. **D6 (4 metrics) and D7 (3 metrics) are scoped and locked in
  `metric-definitions.md` this session — zero code written.** 6 of the 7
  are ready for implementation (`substantive_note_rate`,
  `median_note_length_chars`, `pii_density`, `untrusted_text_ratio`,
  `closed_deal_count_12m`, `outcome_evidence_retention_rate`); D7's
  `win_rate_dispersion` is deferred, bundled into the same
  adapter-contract change as D2's `median_next_step_age_days` and D4's
  `close_date_history_enabled` (see "Deferred" sections below). No
  implementation plan for the 6 shippable metrics has been agreed yet —
  next up.
- **`GetSecondSourceRecordsResult.truncatedRefIds`'s always-empty field on
  `getContactsByRef`/`getAccountsByRef`** (see decisions above) — minor
  cleanup candidate, not blocking.
- Whether `owner_id_fill_rate` should ever gate a capability in `rubric.ts`
  (currently report-only, by design, not oversight).
- The bundled adapter-contract change blocking `median_next_step_age_days`
  (D2), `close_date_history_enabled` (D4), and `win_rate_dispersion` (D7):
  `nextStepHistory` capability, a `closeDateHistory`-shaped capability, and
  `getStageHistoryByOpportunity(oppRefs)` — three additions to
  `packages/adapters`, scoped together, none started.
- Fixture gaps the 6 shippable D6/D7 metrics need before they're testable,
  not yet built: no fixture currently produces `ExternallySourced` text
  (`makeNote` hardcodes `TrustTier.UserAuthored`; `makeActivity` never sets
  `subject`/`body` and hardcodes `direction: 'outbound'`) or any
  PII-pattern-matching text, and no fixture's closed strata fill the
  reservoir (`underfilled: false`) to exercise `closed_deal_count_12m`'s
  new floor path.
- The `excludedCount`-as-`note` tech debt, now at its second use
  (`round_amount_rate`, `stage_mapping_coverage` — see decisions above) —
  revisit if a third metric needs the same pattern, or if
  `duplicate_account_rate`'s heavier note turns out to need it sooner.
- The three `duplicate_account_rate` open questions (beyond-first variant,
  cross-TLD, regional shared-provider domains), the two D4 open questions
  (`lowConfidence` hardcoding, dry-run budget), and one remaining
  note/activity-hydration open question (dry-run budget not accounting
  for `hydrateNotes`/`hydrateActivities`'s calls) — none blocking, all
  deferred to v0.2 or later. `truncatedOpportunityIds` consumption
  (`applyTruncationFloor`) and the mock's truncation-selection order are
  both resolved now — see decisions above.

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
| D5–D7 (11 remaining metrics) | Not started | — |

`notesByOpportunity`/`activitiesByOpportunity` hydration — the gap flagged
when the visual report shipped (`note_coverage_rate`,
`activity_capture_rate`, `stage_activity_contradiction_rate` were running
over permanently-empty maps) — was fixed last session. This session
additionally consumes the truncation info that fix's adapter methods
already computed but discarded: `MetricResult` gained `floor`, surfaced
as a visible badge in the report. See "Cross-package" and the new
decisions below.

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
- `src/metrics/types.ts` — `MetricResult`, `CoverageSample`, `MetricConfig` (gained optional `sharedProviderDenylist` in D3 part 2b; `CoverageSample` gained `stageHistoryEarliestChangedAt`/`stageHistoryHydrated` in D4 part 1, `notesTruncatedOpportunityIds`/`activitiesTruncatedOpportunityIds` this session; `MetricResult` gained optional `floor` this session).
- `src/coverageSample.ts` — builds `CoverageSample` from a `SampleResult` (`buildCoverageSample`) and hydrates it: accounts (`hydrateAccounts`), org-wide earliest stage-history entry (`hydrateStageHistory`), and per-opportunity notes/activities (`hydrateNotes`, `hydrateActivities`) — the latter two now also carry forward each `GetChildRecordsResult`'s `truncatedOpportunityIds`, unioned across chunks; see decisions below.
- `test/fixtures/*.ts`, `test/metrics/*.test.ts` — one golden-fixture file per metric, one test file per metric family. `test/metrics/shared.test.ts` is the exception (added D3 part 2b) — it tests `normalizeDomain`/`wholeCalendarMonthsBetween`/`applyTruncationFloor` directly since those are helpers, not metrics, and have no fixture file of their own.
- `test/coverageSample.test.ts` — builder + hydration tests (not per-metric, so it doesn't follow the `test/fixtures/` + `test/metrics/` split above). Gained `hydrateNotes`/`hydrateActivities` describe blocks last session, plus an integration-style block proving the `activitySync` capability gate survives real hydration.
- `src/report/buildReport.ts`/`render.ts` — `buildReportData` calls `hydrateNotes`/`hydrateActivities` as part of its orchestration (caveat-note logic removed last session, since these 3 metrics now compute over real data); `render.ts` now shows a visible "FLOOR" badge (plus a `≥` value prefix) when a row's `floor` is true, in both the single-report table and the `--all` comparison matrix.
- `src/fixtures/mockOrgs.ts` — `healthy`'s `opp-0` now seeds 205 notes and 205 activities (over the 200 default per-opportunity cap), this session, so the report's floor badge has something real to show, not just unit-test fixtures.

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

`npm run ci` green at handoff: adapters 30, kernel 22, readiness 198.

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
- **`hydrateNotes`/`hydrateActivities` (`src/coverageSample.ts`, this session):** same shape as `hydrateStageHistory` — chunk the sorted, deduped opportunity-ref set at `capabilities().childRecordBatchLimit`, call the adapter, group results back by opportunity. **Deliberately no new `notesHydrated`/`activitiesHydrated` boolean or gate on `CoverageSample`** (a live option, given `accountsHydrated`'s precedent) — decided against it: `notesByOpportunity`/`activitiesByOpportunity` were never documented with `accountsByRef`'s "empty and meaningless until hydrated" caveat, `note_coverage_rate` has no capability to gate on (presence-of-notes is unconditionally meaningful), and `activity_capture_rate`/`stage_activity_contradiction_rate` already gate on `capabilities.activitySync` *before* ever reading the map — a second gate would be redundant, not additive. Verified directly: a dedicated test (`coverageSample.test.ts`, "activitySync capability gate survives real hydration") hydrates real activity data with `activitySync: false` and confirms both metrics still return `not_instrumented`, not a computed value.
- **`buildReport.ts`'s 3 caveat notes (D1 gap, flagged when the visual report shipped) are removed**, not just silenced — the code that added `"Known gap: CoverageSample does not yet hydrate notes/activities..."` to `note_coverage_rate`/`activity_capture_rate`/`stage_activity_contradiction_rate`'s rows is deleted, since `buildReportData` now calls `hydrateNotes`/`hydrateActivities` for real. Rerunning the report against `healthy`/`fresh` now shows real coverage numbers (e.g. `note_coverage_rate` ~0.8 instead of a caveat) instead of the placeholder 0%/caveat pairing; `legacy` (which seeds no notes) correctly still shows 0%, now for a real reason.

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
- **`applyTruncationFloor`'s "most relevant records" assumption.** The
  mock selects which records survive truncation by sorting ascending and
  slicing — the oldest N, not necessarily the most useful N. A real
  adapter would need to define its own truncation-selection order (e.g.
  most-recent-first might serve `activity_capture_rate` better than
  oldest-first, since it only cares about the trailing 30 days). Not
  resolved this session — `floor: true` discloses that the value may be
  incomplete, but says nothing about which records were kept.

(The `metric-definitions.md` "runbook" reference and the
`stage_fill_rate`/`owner_id_fill_rate` question that used to live here are
both resolved — the runbook reference now points at `claude/RUNBOOK.md`,
added to the repo and confirmed to match: its Step 7 is exactly the
"one metric per session" prompt loop the doc describes.)

---

## Next steps (not started, no plan agreed yet)

- **D3 and D4 are as complete as they'll get in v0.1** (D4:
  `owner_history_enabled`/`stage_history_months` done, `close_date_history_enabled`
  deferred pending a new adapter capability). Next up: D5 joinability (4,
  all gated on a second source being connected), D6 text substrate (4),
  D7 label availability (3) — 11 metrics total remaining.
- Whether `owner_id_fill_rate` should ever gate a capability in `rubric.ts`
  (currently report-only, by design, not oversight).
- `median_next_step_age_days`'s `nextStepHistory` capability and
  `close_date_history_enabled`'s new capability — both blocked on the same
  shape of canonical-model/adapter-contract change, if either is
  prioritized before the rest of D5–D7.
- The `excludedCount`-as-`note` tech debt, now at its second use
  (`round_amount_rate`, `stage_mapping_coverage` — see decisions above) —
  revisit if a third metric needs the same pattern, or if
  `duplicate_account_rate`'s heavier note turns out to need it sooner.
- The three `duplicate_account_rate` open questions (beyond-first variant,
  cross-TLD, regional shared-provider domains), the two D4 open questions
  (`lowConfidence` hardcoding, dry-run budget), and the two remaining
  note/activity-hydration open questions (dry-run budget not accounting
  for these calls; the mock's oldest-first truncation-selection order,
  which may not be the most useful order for a trailing-window metric
  like `activity_capture_rate`) — none blocking, all deferred to v0.2 or
  later. `truncatedOpportunityIds` itself is no longer on this list — it's
  consumed now (`applyTruncationFloor`, see decisions above).

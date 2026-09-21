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
| D3–D7 (18 remaining metrics) | Not started | — |

`stage_fill_rate` does not exist and never will — `Opportunity.stage` is
required/non-nullable, so there's no "missing" state to measure. See
metric-definitions.md's D1 header for the full explanation. This was the
other half of the "open question" this doc used to carry; it's resolved.

Files:
- `src/metrics/coverage.ts` — D1 (all 7 metrics, including `owner_id_fill_rate`).
- `src/metrics/freshness.ts` — D2 (two of three; see deferral below).
- `src/metrics/shared.ts` — helpers used by both families (see below).
- `src/metrics/types.ts` — `MetricResult`, `CoverageSample`, `MetricConfig`.
- `test/fixtures/*.ts`, `test/metrics/*.test.ts` — one golden-fixture file per metric, one test file per metric family.

`npm run ci` green at handoff: adapters 14, kernel 22, readiness 114.

---

## Decisions and conventions established so far

These are not written down anywhere else — re-derive them from the commits
above if this doc ever drifts, but treat this list as authoritative for
*why*, not just *what*.

- **Every metric is `(sample: CoverageSample, config: MetricConfig) => MetricResult`.** Pure function, no exceptions. `CoverageSample` is reused across D1 and D2 even where a metric doesn't need all of its fields (e.g. D2's two metrics ignore `notesByOpportunity`/`activitiesByOpportunity`) — a narrower per-family sample type was considered and deliberately rejected to avoid type proliferation for no behavioral gain.
- **Capability gate-off → `not_instrumented`, never a computed score.** Established for `activity_capture_rate` (gated on `AdapterCapabilities.activitySync`). Same pattern intended for any future capability-gated metric (e.g. `close_date_history_enabled`, `owner_history_enabled` in D4 — those are boolean capability checks by definition, not rate computations, so confirm the pattern still applies before assuming it transfers directly).
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

## Open questions, not yet resolved

None currently. (The `metric-definitions.md` "runbook" reference and the
`stage_fill_rate`/`owner_id_fill_rate` question that used to live here are
both resolved — the runbook reference now points at `claude/RUNBOOK.md`,
added to the repo and confirmed to match: its Step 7 is exactly the
"one metric per session" prompt loop the doc describes.)

---

## Next steps (not started, no plan agreed yet)

- D3 consistency/hygiene (4 metrics), D4 history depth (3), D5 joinability
  (4, all gated on a second source being connected), D6 text substrate (4),
  D7 label availability (3) — 18 metrics total remaining.
- Whether `owner_id_fill_rate` should ever gate a capability in `rubric.ts`
  (currently report-only, by design, not oversight).
- `median_next_step_age_days`'s `nextStepHistory` capability, if it's
  prioritized before the rest of D3–D7.

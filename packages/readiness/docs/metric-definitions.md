# Metric definitions — gtm-readiness v0.1.0

Feeds Phase C (`packages/readiness/src/metrics/*.ts`). Each entry is what a
Claude CLI session pastes as input, per `claude/RUNBOOK.md`'s Step 7 prompt
template.
If an implementation session hits a case not covered here, that's a gap in
this doc, not a judgment call for the session to make — stop and add it here.

Thresholds live in `rubric.ts` and are not repeated in full below; each
entry names its threshold key for cross-reference only.

---

## D1. Coverage

**`stage_fill_rate` does not exist, intentionally.** `Opportunity.stage` is
a required, non-nullable field in the canonical model (`canonical.ts`) — an
adapter must map every opportunity to some `CanonicalStage`, even a low-
confidence or unmapped one via `stageConfidence`. There is no "missing
stage" state to measure, so a fill rate over it would always read 100% and
carry no signal. Stage data *quality* (as opposed to presence) is already
covered by D3's `stage_mapping_coverage`.

### close_date_fill_rate
**Definition:** share of sampled *open* opportunities with a non-null Close
Date field.
**Denominator:** open opportunities in the sample (see `sample.ts`), not
closed ones — a closed deal's close date is definitionally set.
**Edge case:** a close date of exactly today counts as filled, not past-due
(that's `past_due_close_date_rate`'s job).
**Threshold:** `close_date_fill_rate`.

### amount_fill_rate
**Definition:** share of sampled open opportunities with a non-null, non-zero
Amount.
**Edge case:** Amount = 0 counts as unfilled. A genuinely free/zero-value
deal is rare enough that treating it as missing data is the safer default;
if an org disputes this, override per-org in `config`, not in the metric.
**Threshold:** `amount_fill_rate`.

### next_step_fill_rate
**Definition:** share of sampled open opportunities with a non-empty Next
Step text field.
**Edge case:** whitespace-only or single-character values ("-", ".") count
as unfilled. Use `str.trim().length > 1`.
**Threshold:** `next_step_fill_rate`.

### activity_capture_rate
**Definition:** share of sampled open opportunities with at least one
qualifying Activity (Task or Event) dated in the trailing 30 days, linked
either directly to the opportunity or to a Contact who has an opportunity
role on it.
**Qualifying activity:** has a real timestamp; is not a system-generated
task from a workflow rule; is not a mass-email send record; is not a
field-history entry.
**Denominator exclusion:** opportunities created inside the trailing 7-day
window are excluded — they haven't had time to accrue activity yet.
**Capability-matrix gate:** if the adapter's capability matrix reports no
activity-sync capability for this org, this metric returns `not_instrumented`
rather than a score. `rubric.ts`'s 0.80/0.50 thresholds assume auto-capture
(email/calendar sync) is on; report this assumption in the metric's output
alongside the number.
**Threshold:** `activity_capture_rate`.

### contact_linkage_rate
**Definition:** share of sampled open opportunities with at least one
associated Contact via an Opportunity Contact Role (not just an Account-level
contact).
**Threshold:** `contact_linkage_rate`.

### note_coverage_rate
**Definition:** share of sampled open opportunities with at least one Note
or logged call-note record, of any length.
**Distinction from `substantive_note_rate`:** this metric doesn't judge
content quality, only presence. A one-word note counts here.
**Threshold:** `note_coverage_rate`.

### owner_id_fill_rate
**Definition:** share of sampled open opportunities with a non-null,
non-empty Owner Id.
**Edge case:** an empty string or a whitespace-only value counts as
unfilled, same as a missing field — use `(ownerId?.trim().length ?? 0) > 0`,
not a bare non-null check.
**Not currently wired into any capability's gates** — report-only, unlike
the other D1 metrics.
**Threshold:** `owner_id_fill_rate`.

---

## D2. Freshness

### median_days_since_modified
**Definition:** median, across sampled open opportunities, of
`today - LastModifiedDate`, in whole days.
**Threshold:** `median_days_since_modified`.

### past_due_close_date_rate
**Definition:** share of sampled open opportunities where `CloseDate < today`.
**Edge case:** null Close Date is excluded from both numerator and
denominator here — that gap is `close_date_fill_rate`'s concern, not this
metric's. Don't double-penalize a missing field in two metrics.
**Threshold:** `past_due_close_date_rate`.

### median_next_step_age_days
**Definition:** median, across sampled open opportunities with a non-empty
Next Step, of `today - <date Next Step field was last modified>`.
**Data requirement:** needs a real field-level modification timestamp for
Next Step, not just the opportunity's overall `LastModifiedDate`. No
fallback: if the adapter can't report a per-field Next Step change date,
this metric returns `not_instrumented` rather than an approximate value
computed from `LastModifiedDate`.
**Status: deferred.** No adapter capability for this exists yet in v0.1.
Requires a `nextStepHistory` capability, field-history backed the same way
`stageHistory`/`ownerHistory` are, before this metric can return anything
but `not_instrumented`. Not implemented until that capability lands.
**Threshold:** `median_next_step_age_days`.

---

## D3. Consistency and hygiene

### stage_mapping_coverage
**Definition:** share of sampled opportunities (open and closed, matching
whatever the sample includes) whose vendor stage value maps to a stage in
the canonical ladder defined in the adapter contract.
**Resolved ambiguity (today):** denominator is *sampled opportunities*, not
*distinct picklist values*. A retired stage value that no sampled deal
currently uses does not count against coverage. This is what makes
`viableAt: 1.0` reachable rather than permanently blocked by legacy config.
**Threshold:** `stage_mapping_coverage`.

### duplicate_account_rate
**Definition:** share of sampled accounts that share a normalized email
domain with at least one other account in the sample, excluding domains on
a shared-provider denylist (gmail.com, outlook.com, yahoo.com, and similar
consumer/free-mail domains, which produce false positives).
**Normalization:** reduced to registrable domain (Public Suffix List, via
`tldts`), not just lowercase + strip-subdomains — needed for correctness on
multi-part TLDs (`sub.acme.co.uk` -> `acme.co.uk`, not `co.uk`). `tldts`
runs with `allowPrivateDomains: true`, so a PaaS tenant subdomain
(`herokuapp.com`, `github.io`, `vercel.app`) stays distinct per tenant
rather than collapsing every tenant on that host into one false-positive
duplicate group. Single shared implementation: `normalizeDomain` in
`src/metrics/shared.ts`; every domain-based metric must import it, not
re-derive normalization.
**Denominator:** sampled accounts (the distinct hydrated accounts backing
the sample's opportunities, one row per account — not one row per
opportunity) with a resolvable, non-denylisted normalized domain. Accounts
with no resolvable domain, or whose normalized domain is on the
shared-provider denylist, are excluded from the denominator.
**Resolved ambiguity (today):** a duplicate group's numerator counts every
member, not just members beyond the first — the definition above is
symmetric ("shares a domain with at least one other account"), so a
group's first-created account satisfies it too. The alternate ("beyond
first") count is derivable from the reported duplicate-group count without
a second metric; see docs/STATUS.md for that as a v0.2 open question.
**Gate:** requires `CoverageSample.accountsHydrated` to be true (a
build-order precondition, not an adapter capability) — returns
`not_instrumented` otherwise, same as an `AdapterCapabilities`-gated metric.
**Out of scope (v0.1):** cross-TLD dedupe (`acme.com` vs `acme.io` are
never linked); regional shared-provider variants (`yahoo.co.uk` etc.) are
not in the default denylist, addable per-org via config.
**Threshold:** `duplicate_account_rate`.

### stage_activity_contradiction_rate
**Definition:** share of sampled *open* opportunities in the top two stages
of the canonical ladder (as ordered in the adapter contract) with zero
qualifying activities (same definition as `activity_capture_rate`) in the
trailing 21 days.
**Resolved ambiguity (today):** "late-stage" = top two canonical stages,
not a percentage or count threshold. "Contradiction" window = 21 days, not
30, since a late-stage deal implies more frequent expected touchpoints than
an early-stage one.
**Threshold:** `stage_activity_contradiction_rate`.

### round_amount_rate
**Definition:** share of sampled open opportunities with a non-null Amount
that is evenly divisible by 1,000 (e.g. 50000, 25000 — not 24999 or 50500).
**Edge case:** Amount = 0 is excluded (already counted as unfilled in
`amount_fill_rate`; don't double count).
**Threshold:** `round_amount_rate`.

---

## D4. History depth

### close_date_history_enabled
**Definition:** boolean, reported by the adapter's capability matrix — is
field-history tracking active on the Close Date field for this org.
**Not sampled from records** — this is a capability check, not a
per-opportunity computation. If the adapter can't answer the capability
question directly, treat as `false` (assume not enabled) rather than
attempting to infer it from whether any history records happen to exist.
**Status: deferred.** No adapter capability for this exists yet in v0.1.
`AdapterCapabilities.stageHistory`/`ownerHistory` don't cover it, and
`StageHistoryEntry.closeDateAtChange` is a snapshot of the close date *at
a stage change*, not field-history on the Close Date field itself — using
it as a stand-in would be exactly the "infer from whether history records
happen to exist" this entry's own rule above forbids. Requires a new
`AdapterCapabilities` field (shape TBD), field-history backed the same way
`stageHistory`/`ownerHistory` are, before this metric can return anything
but `not_instrumented`. Not implemented until that capability lands — same
deferral shape as `median_next_step_age_days` (D2).
**Threshold:** `close_date_history_enabled`.

### stage_history_months
**Definition:** number of full calendar months between the org's earliest
retained Stage-field history entry, **org-wide**, and the sample's `asOf`
time.
**Resolved ambiguity (today):** this is org-wide, not scoped to the
sample's opportunities — a prior version of this sentence read "the org's
earliest... entry (across any opportunity in the sample)", which
contradicted itself (org-wide vs. sample-scoped). Org-wide was chosen
because it's answerable in one bounded, ascending-sorted
`listStageHistory` page (`limit: 1`, no `since`) — the first item of the
first page is definitionally the earliest entry in the whole org. A
sample-scoped version would need either a new by-ref batched history
method (mirroring `getAccounts`) or an unbounded scan, which the scope
doc's "never full-scan a production org" rule forbids.
**Whole calendar months:** partial months are dropped, not rounded — e.g.
Jan 15 -> Jun 20 is 5 months; Jan 15 -> Jun 10 is 4 (the Jan-15 boundary
hasn't been reached again in June yet). See `wholeCalendarMonthsBetween`
(`src/metrics/shared.ts`) for the exact rule, including its month-end and
leap-year behavior.
**Capability on, zero entries retained** (e.g. a freshly-enabled org):
`value: 0`, `note: "history enabled, no entries yet"` — distinct from the
capability being off.
**Threshold:** `stage_history_months`.

### owner_history_enabled
**Definition:** boolean, same capability-matrix pattern as
`close_date_history_enabled`, checked against the Owner field.
**Threshold:** `owner_history_enabled`.

---

## D5. Cross-system joinability

*Applies only when a second source (engagement tool, billing/product system)
is connected. If only the CRM adapter is configured, these four metrics
return `not_instrumented` — the same capability-matrix gate-off convention
established in D1–D4 (see `activity_capture_rate`'s "Capability-matrix
gate"), not `not_applicable`. Every capability gated on a D5 metric is
reported Blocked with remediation "connect a second source to enable this
capability" when that metric is `not_instrumented`.*

### contact_identity_resolution_rate
**Definition:** share of sampled CRM contacts that match a contact in the
second source by normalized email address.
**Hash keys:** each email is trimmed and lowercased, then hashed with
SHA-256 salted with a random value generated once per D5 run. The salt and
every hashed key live in memory only for the duration of that run and are
discarded when it completes — never persisted, never logged (raw emails
from the second source are never materialized in this tool — see
`claude/gtm-readiness-scope.md:96` and `:260`).
**Matching count:** a CRM contact counts as resolved if its hashed email
matches at least one second-source contact — no dedup beyond that. If
several second-source records share a hashed email (e.g. duplicate
records in the second source), the CRM contact still counts once; the
metric doesn't penalize or double-count for second-source-side
duplication. Confirmed with the user (D5 part 2a) — not derived
unilaterally.
**Threshold:** `contact_identity_resolution_rate`.

### account_resolution_rate
**Definition:** share of sampled CRM accounts that match an account/customer
in the second source by normalized website domain, using the same
`normalizeDomain` (`src/metrics/shared.ts`, established in D3 for
`duplicate_account_rate`) on both sides of the match — not a separate
normalization recipe.
**Matching count:** same rule as `contact_identity_resolution_rate` — a
CRM account counts as resolved if its normalized domain matches at least
one second-source account, no dedup beyond that.
**Threshold:** `account_resolution_rate`.

### activity_attribution_rate
**Definition:** share of sampled engagement-tool activities (calls, emails,
meetings) that can be matched to a specific CRM opportunity, via the contact
and account resolution above plus a time window: the activity must be dated
between the opportunity's `createdAt` and its `closeDate` if the opportunity
is closed, or between `createdAt` and `asOf` if it's still open.
**Resolution reuse:** the contact/account match results are computed once
per run and held in memory, shared with `contact_identity_resolution_rate`/
`account_resolution_rate` rather than recomputed for this metric — never
persisted, never merged into a combined record (same in-memory-only,
discard-at-end-of-run rule as the hash keys above).
**Multi-candidate rule, locked (D5 part 2b):** an activity's matched
contact/account can be linked to more than one sampled CRM opportunity
(e.g. an account with several open deals). The activity attributes if
*at least one* candidate opportunity's window contains it — same "at
least one, no dedup" style as the resolution matching above, not "exactly
one" or "the most recent one."
**Gating, locked (D5 part 2b):** gates on `hasActivities`, AND on
(`hasContacts` OR `hasAccounts`) — if the second source has neither
contact nor account data, there is nothing to attribute through at all,
so this is `not_instrumented` (note: "no contact or account data in
second source to attribute through"), not a rate degraded toward zero. A
low rate must never stand in for a missing capability.
**Threshold:** `activity_attribution_rate`.

### temporal_anomaly_rate
**Definition:** share of sampled records, across both sources, exhibiting
any of: `CreatedDate > LastModifiedDate`; an Activity dated after its
opportunity's Close Date; any timestamp more than 24 hours in the future
relative to the sampling run time.
**Denominator:** the sum of both sources' sampled records — CRM records and
second-source records counted together, with no CRM-only carve-out. A
record from either source can independently trip the numerator.
**Scope, locked (D5 part 2b):** "sampled records" means CRM Opportunities
+ CRM Activities + second-source Activities — CRM and second-source
Contacts/Accounts are excluded from both the denominator and every check.
Second-source Contacts/Accounts have no `createdAt` at all (only
`modifiedAt`), so the created-after-modified check couldn't apply to them
regardless of scope; the close-date check is activity-specific by
definition. Per record type:
- CRM Opportunity: created-after-modified (`createdAt`/`modifiedAt`) and
  future-dated (`createdAt`/`modifiedAt`) apply. `closeDate` is
  deliberately excluded from the future-dated check — a forecasted future
  close date on an open deal is expected, not an anomaly. The close-date
  check doesn't apply to an Opportunity itself (it's about an *Activity*
  dated after its opportunity's close date).
- CRM Activity: no `createdAt`/`modifiedAt` field exists on this type, so
  created-after-modified never applies. Close-date and future-dated
  (`occurredAt`) both apply, using the CRM opportunity(ies) it's already
  linked to via `relatedTo`.
- Second-source Activity: all three checks apply — created-after-modified
  (`createdAt`/`lastModifiedAt`), close-date (via the contact/account
  resolution above — same "at least one candidate opportunity" rule as
  `activity_attribution_rate`), and future-dated (`occurredAt`,
  `createdAt`, and `lastModifiedAt`, all checked).
**Resolved ambiguity (today):** this replaced a boolean
(`temporal_alignment_ok`) because a handful of anomalous rows shouldn't
block the whole capability — only a high *rate* of them should. See
`rubric.ts` for the reasoning behind the boolean-to-rate change.
**Threshold:** `temporal_anomaly_rate`.

---

## D6. Text substrate

### substantive_note_rate
**Definition:** share of sampled Notes — drawn from **both open and closed**
sampled opportunities — that are NOT on the filler denylist and have length
≥ 40 characters after trimming.
**Resolved ambiguity — population (today):** deliberately wider than
`note_coverage_rate`'s denominator, which is open-only (D1). This metric
gates `enablement_answer_engine` (`rubric.ts`), whose job is answering from
closed-won/lost history — scoping it to open opportunities only would
measure the wrong text population for the capability that actually needs
it. Reads `CoverageSample.notesByOpportunity` over
`openOpportunities` + `closedOpportunities` combined; that map is already
hydrated for both (`hydrateNotes` fetches notes for every sampled
opportunity regardless of stage), so no new hydration is needed.
**Filler denylist (case-insensitive, exact match after trim):** "n/a",
"na", "-", "none", "called", "left vm", "left voicemail", "no answer",
"followed up", "touch base", "checking in".
**Threshold:** `substantive_note_rate`.

### median_note_length_chars
**Definition:** median character length, after trimming, of sampled Notes
— computed over the same set as `substantive_note_rate`'s denominator: all
sampled notes from open + closed opportunities, not just the substantive
ones.
**Threshold:** `median_note_length_chars`.

### pii_density
**Definition:** share of sampled free-text **records** — Notes (`body`),
Activities (`subject` and/or `body`), and Opportunities (`nextStep`), drawn
from both open and closed sampled opportunities, same population as
`substantive_note_rate` — containing at least one regex-detected PII
pattern: email address, phone number, SSN-like 9-digit pattern, or
credit-card-like 13-19 digit pattern **validated by a Luhn checksum** (cuts
false positives on arbitrary long digit runs — a bare digit-count match is
not sufficient).
**Resolved ambiguity — unit of measure (today):** counted **per record, not
per field**. A record counts once toward the numerator if *any* of its
free-text fields matches a pattern — an Activity matching on both `subject`
and `body` still counts once. The denominator is every sampled record that
has at least one non-empty candidate field: an Activity with neither
`subject` nor `body` set, or an Opportunity with no `nextStep`, is excluded
from the denominator entirely, not counted as a non-match.
**Resolved ambiguity (today):** this is a *flag*, not a *gate* — see
`rubric.ts`. It's computed and reported the same way regardless; the only
change is that no capability's verdict depends on it. PII density varies
legitimately by industry (healthcare, fintech) and shouldn't penalize
readiness.
**Output constraint:** the result must report **counts only** (matching
record count and denominator) and must never surface a matched substring or
the offending field's raw value, in `note` or anywhere else in
`MetricResult`. The existing "no raw PII in ReportData/--json" test
(`test/report/buildReport.test.ts`, added for D5) must be extended to also
cover `pii_density`'s output once implemented.
**Threshold:** `pii_density` (flag).

### untrusted_text_ratio
**Definition:** share of sampled Note bodies and Activity `subject`/`body`
fields — drawn from both open and closed sampled opportunities — tagged
`TrustTier.ExternallySourced` (`model/trust.ts`) rather than
`UserAuthored`/`OrgConfig`/`System`. Does **not** include
`Opportunity.nextStep` (a rep-typed field; contrast with `pii_density`,
which does include it) — there is no meaningful "externally sourced next
step."
**Resolved ambiguity (today):** always computable — no capability gate, no
`not_instrumented` path. Every `TrustedText` value carries a `tier`,
assigned once at ingestion (`model/trust.ts`: "the ingestion boundary is the
only place a tier is assigned"); there is no canonical state where a
hydrated free-text field lacks one. The previous framing here ("relies on
the adapter reporting a source/origin field... if it can't distinguish
origin, `not_instrumented`") described a gate that cannot occur in this
model and has been removed.
**Caveat, stated in the metric's output, not just this doc:** this reports
what the adapter's ingestion-time tier assignment says, not independently
verified ground truth. `inferTier`'s own contract is deliberately
conservative ("when in doubt, treat as externally sourced") — an adapter
that can't actually distinguish origin over-tags as `ExternallySourced`
under that rule, which inflates this ratio, never silently deflates it.
**Threshold:** `untrusted_text_ratio`.

---

## D7. Label availability

### closed_deal_count_12m
**Definition:** count of sampled closed opportunities (`closedOpportunities`)
with `isClosed = true` and `closeDate` within the trailing 12 months,
**computed org-wide** in v0.1.
**Resolved ambiguity — "org-wide" (today):** read against this entry's own
"per-segment" limitation below, "org-wide" means *not sliced by segment*,
not "requires an unbounded, full-org count." The value is
`closedOpportunities.length` after the `isClosed`/`closeDate` filter.
**Resolved ambiguity — trust the sample's window (today):** `sample.ts`'s
`closed_won`/`closed_lost` strata are already windowed to
`CLOSED_WINDOW_MONTHS` (12) of the sample's `asOf` at sampling time. This
metric trusts that window rather than re-deriving "within 12 months of
`config.asOf`" independently against each opportunity's `closeDate` — a
`sample.ts`-level regression test must assert `closedOpportunities` never
contains an entry outside that window, so this metric can rely on it
without re-checking.
**Resolved ambiguity — sample-cap floor (today):** `closedOpportunities` is
a stratified **reservoir sample**, bounded per stratum by
`perStratumSampleSize` (caller-chosen per run, not derived from the org).
Once either the `closed_won` or `closed_lost` stratum's reservoir fills
(`StratumSampleResult.underfilled === false`), `closedOpportunities.length`
for that stratum stops reflecting the org's true closed-deal volume — it
saturates at the run's configured sample size instead. This metric's result
MUST set `floor: true` whenever **either** closed stratum reports
`underfilled: false`, reusing `MetricResult.floor` (same field the
notes/activities truncation signal uses — a different underlying cause,
same "this is a lower bound, not exact" contract). `CoverageSample` must
carry both closed strata's `underfilled` flags forward from `SampleResult` —
`buildCoverageSample` currently discards them when flattening into
`closedOpportunities`; two new `CoverageSample` fields are needed (e.g.
`closedWonUnderfilled`/`closedLostUnderfilled`, or equivalent).
**Known limitation, documented not fixed (today):** this should ideally be
a per-segment floor (segment = deal-size band by default), so an enterprise
org with 80 large deals across two segments isn't penalized the same way as
one with 80 small deals in a single segment. Segment-aware computation is
deferred to v0.2 pending real-org calibration; `rubric.ts`'s 60/25
thresholds are set low specifically to avoid over-penalizing focused/
enterprise motions in the meantime. Note this limitation in the report
footer, same disclosure pattern as `RUBRIC_VERSION`.
**Threshold:** `closed_deal_count_12m`.

### win_rate_dispersion — BLOCKED, see "Deferred" in `STATUS.md`
**Definition:** standard deviation of win rate (won / (won + lost)) computed
per canonical stage the deal passed through, across sampled closed
opportunities from the trailing 12 months.
**Resolved ambiguity (today):** this measures variance **across pipeline
stages**, not across business segments. A low value means win rate barely
differs by stage — i.e., stage isn't predictive of outcome, which usually
means stage definitions aren't being applied consistently. This is
unaffected by segment mix and is correctly kept as a gate on
`forecast_assistance` (see `rubric.ts` rationale — do not reinterpret this
as a segment metric in implementation).
**Blocked (today):** "stage the deal passed through" cannot be read off
`Opportunity.stage` for a closed deal — that field is only ever
`closed_won`/`closed_lost` and retains no record of intermediate pipeline
stages. The only source for that is `StageHistoryEntry.toStage`, keyed by
`opportunityRef` (D4). No adapter method exists to fetch stage-history
records by opportunity ref — `CrmAdapter.listStageHistory` is a
since-window/cursor stream with no ref filter, the same gap
`getAccounts`/`getContactsByRef`/`getNotesByOpportunity` each closed for
their own record type — and D4's existing `hydrateStageHistory` glue only
fetches one org-wide earliest entry (`stage_history_months`'s need), nowhere
near a per-opportunity transition sequence for every sampled closed deal.
Implementing this needs a new `getStageHistoryByOpportunity(oppRefs)`
adapter method: a cross-package, multi-file change requiring a plan and
sign-off first, same as any other adapter-contract addition. See
`STATUS.md`'s "Deferred" section — bundled with `median_next_step_age_days`
and `close_date_history_enabled` as one adapter-contract change.
**Threshold:** `win_rate_dispersion`.

### outcome_evidence_retention_rate
**Definition:** share of sampled closed opportunities (won or lost, trailing
12 months) that still have at least one Note or Activity record retrievable
— i.e., not purged by a data-retention policy after closing.
**Resolved ambiguity — truncation floor (today):** reads the same
`notesByOpportunity`/`activitiesByOpportunity` maps as `note_coverage_rate`/
`activity_capture_rate` and gets the same `applyTruncationFloor` treatment
for consistency, even though truncation can't change a presence check's
answer — same rationale already established for those two metrics: a
general data-completeness signal, not a correction to a wrong number.
**Resolved ambiguity — window (today):** same as `closed_deal_count_12m` —
trusts `closedOpportunities`' existing trailing-12-month window from
`sample.ts`, no independent re-derivation against `closeDate`/`config.asOf`.
**Threshold:** `outcome_evidence_retention_rate`.

---

## Cross-cutting notes for every Phase C session

- Every metric function is pure: `(sample, config) => MetricResult`.
- Every `MetricResult` reports `sampleSize` alongside `value`. A metric with
  a sample size under 30 should set `lowConfidence: true` in its result;
  the report layer decides how to display that, the metric doesn't decide
  thresholds.
- A metric returning `not_applicable` or `not_instrumented` is not the same
  as a `blocked` verdict — `gradeCapability` in `rubric.ts` already treats
  an absent reading as blocked, so a metric should only return one of these
  statuses when it genuinely cannot compute a number, not as a way to signal
  a bad result.
- A metric with `rubric.ts`'s `unit: 'bool'` reports `MetricResult.value`
  as `1` (true) or `0` (false), never a JS boolean — `value`'s type is
  `number | null`. Established by `owner_history_enabled` (D4), the first
  `unit: 'bool'` metric implemented.

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
**Normalization:** lowercase, strip subdomains.
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
**Threshold:** `close_date_history_enabled`.

### stage_history_months
**Definition:** number of full calendar months between the org's earliest
retained Stage-field history entry (across any opportunity in the sample)
and today.
**Threshold:** `stage_history_months`.

### owner_history_enabled
**Definition:** boolean, same capability-matrix pattern as
`close_date_history_enabled`, checked against the Owner field.
**Threshold:** `owner_history_enabled`.

---

## D5. Cross-system joinability

*Applies only when a second source (engagement tool, billing/product system)
is connected. If only the CRM adapter is configured, these five metrics
report `not_applicable`, and every capability gated on them is reported
Blocked with remediation "connect a second source to enable this
capability" rather than silently passing.*

### contact_identity_resolution_rate
**Definition:** share of sampled CRM contacts that match a contact in the
second source by normalized, lowercased email address, using SHA-256 hashed
keys for the match (raw emails from the second source are never materialized
in this tool — see `CLAUDE.md` rule 2).
**Threshold:** `contact_identity_resolution_rate`.

### account_resolution_rate
**Definition:** share of sampled CRM accounts that match an account/customer
in the second source by normalized website domain (strip protocol, `www.`,
and trailing slash; lowercase).
**Threshold:** `account_resolution_rate`.

### activity_attribution_rate
**Definition:** share of sampled engagement-tool activities (calls, emails,
meetings) that can be matched to a specific CRM opportunity, via the contact
and account resolution above plus a time-window heuristic (activity dated
within the opportunity's open window).
**Threshold:** `activity_attribution_rate`.

### temporal_anomaly_rate
**Definition:** share of sampled records, across both sources, exhibiting
any of: `CreatedDate > LastModifiedDate`; an Activity dated after its
opportunity's Close Date; any timestamp more than 24 hours in the future
relative to the sampling run time.
**Resolved ambiguity (today):** this replaced a boolean
(`temporal_alignment_ok`) because a handful of anomalous rows shouldn't
block the whole capability — only a high *rate* of them should. See
`rubric.ts` for the reasoning behind the boolean-to-rate change.
**Threshold:** `temporal_anomaly_rate`.

---

## D6. Text substrate

### substantive_note_rate
**Definition:** share of sampled Notes (drawn from opportunities passing
`note_coverage_rate`) that are NOT on the filler denylist and have length
≥ 40 characters after trimming.
**Filler denylist (case-insensitive, exact match after trim):** "n/a",
"na", "-", "none", "called", "left vm", "left voicemail", "no answer",
"followed up", "touch base", "checking in".
**Threshold:** `substantive_note_rate`.

### median_note_length_chars
**Definition:** median character length, after trimming, of sampled Notes
— computed over the same set as `substantive_note_rate`'s denominator (all
sampled notes, not just the substantive ones).
**Threshold:** `median_note_length_chars`.

### pii_density
**Definition:** share of sampled Notes and free-text fields containing at
least one regex-detected PII pattern (email address, phone number, SSN-like
9-digit pattern, credit-card-like 13-19 digit pattern).
**Resolved ambiguity (today):** this is a *flag*, not a *gate* — see
`rubric.ts`. It's computed and reported the same way regardless; the only
change is that no capability's verdict depends on it. PII density varies
legitimately by industry (healthcare, fintech) and shouldn't penalize
readiness.
**Threshold:** `pii_density` (flag).

### untrusted_text_ratio
**Definition:** share of sampled Notes/activity descriptions whose content
originates outside the org — specifically, text auto-logged from an inbound
email body (not a manually-typed note, even if the note references an
email).
**Detection:** relies on the adapter reporting a source/origin field on the
activity record (e.g. Salesforce Task's `TaskSubtype` or an email-to-case
flag). If the adapter can't distinguish origin, this metric returns
`not_instrumented`.
**Threshold:** `untrusted_text_ratio`.

---

## D7. Label availability

### closed_deal_count_12m
**Definition:** count of sampled opportunities with `IsClosed = true` and
`CloseDate` within the trailing 12 months, **computed org-wide** in v0.1.
**Known limitation, documented not fixed (today):** this should ideally be
a per-segment floor (segment = deal-size band by default), so an enterprise
org with 80 large deals across two segments isn't penalized the same way as
one with 80 small deals in a single segment. Segment-aware computation is
deferred to v0.2 pending real-org calibration; `rubric.ts`'s 60/25
thresholds are set low specifically to avoid over-penalizing focused/
enterprise motions in the meantime. Note this limitation in the report
footer, same disclosure pattern as `RUBRIC_VERSION`.
**Threshold:** `closed_deal_count_12m`.

### win_rate_dispersion
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
**Threshold:** `win_rate_dispersion`.

### outcome_evidence_retention_rate
**Definition:** share of sampled closed opportunities (won or lost, trailing
12 months) that still have at least one Note or Activity record retrievable
— i.e., not purged by a data-retention policy after closing.
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

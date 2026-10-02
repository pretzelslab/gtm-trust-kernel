# Metric definitions — gtm-readiness v0.1.0

Feeds Phase C (`packages/readiness/src/metrics/*.ts`). Each entry is what a
build step takes as input, per the one-metric-per-step prompt template in the
internal build runbook (not published).
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
**Salesforce sources (2026-09-30):** `Task` and `Event` (meetings) with
`WhatId` = the opportunity, merged per opportunity under the same
`activitiesPerOpportunityLimit`. Activities logged only against a contact
with a role on the opportunity are not yet read (deferred; see README
Known gaps).
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
**Salesforce (decided 2026-09-30):** the capability is **declared by the
user**, not detected: `SF_ACTIVITY_CAPTURE=auto` turns it on; `manual` or
unset leaves it off, so the metric is `not_instrumented` and its gated
capabilities read **Not measured** (with the hint "Set
SF_ACTIVITY_CAPTURE=auto if your team logs activity automatically.").
There is no reliable SOQL check: Einstein Activity Capture, for one, does
not by default store captured email and events as Task/Event records.
**Unverified** against a live org with activity capture on (a Developer
Edition org doesn't have it).
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
**Salesforce sources (2026-09-30):** legacy `Note` records plus Enhanced
Notes (`ContentNote`, linked to the opportunity through
`ContentDocumentLink`), merged per opportunity under the same
`notesPerOpportunityLimit`. The same merged notes feed every D6 metric and
`outcome_evidence_retention_rate`.
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
computed from `LastModifiedDate`. Gated on `AdapterCapabilities.nextStepHistory`.
**Per-opportunity exclusion (locked 2026-09-26):** a sampled open opportunity
with a non-empty Next Step but zero `NextStepChange` entries (capability
just turned on, or retained history doesn't reach back far enough) is
**excluded from the denominator** — same "filtered sample size" convention
`activity_capture_rate` already uses. Not treated as age 0, and never
falls back to the opportunity's whole-record `modifiedAt`. The excluded
count is reported in `note`.
**Low-confidence trigger (locked 2026-09-26):** `lowConfidence` is set true
when sample size is below `LOW_CONFIDENCE_SAMPLE_SIZE` (the existing
cross-cutting rule) **or** when more than 50% of eligible opportunities
(non-empty Next Step) were excluded per the rule above — whichever fired.
`note` must name which cause fired (e.g. "62% of opportunities excluded: no
Next Step change history") so the two cases are distinguishable. **This is
a low-confidence flag only — it does not force a `degraded` verdict.** The
computed tier (viable/degraded/blocked) is still graded by `rubric.ts`'s
`gradeGate()` from the real value against threshold, exactly like every
other metric; there is no mechanism for a metric to force a tier directly,
and this metric gates zero capabilities today regardless (see rubric.ts's
`CAPABILITIES` — confirmed by exhaustive grep, 2026-09-26). If a future
capability ever gates on this metric, revisit whether the exclusion rate
should influence grading more directly — not resolved now.
**Data source:** `NextStepChange { ref, opportunityRef, changedAt }` — a new
canonical/adapter-contract type, deliberately carrying no text value (only
a timestamp), same "structurally incapable of leaking content" shape as
`StageHistoryEntry`. Fetched via `CrmAdapter.getNextStepHistoryByOpportunity(oppRefs)`,
same shape/batching as `getNotesByOpportunity`.
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
**Custom stages (Salesforce, 2026-09-30):** an org maps its own stage
labels with a JSON stage map (`SF_STAGE_MAP_PATH`), merged over the default
Sales Process map. A mapping that contradicts Salesforce's own
IsClosed/IsWon flags counts as unmapped (the flags decide the stage), so a
map error shows up here rather than silently. Stage labels never appear in
the report. When the sample holds an unmapped stage (an opportunity here,
or a closed deal's stage-history row for `win_rate_dispersion`), the report
shows one notice with the adapter's stage-map hint (`stageMapHint`, static
text naming the setting); with no unmapped stage it shows nothing.
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
a second metric; see docs/dev-log.md for that as a v0.2 open question.
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
**Denominator exclusion (2026-10-01):** opportunities created in the last
7 days are excluded, the same rule and constant as `activity_capture_rate`
(`NEW_OPPORTUNITY_EXCLUSION_DAYS`). A deal created straight into proposal
or negotiation hasn't had time to accrue activity, so flagging it would
count its age, not a contradiction. The live smoke run found exactly
that: a deal created the same day was flagged. If every late-stage deal
is excluded, the result is not applicable (no value), never 0 or 1.
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
**Definition:** boolean, reported by the adapter's capability matrix — can
this CRM retain a change history for the Close Date field, sufficient to
detect slip.
**Not sampled from records** — this is a capability check, not a
per-opportunity computation. If the adapter can't answer the capability
question directly, treat as `false` (assume not enabled) rather than
attempting to infer it from whether any history records happen to exist.
`StageHistoryEntry.closeDateAtChange` remains explicitly disallowed as a
stand-in — a snapshot of the close date *at a stage change* is not the
same as field-history on Close Date itself, and inferring this capability
from whether such snapshots happen to exist would be exactly the "infer
from whether history records happen to exist" this entry's rule forbids.
**Adapter contract:** `AdapterCapabilities.closeDateHistory: boolean`.
**Salesforce-specific finding, locked 2026-09-26 (verified against docs and
a live read-only query, not assumed):** Salesforce's standard
`OpportunityHistory` object — the same object `stageHistory`/
`getStageHistoryByOpportunity` already read — snapshots **Stage, Amount,
Probability, and Close Date** on every change to any of those four fields,
individually. This is **not** gated by the admin-toggle Field History
Tracking feature (`OpportunityFieldHistory`, a different object) — it is
always queryable, the same unconditional guarantee `stageHistory: true`
already rests on. Confirmed live: every multi-row opportunity in a real
dev-org query showed a same-Stage, different-CloseDate consecutive pair,
and the object's own `describe()` exposes `PrevCloseDate`/`PrevAmount` as
standard fields. `SalesforceAdapter.capabilities().closeDateHistory` is
therefore declared **statically `true`**, not the static `false` that
would apply to a genuinely admin-gated capability (contrast
`nextStepHistory`, which stays `false` — `OpportunityHistory` has no
`NextStep` field at all, confirmed via the same `describe()` call, so Next
Step genuinely has no always-on tracking path). Do not generalize this
finding to other adapters without checking each one's own equivalent
object — HubSpot/other CRMs may or may not have a comparable always-on
mechanism.
**Signal strength:** on Salesforce specifically, this metric is
near-universally `true` (it rests on an unconditional platform guarantee,
not an admin toggle an org could have left off), so a `viable` verdict here
carries little diagnostic weight for a Salesforce org — a `blocked`/`degraded`
result is the informative case, flagging an adapter that isn't Salesforce
or a genuine capability gap.
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

*Blocked vs Not measured here (decided 2026-09-30): with **no second
source connected**, the cross-system data is missing, so each gated
capability is **Blocked** (the metric row still shows `not_instrumented`).
**Not measured** applies only when a second source **is** connected but
can't supply the data type a metric needs (e.g. `hasActivities: false`).
`buildReport.ts` records this per row as `MetricRow.notMeasured`.*

### contact_identity_resolution_rate
**Definition:** share of sampled CRM contacts that match a contact in the
second source by normalized email address.
**Hash keys:** each email is trimmed and lowercased, then hashed with
SHA-256 salted with a random value generated once per D5 run. The salt and
every hashed key live in memory only for the duration of that run and are
discarded when it completes — never persisted, never logged (raw emails
from the second source are never materialized in this tool, per
the internal scope notes (not published)).
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
**Floor (2026-09-30):** a note whose body is only a preview
(`Note.bodyTruncated`) is at least as long as shown, so when any sampled
note is one, the value is reported as a floor. On Salesforce this happens
to an Enhanced Note whose `TextPreview` hits the preview cap after the
run's full-text fetch budget (`SF_NOTE_FULLTEXT_FETCH_LIMIT`, default 200)
is spent. Other D6 metrics read the same preview text; a preview at the cap
is well past the 40-character substantive bar, but `pii_density` could
miss a pattern that sits past the preview.
**Threshold:** `median_note_length_chars`.

### pii_density
**Definition:** share of sampled free-text **records** containing at least
one regex-detected PII pattern. **Pooled denominator, not three separate
rates:** Notes (`body`), Activities (`subject` and/or `body`), and
Opportunities (`nextStep`) — three structurally different record types,
drawn from both open and closed sampled opportunities (same population as
`substantive_note_rate`) — are counted into one flat numerator/denominator
pair, not reported as three per-type rates and not weighted by type. A
mixed-type denominator is a deliberate choice here (unlike every other v0.1
metric, which reads one record type): this is a coarse, top-of-report flag,
not a gate, and the report has no per-record-type breakdown for it in v0.1.
**Patterns, locked (today):**
- Email: standard email-address shape.
- Phone: **must have an internal separator (space, dash, dot, or
  parentheses) or a leading `+` international prefix.** A bare, unbroken
  run of digits (e.g. 10 digits with no separators) does NOT match as
  phone-like — that shape is reserved for the SSN-like and card-like
  patterns below, so one digit run is never claimed by two patterns.
- SSN-like: **hyphenated only**, exactly `###-##-####`. A bare 9-digit run
  with no hyphens does NOT match — that was the single biggest source of
  false positives (internal IDs, truncated phone numbers, etc.) and is
  deliberately excluded, at the cost of missing an SSN typed without
  hyphens.
- Card-like: 13-19 contiguous digits **validated by a Luhn checksum** — a
  bare digit-count match is not sufficient; this is what lets a normal
  dollar amount or a long internal ID coexist in the same corpus without
  tripping the pattern.
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
**Test coverage must include negative cases**, not just positive matches —
at minimum: an internal-ID-shaped string (digits only, no separators, so it
trips neither the tightened SSN pattern nor the phone pattern) and a plain
dollar-amount-shaped string (e.g. "$45,000" or "45000.00" — must not
Luhn-validate as card-like, and must not match phone/SSN either). These
prove the tightened patterns actually exclude the false positives they were
tightened for, not just that they still catch the positive cases.
**Output constraint:** the result must report **counts only** (matching
record count and denominator) and must never surface a matched substring or
the offending field's raw value, in `note` or anywhere else in
`MetricResult`. The existing "no raw PII in ReportData/--json" test
(`test/report/buildReport.test.ts`, added for D5) must be extended to also
cover `pii_density`'s output.
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
**Definition:** the number of closed opportunities (won or lost) with a
close date in the trailing 12 months, **computed org-wide** in v0.1.
**Source (decided 2026-09-30):** the adapter's own population count
(`countOpportunitiesForSample`'s `closedInWindow`; a `SELECT COUNT()` on
Salesforce), taken before the scan, carried as
`CoverageSample.closedInWindowCount`. Not the scanned or sampled rows, so
it stays exact when the 5,000-deal scan budget is hit, and `floor` is
always false. The adapter contract checks the count matches the full
listing however little of it a scan reads. Not applicable when a sample
carries no count.
**Resolved ambiguity — "org-wide" (today):** read against this entry's own
"per-segment" limitation below, "org-wide" means *not sliced by segment*.
**Superseded (2026-09-30):** the value used to be the sampled
`closedOpportunities.length`, with `floor: true` once a closed stratum's
reservoir filled, so it could never exceed 2 x the per-stratum sample size.
**Thresholds are provisional (calibrate in Phase 4):** `rubric.ts`'s 40/20
were set against that 40-deal ceiling and are kept, unchanged, as real
counts until Phase 4 calibration.
**Known limitation, documented not fixed (today):** this should ideally be
a per-segment floor (segment = deal-size band by default), so an enterprise
org with 80 large deals across two segments isn't penalized the same way as
one with 80 small deals in a single segment. Segment-aware computation is
deferred to v0.2 pending real-org calibration; `rubric.ts`'s 40/20
thresholds are set low specifically to avoid over-penalizing focused/
enterprise motions in the meantime. Note this limitation in the report
footer, same disclosure pattern as `RUBRIC_VERSION`.
**Threshold:** `closed_deal_count_12m`.

### win_rate_dispersion
**Definition:** standard deviation of win rate (won / (won + lost)) computed
per canonical stage the deal passed through, across sampled closed
opportunities from the trailing 12 months.
**Intermediate stages only, found while implementing (2026-09-26):**
"stage the deal passed through" means `CANONICAL_STAGE_ORDER` (prospecting
through negotiation) — never `closed_won`/`closed_lost` themselves. Including
the closing stage would be circular (every closed_won deal trivially shows
a 100% win rate for the "closed_won" bucket), not a measure of whether
pipeline stage predicts outcome. A real adapter's stage-history object may
include a snapshot row for the closing transition itself (Salesforce's
`OpportunityHistory` does) — that row is filtered out by the metric, not
assumed absent from adapter data.
**Resolved ambiguity (today):** this measures variance **across pipeline
stages**, not across business segments. A low value means win rate barely
differs by stage — i.e., stage isn't predictive of outcome, which usually
means stage definitions aren't being applied consistently. This is
unaffected by segment mix and is correctly kept as a gate on
`forecast_assistance` (see `rubric.ts` rationale — do not reinterpret this
as a segment metric in implementation).
**Unmapped history (2026-09-30):** a stage-history entry whose vendor stage
has no canonical mapping (`StageHistoryEntry.toStageConfidence:
'unmapped'`) carries only a placeholder `toStage`, so it is skipped, and
the number skipped goes in `note`. An opportunity with only unmapped
entries is not eligible.
**Data source:** `StageHistoryEntry.toStage`, keyed by `opportunityRef`,
fetched via `CrmAdapter.getStageHistoryByOpportunity(oppRefs)` (new,
same shape as `getNotesByOpportunity` — a closed deal's `Opportunity.stage`
alone is only ever `closed_won`/`closed_lost`, never the intermediate
pipeline stages this metric needs).
**Sample size (locked 2026-09-26):** count of sampled closed opportunities
with at least one resolvable stage-history entry from
`getStageHistoryByOpportunity` — same "filtered subset" convention as
every other metric whose real denominator isn't the raw sample.
**Per-stage exclusion and `not_applicable` boundary (locked 2026-09-26):**
a canonical stage with fewer than 5 closed opportunities passing through it
is excluded from the dispersion calculation entirely — too few deals for a
per-stage win rate to mean anything. If fewer than 2 stages remain after
that exclusion, the result is `not_applicable` (dispersion across fewer
than 2 stages is undefined, not zero). The excluded-stage **count** (not
which stages) is reported in `note` — same "note carries the excluded
count" pattern `round_amount_rate`/`stage_mapping_coverage` already use.
**Fixture requirement, found while locking this (2026-09-26):** every
existing mock fixture (`healthy`/`fresh`/`legacy`/`volume`) seeds exactly
**one** `StageHistoryEntry` per opportunity — its stage at creation, not a
real multi-hop transition sequence. For a closed deal, that one entry's
`toStage` is just `closed_won`/`closed_lost` itself, giving this metric no
real intermediate-stage signal in any fixture today. The commit
implementing this metric must add genuine multi-hop stage histories to
`generateHealthy()` (a deal's real path through the canonical ladder before
closing), plus at least one deliberate single-entry "degenerate" case
(mirroring today's default) so the exclusion/`not_applicable` paths are
exercised too, not just the happy path.
**Threshold:** `win_rate_dispersion`.

### outcome_evidence_retention_rate
**Definition:** share of sampled closed opportunities (won or lost, trailing
12 months) that still have at least one Note or Activity record retrievable
— i.e., not purged by a data-retention policy after closing.
**Resolved ambiguity — no truncation floor, reversing this doc's earlier
draft (today):** reads the same `notesByOpportunity`/`activitiesByOpportunity`
maps as `note_coverage_rate`/`activity_capture_rate`, but does **not** get
`applyTruncationFloor`, unlike those two. An earlier draft of this entry
called for applying it "for consistency," on the reasoning that truncation
can't turn a real "≥1 record" into a wrong "0" — but that reasoning is
equally true of `note_coverage_rate`/`activity_capture_rate` themselves, and
they still get the floor as a deliberate general data-completeness signal,
not because their arithmetic can be wrong. This entry makes the opposite
deliberate choice for this metric specifically: the ≥1 predicate is
unaffected by truncation, full stop, and that's reason enough not to flag
it here, even though the same fact didn't stop the floor from applying
elsewhere. Not a logical necessity either way — a policy call, made this
way for this metric.
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
  as a `blocked` verdict. A metric should only return one of these statuses
  when it genuinely cannot compute a number, not as a way to signal a bad
  result.
- **Sample population and order (decided 2026-09-30).** The sampler reads
  only the opportunities a sample can use (every open one, plus closed ones
  with a close date in the trailing 12 months), newest created first
  (`CrmAdapter.listOpportunitiesForSample`), and counts that population up
  front (`countOpportunitiesForSample`).
- **Two tiers (decided 2026-09-30).**
  - **Scan tier:** the scan reads every eligible deal up to 5,000
    (`maxRecordsToScan`). Metrics that need only list-query fields run over
    all of it (`buildReport.ts`, `SCAN_TIER_METRICS`):
    `close_date_fill_rate`, `amount_fill_rate`, `owner_id_fill_rate`,
    `next_step_fill_rate`, `contact_linkage_rate`,
    `median_days_since_modified`, `past_due_close_date_rate`,
    `round_amount_rate`, `stage_mapping_coverage`. `closed_deal_count_12m`
    reads the population count instead (see its entry).
  - **Detailed-check tier:** every other metric needs hydrated data (notes,
    activities, history, accounts, contacts) and runs over a stratified
    sample, up to 20 deals per stratum by default (`--hydrate-per-stratum`).
    Each stratum's sample is a seeded reservoir over the whole scan, so it
    is uniform across the population, not the newest deals, and the same
    seed and data draw the same sample. The seed is recorded in the report
    (`ReportOrgSummary.sampleSeed`).
  - **Population weighting (accepted 2026-09-30):** scan-tier rates weight
    each stage by how many deals it holds. The old sample held up to 20 per
    stage, so a stage with 2,000 deals counted the same as one with 20;
    now the large stage dominates. Thresholds keep their meaning (a share
    of the org's deals); on a real org the numbers shift toward the
    biggest stages.
  - **Report:** both sizes and the seed are always shown: "Scanned N of M
    eligible deals; detailed checks on K sampled deals (up to P per stage,
    seed "S")."
  - **Unread deals:** the scan runs to the end of the population unless
    it hits the 5,000 budget or `--quick` stops it once every stratum's
    sample is full (off by default). Whenever eligible deals go unread
    (`ReportOrgSummary.eligibleDealsUnread`), the report says so: "Scanned
    the N most recently created of M eligible deals. K older open deals were
    excluded, so this report describes newer deals.", or, if every unread
    deal is closed, "The K oldest were not read, ...". The population counts,
    seed and per-stratum size are not sent to the narrative model.
- **Blocked vs Not measured (decided 2026-09-30).** A gate with no reading
  is graded by *why* it has none:
  - **Blocked: the data is missing.** The CRM doesn't hold what the metric
    needs (e.g. no sampled notes, no open opportunities). Status
    `not_applicable`. This is a verdict about the org's data.
  - **Not measured: the tool can't see it.** The adapter, or a connected
    second source, lacks the capability (`not_instrumented`, e.g.
    `activitySync` off), or the metric is `deferred`/`not_implemented`.
    This says nothing about the org's data either way. Exception: a D5
    metric with **no** second source connected is missing data, so
    Blocked (see D5).

  A capability takes its worst gate in the order **blocked > not measured >
  degraded > viable**. The report still lists every non-viable gate under
  the capability, so a not-measured capability shows its degraded gates too.
  A single metric row is never "not measured": its status carries that.
  `buildReport.ts`'s `gateVerdictOf` and `rubric.ts`'s `gradeCapability`
  implement this rule.
- **Notes the adapter can't read are Not measured (decided 2026-09-30).**
  When the adapter found notes it couldn't read
  (`AdapterCapabilities.notesComplete` false), every metric that reads
  notes is `not_instrumented` with the adapter's setting hint, not scored
  on the notes it could read: `note_coverage_rate`,
  `substantive_note_rate`, `median_note_length_chars`,
  `outcome_evidence_retention_rate`, `pii_density`, `untrusted_text_ratio`
  (the last three also read activities or deal text, but a partial set of
  notes would still undercount or skew them). On Salesforce this is
  Enhanced Notes linked to sampled deals while `ContentNote` isn't
  queryable for the Run As user. With no Enhanced Notes linked, nothing
  is missing and the metrics are scored, queryable or not. The adapter
  learns this while reading notes, so `hydrateNotes` re-reads it.
- A metric with `unit: 'bool'` has no degraded band (decided 2026-09-30): a
  value below `viableAt` grades **blocked**. A capability either exists or
  it doesn't.
- A metric with `rubric.ts`'s `unit: 'bool'` reports `MetricResult.value`
  as `1` (true) or `0` (false), never a JS boolean — `value`'s type is
  `number | null`. Established by `owner_history_enabled` (D4), the first
  `unit: 'bool'` metric implemented.

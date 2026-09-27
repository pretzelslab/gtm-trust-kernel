# report/narrative.ts — design note (locked, implemented)

## Session handoff (2026-09-26)

Commits: fe398cb (1), 065cded (2), d93a0ac (2b), e01abcb (2c), 4094b76 (2d), 049198e (2e), c26f62a (2f), c232891 (3), b70470b (4) — 1 through 2f were local until pushed at the end of that session; 3 and 4 pushed this session.


**e01abcb (2c) was committed but NOT live-validated** at the time — all 12 smoke-run calls failed identically at the transport layer: API 400, `output_config.format.schema: For 'array' type, property 'maxItems' is not supported`. Fixed by 2d.

**4094b76 (2d) fixed that schema rejection (decision 17).** `CLAIMS_SCHEMA`'s `claims` array no longer declares `maxItems`; the prompt's "at most 8 claims" instruction is unchanged and is still the model's only signal about the limit. `AnthropicNarrativeModelClient.generate()` enforces the cap client-side via a new pure `capClaims()`, called after the shape-guard passes, exposing the pre-cap count as `NarrativeModelResponse.originalClaimCount`. Validator untouched. **Live-validated (`--runs 3`):** 0 transport/truncation failures — the schema fix reached the model on all 12 calls for the first time — but grounding fallback rose to 75% (9/12), worse than 2b's 42% baseline. Every failure was the same new shape: a tier word ("viable"/"degraded") describing a *threshold number*, not the cited item's own tier (e.g. "below the 95% **viable** threshold", cited tier `degraded`).

**049198e (2e) fixed that leak (decision 18).** Root cause: `MetricRow.viableAt`/`degradedAt` — the literal JSON keys the model reads for every metric — are themselves named with the tier words, so the model had a structural cue no prose instruction reliably overrode. `NarrativePromptMetricRow` (new type) renames those two fields to `target`/`limit` (tier-neutral; not `floor`, to avoid colliding with the existing unrelated `floor: boolean` truncation flag); `buildPrompt()` gained two WRONG/RIGHT few-shot pairs teaching the new vocabulary. Validator unchanged. **Live-validated (`--runs 3`):** grounding fallback dropped to 25% (3/12), down from 2d's 75% — but all 3 failures were claim 7 (the last claim in each failing run): an aggregate/closing sentence ("All 8 capabilities are blocked", "5 of 8 blocked") or an otherwise-grounded claim with an uncited tier word tacked on at the end.

**c26f62a (2f) fixed that leak (decision 19).** Root cause: `NarrativePromptInput.org` still carried `capabilityVerdictCounts`/`metricStatusCounts` — tier-keyed aggregate counts — giving the model the exact numbers to build a closing "N of M blocked" sentence from, the same "echoes what it sees" pattern as 2e's fix, just one field over. `NarrativePromptInput.org` is now `Omit<ReportOrgSummary, 'orgDescription' | 'capabilityVerdictCounts' | 'metricStatusCounts'>`; `buildNarrativePromptInput()` no longer copies those two fields. `buildPrompt()` also gained an explicit "no closing/summary claim" rule and sharpened the tier-word rule to forbid tacking an uncited second tier word onto an otherwise-valid claim. Validator unchanged. **Live-validated (`--runs 3`):** grounding fallback dropped to 8% (1/12), the lowest of every iteration since 2b (100% → 42% → 75% → 25% → 8%) and the first at or under decision 4's ~20% threshold — see decision 4's "Threshold met" note. Zero aggregate/closing-claim or tier-tack-on failures this run: decision 19's fix held. **The one failure is a new, unrelated shape:** `legacy` run 2, claim 3, `"activity_capture_rate is blocked because the org has no activity-sync capability"` — `activity_capture_rate` is gated off (`AdapterCapabilities.activitySync: false` on `legacy`), so its real tier is `null` ("none" in the validator's message), not `blocked`. The model used "blocked" colloquially to describe a *gate-off* metric rather than one that was actually evaluated and scored `blocked` — a plausible English reading of "not instrumented" that decision 6's strict tier-word check correctly rejects. Not a recurrence of 2d's threshold-echo or 2e's/2f's closing-claim/tack-on patterns; not chased further this timeboxed commit (rate is already within threshold, and the fallback is free and correct) — flagged as an open item if it recurs.

Older open findings from the 2b run, largely superseded by the above (claim count too high, mixed-id tier claims, capability-only numeric citations, usage lost on parse failure) were addressed by 2c/2d's prompt and cap changes and were not the dominant failure in 2d's, 2e's, or 2f's live runs. Still open, unrelated to 2c-2f: the `volume` claim-4 note-derived-count hypothesis (see decision "open item" above, unconfirmed as of the 2b re-run); and the new gate-off-described-as-"blocked" pattern flagged above.

**c232891 (commit 3) built `narrative.ts`'s orchestration (decisions
20-22)** — pure wiring/formatting, no prompt or grounding-rule change, so
none of 2f's live-validated 8% fallback rate is expected to move. One
mid-implementation correction from the plan handed off at the start of this
session: the grounding-failure notice was originally going to quote
`GroundingFailure.reason` directly (per decision 9's literal example
wording). Caught before writing code — `reason`'s "cited id ... does not
exist" shape echoes an unvalidated, model-supplied `groundedIn` string,
which could in principle carry the claim's own rejected wording. Fixed by
building the notice from a fixed category label (`checkNameFor`, prefix-
matched against the four known failure shapes) plus the claim number only —
see decision 21's full writeup. Also added, per explicit instruction: a
`"(+N more)"` suffix when more than one claim fails grounding, and a
direct test asserting the notice contains neither the failing claim's text
nor an invalid cited id. `npm run ci` green (adapters 63, kernel 24,
readiness 405 — 6 new in `narrative.test.ts`). Not live-validated against
the real API this commit — no prompt/model-facing change to validate;
the existing 2f live-validation result stands.

**b70470b (commit 4) wired `--narrative` into `cli.ts` and a render slot
into `render.ts` (decisions 23-27)** — see those decisions below for the
full design. Pure CLI/render plumbing, same "no prompt/grounding change"
category as commit 3: nothing here can move 2f's live-validated 8%
fallback rate. `npm run ci` green (adapters 63, kernel 24, readiness 409 —
4 new in `render.test.ts`, canned `NarrativeResult`, no network). Manually
verified with `tsx src/report/cli.ts` (not part of `npm run ci`, same
precedent as `--live`'s manual-only path): `--all --narrative` exits 1 with
the CLI error (decision 24); `--narrative` with `ANTHROPIC_API_KEY` unset
exits 1 naming the var (decision 25); a plain default run's HTML is
byte-identical to pre-commit-4 output (confirmed no
`<div class="narrative-fallback-notice">` appears and the "Plain-English
summary" paragraph is unchanged).

Motivated by Phase E (`claude/gtm-readiness-scope.md`; `docs/STATUS.md`'s
Known Gaps: "the LLM narrative pass, `report/narrative.ts` (Phase E), is
still not built"). **Draft plan** — the decisions below are locked as in
"agreed, to be built this way," but nothing is implemented: no code, no
new dependency, no tests exist yet. Per root `CLAUDE.md` rule 4, each
commit below still gets its own plan-and-wait pass before writing, same
as every other multi-file change in this repo.

## Scope

`narrative.ts` is a single, non-agentic model call that turns an already-
computed `ReportData` into prose, with a grounding check that rejects any
hallucinated or mismatched claim, falling back to the existing
deterministic summary (`plainSummary.ts`) whenever anything doesn't check
out.

**Explicitly not in scope:**
- Reasoning over raw CRM text (notes, activity bodies, transcripts). That
  is what `packages/adapters/src/model/trust.ts`'s `UntrustedEnvelope`/
  `TrustTier`/canary-token machinery is for, and it stays unused by this
  phase — `ReportData` (`report/buildReport.ts`) is already numbers/enums/
  static-string-only, verified by the existing `redactionCanary.test.ts`.
  The envelope is reserved for a different, unbuilt capability (e.g.
  `rubric.ts`'s `grounded_account_brief`), not this one.
- `packages/kernel`'s audit ledger (write-proposal audit trail — a
  different package, a different concern). `packages/readiness` has no
  dependency on `packages/kernel` today and this phase doesn't add one.

## Decisions (draft, per the user's explicit calls)

1. **Input is `ReportData` only, never raw records.** Matches the scope
   doc's Phase E prompt verbatim ("receives computed numbers only and may
   not see raw records") and root `CLAUDE.md` rule 4. See decision 10 for
   how this gets verified, not just assumed.

2. **Model-calling layer: one Messages API call, no tools.** A
   `NarrativeModelClient` interface (`generate(input) => Promise<result>`),
   with `FakeNarrativeModelClient` (test-only) and
   `AnthropicNarrativeModelClient` (the only file importing
   `@anthropic-ai/sdk`) — same dependency-injection shape `CrmAdapter`/
   `MockAdapter` already establish. Structured output via
   `output_config.format` (a fixed JSON schema for `claims`), not forced
   tool-use.

3. **Model default + override.** Default model:
   `claude-haiku-4-5-20251001`. Overridable via the `NARRATIVE_MODEL` env
   var (same minimal `.env`-loader convention `cli.ts` already uses for
   Salesforce live credentials — no new config system).

4. **Model-selection escalation rule (not a claim-tolerance rule).** A
   manual smoke script (outside `npm run ci`, gated on `ANTHROPIC_API_KEY`
   being set) runs the narrative pass across every fixture and reports the
   fallback rate — how often the whole-narrative-discard in decision 8
   fired. **If that rate exceeds roughly 20%, switch the hardcoded default
   to `claude-sonnet-5`.** This is an operational trigger for a human to
   act on after running the script, not a runtime threshold the code
   enforces — claim-level grounding stays strict regardless (decision 8).
   **Threshold met, 2026-09-26 (commit 2f's live validation):** after
   commit 2f's fix (decision 19), a `--runs 3` smoke run's grounding
   fallback rate dropped to 8% (1/12) — the first live run at or under the
   ~20% mark across every 2b–2f iteration (100% → 42% → 75% → 25% → 8%).
   No escalation to `claude-sonnet-5` needed; `DEFAULT_MODEL` stays
   `claude-haiku-4-5-20251001`. The one remaining failure is a new,
   unrelated shape, not a recurrence of any prior one — see the
   "Session handoff" section.

5. **Every claim must cite at least one id.** `groundedIn` (an array of
   `MetricId`/`CapabilityId` values) must be non-empty on every claim; no
   free-floating connective sentences. An id that doesn't exist in the
   `ReportData` passed to the model fails the claim.
   **Amended 2026-09-26 (commit 2b), approved by the user in response to
   commit 2's live smoke-run finding (100% grounding-fallback rate across
   all 4 fixtures, 0 transport failures):** three additional, namespaced
   ids are citable alongside `MetricId`/`CapabilityId` --
   `summary.recordsScanned`, `summary.openSampleSize`,
   `summary.closedSampleSize` -- each checked by **exact match** against
   the real `ReportData.org` value (`recordsScanned`/`openSampleSize`/
   `closedSampleSize` respectively), never the percent-tolerance rule
   decision 7 uses for rate-unit metrics: these are plain integer counts,
   not rates. Additive only -- no existing `MetricId`/`CapabilityId`
   citation, tier-word, or numeric-tolerance check is loosened. Motivation:
   the model's very first claim, in every one of the 4 live fixtures, tried
   to state one of these exact org-level counts (a legitimate fact about
   the data) but had no valid id to cite for it, since neither a metric nor
   a capability represents "how many records were scanned." Deliberately a
   closed 3-id set, not a wildcard `summary.*` acceptance -- an unlisted
   org-summary field cited this way still fails as "does not exist," same
   as today (see `narrativeGrounding.test.ts`'s `summary.bogus` case).

6. **Tier-word check.** If a claim's text contains a tier or qualitative
   term (`viable`/`degraded`/`blocked`, `ready`/`not ready`,
   `strong`/`weak`, and equivalents), that term must match the actual
   `tier`/`verdict` of every id the claim cites. A mismatch (e.g. the
   model writes "viable" for a metric whose real tier is `degraded`) fails
   the claim, independent of the numeric check in decision 7.
   **Known v1 vocabulary limit (accepted, 2026-09-26):** this checks only
   the 7 literal terms above. Other qualitative words a model might reach
   for — "healthy", "poor", "risky", and similar — aren't checked at all;
   a claim using one of those neither passes nor fails on that basis.
   Revisit if the manual smoke script (decision 4) surfaces model output
   that leans on unchecked vocabulary to imply a tier.

7. **Numeric tolerance, and the unmatched-number rule (revised
   2026-09-26).** Fractions are normalized to percent before comparison
   (`0.203` and `20.3%` are the same value). Percent-shaped values must
   match within **±0.5 percentage points**. Non-percent values (counts,
   day counts, chars) must match the metric's own displayed value exactly
   — `render.ts` shows these with no rounding, so there is no tolerance
   band to allow.
   **The check is not scoped to `MetricId` citations, as first
   implemented — corrected per explicit instruction:** if a claim's text
   contains any number at all, at least one of its cited **metric** ids
   must have a value that number matches, within the tolerance above.
   Otherwise the claim fails, regardless of what it cites. This applies
   even when every cited id is a capability (no single value to check
   against) or a bool-unit metric (categorical, not numeric) — a number
   appearing in either case fails, rather than silently passing for lack
   of a shape to check.
   **Known v1 strictness tradeoff (accepted, not an oversight):** an
   aggregate figure derived from several rows at once (e.g. "2 of 8
   capabilities are blocked") has no single cited metric whose own value
   it matches, so it fails this check even when every underlying number
   is correct. Revisit if the smoke script's fallback rate is high and
   this turns out to be why.

8. **Any single failing claim discards the whole narrative.** No partial
   assembly of "the claims that passed." This stays strict per the user's
   explicit confirmation — revisit only if it proves too blunt in
   practice, not preemptively.

9. **Visible fallback, never silent.** When the narrative is rejected, the
   report states that explicitly, names which check failed, and which
   claim triggered it — e.g. *"LLM narrative rejected: ungrounded figure
   in claim 3; showing deterministic summary."* A reader must never see
   what looks like a normal narrative that is secretly the fallback, and
   must never see a report that silently omits the narrative section with
   no explanation.

10. **Free-text verification is a gate before commit 1, not a defense
    built later.** Before writing any code: check whether `ReportData`
    actually contains any CRM-sourced free text — `Opportunity.vendorStageLabel`
    (a custom, org-defined stage label) is the concrete field to check
    first, plus anything else that could carry a picklist value or an
    org/account/owner name through into a `MetricRow.note` or
    `ReportCapabilityRow`/`ReportOrgSummary` field.
    - **If any such field is found:** list exactly which fields, and
      propose handling (exclude it from the prompt input, allowlist a
      fixed set of values, or route it through the envelope from
      decision-scope above) for approval before proceeding.
    - **If none is found** (the expected outcome, per the scope-doc
      guarantee already holding for `plainSummary.ts`): add a test
      asserting this as part of commit 1, not deferred.
    - This is separate from, and precedes, the prompt-payload
      redaction-canary test in the test strategy below, which stays
      where originally planned (verifying the actual serialized prompt
      payload, once the prompt-builder exists).
    - **Verified clean, 2026-09-26** (traced every write site of every
      string field reachable from `ReportData`, not just grepped for
      `vendorStageLabel`): zero reads of `vendorStageLabel`/`.name`/
      `.title`/`.industry`/`.forecastCategory` anywhere in `src/metrics/`
      or `src/report/`. The two fields that *are* read
      (`consistency.ts`'s `account.domain` for `duplicate_account_rate`,
      `joinability.ts`'s `.email` truthy check) never put the raw value
      into any `MetricResult.note` — every `note` interpolates only
      counts. `stageConfidence` is a closed enum, never the raw picklist
      label. `ReportOrgSummary.orgLabel`/`orgDescription` are the one
      near-miss — see decision 11.

11. **Prompt input excludes `ReportOrgSummary.orgDescription` entirely.**
    In `--live` mode `orgDescription` is `SalesforceAdapter.orgId`, which
    `salesforce.ts` derives as `new URL(instanceUrl).host` — the connected
    instance's hostname. That identifies the customer, and sending it to a
    third-party model API is data egress this package's local-first
    design doesn't otherwise permit — not customer-authored free text like
    a note body, but a real instance of the same problem. `orgLabel` is
    kept: it's already generic and static in both modes (`fixture.label`
    in fixture mode, the hardcoded literal `'Live Salesforce org'` in live
    mode — never org-specific). `NarrativePromptInput.org` is typed as
    `Omit<ReportOrgSummary, 'orgDescription'>`, not `ReportOrgSummary`
    itself, so this is a compile-time guarantee, not a runtime filter that
    could be forgotten on some code path.

12. **Structural guard: a pinned inventory of every string-valued path in
    `ReportData`.** Decision 10's field-by-field trace is a point-in-time
    check — it says nothing about a field added next month. A test walks
    a built `ReportData` (every mock-org fixture) and collects every path
    whose value is a string (arrays normalized to `[]`, e.g.
    `metrics[].note`), then asserts that set equals an explicit, reviewed
    allowlist committed in the test file. A new string field anywhere in
    `ReportData` changes the discovered set and fails the test until a
    human reviews it and adds it to the allowlist deliberately — the same
    "changes the discovered set" property also fails if a known path
    disappears, so the allowlist can't silently drift stale either.

13. **Decision 3's distinctiveness check — resolved by reusing the
    existing canary technique, not by editing production fixture data.**
    Audited `mockOrgs.ts`'s actual seeded free text: `Opportunity.name`
    (`` `Deal ${id}` ``) and `Account`/`Contact.name` (`` `Account ${id}` ``/
    `` `Contact ${id}` ``) are distinctive enough combined with their
    fixture-specific id. `Opportunity.vendorStageLabel` is **not** —
    for 3 of the 4 fixtures it's set to the literal canonical stage name
    (`'discovery'`, `'proposal'`, etc.), a word ordinary report prose could
    plausibly contain for unrelated reasons. Rather than rewrite
    `mockOrgs.ts` (shared by all 341 existing tests) to make that one
    field more distinctive, the commit-1 test extends
    `test/report/redactionCanary.test.ts`'s existing canary-injection
    technique (`canaryOpportunity`) to also seed `name`/`vendorStageLabel`
    with the same purpose-built, unmistakably-distinctive tokens the rest
    of that suite already uses — sidestepping the naturalness problem
    entirely instead of assessing it field-by-field. That test already
    asserts `JSON.stringify(reportData)` (the `--json` surface) carries no
    canary fragment, so this one extension closes decision 10's gap for
    `ReportData` specifically, without new scaffolding.

14. **Prompt must enumerate the exact valid `groundedIn` vocabulary (2026-
    09-26, commit 2b).** `anthropicNarrativeModelClient.ts`'s `buildPrompt()`
    lists every `metrics[].metric` id, every `capabilities[].id`, and the 3
    summary ids from decision 5's amendment, verbatim (`listValidIds()`),
    and explicitly states that citing any other field name (e.g.
    `capabilityVerdictCounts`, `metricStatusCounts`, `gatesCapabilities`, or
    any other JSON key visible in the data dump) is not allowed. Motivated
    by the same live-run finding as decision 5's amendment: the model was
    reaching for structural field names it could see in the JSON, not just
    the 3 legitimate org-summary counts — enumerating the vocabulary
    explicitly, rather than relying on the model to infer "id" from
    context, is the fix for that broader pattern. `listValidIds()` is
    exported and unit-tested directly: it must contain every real id and
    must never contain the 3 named structural fields, checked separately
    from a test confirming the prompt's *forbidding sentence* still names
    them (so deleting that sentence, while tidying the prompt, is itself a
    test failure).

15. **Aggregate tier-count sentences are prohibited; per-capability/per-
    metric tier claims remain allowed (2026-09-26, commit 2b).** The prompt
    instructs the model never to write a sentence summarizing a count
    across multiple capabilities/metrics by tier (e.g. "2 capabilities are
    blocked, 5 are viable") — citing `capabilityVerdictCounts`/
    `metricStatusCounts` this way was the second major source of live-run
    failures, alongside decision 14's structural-field-name problem. A
    claim about one specific capability's or metric's own tier (e.g. "the
    `pipeline_risk_signals` capability is blocked") is unaffected and stays
    allowed. **This is a prompt-only instruction, not a new grounding
    check:** even without it, such a sentence would still fail decision 5's
    (unchanged) id-existence check today, since `capabilityVerdictCounts`/
    `metricStatusCounts` are not part of the citable vocabulary — this
    decision just stops the model from generating (and having rejected)
    that pattern in the first place, rather than adding new enforcement.

**Open item, not yet resolved (2026-09-26, commit 2b):** the live run also
surfaced a narrower, distinct hypothesis — `volume`'s one non-id-related
numeric failure cited a real metric (`stage_mapping_coverage`, a `'rate'`-
unit metric) but still failed the numeric check, and the likely cause is
that the claim quoted a count from that metric's own `note` field (e.g.
`stage_mapping_coverage`'s note reads "115 mapped, 0 inferred, 0
unmapped") rather than a percent — `metricMatchesSomeNumber` only checks
percent-shaped numbers against a `'rate'`-unit metric's value, never bare
counts, so a note-derived count on a rate metric can never pass regardless
of correctness. Not confirmed against the literal claim text and **not
fixed this commit** — commit 2b adds claim text to the smoke script's
failure output specifically to confirm or refute this on the next live
run. If confirmed, this is a separate gap from decisions 5/14/15 above and
needs its own decision before any fix.
**Status after the commit-2b live re-run (`--runs 3`, 2026-09-26):
inconclusive, not confirmed or refuted.** None of the 3 `volume` runs
produced a claim referencing `stage_mapping_coverage` at all — the
model's claim selection varies run to run, and this exact pattern didn't
recur. Still open.

16. **Validator stays strict; prompt constrains language (2026-09-26,
    commit 2c).** The commit-2b live re-run (`--runs 3`) showed the
    grounding-fallback rate was still above threshold (42%, 5/12) and
    surfaced two new problems, neither fixed by loosening
    `narrativeGrounding.ts` — **per explicit instruction, the validator is
    not touched by this decision, in any commit**:
    - **Token-budget truncation.** Responses got long enough (encouraged by
      decision 15's per-item tier claims) to hit the old `max_tokens: 1024`
      cap mid-JSON, throwing a JSON-parse error indistinguishable from a
      genuine transport failure. Fixed by: `max_tokens` raised to 1536;
      `CLAIMS_SCHEMA`'s `claims` array gained `maxItems: 8`, paired with a
      prompt instruction to write at most 8 claims and prioritize the most
      decision-relevant ones; and `AnthropicNarrativeModelClient.generate()`
      now checks `message.stop_reason === 'max_tokens'` **before**
      attempting to parse, throwing a distinct `NarrativeGenerationError`
      (`kind: 'truncation'`) rather than letting it surface as an
      indistinguishable JSON-parse failure.
    - **Tier-word-as-threshold false positives.** The dominant failure
      pattern in the live re-run was the model using a tier word to
      describe a *threshold or benchmark* ("falling short of the 95%
      threshold required for viable status") rather than the cited item's
      *own current tier* — `findTierWordMismatches` correctly has no way to
      tell those apart (it's a literal-word match, per decision 6's
      documented limitation), and **that check is not being changed**.
      Fixed entirely in the prompt instead: tier words may only state the
      cited item's own current tier; a threshold/benchmark must be
      expressed as a number, never a tier word; at most one tier word per
      claim (the other live-run failure shape was two tier words in one
      sentence — the capability's own tier plus a contributing metric's —
      getting cross-checked against a merged expected-tier set that
      neither alone would fail). A fourth prompt rule, not itself motivated
      by a new failure but tightening an existing one: any number must
      cite its own metric id, restating decision 5/7's existing rule
      explicitly so the model doesn't waste a generation on a
      capability-only numeric claim that was already going to fail.
    - `NarrativeModelClient.generate()`'s switch from `messages.parse()` to
      `messages.create()` + manual `JSON.parse` (see
      `anthropicNarrativeModelClient.ts`'s docblock) was necessary, not
      optional, to satisfy the "capture usage even when parsing fails"
      requirement below: `.parse()` discards the raw `Message` on a parse
      failure, since parsing happens inside its own `.then()` and only the
      thrown error escapes the promise chain.
    - **Token accounting is now complete on every outcome.**
      `NarrativeGenerationError.usage` is populated whenever the SDK
      returned a `Message` at all (truncation, parse failure, or shape
      mismatch), not just on success -- only a genuine `api_error` (no
      `Message` came back) has no usage to report. The smoke script's
      totals are consequently now accurate rather than undercounting
      failed calls, which the previous live re-run's report flagged as a
      gap.
    **Rationale, stated plainly per the user's framing:** the validator
    stays strict and unchanged; the prompt is what constrains the model's
    language to stay inside what the validator can already correctly
    judge.

17. **The API doesn't support `maxItems` on an array-typed schema property;
    the 8-claim cap is enforced client-side instead (2026-09-26, commit
    2d).** Commit 2c's live validation (all 12 smoke-run calls) failed
    identically at the transport layer: `output_config.format.schema: For
    'array' type, property 'maxItems' is not supported` -- the request
    never reached the model, so none of 2c's other changes (max_tokens
    1536, the 4 tier-word prompt rules, `stop_reason` truncation detection)
    were exercised. `CLAIMS_SCHEMA`'s `claims` array no longer declares
    `maxItems`; the prompt's "at most 8 claims, prioritize the most
    decision-relevant" instruction is unchanged and is still the model's
    only signal about the limit. `AnthropicNarrativeModelClient.generate()`
    now calls a new pure `capClaims()` after the shape-guard (`isClaimsShape`)
    passes: if the parsed response has more than 8 claims, keeps the first
    8 and drops the rest, in order. Safe to truncate rather than reject
    outright because every claim is grounded and checked independently
    (`validateGrounding()` validates one claim at a time) -- dropping
    claims 9+ removes zero verified content and adds zero unverified
    content to the 8 that remain. `NarrativeModelResponse` gained an
    optional `originalClaimCount`, set only when capping actually fired, so
    a caller (the smoke script) can distinguish "8 claims, none dropped"
    from "N claims, capped to 8" and log the latter as `capped N→8`. The
    validator (decision 16's "stays strict, unchanged" rule) is untouched
    by this decision too -- this is a transport-layer fix, not a grounding
    change.

18. **Model echoes tier-labeled data; neutralize at the input, not only via
    instructions (2026-09-26, commit 2e).** The first live-validated run
    after 2d's schema fix (`--runs 3`, all 12 calls reaching the model for
    the first time) showed a 75% grounding-fallback rate — worse than 2b's
    42% baseline — with every failure the same shape: a tier word
    ("viable"/"degraded") describing a *threshold*, not the cited item's
    own tier, e.g. "below the 95% **viable** threshold" (cited tier:
    `degraded`) or "below the 20-deal **degraded** threshold" (cited tier:
    `blocked`). This is exactly the pattern decision 16's prompt rule
    ("never use a tier word to describe a threshold... write 'below the
    95% threshold'") was meant to stop, and the rule was still in the
    prompt — but `MetricRow.viableAt`/`degradedAt` (the JSON keys the model
    reads for every metric) are themselves named with the literal tier
    words, so the model had a structural cue to echo that no amount of
    prose instruction reliably overrode. **Fix is at the input, not just
    the instructions:** `NarrativePromptMetricRow` (new type,
    `narrativeTypes.ts`) copies `MetricRow` field-for-field except
    `viableAt`/`degradedAt`, renamed to `target`/`limit` — tier-neutral,
    and deliberately not `target`/`floor` (the user's own suggested naming)
    since a row already has an unrelated `floor: boolean` (the
    truncation-floor flag from decision "applyTruncationFloor" in
    `docs/STATUS.md`) and reusing that name on the same object would
    collide. `tier` itself is unchanged — citing a metric's or capability's
    own real tier is decision 6's legitimate case, not the leak.
    `buildNarrativePromptInput()` now maps `data.metrics` through this
    rename (previously passed through by reference; `NarrativePromptInput`
    is no longer identical to a subset of `ReportData` for metrics, same as
    decision 11 already made true for `org`). `buildPrompt()` additionally
    gained two WRONG/RIGHT few-shot pairs demonstrating the `target`/`limit`
    vocabulary and the "state the tier as a separate fact" pattern, to
    reinforce the renamed data with matching prose guidance. **The
    validator is unchanged** — same rule as decision 16, this is a data/
    prompt-only fix.

19. **Aggregate tier-count fields stripped from the prompt input; explicit
    "no closing claim" / "no uncited tier tack-on" prompt rules added
    (2026-09-26, commit 2f).** 2e's first live run (`--runs 3`, schema fix
    and `target`/`limit` rename both live) showed a 25% grounding-fallback
    rate (3/12) — an improvement on 2d's 75%, but all 3 failures were the
    same new shape: claim 7, the *last* claim in each failing run, was
    either an aggregate/closing sentence ("All 8 capabilities are blocked",
    "5 of 8 blocked") or an otherwise-grounded claim with an extra,
    uncited tier word tacked on at the end. Root cause: `NarrativePromptInput.org`
    still carried `capabilityVerdictCounts`/`metricStatusCounts` —
    tier-keyed aggregate counts — even though decision 14's prompt rule
    already told the model not to write a sentence summarizing a count by
    tier. Same lesson as decision 18: a prose instruction alone didn't
    reliably override a structural cue sitting right there in the data the
    model reads. **Fix is at the input, not just the instructions, same
    pattern as decision 18:** `NarrativePromptInput.org` is now
    `Omit<ReportOrgSummary, 'orgDescription' | 'capabilityVerdictCounts' |
    'metricStatusCounts'>` (`narrativeTypes.ts`); `buildNarrativePromptInput()`
    no longer copies those two fields (`narrativePromptInput.ts`). The 3
    `SUMMARY_IDS` (decision 5's amendment) are unaffected and still passed
    through — those are plain org-level counts, not tier-keyed breakdowns,
    and remain the model's only legitimate way to cite a scan/sample count.
    `buildPrompt()` (`anthropicNarrativeModelClient.ts`) additionally gained
    two new rules on top of the data fix: (1) an explicit ban on any
    closing/summary/overview claim — "every claim, including your last one,
    must be about one specific, cited metric or capability... Stop after
    your last per-item claim" — targeting the *position* pattern (last
    claim tends to be where a model reaches for a wrap-up sentence), not
    just the count-by-tier phrasing decision 14 already forbade; (2) the
    existing "at most one tier word per claim" rule is sharpened to say
    that tier word must describe *only that claim's own cited item*, and
    explicitly forbids tacking a second, uncited tier word onto an
    otherwise-valid claim to describe a different item, a group, or the
    report overall. The "Do NOT cite structural field names" line dropped
    `capabilityVerdictCounts`/`metricStatusCounts` (they no longer appear
    in the data at all, so the line describing them as "appear[ing] in the
    data" would now be false) but kept `gatesCapabilities`, which is still
    present on every metric row. **Validator unchanged** — same rule as
    decisions 16 and 18, this is a data/prompt-only fix. See this file's
    "Session handoff" section for this commit's live-validated results.

20. **`NarrativeResult` shape (2026-09-26, commit 3).**
    ```ts
    type NarrativeResult =
      | { ok: true; text: string; claims: NarrativeClaim[] }
      | { ok: false; reasonKind: 'client_error' | 'grounding'; notice: string; text: string };
    ```
    `text` is present on **both** branches — a caller (commit 4's render
    layer) never has to branch on `ok` just to find prose to show. On the
    `ok: false` branch it is the deterministic summary: `plainSummary.ts`'s
    `buildExecutiveSummary(data)` output, verbatim, not `buildFullNarrative`
    (a separate, structured multi-part shape used only by `plainReport.ts`'s
    own renderer — confirmed by grep, `render.ts` imports only
    `buildExecutiveSummary`). `claims` is only present on `ok: true`
    (decision 22), so a caller can walk each claim's own `groundedIn` for
    traceability; the fallback branch has no model claims to expose.

21. **Fallback notice text — fixed category strings, never raw error or
    reason text (2026-09-26, commit 3, amended from the original plan per
    explicit instruction).** Client-throw notice is a fixed string,
    regardless of what was thrown or its `kind` (`NarrativeGenerationError`
    or otherwise): `"LLM narrative unavailable (network/API error); showing
    deterministic summary."` — never includes `error.message`, so no SDK
    internals ever reach the report.
    **Grounding notice does not quote `GroundingFailure.reason` either**,
    contrary to the first draft of this decision. Three of
    `narrativeGrounding.ts`'s four failure shapes interpolate only
    `ReportData`-derived content (real metric/capability ids, decision 6's
    fixed tier-word vocabulary) — safe on inspection — but the fourth
    (`cited id "..." does not exist in this report`) echoes whatever
    arbitrary string the model put in a claim's `groundedIn` array. Once
    that string has failed the id-existence check it is unvalidated
    model-generated content with no format guarantee beyond "a string", so
    rather than trust that one shape apart from the other three, the notice
    never quotes any `reason` text at all. Instead, `narrative.ts` maps each
    `reason` to a fixed category label via prefix-matching against the four
    known shapes (`checkNameFor`; an unrecognized future shape falls back to
    a generic `"grounding check"` label rather than the raw reason) and
    builds the notice from that label plus the 1-indexed claim number only:
    `` `LLM narrative rejected: ${checkName} in claim ${claimIndex + 1}; showing deterministic summary.` ``
    — following decision 9's example phrasing (`"ungrounded figure"` is
    literally one of the four category labels). When more than one claim
    fails, `" (+N more)"` is appended after the claim number (N = failure
    count minus one) so a reader isn't misled into thinking only one claim
    had a problem — only the *first* failure's check/claim is named in
    full, matching decision 8's "any single failing claim discards the
    whole narrative" framing (a reader doesn't need every failure
    enumerated to know why). Tested directly: a claim whose text and whose
    invalid cited id both carry a distinctive marker string produces a
    notice containing neither marker.

22. **Passing claims render as one bullet per claim (2026-09-26, commit
    3).** `` `- ${claim.text}` ``, one per line, joined `\n`, in model order
    (`response.claims`'s order — already preserved by `validateGrounding`,
    which doesn't reorder, and by `capClaims`, which truncates but doesn't
    reorder). This is `NarrativeResult.text` on the `ok: true` branch. The
    raw `claims` array is also returned unmodified alongside it (decision
    20) so a future render layer can inspect each claim's own `groundedIn`
    ids rather than only the flattened prose.

23. **Fallback-notice CSS: a new, neutral-info class, not the mock-data
    banner style (2026-09-26, commit 4).** `.narrative-fallback-notice`
    (`shell.ts`'s `STYLE`) reuses the existing `--ninstr-bg`/`--ninstr-fg`
    tokens (the same blue-ish "informational" color already used for the
    `not_instrumented` status pill) rather than the red `.banner`/
    `.banner-live` treatment reserved for the top-of-page mock/live-data
    banners — a rejected narrative is a normal, expected report state, not
    a warning about the report's data source. Rendered as a `<div>`
    directly above the deterministic summary `<p>` inside the existing
    `.plain-summary` block (see `render.ts`'s `renderNarrativeBody`), never
    replacing it.

24. **`--narrative` with `--all` is a CLI error, exit 1 (2026-09-26, commit
    4).** Checked immediately after `parseArgs`, before any I/O.
    `renderComparisonHtml` never took a narrative option and still doesn't
    — same "no plain-English narrative for a multi-org comparison page"
    precedent `cli.ts`'s own docblock already states for `plainReport.ts`.
    An explicit CLI error (not a silently-ignored flag) so a caller who
    typed `--narrative --all` finds out immediately, not by noticing its
    absence in the output.

25. **`--narrative` with `ANTHROPIC_API_KEY` unset fails the whole run,
    exit 1, naming the var (2026-09-26, commit 4).** `--narrative` is an
    explicit opt-in — per the user's framing, "fail loud" rather than
    silently producing a report with no narrative and no explanation.
    `AnthropicNarrativeModelClient`'s constructor already throws
    `"Missing required env var: ANTHROPIC_API_KEY. ..."`; `cli.ts`'s new
    `resolveNarrative()` catches only that construction step and reuses the
    message verbatim (never inventing a second message). This is distinct
    from a grounding/client-throw failure *during* generation, which still
    falls back to the deterministic summary per decisions 8/21 — the
    difference is configuration-missing (nothing to even attempt) vs.
    generation-failed (attempted, and the free deterministic fallback
    exists precisely for that case).

26. **`loadEnvFileIfPresent()` hoisted to an unconditional call at the top
    of `main()` (2026-09-26, commit 4).** Previously only called inside
    `buildLive()`, so `.env` (and `ANTHROPIC_API_KEY`) was never loaded on
    the fixture path. `--narrative` needs the key in fixture mode too, not
    only under `--live` — hoisting once, unconditionally, avoids
    duplicating the call across three branches (`--live`, `--all`, fixture)
    and matches `--live`'s own precedent of loading `.env` before checking
    whether any of its values are actually needed.

27. **Render tests use a canned `NarrativeResult`, never a real client
    (2026-09-26, commit 4).** `render.test.ts` gained 4 cases:
    `narrative` undefined produces byte-identical output to a call with no
    narrative option at all; `ok: true` renders one `<li>` per claim in
    model order with `groundedIn` ids joined into the `title` attribute;
    `ok: false` renders the notice `<div>` strictly before the deterministic
    `<p>`; and a hostile claim (`<script>`, quotes) is escaped in both the
    `<li>` body and the `title` attribute. No network, no
    `ANTHROPIC_API_KEY` — same "no live API call in `npm run ci`" non-goal
    every other test file in this phase already honors.

## Non-goals (explicit)

- No envelope/trust-tier wiring in this phase (see Scope).
- No `packages/kernel` audit-ledger integration.
- No live API call ever runs inside `npm run ci`. Same precedent as
  `SalesforceAdapter`, which has no live-credential path in CI either —
  only a manual `--live` CLI run.

## Test strategy (no live API calls)

- `validateGrounding()` — pure function, golden-fixture unit tests: unknown
  id, tier-word mismatch, numeric mismatch (percent and non-percent),
  all-claims-pass.
- `narrative.ts` orchestration — inject `FakeNarrativeModelClient`; assert
  fallback fires (with the correct visible reason from decision 9) for:
  client throws, malformed JSON, any claim failing any of decisions 5/6/7.
- The commit-1 free-text-cleanliness test from decision 10.
- A redaction-canary-style test on the actual serialized prompt payload
  (built from a real fixture's `ReportData`), asserting no raw record
  text reaches it — same technique `test/report/redactionCanary.test.ts`
  already uses.
- `@anthropic-ai/sdk` is imported only by `AnthropicNarrativeModelClient`;
  no test file imports it or sets `ANTHROPIC_API_KEY`.

## Commit breakdown

1. **Free-text verification gate (decision 10, done — see above), then:
   types, prompt-input builder, fake client, grounding validation, and the
   two new guard tests (decisions 11-13).**
   `NarrativeModelClient`/`NarrativePromptInput`/`NarrativeClaim`/
   `NarrativeModelResponse` types (`src/report/narrativeTypes.ts`);
   `buildNarrativePromptInput()` dropping `orgDescription`
   (`src/report/narrativePromptInput.ts`, decision 11) with its own test;
   `FakeNarrativeModelClient` (`test/support/`); `validateGrounding()`
   (ids, tier-words, numeric tolerance — `src/report/narrativeGrounding.ts`)
   + golden-fixture tests; the `redactionCanary.test.ts` extension
   (decision 13); the structural-path-inventory test (decision 12). No new
   dependency yet.
2. **Real client + manual smoke script.** Add `@anthropic-ai/sdk`,
   `AnthropicNarrativeModelClient`, structured-output schema wiring, the
   `NARRATIVE_MODEL` env override. The fixture-fallback-rate smoke script
   from decision 4, explicitly excluded from `npm run ci`.
2b. **Prompt/grounding correction from commit 2's live smoke-run finding
   (2026-09-26).** The first live run (4 fixtures, 1 run each) showed a
   100% grounding-fallback rate — every fixture's narrative was rejected,
   0 transport failures. Root cause: the model cited JSON field names that
   aren't valid `MetricId`/`CapabilityId` values (`recordsScanned`,
   `openSampleSize`, `closedSampleSize`, `capabilityVerdictCounts`,
   `metricStatusCounts`, `gatesCapabilities`) when writing an overview
   sentence about scan/sample counts or an aggregate tier-count summary —
   see decision 5's amendment and decisions 14/15 above. The smoke script
   also gained claim text in its failure output (previously only the
   failure reason) and `--runs N` (default 1) for a multi-run pass-rate
   signal, both to support confirming the separate note-derived-count
   hypothesis flagged as an open item above — not fixed this commit.
2c. **Token-budget and tier-word-phrasing correction from commit 2b's live
   re-run (2026-09-26, decision 16).** `--runs 3` still showed a 42%
   (5/12) grounding-fallback rate, plus a new max_tokens-truncation
   failure mode (5/12) the old `max_tokens: 1024` cap hadn't triggered
   before commit 2b's prompt changes made responses longer. Validator
   unchanged, per explicit instruction — fixed entirely via prompt
   constraints (own-tier-only tier words, thresholds as numbers, one tier
   word per claim, numbers must cite their own metric id) plus
   `max_tokens` 1536, `claims` capped at 8 (schema `maxItems` + prompt),
   and a `stop_reason === 'max_tokens'` check that classifies truncation
   separately from transport and still captures usage. See decision 16.
   **Committed but not live-validated until 2d** — see below.
2d. **Schema-rejection fix from 2c's live validation (2026-09-26, decision
   17).** All 12 of 2c's live smoke-run calls failed identically at the
   transport layer (`maxItems` unsupported on an array schema property), so
   none of 2c's other changes were actually exercised against the live API
   before this commit. Dropped `maxItems` from `CLAIMS_SCHEMA`; kept the
   prompt's "at most 8 claims" instruction; added client-side `capClaims()`
   enforcing the same cap after the shape-guard, exposing
   `originalClaimCount` when it fires. See decision 17 for the full
   rationale and this file's "Session handoff" section for the
   live-validated results (per-fixture pass rate, grounding/truncation/
   transport rates, how often the cap applied).
2e. **Tier-word-leakage fix from 2d's live validation (2026-09-26, decision
   18).** 2d's first fully-live run (schema fix reached the model on all 12
   calls) showed grounding fallback rise to 75% (vs. 2b's 42% baseline),
   with every failure the same shape: a tier word describing a threshold
   number, not the cited item's own tier. Root cause: `viableAt`/
   `degradedAt`, the JSON keys the model reads for every metric, are
   themselves named with the literal tier words — a structural cue prompt
   instructions alone couldn't reliably override. Fixed at the input:
   `NarrativePromptMetricRow` renames those fields to `target`/`limit`;
   `buildPrompt()` gained two WRONG/RIGHT few-shot pairs. Validator
   unchanged. See decision 18 and this file's "Session handoff" for the
   live-validated results.
2f. **Aggregate-tier-count-leak fix from 2e's live validation (2026-09-26,
   decision 19).** 2e's first live run (`--runs 3`) showed a 25% (3/12)
   grounding-fallback rate, down from 2d's 75%, but every failure was
   claim 7 (the last claim): an aggregate/closing sentence ("All 8
   capabilities are blocked") or an uncited tier word tacked onto an
   otherwise-valid claim. `NarrativePromptInput.org` no longer carries
   `capabilityVerdictCounts`/`metricStatusCounts` at all; `buildPrompt()`
   gained an explicit "no closing/summary claim" rule and a sharpened
   "one tier word per claim, only for that claim's own cited item" rule.
   Validator unchanged. See decision 19 and this file's "Session handoff"
   for the live-validated results.
3. **`narrative.ts` orchestration — done (2026-09-26, decisions 20-22).**
   `buildNarrative(data, client)` builds the prompt input, calls the
   client, validates grounding, and falls back with a visible,
   leak-free notice (decisions 9/21) for a client throw or any grounding
   failure (decision 8) — fully testable via `FakeNarrativeModelClient`,
   no network. `npm run ci` green (`c232891`).
4. **CLI/render wiring — done (2026-09-26, decisions 23-27).** Opt-in
   `--narrative` flag in `cli.ts` (default off, fixture + `--live` only,
   rejected with `--all`), a render slot in `render.ts` showing either the
   narrative or the visible fallback notice. `npm run ci` green (`b70470b`).
5. **Docs.** `STATUS.md` update; fold this note's "draft" status to
   "locked, implemented" once all four commits land and `npm run ci` is
   green.

Expected to span multiple sessions (`claude/RUNBOOK.md` session hygiene —
one phase per session), not one sitting.

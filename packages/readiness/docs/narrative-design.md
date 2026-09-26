# report/narrative.ts — design note (draft plan, not implemented)

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

5. **Every claim must cite at least one id.** `groundedIn` (an array of
   `MetricId`/`CapabilityId` values) must be non-empty on every claim; no
   free-floating connective sentences. An id that doesn't exist in the
   `ReportData` passed to the model fails the claim.

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
3. **`narrative.ts` orchestration.** Builds the prompt input from
   `ReportData`, calls the client, validates, falls back with the visible
   reason from decision 9 — fully testable via the fake client from
   commit 1.
4. **CLI/render wiring.** Opt-in `--narrative` flag in `cli.ts` (default
   off), a render slot showing either the narrative or the visible
   fallback notice.
5. **Docs.** `STATUS.md` update; fold this note's "draft" status to
   "locked, implemented" once all four commits land and `npm run ci` is
   green.

Expected to span multiple sessions (`claude/RUNBOOK.md` session hygiene —
one phase per session), not one sitting.

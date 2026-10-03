# Project status

Current state of the GTM trust kernel, as of 2026-10-03. The dated history
behind it (decisions, measurements, earlier states) is in
[dev-log.md](dev-log.md); code comments that cite "STATUS.md" for a known
gap or decision refer to that log.

## Packages

| Package | npm | Published | Next (unreleased, not yet packed) |
|---|---|---|---|
| CLI | `gtm-trust-kernel` | 0.1.0 | 0.2.0 |
| CRM adapters | `@gtm-trust-kernel/adapters` | 0.2.0 | 0.2.1 |
| Readiness report | (private, bundled into the CLI) | | |
| Proposal kernel | (private) | | |

## What works

- **Readiness report.** Scores CRM data on seven dimensions (coverage,
  freshness, consistency, history, cross-system matching, text quality,
  outcome labels) and gives each AI use case a verdict: viable, degraded,
  blocked or not measured, with the metrics and thresholds behind it.
  Writes a detailed HTML report and a plain-English one; an optional
  AI-written summary (`--narrative`) sends only metric names, values and
  ratings to Anthropic's API, and only with consent: a prompt in a
  terminal, or `--narrative-consent` for unattended runs. Answering no
  writes the report without the summary. `--narrative-preview` prints the
  exact request and sends nothing. Each report's banner states what left
  the machine. A live report leaves out the org hostname unless
  `--show-org` is passed. The whole data flow is in
  [docs/DATA-FLOW.md](../../../docs/DATA-FLOW.md).
- **CLI from npm.** `npx gtm-trust-kernel scan --demo` runs the report on a
  bundled sample CRM with no credentials or network. 0.2.0 adds a verdict
  summary, `--verbose`, one-line usage errors, and `--fail-on` for CI (exit
  2 on a listed verdict).
- **Salesforce, read-only.** The adapter reads deals, contact roles,
  accounts, contacts, Tasks, Events, Notes, Enhanced Notes and stage
  history, batched by deal id (12 API calls for a 35-deal org). It cannot
  write. The access token is cached in the user's config folder, owner-only
  on macOS and Linux. The full report runs against a real org from a repo clone
  (`npm run report -- --live`); see [salesforce-setup.md](salesforce-setup.md).
  It has no health preflight and doesn't retry a rate limit (429) yet.
- **Adapter contract.** The mock and Salesforce adapters pass one shared
  contract suite; Salesforce passes it against a live Developer Edition
  org, re-run weekly in CI (`live-contract.yml`). A response-shape
  contract checks the fake Salesforce API against what the adapter reads.
- **Proposal kernel.** Evidence-cited, human-approved field writes with
  concurrency checks, rollback and a hash-chained audit ledger.
- **CI.** Typecheck and about 700 tests on every push (`npm run ci` removes
  any `dist/` first), plus a packed-tarball lint of both npm packages
  (publint, arethetypeswrong).

## Known gaps

- **Thresholds are provisional.** They are not yet calibrated against real
  orgs (Phase 4).
- **Salesforce:**
  - activity capture is declared (`SF_ACTIVITY_CAPTURE`), not detected;
  - activities logged only against a deal's contacts aren't counted;
  - Enhanced Notes and the custom-stage notice are unit-tested but not yet
    seen on a live org;
  - paged child results (a subquery's `nextRecordsUrl`) are covered only
    by doc-based fake tests: on the live org a 201-row child result came
    back on one page;
  - `CurrencyIsoCode` isn't read, so deal currency is unset.
- **Not built yet:** the `untrusted_text_ratio` metric (Phase 4); live
  scanning from the published CLI.
- **Trust kernel:** the injection guard is a phrase list plus a canary
  token, with no red-team corpus; the audit ledger is in memory and not
  anchored externally; writes are per field, not atomic per record; an
  approver's role isn't checked.

The full list, with the reasoning behind each item, is in
[dev-log.md](dev-log.md) ("Known Gaps" and "Open questions").

## Releases

Releases are published from GitHub Actions with npm trusted publishing;
the steps are in [RELEASING.md](../../../RELEASING.md). Adapters 0.2.1 and
CLI 0.2.0 are not packed yet: the tarballs prepared on 2026-10-02 are
invalidated by the privacy batch (2026-10-03), and the reliability batch
changes the adapters again, so both are packed once, after it. Publishing
also waits on the repository becoming public (`publish.yml` publishes
with `--provenance`, which npm accepts only from a public repository, as
far as is known).

**Backup repositories.** The repository's history was rewritten on
2026-10-03. Two private backup repositories,
`pretzelslab/gtm-trust-kernel-pre-rewrite` and
`pretzelslab/gtm-trust-kernel-old`, still hold history from before the
rewrite. They must stay private: never make them public, transfer them,
or publish from them. The same applies to the local mirror and bundle
backups. Published 0.1.0 and adapters 0.2.0 `gitHead` values point at
pre-rewrite commits and don't resolve in this repository.

## Next

Before going public:

1. **Reliability batch** (adapters): a health preflight before a live
   scan (L5) and retry with backoff on a 429 rate limit (L6).
2. **README story:** finish the plain-English README.
3. **Demo kit:** a `demo:kernel` script, committed sample reports and a
   walkthrough.
4. **Re-pack** adapters 0.2.1 and CLI 0.2.0 once (new shasums, file
   lists and changelogs), with a clean-room install check.
5. **Go public**, then switch on private vulnerability reporting, secret
   scanning with push protection, Dependabot alerts and a ruleset for
   `master`. Then publish adapters 0.2.1, then CLI 0.2.0.

After that:

1. **Phase 4:** calibrate thresholds against real orgs, and build
   `untrusted_text_ratio`.
2. Later: live scanning in the CLI, an `--out` flag, an approver role
   check, per-record atomic writes, an injection test corpus, an
   evaluation harness, a HubSpot adapter.

# Project status

Current state of the GTM trust kernel, as of 2026-10-02. The dated history
behind it (decisions, measurements, earlier states) is in
[dev-log.md](dev-log.md); code comments that cite "STATUS.md" for a known
gap or decision refer to that log.

## Packages

| Package | npm | Published | Prepared, not yet published |
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
  ratings to Anthropic's API.
- **CLI from npm.** `npx gtm-trust-kernel scan --demo` runs the report on a
  bundled sample CRM with no credentials or network. 0.2.0 adds a verdict
  summary, `--verbose`, one-line usage errors, and `--fail-on` for CI (exit
  2 on a listed verdict).
- **Salesforce, read-only.** The adapter reads deals, contact roles,
  accounts, contacts, Tasks, Events, Notes, Enhanced Notes and stage
  history, batched by deal id (12 API calls for a 35-deal org). It cannot
  write. The full report runs against a real org from a repo clone
  (`npm run report -- --live`); see [salesforce-setup.md](salesforce-setup.md).
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
the steps are in [RELEASING.md](../../../RELEASING.md). Adapters 0.2.1
(shasum `1393045e2578cebbcf08f75d4c06d7e112c92ce5`) and CLI 0.2.0 (shasum
`c34f62472d87f299e1185e650b056156056e10c3`) are prepared and waiting on the
repository becoming public (`publish.yml` publishes with `--provenance`,
which npm accepts only from a public repository, as far as is known).

## Next

1. Make the repository public; publish adapters 0.2.1, then CLI 0.2.0.
2. **Phase 4:** calibrate thresholds against real orgs, and build
   `untrusted_text_ratio`.
3. Later: live scanning in the CLI, an `--out` flag, an approver role
   check, per-record atomic writes, an injection test corpus, an
   evaluation harness, a HubSpot adapter.

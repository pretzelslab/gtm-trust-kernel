# Project status

Current state of the GTM trust kernel, as of 2026-10-03. The dated history
behind it (decisions, measurements, earlier states) is in
[dev-log.md](dev-log.md); code comments that cite "STATUS.md" for a known
gap or decision refer to that log.

## Packages

| Package | npm | Published | Packed, not yet published |
|---|---|---|---|
| CLI | `gtm-trust-kernel` | 0.1.0 | 0.2.0 |
| CRM adapters | `@gtm-trust-kernel/adapters` | 0.2.0 | 0.3.0 |
| Readiness report | (private, bundled into the CLI) | | |
| Proposal kernel | (private) | | |
| Demo kit | (private, never published) | | |

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
- **Decision view.** Both reports open with an "At a glance" section: data
  health by CRM object, the four use-case counts, a ranked "Fix this
  first" list (plain action, object, likely owner, use cases held back), a
  card per use case with each check's value against its pass and weak
  lines, and a use-case by object grid. It reuses the existing verdicts
  and thresholds, adds no score, sends nothing new to the AI summary, and
  leaves the `--all` comparison page unchanged. Checks that need a second
  system are left out of the object counts when none is connected; Contact
  then shows as a greyed "needs a second system" row. A jump bar under
  the title links to the five numbered parts and to a "Details" band
  holding the rest of each report (sticky at 720 px and wider; pages at
  most 1100 px wide). The use-case cards are grouped by verdict with
  counts; ready cards fold to "All N checks pass" and other cards fold
  their passing checks. Code:
  `packages/readiness/src/report/decisionView/`.
- **CLI from npm.** `npx gtm-trust-kernel scan --demo` runs the report on a
  bundled sample CRM with no credentials or network. 0.2.0 adds a verdict
  summary, `--verbose`, one-line usage errors, and `--fail-on` for CI (exit
  2 on a listed verdict; `blocked` also matches anything the plain report
  shows as "Not ready yet").
- **Salesforce, read-only.** The adapter reads deals, contact roles,
  accounts, contacts, Tasks, Events, Notes, Enhanced Notes and stage
  history, batched by deal id (12 API calls for a 35-deal org). It cannot
  write. The access token is cached in the user's config folder, owner-only
  on macOS and Linux. The full report runs against a real org from a repo clone
  (`npm run report -- --live`); see [salesforce-setup.md](salesforce-setup.md).
- **Live-run reliability.** Before any read, a preflight checks sign-in,
  the API version and read access to every object and field the report
  uses; a problem stops the run with one line each. Note objects the
  Run As user can't read are warnings, and the note metrics are then
  marked not measured. A rate limit (429), a 503 or a concurrent-request
  limit is retried with backoff (4 attempts, 60 s of waiting at most);
  the org's daily limit stops the run at once. The plan uses the org's
  own calls left today (`Sforce-Limit-Info`), keeps 10% of the daily
  maximum for the org's other tools, refuses to start a run that doesn't
  fit, and stops a run that reaches the reserve. `.env` is read from the
  folder the report is run from, else the repo root.
- **Adapter contract.** The mock and Salesforce adapters pass one shared
  contract suite; Salesforce passes it against a live Developer Edition
  org, re-run weekly in CI (`live-contract.yml`). A response-shape
  contract checks the fake Salesforce API against what the adapter reads.
- **Proposal kernel.** Evidence-cited, human-approved field writes with
  concurrency checks, rollback and a hash-chained audit ledger.
- **Demo kit.** `npm run demo:kernel` follows one GTM motion on the
  bundled sample CRM, from the scan verdict to an approval-gated change,
  including the Enhanced Notes not-measured path. Committed samples and
  screenshots are in `docs/demo/`; the walkthrough is
  [docs/DEMO.md](../../../docs/DEMO.md).
- **CI.** Typecheck and about 930 tests on every push (`npm run ci` removes
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
  - the maintainer's live org has no `ContentNote` access, on purpose: it
    shows the not-measured path for Enhanced Notes (salesforce-setup.md,
    section 3);
  - network errors (a dropped connection) aren't retried, only rate limits
    and 503s;
  - paged child results (a subquery's `nextRecordsUrl`) are covered only
    by doc-based fake tests: on the live org a 201-row child result came
    back on one page;
  - `CurrencyIsoCode` isn't read, so deal currency is unset.
- **`untrusted_text_ratio` is built** (`textSubstrate.ts`), computed on
  every run, and gates fully automatic CRM updates. Open question: on
  Salesforce every Task and Event counts as external text, because stock
  Salesforce has no reliable inbound/outbound signal; whether logged calls
  and meetings can count as user-authored is undecided (Phase 4).
- **Not built yet:** live scanning from the published CLI.
- **Trust kernel:** the injection guard is a phrase list plus a canary
  token, with no red-team corpus; the audit ledger is in memory and not
  anchored externally; writes are per field, not atomic per record; an
  approver's role isn't checked.

The full list, with the reasoning behind each item, is in
[dev-log.md](dev-log.md) ("Known Gaps" and "Open questions").

## Releases

Releases are published from GitHub Actions with npm trusted publishing;
the steps are in [RELEASING.md](../../../RELEASING.md). **Adapters 0.3.0
and CLI 0.2.0 were re-packed on 2026-10-04** (versions bumped, CLI range
`^0.3.0`, lockfile, changelogs) and are not tagged or published. Publishing
waits on the repository becoming public (`publish.yml` publishes with
`--provenance`, which npm accepts only from a public repository, as far as
is known), and must be dispatched from the release tag, not `master`.

Pack check (`npm pack --dry-run` in each package folder, after a clean
`npm run ci`; the tarballs built for the clean-room install had the same
shasums). Re-packed after the report sections change (5158a15): the
adapters tarball is byte-identical, only the CLI shasum changed:

| Package | Tarball | Files | Size (packed / unpacked) | shasum |
|---|---|---|---|---|
| `@gtm-trust-kernel/adapters` | 0.3.0 | 24 | 60.3 kB / 229.2 kB | `59cd85dc00821587025c9cf32cda12f88ccc4e49` |
| `gtm-trust-kernel` | 0.2.0 | 7 | 57.8 kB / 218.9 kB | `4b443488414f5b5885871f04f2ab12394b180f02` |

Adapters 0.3.0 files: `CHANGELOG.md`, `LICENSE`, `README.md`,
`package.json`, and under `dist/src/`: `mock`, `retry`, `salesforce`,
`tokenCache`, `types` (each `.js` + `.d.ts`) and `model/canonical`,
`model/trust`; under `dist/test/`: `contract/adapter.contract`,
`contract/secondSource.contract`, `fixtures` (each `.js` + `.d.ts`).
CLI 0.2.0 files: `CHANGELOG.md`, `LICENSE`, `README.md`, `package.json`,
`dist/cli.js`, `dist/chunk-PQV3VBQU.js`,
`dist/anthropicNarrativeModelClient-XPRGRPJG.js`.

`npm run lint:pack` passes (publint and arethetypeswrong; the CommonJS
rows are ignored because both packages are ESM-only). Clean-room check:
both tarballs installed together in an empty folder outside the repository
(`npm install` of the two `.tgz` files); `npm ls` shows adapters 0.3.0
under CLI 0.2.0, `gtm-trust-kernel --version` prints 0.2.0, and
`gtm-trust-kernel scan --demo` writes both reports with the jump bar, the
five numbered "At a glance" parts and the "Details" band, and prints "4 ready, 3 use with caution, 1 not ready".

If any file under a package folder, or a version, changes after this
point, the shasums above are stale: re-run the pack check.

**Backup repositories.** The repository's history was rewritten on
2026-10-03. Two private backup repositories,
`pretzelslab/gtm-trust-kernel-pre-rewrite` and
`pretzelslab/gtm-trust-kernel-old`, still hold history from before the
rewrite. They must stay private: never make them public, transfer them,
or publish from them. The same applies to the local mirror and bundle
backups. Published 0.1.0 and adapters 0.2.0 `gitHead` values point at
pre-rewrite commits and don't resolve in this repository. The tags
`adapters-v0.1.0`, `adapters-v0.2.0` and `cli-v0.1.0` mark the released
content on the rewritten history; npm's `gitHead` for those versions
points to pre-rewrite commits.

## Next

Before going public:

1. **README story:** done, merged to `master` (PR #5, `f1219f7`); see the
   dev log, 2026-10-03.
2. **Demo kit:** done (`packages/demo`, `docs/demo/`, `docs/DEMO.md`);
   see the dev log, 2026-10-03.
3. **Re-pack:** done 2026-10-04 (see Releases); not tagged.
4. **Go public**, then switch on private vulnerability reporting, secret
   scanning with push protection, Dependabot alerts and a ruleset for
   `master` with a repository-admin bypass (RELEASING.md, "Repository
   settings"). Then tag and publish adapters 0.3.0, then CLI 0.2.0, each
   dispatched from its tag.
5. **Terminal recording** of the demo (GIF or similar), after the
   re-pack, so it shows the released CLI and package versions.

The reliability batch (L3, L5, L6, L10) is done; see the dev log,
2026-10-03.

After that:

1. **Phase 4:** calibrate thresholds against real orgs, and settle how
   `untrusted_text_ratio` treats Salesforce activities.
2. Later: live scanning in the CLI, an `--out` flag, an approver role
   check, per-record atomic writes, an injection test corpus, an
   evaluation harness, a HubSpot adapter.

### Next-release backlog

- One-screen executive summary at the top: N of 8 use cases supported; top
  2 fixes and how many use cases they unlock; built only from existing
  data.

### Phase 5 backlog (objects not scanned yet)

The decision view lists these as greyed "not scanned yet" rows, in this
order. No check, adapter read or threshold exists for any of them.

- Leads
- Quotes
- Products / line items
- Campaigns
- Territories / targets

### Phase 5 backlog (candidate checks, not scoped)

From the README's "One data spine, every GTM motion" table. Titles only;
none is designed, and none touches `rubric.ts` until it is.

- Line-item coverage
- Parent-account linkage
- Product × account coverage
- Geo field completeness
- Industry consistency
- Firmographic completeness
- Target account list coverage
- Partner attribution on deals
- Renewal and contract dates
- Churn and loss reason capture

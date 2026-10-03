# gtm-trust-kernel

[![npm](https://img.shields.io/npm/v/gtm-trust-kernel)](https://www.npmjs.com/package/gtm-trust-kernel)
[![ci](https://github.com/pretzelslab/gtm-trust-kernel/actions/workflows/ci.yml/badge.svg?branch=master)](https://github.com/pretzelslab/gtm-trust-kernel/actions/workflows/ci.yml)
[![license: MIT](https://img.shields.io/badge/license-MIT-blue)](https://github.com/pretzelslab/gtm-trust-kernel/blob/master/LICENSE)

**Find out whether your CRM data is good enough for AI, before you roll AI
out.**

A command-line readiness report for sales CRM data. It checks whether the
data is complete, consistent and recent enough to support specific AI use
cases (pipeline risk alerts, close-date checks, account briefs, forecast
support, automatic CRM updates) and says, for each one, ready, use with
caution, or not ready, with the metrics behind every verdict.

## Who it's for

- **RevOps, sales ops and GTM leaders** who want a quick, evidence-backed
  read on CRM data quality before an AI rollout.
- **Developers** wiring a readiness gate into CI (`--fail-on`) or
  evaluating the [GTM trust kernel](https://github.com/pretzelslab/gtm-trust-kernel).

## What runs from npm today, and what doesn't

- **From npm (this package): the demo scan only.** `scan --demo` runs the
  full report on a built-in sample CRM. No account, no credentials, no
  network calls.
- **Scanning your own Salesforce org is not in this CLI yet.** It runs
  from a clone of the repo (`npm run report -- --live`); see
  [Salesforce setup](https://github.com/pretzelslab/gtm-trust-kernel/blob/master/packages/readiness/docs/salesforce-setup.md).
  That path is read-only: it never writes to your CRM.

## Try it in 60 seconds

Requires Node.js 22 or newer.

```bash
npx gtm-trust-kernel scan --demo
```

```text
Demo scan of sample CRM data ("Healthy"): 4 ready, 3 use with caution, 1 not ready.
Open out/latest-plain.html for the plain-English report (full detail: out/latest.html).
```

Open `out/latest-plain.html` in a browser. An abridged excerpt:

```text
Ready to use
  Pipeline risk alerts: stalled, silent or slipping deals can be flagged automatically.
  Close-date reality checks: deals with unrealistic or already-passed close dates can be flagged.
Usable with caution
  AI-generated account briefs: account summaries can be generated, but with thinner supporting
  evidence than ideal. Right now, notes and activity text aren't detailed enough.
Not ready yet
  Fully automatic CRM updates with no human check: AI should not write to the CRM without
  a person checking every change yet.
```

`out/latest.html` has the full detail: every metric, its threshold, the
sample sizes and the seed.

## Usage

```
gtm-trust-kernel scan --demo [--narrative [--narrative-consent]] [--json] [--verbose] [--fail-on [<verdicts>]]
gtm-trust-kernel scan --demo --narrative-preview
gtm-trust-kernel --version
gtm-trust-kernel --help
```

| Option | What it does |
|---|---|
| `--json` | Print the report data as JSON to stdout; everything else goes to stderr, so it pipes cleanly |
| `--verbose` | Also print the sampling plan and every file written |
| `--narrative` | Add an AI-written summary. Needs `ANTHROPIC_API_KEY`, and sends metric names, values and ratings (never record text) to Anthropic's API. Asks before sending; answering no runs the scan without it |
| `--narrative-consent` | With `--narrative`: consent up front, for runs with no terminal to answer the prompt (CI, scripts). Without it, such a run exits 1 before sending anything |
| `--narrative-preview` | Print the exact request `--narrative` would send, then exit. Sends nothing, writes no report, needs no key |
| `--fail-on [<verdicts>]` | Exit 2 if any capability has a listed verdict (see below). Off by default |

Each run writes to `./out`: `latest.html` and `latest-plain.html`, plus
timestamped copies so runs don't overwrite each other.

### `--fail-on` (for CI)

Opt-in. The value is a comma-separated list of `blocked`, `degraded` and
`not_measured`; a bare `--fail-on` means `blocked`. `not_measured` counts
only when you list it. The report is always written first; then the exit
code is 2 if any capability has a listed verdict, and the failing ones are
named on stderr. `--fail-on` works on the raw verdicts shown in
`latest.html`.

```bash
npx gtm-trust-kernel scan --demo --fail-on                    # fail on blocked
npx gtm-trust-kernel scan --demo --fail-on blocked,degraded
```

### Exit codes

| Code | Meaning |
|---|---|
| 0 | Report written; no capability matched `--fail-on`, or `--fail-on` is unset |
| 1 | Error: bad usage (unknown flag, invalid `--fail-on` value) or the scan failed |
| 2 | Report written; at least one capability matched `--fail-on` |

## Limitations

- Demo data only from npm (see above); Salesforce is the only CRM the
  repo can scan so far.
- The verdict thresholds are provisional, not yet calibrated against many
  real orgs.
- ESM-only Node.js package (it's a CLI, so this only matters if you import
  its internals, which aren't a public API).

## More

- [Changelog](https://github.com/pretzelslab/gtm-trust-kernel/blob/master/packages/cli/CHANGELOG.md)
- [Security policy](https://github.com/pretzelslab/gtm-trust-kernel/blob/master/SECURITY.md)
- [How the report works](https://github.com/pretzelslab/gtm-trust-kernel#how-to-read-the-report)
- [`@gtm-trust-kernel/adapters`](https://www.npmjs.com/package/@gtm-trust-kernel/adapters): the CRM adapter library underneath

## License

MIT

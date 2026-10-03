# gtm-trust-kernel

[![npm](https://img.shields.io/npm/v/gtm-trust-kernel)](https://www.npmjs.com/package/gtm-trust-kernel)
[![ci](https://github.com/pretzelslab/gtm-trust-kernel/actions/workflows/ci.yml/badge.svg?branch=master)](https://github.com/pretzelslab/gtm-trust-kernel/actions/workflows/ci.yml)
[![license: MIT](https://img.shields.io/badge/license-MIT-blue)](https://github.com/pretzelslab/gtm-trust-kernel/blob/master/LICENSE)

**CRM Data Readiness Scan. Faster, cleaner deals start with CRM data your
sellers can trust.**

Revenue outcome ← seller decision ← AI assist ← CRM data ← this scan. It
checks your data, not the AI tools, and doesn't measure revenue outcomes.

A command-line readiness report for sales CRM data. It checks whether the
data is complete, consistent and recent enough to support specific AI use
cases (account briefs, forecast support, pipeline risk alerts, close-date
checks, automatic CRM updates) and gives each one a verdict, with the
metrics behind it.

## Who it's for

- **RevOps, sales ops and GTM leaders** who want a quick, evidence-backed
  read on CRM data quality before an AI rollout.
- **Developers** wiring a readiness gate into CI (`--fail-on`) or
  evaluating the [GTM trust kernel](https://github.com/pretzelslab/gtm-trust-kernel).

## What it isn't

- **An AI tool evaluator.** It doesn't compare or score AI vendors or
  models.
- **A data cleaner.** It reads and reports. It doesn't fix records.
- **A way for your data to leave your machine.** The only thing that can
  be sent anywhere is the optional AI summary (`--narrative`), which sends
  metric names and values, never record text, and only after you say yes.

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

### Verdict words

The plain-English report (`latest-plain.html`) and the scan summary use
plain words. The detailed report (`latest.html`), `--json` and
`--fail-on` use the raw verdicts.

| Plain report | Raw verdict | Meaning |
|---|---|---|
| Ready to use | `viable` | Every check the use case depends on passes |
| Usable with caution | `degraded` | It can run, on thinner evidence than ideal |
| Not ready yet | `blocked` | Data it needs is missing or poor |
| Can't tell yet | `not_measured` | The scan can't see the data it would need |

One exception: fully automatic CRM updates is shown as **Not ready yet**
when its raw verdict is `degraded` or `not_measured`, because AI writing
to the CRM needs a person to check every change. `--fail-on` uses the raw
verdict, so on the demo data a bare `--fail-on` exits 0 even though the
plain report lists one use case as not ready. Use
`--fail-on blocked,degraded` to catch it.

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

## Help calibrate the thresholds

If you scan a real org, you can help calibrate the thresholds by sharing
anonymised scores, never data:
[share your scores](https://github.com/pretzelslab/gtm-trust-kernel/issues/new?template=calibration-scores.yml).
The form only offers fixed choices.

## More

- [Changelog](https://github.com/pretzelslab/gtm-trust-kernel/blob/master/packages/cli/CHANGELOG.md)
- [Security policy](https://github.com/pretzelslab/gtm-trust-kernel/blob/master/SECURITY.md)
- [How the report works](https://github.com/pretzelslab/gtm-trust-kernel#how-to-read-the-report)
- [`@gtm-trust-kernel/adapters`](https://www.npmjs.com/package/@gtm-trust-kernel/adapters): the CRM adapter library underneath

## License

MIT

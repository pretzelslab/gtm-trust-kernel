# Changelog

All notable changes to `gtm-trust-kernel` (the CLI).

## 0.2.0

### Changed

- Both single-org reports have a jump bar under the title (Data health,
  Counts, Fixes, Use cases, Grid, Details); it stays at the top of the
  window on screens 720 px and wider. The five "At a glance" parts are
  numbered cards with a one-line explanation each, the rest of the report
  sits under a "Details" heading, pages are at most 1100 px wide, and the
  `latest.html` tables scroll sideways on narrow screens. The `--all`
  comparison page is unchanged.

### Added

- An "At a glance" decision view at the top of both reports (the
  plain-English report and `latest.html`): data health by CRM object, the
  use-case counts, a ranked "Fix this first" list with a plain action,
  object and likely owner for each check, a card per use case with each
  check's value against its pass and weak lines, and a use case by object
  grid. It uses the same verdicts and thresholds as the rest of the report
  and adds no score. Use cases are grouped by verdict, and checks that one
  adapter setting unlocks share a single "Fix this first" row. Inline HTML and SVG only; the report still works
  offline. The `--all` comparison page is unchanged.
- `--fail-on [<verdicts>]`: exit 2 when any capability has a listed
  verdict (`blocked`, `degraded`, `not_measured`; a bare `--fail-on` means
  `blocked`), after the report is written. Off by default. `blocked` also
  matches anything the plain report shows as "Not ready yet" (fully
  automatic CRM updates when degraded or not measured), so the gate and
  the plain report agree; on the demo data a bare `--fail-on` exits 2.
- A verdict summary after each scan ("4 ready, 3 use with caution, 1 not
  ready", the same groups as the plain-English report) and which file to
  open.
- `--verbose`: also print the sampling plan and every file written.
- `--narrative-preview`: print the exact request `--narrative` would send
  to Anthropic's API, then exit. Sends nothing, writes no report and needs
  no API key.

### Changed

- The sampling plan is no longer printed by default (see `--verbose`).
- Bad usage (an unknown flag, `scan` without `--demo`, an invalid
  `--fail-on` value) prints one line and the usage text and exits 1,
  instead of a stack trace. Other failures print their message only.
- The Anthropic SDK is loaded only when `--narrative` is passed.
- The plain-English report calls the enablement use case "pitch and
  objection-handling answers" (was "answers drawn from past deals"). The
  detailed report and `--json` are unchanged.
- Depends on `@gtm-trust-kernel/adapters` `^0.3.0` (set when this
  release is packed). `scan --demo` behaves the same.
- **Breaking for unattended runs:** `--narrative` now asks for consent
  before sending anything to Anthropic's API. In a terminal it prompts
  (default no); with no terminal (CI, scripts) it exits 1 unless
  `--narrative-consent` is passed. The API key is still checked first.
  Answering no runs the scan without the AI summary (the deterministic
  summary, as without `--narrative`), writes the report and exits 0.
- Dependencies: `@gtm-trust-kernel/adapters` `^0.3.0`; `@anthropic-ai/sdk`
  and `tldts` use caret ranges instead of exact pins.

## 0.1.0

First release: `scan --demo` (the readiness report on a bundled sample
CRM, written to `./out` as HTML), `--json` and `--narrative`.

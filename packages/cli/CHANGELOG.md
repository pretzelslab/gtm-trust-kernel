# Changelog

All notable changes to `gtm-trust-kernel` (the CLI).

## 0.2.0 (unreleased)

### Added

- `--fail-on [<verdicts>]`: exit 2 when any capability has a listed
  verdict (`blocked`, `degraded`, `not_measured`; a bare `--fail-on` means
  `blocked`), after the report is written. Off by default.
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
- Dependencies: `@gtm-trust-kernel/adapters` `^0.2.1`; `@anthropic-ai/sdk`
  and `tldts` use caret ranges instead of exact pins.

## 0.1.0

First release: `scan --demo` (the readiness report on a bundled sample
CRM, written to `./out` as HTML), `--json` and `--narrative`.

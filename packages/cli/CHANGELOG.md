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

### Changed

- The sampling plan is no longer printed by default (see `--verbose`).
- Bad usage (an unknown flag, `scan` without `--demo`, an invalid
  `--fail-on` value) prints one line and the usage text and exits 1,
  instead of a stack trace. Other failures print their message only.
- The Anthropic SDK is loaded only when `--narrative` is passed.
- Dependencies: `@gtm-trust-kernel/adapters` `^0.2.1`; `@anthropic-ai/sdk`
  and `tldts` use caret ranges instead of exact pins.

## 0.1.0

First release: `scan --demo` (the readiness report on a bundled sample
CRM, written to `./out` as HTML), `--json` and `--narrative`.

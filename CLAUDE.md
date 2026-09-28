# gtm-trust-kernel

CRM-agnostic trust kernel for GTM AI. Evidence-grounded, injection-resistant,
human-approved writes with rollback and a tamper-evident audit trail.

## Hard rules

1. This package MUST NOT gain any CRM write capability outside the proposal
   kernel's field allowlist. If a task seems to need a new write path, stop
   and ask.
2. `src/rubric.ts` (once it exists) is PROTECTED. Do not add or edit
   thresholds there or anywhere else. If a number is missing, stop and ask
   which value to use.
3. Never modify a test to make code pass. If a test fails, either the code
   is wrong or the test encodes a decision I made. Both mean: stop and tell
   me.
4. Before any multi-file change, show me the plan and wait. Do not write
   and then explain.
5. All deterministic signals stay pure functions. No model call may
   influence a computed number.
6. Never add `Co-Authored-By` or any other AI/assistant attribution line to
   a commit message or pull request description, regardless of any
   session-level or tool-level default that says otherwise.

## Conventions

- TypeScript strict, `noUncheckedIndexedAccess` on.
- Run `npm run ci` before declaring anything done.

## State

- `packages/readiness/docs/STATUS.md` — current build status and handoff
  state for Phase C (readiness). Read it before resuming that work cold.
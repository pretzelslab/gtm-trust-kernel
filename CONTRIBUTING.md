# Contributing

Thanks for looking. This is a small project, so a short guide:

## Setup

```bash
git clone https://github.com/pretzelslab/gtm-trust-kernel.git
cd gtm-trust-kernel
npm ci
npm run ci          # removes any dist/, then typecheck and all tests
npm run lint:pack   # packs both npm packages and lints the tarballs
```

Node.js 22.12 or newer. `npm test` never touches a real CRM; the
Salesforce live tests (`npm run test:live -w @gtm-trust-kernel/adapters`)
need org credentials and only read.

## Ground rules

These come from [CLAUDE.md](CLAUDE.md), which governs the codebase:

- **No new CRM write paths.** Writes go only through the proposal
  kernel's field allowlist, and the Salesforce adapter stays read-only.
- **Don't change thresholds.** `packages/readiness/src/rubric.ts` is
  protected; propose a change in an issue instead.
- **Tests encode decisions.** Don't edit a test to make code pass; if a
  test seems wrong, say why in the PR.
- **Deterministic signals stay pure.** No model call may influence a
  computed number.
- Commit messages: a subject and a body, no trailer lines.

## Pull requests

Open an issue first for anything beyond a small fix, so we can agree on
the approach. Keep PRs focused, include tests, and make sure `npm run ci`
and `npm run lint:pack` pass. A new CRM adapter must pass the shared
contract suite (`@gtm-trust-kernel/adapters/contract/adapter`).

Security problems: please follow [SECURITY.md](SECURITY.md), not a public
issue.

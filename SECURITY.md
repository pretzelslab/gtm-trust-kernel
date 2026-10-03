# Security policy

## Reporting a vulnerability

Please report security problems privately, not in a public issue: use
GitHub's **Report a vulnerability** button on this repository's
**Security** tab. Include what you found, how to reproduce it, and which
package and version are affected. You'll get an acknowledgement, and a fix
or a decision, as soon as the maintainer can manage; this is a small
open-source project, not a commercial service with a response-time SLA.

## Supported versions

Only the latest published version of each package
(`@gtm-trust-kernel/adapters`, `gtm-trust-kernel`) gets fixes.

## What this project guarantees, and where the edges are

- **Read-only CRM access.** The Salesforce adapter cannot write to
  Salesforce: `capabilities().writeGranularity` is `'none'` and
  `applyFieldWrite()` always returns `rejected` without calling the API.
  The readiness report and the CLI only read.
- **Credentials stay where you put them.** Salesforce credentials are read
  from environment variables (or a local `.env` you create); they are never
  logged, written to the reports, or included in the published packages.
  The access token is cached on disk at `SF_TOKEN_CACHE_PATH` (by default
  inside the adapters package folder); treat that file like a password.
- **The demo makes no network calls.** `npx gtm-trust-kernel scan --demo`
  runs on bundled sample data.
- **`--narrative` is the only data that leaves your machine,** and only
  when you pass it and consent (at a prompt, or with
  `--narrative-consent`): metric names, values, sample sizes and ratings
  go to Anthropic's API. Record text (notes, emails, names) is never sent.
  `--narrative-preview` prints the exact request without sending it.
- **CRM free text is untrusted.** Notes and activity text are carried in a
  trust envelope and treated as data, never as instructions. The injection
  guard is basic (a phrase list plus a canary token); see "Known gaps" in
  the README.

## Releases

Packages are published from GitHub Actions with npm trusted publishing;
see [RELEASING.md](RELEASING.md).

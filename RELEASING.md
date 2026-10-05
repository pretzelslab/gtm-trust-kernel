# Releasing

Two packages are published to npm from this repo:

| Input | npm package | Folder | Tag |
|---|---|---|---|
| `adapters` | `@gtm-trust-kernel/adapters` | `packages/adapters` | `adapters-v<version>` |
| `cli` | `gtm-trust-kernel` | `packages/cli` | `cli-v<version>` |

Releases go through the `publish` workflow (`.github/workflows/publish.yml`)
with npm **trusted publishing**: GitHub Actions proves its identity to
npm over OIDC, so there is no npm token and no `npm login`, and every
release carries a provenance attestation.

## One-time setup on npmjs.com (per package)

Do this once for **each** package, `@gtm-trust-kernel/adapters` and
`gtm-trust-kernel`, signed in as a maintainer:

1. Open the package on npmjs.com, then **Settings**.
2. Under **Trusted Publisher**, choose **GitHub Actions**.
3. Organization or user: `pretzelslab`. Repository: `gtm-trust-kernel`.
   Workflow filename: `publish.yml`. Environment: the package's input
   name, `adapters` or `cli`. It must match the GitHub environment that
   `publish.yml` runs in (`environment: ${{ inputs.package }}`), or npm
   rejects the publish.
4. Save.

Until this is done for a package, the workflow's publish step fails for
it with an authentication error; nothing else changes.

## Release steps

1. **Bump the version** in the package's `package.json`. For the CLI, also
   check its `@gtm-trust-kernel/adapters` range covers the adapters
   version it needs, and publish adapters first if that version is new.
   Run `npm install --package-lock-only` so the lockfile follows.
2. **Changelog.** Add the version's entry to the package's `CHANGELOG.md`
   (breaking changes for adapter authors listed separately).
3. **Check the tarball:** `npm pack --dry-run` in the package folder. Note
   the file list and the `shasum`.
4. **Commit and push** (`npm run ci` first), and wait for CI to pass.
5. **Tag the release commit** and push the tag:

   ```bash
   git tag -a adapters-v0.3.0 -m "@gtm-trust-kernel/adapters 0.3.0"
   git push origin adapters-v0.3.0
   ```

6. **Dispatch the workflow from the tag, not from `master`.** The
   `adapters` and `cli` environments only accept deployments from their own
   tags (`adapters-v*`, `cli-v*`; see "Repository settings" below), so a run
   dispatched from `master` is blocked at the environment gate. In GitHub:

   1. Actions, then **publish** in the left list, then **Run workflow**.
   2. **Use workflow from:** open the dropdown, switch to the **Tags** tab
      and pick the release tag (`adapters-v0.3.0` for adapters,
      `cli-v0.2.0` for the CLI). Not Branch: master.
   3. **Package to publish:** `adapters` or `cli`, matching the tag.
   4. Run workflow, open the run, and approve the environment's required
      reviewer prompt.

   Or from the command line:

   ```bash
   gh workflow run publish.yml --ref adapters-v0.3.0 -f package=adapters
   ```

   Dispatching adapters from the `cli-v*` tag (or the reverse) fails the
   environment's tag rule. It publishes the code at the tag, not the branch head. It refuses to
   publish if the tag doesn't exist, if the tag's `package.json` has a
   different version, or if that version is already on npm. It runs
   `npm ci` and `npm run ci` before `npm publish --provenance`.
7. **Verify** (the registry can take a few minutes to show it):

   ```bash
   npm view @gtm-trust-kernel/adapters@0.3.0 dist.shasum gitHead --prefer-online
   ```

   `gitHead` should be the tagged commit. The package page on npmjs.com
   shows the provenance badge, and the attestation should name
   `publish.yml` at the release tag:

   ```bash
   curl -s "https://registry.npmjs.org/-/npm/v1/attestations/@gtm-trust-kernel%2Fadapters@0.3.0"
   ```

   Compare the published tarball's extracted contents with a local pack
   (`npm pack <name>@<version>`, then `npm pack` in the package folder,
   extract both, `diff -r`). Don't expect `dist.shasum` to equal the
   step 3 shasum when you pack on Windows: the CLI's `dist/cli.js` is
   mode 0755 on the CI runner and 0644 on Windows, which changes the
   tarball bytes and so the shasum. Identical contents, `gitHead` and
   provenance are the check. A package with no executable file (adapters)
   usually still matches.

## Repository settings (set when the repository goes public)

Set by hand under Settings on the repository; GitHub only offers some of
them once it is public.

- **Master ruleset** (Rules, Rulesets, New branch ruleset, target the
  default branch): require the `verify` and `package-lint` status checks,
  block force pushes, restrict deletions. **Add Repository admin (role)
  as a bypass actor, mode "Always"**, so the maintainer's direct pushes
  to `master` keep working; this is a one-person repository and the
  maintainer pushes straight to `master`. The rules still stop force pushes
  and deletions for everyone else, and the bypass is logged. If the
  bypass is ever removed, direct pushes need a pull request.
- **Environments** `adapters` and `cli` (Settings, Environments):
  deployment branches and tags set to "Selected branches and tags" with
  one tag rule each, `adapters-v*` and `cli-v*`, and a required reviewer.
- **Private vulnerability reporting, secret scanning with push
  protection, Dependabot alerts and security updates:** Settings,
  Advanced Security.
- **Dependabot** (`.github/dependabot.yml`) ignores major-version bumps of
  `typescript` and `@types/node`: the compiler major is a deliberate
  upgrade, and `@types/node` should track the Node version in `engines`,
  not the latest. Minor and patch updates for both still arrive.

## Before trusted publishing

0.1.0 (both packages) and adapters 0.2.0 were published by hand from the
maintainer's machine; 0.2.0 used a one-day granular token, since revoked.
Those releases have no provenance attestation.

## Backup repositories

`pretzelslab/gtm-trust-kernel-pre-rewrite` and
`pretzelslab/gtm-trust-kernel-old` are private backups that hold history
from before the 2026-10-03 rewrite. Keep both private. Never make them
public, transfer them, or point a Trusted Publisher or release at them.
Releases come only from `pretzelslab/gtm-trust-kernel`.

`gtm-trust-kernel-pre-rewrite` stays private permanently: the `gitHead`
values of published 0.1.0 and adapters 0.2.0 point into it.
`gtm-trust-kernel-old` can be deleted after 2026-11-04.

## If the repository is recreated

GitHub settings don't carry over to a new repository; redo them by hand:

- [ ] Actions secrets and environments: the `SF_CLIENT_ID`,
      `SF_CLIENT_SECRET` and `SF_INSTANCE_URL` secrets, and the `adapters`
      and `cli` environments.

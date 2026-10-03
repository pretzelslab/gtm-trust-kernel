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
   Workflow filename: `publish.yml`. Leave the environment empty.
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

6. **Dispatch the workflow:** GitHub, Actions, **publish**, Run workflow,
   choose the package. Or:

   ```bash
   gh workflow run publish.yml -f package=adapters
   ```

   It publishes the code at the tag, not the branch head. It refuses to
   publish if the tag doesn't exist, if the tag's `package.json` has a
   different version, or if that version is already on npm. It runs
   `npm ci` and `npm run ci` before `npm publish --provenance`.
7. **Verify** (the registry can take a few minutes to show it):

   ```bash
   npm view @gtm-trust-kernel/adapters@0.3.0 dist.shasum gitHead --prefer-online
   ```

   `dist.shasum` should match step 3 and `gitHead` the tagged commit. The
   package page on npmjs.com shows the provenance badge.

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

/**
 * Where the Salesforce access token is cached between runs, and how it is
 * written. Internal to the adapter: not in the package's exports map.
 *
 * Location: the user's own config folder, one file per org and connected
 * app (the name hashes instanceUrl + clientId, so two checkouts pointing at
 * different orgs never share a token):
 *   Windows       %LOCALAPPDATA%\gtm-trust-kernel\  (Local, so it doesn't roam)
 *   macOS         ~/Library/Application Support/gtm-trust-kernel/
 *   Linux, other  $XDG_CONFIG_HOME/gtm-trust-kernel/ (default ~/.config)
 * SF_TOKEN_CACHE_PATH overrides it.
 *
 * Permissions: on macOS/Linux a folder this creates is 0700 and the file is
 * 0600, written to a temp file in the same folder and renamed into place,
 * so it is never readable by anyone else, even briefly. An existing folder
 * is left as it is (it may be one the user chose via SF_TOKEN_CACHE_PATH).
 * Windows has no mode bits: the file relies on %LOCALAPPDATA% being private
 * to the user by default (the user, SYSTEM and Administrators).
 *
 * Before 0.2.1 the token was cached inside this package's own folder. That
 * file is deleted on sight, never migrated: a token is cheap to fetch again.
 */

import { createHash, randomBytes } from 'node:crypto';
import { chmod, mkdir, readFile, rename, rm, rmdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const APP_DIR = 'gtm-trust-kernel';

/** The pre-0.2.1 default, relative to this module exactly as salesforce.ts computed it. */
export const LEGACY_TOKEN_CACHE_PATH = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '.cache', 'salesforce-token.json');

export interface CachedToken {
  readonly accessToken: string;
  readonly instanceUrl: string;
  readonly obtainedAt: string;
}

/** Pure: the per-user folder for the token cache on `platform`. */
export function defaultTokenCacheDir(platform: NodeJS.Platform, env: NodeJS.ProcessEnv, home: string): string {
  if (platform === 'win32') {
    return path.win32.join(env.LOCALAPPDATA || path.win32.join(home, 'AppData', 'Local'), APP_DIR);
  }
  if (platform === 'darwin') {
    return path.posix.join(home, 'Library', 'Application Support', APP_DIR);
  }
  // The XDG spec says to ignore a relative XDG_CONFIG_HOME.
  const xdg = env.XDG_CONFIG_HOME;
  return path.posix.join(xdg && path.posix.isAbsolute(xdg) ? xdg : path.posix.join(home, '.config'), APP_DIR);
}

/** One file per org and connected app, without the hostname in the name. */
export function tokenCacheFileName(instanceUrl: string, clientId: string): string {
  const digest = createHash('sha256').update(`${instanceUrl}\n${clientId}`).digest('hex').slice(0, 12);
  return `salesforce-token-${digest}.json`;
}

export function defaultTokenCachePath(
  instanceUrl: string,
  clientId: string,
  platform: NodeJS.Platform,
  env: NodeJS.ProcessEnv,
  home: string,
): string {
  const dir = defaultTokenCacheDir(platform, env, home);
  const join = platform === 'win32' ? path.win32.join : path.posix.join;
  return join(dir, tokenCacheFileName(instanceUrl, clientId));
}

export async function readTokenCache(cachePath: string): Promise<CachedToken | null> {
  try {
    const raw = await readFile(cachePath, 'utf8');
    return JSON.parse(raw) as CachedToken;
  } catch {
    return null;
  }
}

/** Owner-only on macOS/Linux: see this file's docblock. */
export async function writeTokenCache(cachePath: string, token: CachedToken): Promise<void> {
  await mkdir(path.dirname(cachePath), { recursive: true, mode: 0o700 });
  const tmpPath = `${cachePath}.${process.pid}.${randomBytes(4).toString('hex')}.tmp`;
  try {
    await writeFile(tmpPath, JSON.stringify(token, null, 2), { encoding: 'utf8', mode: 0o600 });
    await chmod(tmpPath, 0o600);
    await rename(tmpPath, cachePath);
  } catch (err) {
    await rm(tmpPath, { force: true }).catch(() => {});
    throw err;
  }
}

/**
 * Deletes the pre-0.2.1 cache file, and its `.cache` folder if that is now
 * empty. Never fails: a read-only install or a missing file is fine.
 * Skipped when the active cache path is that same file
 * (SF_TOKEN_CACHE_PATH pointing at it).
 */
export async function removeLegacyTokenCache(legacyPath: string, activePath: string): Promise<void> {
  if (path.resolve(legacyPath) === path.resolve(activePath)) return;
  try {
    await rm(legacyPath, { force: true });
  } catch {
    return;
  }
  await rmdir(path.dirname(legacyPath)).catch(() => {});
}

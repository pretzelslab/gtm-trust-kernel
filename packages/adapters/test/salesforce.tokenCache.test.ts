/**
 * The token cache lives in the user's config folder, owner-only, one file
 * per org + connected app; the pre-0.2.1 file inside the package folder is
 * deleted on first use. Path tests are pure (platform, env and home passed
 * in), so they never touch the real home folder. The permission tests need
 * POSIX mode bits and are skipped on Windows only; CI runs them on Linux.
 */

import { existsSync, mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { chmod, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadSalesforceConfigFromEnv } from '../src/salesforce.js';
import {
  defaultTokenCacheDir,
  defaultTokenCachePath,
  LEGACY_TOKEN_CACHE_PATH,
  readTokenCache,
  removeLegacyTokenCache,
  tokenCacheFileName,
  writeTokenCache,
} from '../src/tokenCache.js';
import { installFakeSalesforce, INSTANCE_URL, sfId } from './support/fakeSalesforce.js';

const TOKEN = { accessToken: 'tok', instanceUrl: 'https://x.my.salesforce.com', obtainedAt: '2026-10-03T00:00:00.000Z' };
const tmpDirs: string[] = [];

function tmp(): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'gtk-token-cache-'));
  tmpDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of tmpDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('defaultTokenCacheDir', () => {
  it('Windows: %LOCALAPPDATA%\\gtm-trust-kernel', () => {
    expect(defaultTokenCacheDir('win32', { LOCALAPPDATA: 'C:\\Users\\u\\AppData\\Local' }, 'C:\\Users\\u')).toBe(
      'C:\\Users\\u\\AppData\\Local\\gtm-trust-kernel',
    );
  });

  it('Windows without LOCALAPPDATA: <home>\\AppData\\Local\\gtm-trust-kernel', () => {
    expect(defaultTokenCacheDir('win32', {}, 'C:\\Users\\u')).toBe('C:\\Users\\u\\AppData\\Local\\gtm-trust-kernel');
  });

  it('macOS: ~/Library/Application Support/gtm-trust-kernel', () => {
    expect(defaultTokenCacheDir('darwin', { XDG_CONFIG_HOME: '/x' }, '/Users/u')).toBe('/Users/u/Library/Application Support/gtm-trust-kernel');
  });

  it('Linux: $XDG_CONFIG_HOME/gtm-trust-kernel when it is absolute', () => {
    expect(defaultTokenCacheDir('linux', { XDG_CONFIG_HOME: '/home/u/cfg' }, '/home/u')).toBe('/home/u/cfg/gtm-trust-kernel');
  });

  it('Linux: ~/.config/gtm-trust-kernel when XDG_CONFIG_HOME is unset or relative', () => {
    expect(defaultTokenCacheDir('linux', {}, '/home/u')).toBe('/home/u/.config/gtm-trust-kernel');
    expect(defaultTokenCacheDir('linux', { XDG_CONFIG_HOME: 'cfg' }, '/home/u')).toBe('/home/u/.config/gtm-trust-kernel');
  });
});

describe('tokenCacheFileName', () => {
  it('is stable, differs per org and per connected app, and never contains the hostname', () => {
    const a = tokenCacheFileName('https://a.my.salesforce.com', 'client-1');
    expect(a).toBe(tokenCacheFileName('https://a.my.salesforce.com', 'client-1'));
    expect(a).toMatch(/^salesforce-token-[0-9a-f]{12}\.json$/);
    expect(tokenCacheFileName('https://b.my.salesforce.com', 'client-1')).not.toBe(a);
    expect(tokenCacheFileName('https://a.my.salesforce.com', 'client-2')).not.toBe(a);
    expect(a).not.toContain('salesforce.com');
  });

  it('defaultTokenCachePath joins the folder and the file name', () => {
    expect(defaultTokenCachePath('https://a.my.salesforce.com', 'c', 'linux', {}, '/home/u')).toBe(
      `/home/u/.config/gtm-trust-kernel/${tokenCacheFileName('https://a.my.salesforce.com', 'c')}`,
    );
  });
});

describe('loadSalesforceConfigFromEnv token cache path', () => {
  const base = { SF_CLIENT_ID: 'client-1', SF_CLIENT_SECRET: 's', SF_INSTANCE_URL: 'https://a.my.salesforce.com/' };

  it('defaults to the user config folder for this platform, keyed on the trimmed instance URL', () => {
    const env = { ...base, LOCALAPPDATA: path.join(os.tmpdir(), 'lad'), XDG_CONFIG_HOME: path.join(os.tmpdir(), 'xdg') };
    expect(loadSalesforceConfigFromEnv(env).tokenCachePath).toBe(
      defaultTokenCachePath('https://a.my.salesforce.com', 'client-1', process.platform, env, os.homedir()),
    );
  });

  it('honours SF_TOKEN_CACHE_PATH', () => {
    expect(loadSalesforceConfigFromEnv({ ...base, SF_TOKEN_CACHE_PATH: '/somewhere/token.json' }).tokenCachePath).toBe('/somewhere/token.json');
  });

  it('no longer defaults to a path inside the package folder', () => {
    expect(loadSalesforceConfigFromEnv(base).tokenCachePath).not.toBe(LEGACY_TOKEN_CACHE_PATH);
  });
});

describe('writeTokenCache / readTokenCache', () => {
  it('round-trips a token and leaves no temp file behind', async () => {
    const file = path.join(tmp(), 'nested', 'token.json');
    await writeTokenCache(file, TOKEN);
    expect(await readTokenCache(file)).toEqual(TOKEN);
    expect(existsSync(path.dirname(file))).toBe(true);
    const leftovers = (await import('node:fs')).readdirSync(path.dirname(file)).filter((f) => f.endsWith('.tmp'));
    expect(leftovers).toEqual([]);
  });

  it('reads a missing or corrupt file as no token', async () => {
    const dir = tmp();
    expect(await readTokenCache(path.join(dir, 'missing.json'))).toBeNull();
    await writeFile(path.join(dir, 'bad.json'), '{not json', 'utf8');
    expect(await readTokenCache(path.join(dir, 'bad.json'))).toBeNull();
  });

  it.skipIf(process.platform === 'win32')('POSIX: writes the token file 0600 and creates its folder 0700', async () => {
    const dir = path.join(tmp(), 'gtm-trust-kernel');
    const file = path.join(dir, 'token.json');
    await writeTokenCache(file, TOKEN);
    expect(statSync(file).mode & 0o777).toBe(0o600);
    expect(statSync(dir).mode & 0o777).toBe(0o700);
  });

  it.skipIf(process.platform === 'win32')('POSIX: replaces an existing world-readable token file with a 0600 one', async () => {
    const file = path.join(tmp(), 'token.json');
    await writeFile(file, '{}', 'utf8');
    await chmod(file, 0o644);
    await writeTokenCache(file, TOKEN);
    expect(statSync(file).mode & 0o777).toBe(0o600);
    expect(JSON.parse(await readFile(file, 'utf8'))).toEqual(TOKEN);
  });
});

describe('removeLegacyTokenCache', () => {
  it('deletes the old file and its now-empty .cache folder', async () => {
    const legacyDir = path.join(tmp(), '.cache');
    mkdirSync(legacyDir);
    const legacy = path.join(legacyDir, 'salesforce-token.json');
    writeFileSync(legacy, '{}');
    await removeLegacyTokenCache(legacy, path.join(tmp(), 'new.json'));
    expect(existsSync(legacy)).toBe(false);
    expect(existsSync(legacyDir)).toBe(false);
  });

  it('keeps the folder when something else is in it', async () => {
    const legacyDir = path.join(tmp(), '.cache');
    mkdirSync(legacyDir);
    const legacy = path.join(legacyDir, 'salesforce-token.json');
    writeFileSync(legacy, '{}');
    writeFileSync(path.join(legacyDir, 'other'), 'x');
    await removeLegacyTokenCache(legacy, path.join(tmp(), 'new.json'));
    expect(existsSync(legacy)).toBe(false);
    expect(existsSync(path.join(legacyDir, 'other'))).toBe(true);
  });

  it('does nothing when there is no old file, and never throws', async () => {
    const dir = tmp();
    await expect(removeLegacyTokenCache(path.join(dir, 'nope', 'salesforce-token.json'), path.join(dir, 'new.json'))).resolves.toBeUndefined();
    // A directory where the file should be: rm without recursive fails; swallowed.
    const odd = path.join(dir, 'salesforce-token.json');
    mkdirSync(odd);
    await expect(removeLegacyTokenCache(odd, path.join(dir, 'new.json'))).resolves.toBeUndefined();
    expect(existsSync(odd)).toBe(true);
  });

  it('leaves the file alone when SF_TOKEN_CACHE_PATH points at it', async () => {
    const legacy = path.join(tmp(), 'salesforce-token.json');
    writeFileSync(legacy, '{}');
    await removeLegacyTokenCache(legacy, legacy);
    expect(existsSync(legacy)).toBe(true);
  });
});

describe('SalesforceAdapter and the token cache', () => {
  it('deletes the pre-0.2.1 cache file on first token use, then caches at the configured path', async () => {
    const legacyExisted = existsSync(LEGACY_TOKEN_CACHE_PATH);
    if (!legacyExisted) {
      mkdirSync(path.dirname(LEGACY_TOKEN_CACHE_PATH), { recursive: true });
      writeFileSync(LEGACY_TOKEN_CACHE_PATH, '{"accessToken":"stale"}');
    }
    const sf = installFakeSalesforce();
    sf.on(/FROM Opportunity /, []);
    const file = path.join(tmp(), 'token.json');
    const adapter = sf.adapter({ tokenCachePath: file });
    await adapter.getOpportunity({ crm: 'salesforce', orgId: new URL(INSTANCE_URL).host, objectType: 'opportunity', id: sfId('006', 1) });
    expect(existsSync(LEGACY_TOKEN_CACHE_PATH)).toBe(false);
    expect(await readTokenCache(file)).toMatchObject({ accessToken: 'FAKE_TOKEN' });
  });
});

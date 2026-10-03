/**
 * .env lookup (envFile.ts): the folder the command was run from (INIT_CWD,
 * else the current folder), then the repo root; only the first file found
 * is read, shell variables win, and the notice names the folder, never a
 * path. Temp folders and a stand-in env object; the real .env is untouched.
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { envFileNotice, loadEnvFileIfPresent } from '../../src/report/envFile.js';

const made: string[] = [];

function folders() {
  const base = mkdtempSync(path.join(tmpdir(), 'gtk-env-'));
  made.push(base);
  const repoRoot = path.join(base, 'repo');
  const cwd = path.join(base, 'work');
  mkdirSync(repoRoot);
  mkdirSync(cwd);
  return { repoRoot, cwd };
}

afterEach(() => {
  for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('loadEnvFileIfPresent', () => {
  it('reads .env from the current folder first, and only that file', async () => {
    const { repoRoot, cwd } = folders();
    writeFileSync(path.join(cwd, '.env'), 'SF_CLIENT_ID=from-cwd\nONLY_CWD=1\n');
    writeFileSync(path.join(repoRoot, '.env'), 'SF_CLIENT_ID=from-root\nONLY_ROOT=1\n');
    const env: NodeJS.ProcessEnv = {};
    expect(await loadEnvFileIfPresent({ cwd, repoRoot, env })).toBe('current folder');
    expect(env).toEqual({ SF_CLIENT_ID: 'from-cwd', ONLY_CWD: '1' });
  });

  it('falls back to the repo root', async () => {
    const { repoRoot, cwd } = folders();
    writeFileSync(path.join(repoRoot, '.env'), 'SF_CLIENT_ID="from-root"\n# comment\n');
    const env: NodeJS.ProcessEnv = {};
    expect(await loadEnvFileIfPresent({ cwd, repoRoot, env })).toBe('repo root');
    expect(env).toEqual({ SF_CLIENT_ID: 'from-root' });
  });

  it('returns null and sets nothing when neither folder has one', async () => {
    const { repoRoot, cwd } = folders();
    const env: NodeJS.ProcessEnv = {};
    expect(await loadEnvFileIfPresent({ cwd, repoRoot, env })).toBeNull();
    expect(env).toEqual({});
  });

  it('never overrides a variable already set in the shell', async () => {
    const { repoRoot, cwd } = folders();
    writeFileSync(path.join(cwd, '.env'), 'SF_CLIENT_ID=from-file\nSF_API_VERSION=v61.0\n');
    const env: NodeJS.ProcessEnv = { SF_CLIENT_ID: 'from-shell' };
    await loadEnvFileIfPresent({ cwd, repoRoot, env });
    expect(env).toEqual({ SF_CLIENT_ID: 'from-shell', SF_API_VERSION: 'v61.0' });
  });

  it('uses INIT_CWD, the folder npm was run from, as the current folder', async () => {
    const { repoRoot, cwd } = folders();
    writeFileSync(path.join(cwd, '.env'), 'FROM_INIT_CWD=1\n');
    const env: NodeJS.ProcessEnv = { INIT_CWD: cwd };
    expect(await loadEnvFileIfPresent({ repoRoot, env })).toBe('current folder');
    expect(env.FROM_INIT_CWD).toBe('1');
  });

  it('reads the file once when the current folder is the repo root', async () => {
    const { repoRoot } = folders();
    writeFileSync(path.join(repoRoot, '.env'), 'A=1\n');
    const env: NodeJS.ProcessEnv = {};
    expect(await loadEnvFileIfPresent({ cwd: repoRoot, repoRoot, env })).toBe('current folder');
    expect(env).toEqual({ A: '1' });
  });
});

describe('envFileNotice', () => {
  it('names the folder, not a path', () => {
    expect(envFileNotice('current folder')).toBe('Settings from .env in the current folder.');
    expect(envFileNotice('repo root')).toBe('Settings from .env in the repo root.');
  });
});

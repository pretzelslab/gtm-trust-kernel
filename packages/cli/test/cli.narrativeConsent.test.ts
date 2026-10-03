/**
 * `scan --demo --narrative` asks for consent before anything is sent. The
 * spawned cases have no terminal, so they can't prompt. Where the key check
 * has to pass, ANTHROPIC_API_KEY is a placeholder and the run is one that
 * must stop at consent; no case lets a request through. Each process case
 * runs in its own temp directory.
 */

import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  NARRATIVE_CONSENT_DECLINED,
  NARRATIVE_CONSENT_PROMPT,
  NARRATIVE_CONSENT_REQUIRED,
} from '@gtm-trust-kernel/readiness/report/narrativeConsent.js';
import { runScan } from '../src/scan.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const TSX = path.join(ROOT, 'node_modules', 'tsx', 'dist', 'cli.mjs');
const CLI = path.join(ROOT, 'packages', 'cli', 'src', 'cli.ts');
const PLACEHOLDER_KEY = 'placeholder-not-a-real-key';

function cli(env: NodeJS.ProcessEnv, ...args: string[]): { status: number | null; stderr: string; wroteOut: boolean } {
  const cwd = mkdtempSync(path.join(os.tmpdir(), 'gtm-cli-consent-'));
  try {
    const r = spawnSync(process.execPath, [TSX, '--conditions=source', CLI, ...args], { cwd, env, encoding: 'utf8' });
    return { status: r.status, stderr: r.stderr, wroteOut: existsSync(path.join(cwd, 'out')) };
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
}

function envWithoutKey(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  delete env.ANTHROPIC_API_KEY;
  return env;
}

describe('scan --demo --narrative consent (process)', () => {
  it('stops with exit 1 and no report when there is no terminal and no --narrative-consent', { timeout: 60_000 }, () => {
    const r = cli({ ...process.env, ANTHROPIC_API_KEY: PLACEHOLDER_KEY }, 'scan', '--demo', '--narrative');
    expect(r.status).toBe(1);
    expect(r.wroteOut).toBe(false);
    expect(r.stderr).toContain(NARRATIVE_CONSENT_REQUIRED);
  });

  it('checks the key before consent: --narrative-consent without a key names the key', { timeout: 60_000 }, () => {
    const r = cli(envWithoutKey(), 'scan', '--demo', '--narrative', '--narrative-consent');
    expect(r.status).toBe(1);
    expect(r.wroteOut).toBe(false);
    expect(r.stderr).toContain('ANTHROPIC_API_KEY');
    expect(r.stderr).not.toContain(NARRATIVE_CONSENT_REQUIRED);
  });

  it('rejects --narrative-consent without --narrative as bad usage', { timeout: 60_000 }, () => {
    const r = cli(envWithoutKey(), 'scan', '--demo', '--narrative-consent');
    expect(r.status).toBe(1);
    expect(r.wroteOut).toBe(false);
    expect(r.stderr.split('\n')[0]).toBe('gtm-trust-kernel: --narrative-consent only applies together with --narrative.');
    expect(r.stderr).toContain('Usage:');
  });
});

describe('scan --demo --narrative consent (in process, at a terminal)', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    process.exitCode = undefined;
  });

  it('prompts once and, on "n", stops before scanning: exit 1, nothing written', async () => {
    vi.stubEnv('ANTHROPIC_API_KEY', PLACEHOLDER_KEY);
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const ask = vi.fn(async () => 'n');
    const outDir = path.join(await mkdtemp(path.join(os.tmpdir(), 'gtm-cli-consent-')), 'out');
    try {
      await runScan({ outDir, useNarrative: true, useJson: false, verbose: true, interactive: true, ask });
      expect(ask).toHaveBeenCalledTimes(1);
      expect(ask).toHaveBeenCalledWith(NARRATIVE_CONSENT_PROMPT);
      expect(process.exitCode).toBe(1);
      expect(errorSpy.mock.calls.flat()).toContain(NARRATIVE_CONSENT_DECLINED);
      expect(logSpy.mock.calls.flat().join('\n')).not.toContain('Stratified sample plan');
      expect(existsSync(outDir)).toBe(false);
    } finally {
      await rm(path.dirname(outDir), { recursive: true, force: true });
    }
  });
});

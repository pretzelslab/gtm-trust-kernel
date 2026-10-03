/**
 * `npm run report -- --narrative` consent, from a real process. spawnSync
 * gives the child no terminal, so it can't prompt. ANTHROPIC_API_KEY is a
 * placeholder (set explicitly: a repo-root .env never overrides a set var),
 * so the key check passes and the consent check is what stops the run.
 * No case here passes --narrative-consent, so nothing can be sent. Each
 * case runs in its own temp directory.
 */

import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { NARRATIVE_CONSENT_REQUIRED, NARRATIVE_CONSENT_WITHOUT_NARRATIVE } from '../../src/report/narrativeConsent.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
const TSX = path.join(ROOT, 'node_modules', 'tsx', 'dist', 'cli.mjs');
const CLI = path.join(ROOT, 'packages', 'readiness', 'src', 'report', 'cli.ts');

function report(...args: string[]): { status: number | null; stdout: string; stderr: string; wroteOut: boolean } {
  const cwd = mkdtempSync(path.join(os.tmpdir(), 'gtm-report-consent-'));
  try {
    const env = { ...process.env, ANTHROPIC_API_KEY: 'placeholder-not-a-real-key' };
    const r = spawnSync(process.execPath, [TSX, '--conditions=source', CLI, ...args], { cwd, env, encoding: 'utf8' });
    return { status: r.status, stdout: r.stdout, stderr: r.stderr, wroteOut: existsSync(path.join(cwd, 'out')) };
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
}

describe.concurrent('report --narrative consent', { timeout: 60_000 }, () => {
  it('stops with exit 1 and no report when there is no terminal and no --narrative-consent', () => {
    const r = report('--narrative');
    expect(r.status).toBe(1);
    expect(r.wroteOut).toBe(false);
    expect(r.stderr).toContain(NARRATIVE_CONSENT_REQUIRED);
    expect(r.stdout).not.toContain('Stratified sample plan');
  });

  it('rejects --narrative-consent without --narrative', () => {
    const r = report('--narrative-consent');
    expect(r.status).toBe(1);
    expect(r.wroteOut).toBe(false);
    expect(r.stderr).toContain(NARRATIVE_CONSENT_WITHOUT_NARRATIVE);
  });
});

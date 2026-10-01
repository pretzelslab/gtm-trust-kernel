/**
 * `npm run report -- --fail-on` exit codes, from a real process. The legacy
 * fixture has every capability blocked; healthy has none blocked. Each
 * case runs in its own temp directory.
 */

import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
const TSX = path.join(ROOT, 'node_modules', 'tsx', 'dist', 'cli.mjs');
const CLI = path.join(ROOT, 'packages', 'readiness', 'src', 'report', 'cli.ts');

function report(...args: string[]): { status: number | null; stderr: string; wroteReport: boolean } {
  const cwd = mkdtempSync(path.join(os.tmpdir(), 'gtm-report-failon-'));
  try {
    const r = spawnSync(process.execPath, [TSX, '--conditions=source', CLI, ...args], { cwd, encoding: 'utf8' });
    return { status: r.status, stderr: r.stderr, wroteReport: existsSync(path.join(cwd, 'out', 'latest.html')) };
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
}

describe.concurrent('report --fail-on exit codes', { timeout: 60_000 }, () => {
  it('exits 0 when --fail-on is unset, even with every capability blocked', () => {
    const r = report('--fixture', 'legacy');
    expect(r.status).toBe(0);
    expect(r.wroteReport).toBe(true);
  });

  it('exits 2 for a bare --fail-on when a capability is blocked, after writing the report', () => {
    const r = report('--fixture', 'legacy', '--fail-on');
    expect(r.status).toBe(2);
    expect(r.wroteReport).toBe(true);
    expect(r.stderr).toMatch(/--fail-on blocked: \d+ capabilit(y|ies) failed/);
  });

  it('exits 0 for --fail-on blocked when nothing is blocked', () => {
    expect(report('--fixture', 'healthy', '--fail-on', 'blocked').status).toBe(0);
  });

  it('exits 1 on an invalid value, without writing a report', () => {
    const r = report('--fail-on', 'viable');
    expect(r.status).toBe(1);
    expect(r.wroteReport).toBe(false);
    expect(r.stderr).toContain('Invalid --fail-on value "viable"');
  });
});

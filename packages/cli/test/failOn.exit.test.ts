/**
 * `scan --demo --fail-on` exit codes, from a real process (process.exitCode
 * can't be observed in-process without leaking into the test runner). The
 * demo org (healthy fixture) has viable and degraded capabilities, none
 * blocked or not_measured; its degraded autonomous_writeback shows as "Not
 * ready yet" in the plain report, so a bare --fail-on fails on it. Each case
 * runs in its own temp directory.
 */

import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const TSX = path.join(ROOT, 'node_modules', 'tsx', 'dist', 'cli.mjs');
const CLI = path.join(ROOT, 'packages', 'cli', 'src', 'cli.ts');

function scan(...args: string[]): { status: number | null; stderr: string; wroteReport: boolean } {
  const cwd = mkdtempSync(path.join(os.tmpdir(), 'gtm-cli-failon-'));
  try {
    const r = spawnSync(process.execPath, [TSX, '--conditions=source', CLI, 'scan', '--demo', ...args], { cwd, encoding: 'utf8' });
    return { status: r.status, stderr: r.stderr, wroteReport: existsSync(path.join(cwd, 'out', 'latest.html')) };
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
}

describe.concurrent('scan --demo --fail-on exit codes', { timeout: 60_000 }, () => {
  it('exits 0 when --fail-on is unset', () => {
    const r = scan();
    expect(r.status).toBe(0);
    expect(r.wroteReport).toBe(true);
  });

  it('exits 2 for a bare --fail-on (blocked) when the plain report shows a use case as not ready', () => {
    const r = scan('--fail-on');
    expect(r.status).toBe(2);
    expect(r.wroteReport).toBe(true);
    expect(r.stderr).toMatch(/--fail-on blocked: 1 capability failed: .*\(degraded, shown as not ready\)/);
  });

  it('exits 2 for --fail-on degraded, after writing the report', () => {
    const r = scan('--fail-on', 'degraded');
    expect(r.status).toBe(2);
    expect(r.wroteReport).toBe(true);
    expect(r.stderr).toMatch(/--fail-on degraded: \d+ capabilit(y|ies) failed: .*\(degraded\)/);
  });

  it('exits 0 for --fail-on not_measured when nothing is not_measured', () => {
    expect(scan('--fail-on=not_measured').status).toBe(0);
  });

  it('exits 1 on an invalid value, without writing a report', () => {
    const r = scan('--fail-on', 'nope');
    expect(r.status).toBe(1);
    expect(r.wroteReport).toBe(false);
    expect(r.stderr).toContain('Invalid --fail-on value "nope"');
  });
});

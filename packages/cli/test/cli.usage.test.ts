/**
 * Bad usage from a real process: one line naming the problem, the usage
 * text, exit 1, and no stack trace. Plus the default and --verbose output.
 * Each process case runs in its own temp directory.
 */

import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import { runScan } from '../src/scan.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const TSX = path.join(ROOT, 'node_modules', 'tsx', 'dist', 'cli.mjs');
const CLI = path.join(ROOT, 'packages', 'cli', 'src', 'cli.ts');

function cli(...args: string[]): { status: number | null; stdout: string; stderr: string; wroteReport: boolean } {
  const cwd = mkdtempSync(path.join(os.tmpdir(), 'gtm-cli-usage-'));
  try {
    const r = spawnSync(process.execPath, [TSX, '--conditions=source', CLI, ...args], { cwd, encoding: 'utf8' });
    return { status: r.status, stdout: r.stdout, stderr: r.stderr, wroteReport: existsSync(path.join(cwd, 'out')) };
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
}

const STACK_LINE = /^\s+at .+[(:]\d+/m;

describe.concurrent('bad usage', { timeout: 60_000 }, () => {
  it('rejects an unknown flag with one line, the usage text and exit 1', () => {
    const r = cli('scan', '--demo', '--nope');
    expect(r.status).toBe(1);
    expect(r.stderr.split('\n')[0]).toBe("gtm-trust-kernel: Unknown option '--nope'.");
    expect(r.stderr).toContain('Usage:');
    expect(r.stderr).not.toMatch(STACK_LINE);
    expect(r.wroteReport).toBe(false);
  });

  it('rejects scan without --demo the same way', () => {
    const r = cli('scan');
    expect(r.status).toBe(1);
    expect(r.stderr.split('\n')[0]).toBe('gtm-trust-kernel: only "scan --demo" is supported right now.');
    expect(r.stderr).toContain('Usage:');
    expect(r.stderr).not.toMatch(STACK_LINE);
  });

  it('rejects an invalid --fail-on value the same way', () => {
    const r = cli('scan', '--demo', '--fail-on', 'nope');
    expect(r.status).toBe(1);
    expect(r.stderr.split('\n')[0]).toMatch(/^gtm-trust-kernel: Invalid --fail-on value "nope"\./);
    expect(r.stderr).toContain('Usage:');
    expect(r.stderr).not.toMatch(STACK_LINE);
  });

  it('prints the summary and the file to open, without the plan, by default', () => {
    const r = cli('scan', '--demo');
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('Demo scan of sample CRM data ("Healthy"): 4 ready, 3 use with caution, 1 not ready.');
    expect(r.stdout).toContain(`Open ${path.join('out', 'latest-plain.html')} for the plain-English report`);
    expect(r.stdout).not.toContain('Stratified sample plan');
  });
});

describe('runScan --verbose', () => {
  it('also prints the sampling plan and every file written', async () => {
    const outDir = await mkdtemp(path.join(os.tmpdir(), 'gtm-cli-test-'));
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    try {
      await runScan({ outDir, useNarrative: false, useJson: false, verbose: true });
      const logged = logSpy.mock.calls.map((c) => c.join(' ')).join('\n');
      expect(logged).toContain('Stratified sample plan');
      expect(logged).toContain('4 ready, 3 use with caution, 1 not ready');
      expect(logged.match(/^Wrote /gm)).toHaveLength(4);
    } finally {
      vi.restoreAllMocks();
      await rm(outDir, { recursive: true, force: true });
    }
  });
});

import { mkdtemp, readdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import { runScan } from '../src/scan.js';

describe('runScan --json', () => {
  let outDir: string;
  let logSpy: MockInstance<typeof console.log>;
  let errSpy: MockInstance<typeof console.error>;

  beforeEach(async () => {
    outDir = await mkdtemp(path.join(os.tmpdir(), 'gtm-cli-test-'));
    // Swallow the readiness plan output; assert on where it goes below.
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await rm(outDir, { recursive: true, force: true });
  });

  it('writes only parseable report JSON to stdout, and the plan (--verbose) and summary to stderr', async () => {
    const stdoutChunks: string[] = [];
    // Capture the real console.log at call time: the mock installed in
    // beforeEach is what runScan swaps out and restores.
    const logBefore = console.log;

    await runScan({ outDir, useNarrative: false, useJson: true, verbose: true, stdout: (t) => stdoutChunks.push(t) });

    const stdout = stdoutChunks.join('');
    const parsed: unknown = JSON.parse(stdout);
    expect(parsed).toBeTypeOf('object');
    expect(parsed).not.toBeNull();
    expect(Object.keys(parsed as object).length).toBeGreaterThan(0);

    // Nothing human-readable leaked to console.log while --json was active.
    expect(logSpy).not.toHaveBeenCalled();
    const stderrText = errSpy.mock.calls.map((c) => c.join(' ')).join('\n');
    expect(stderrText).toContain('Stratified sample plan');
    expect(stderrText).toContain('4 ready, 4 use with caution, 0 not ready');
    expect(stderrText).toContain('latest-plain.html for the plain-English report');

    // console.log is restored afterwards.
    expect(console.log).toBe(logBefore);
  });

  it('still writes the HTML reports and no JSON file', async () => {
    await runScan({ outDir, useNarrative: false, useJson: true, stdout: () => {} });
    const files = await readdir(outDir);
    expect(files).toContain('latest.html');
    expect(files).toContain('latest-plain.html');
    expect(files.some((f) => f.endsWith('.json'))).toBe(false);
  });

  it('restores console.log even when the scan throws', async () => {
    const logBefore = console.log;
    // outDir under a regular file makes mkdir fail.
    const badOut = path.join(outDir, 'latest.html', 'nope');
    await runScan({ outDir, useNarrative: false, useJson: false, stdout: () => {} });
    await expect(
      runScan({ outDir: badOut, useNarrative: false, useJson: true, stdout: () => {} }),
    ).rejects.toThrow();
    expect(console.log).toBe(logBefore);
  });
});

describe('runScan without --json', () => {
  it('prints human lines to console.log and emits no JSON on stdout', async () => {
    const outDir = await mkdtemp(path.join(os.tmpdir(), 'gtm-cli-test-'));
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const stdoutChunks: string[] = [];
    try {
      await runScan({ outDir, useNarrative: false, useJson: false, stdout: (t) => stdoutChunks.push(t) });
      expect(stdoutChunks).toEqual([]);
      const logged = logSpy.mock.calls.map((c) => c.join(' ')).join('\n');
      expect(logged).toContain('Demo scan of sample CRM data ("Healthy"): 4 ready, 4 use with caution, 0 not ready.');
      expect(logged).toContain('latest-plain.html for the plain-English report');
      // The sampling plan is shown only with --verbose.
      expect(logged).not.toContain('Stratified sample plan');
    } finally {
      vi.restoreAllMocks();
      await rm(outDir, { recursive: true, force: true });
    }
  });
});

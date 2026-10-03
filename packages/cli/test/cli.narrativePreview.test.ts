/**
 * `scan --demo --narrative-preview` prints the exact request --narrative
 * would send and stops: no API key, no network, no report files. The
 * process runs without ANTHROPIC_API_KEY, so constructing the narrative
 * client (which throws without one) would fail the run. Each process case
 * runs in its own temp directory.
 */

import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import { healthyFixture } from '@gtm-trust-kernel/readiness/fixtures/healthy.js';
import {
  CLAIMS_SCHEMA,
  MAX_TOKENS,
  resolveNarrativeModel,
} from '@gtm-trust-kernel/readiness/report/narrativeRequest.js';
import { runScan } from '../src/scan.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const TSX = path.join(ROOT, 'node_modules', 'tsx', 'dist', 'cli.mjs');
const CLI = path.join(ROOT, 'packages', 'cli', 'src', 'cli.ts');

function cli(...args: string[]): { status: number | null; stdout: string; stderr: string; wroteOut: boolean } {
  const cwd = mkdtempSync(path.join(os.tmpdir(), 'gtm-cli-preview-'));
  try {
    const env = { ...process.env };
    delete env.ANTHROPIC_API_KEY;
    const r = spawnSync(process.execPath, [TSX, '--conditions=source', CLI, ...args], { cwd, env, encoding: 'utf8' });
    return { status: r.status, stdout: r.stdout, stderr: r.stderr, wroteOut: existsSync(path.join(cwd, 'out')) };
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
}

describe('scan --demo --narrative-preview', () => {
  it('prints only the request JSON on stdout, writes nothing, and needs no key', { timeout: 60_000 }, () => {
    const r = cli('scan', '--demo', '--narrative-preview');
    expect(r.status).toBe(0);
    expect(r.wroteOut).toBe(false);
    expect(r.stderr).toContain('Nothing was sent and no report was written.');

    const request = JSON.parse(r.stdout) as {
      model: string;
      max_tokens: number;
      messages: { role: string; content: string }[];
      output_config: unknown;
    };
    expect(Object.keys(request).sort()).toEqual(['max_tokens', 'messages', 'model', 'output_config']);
    expect(request.max_tokens).toBe(MAX_TOKENS);
    expect(request.output_config).toEqual({ format: { type: 'json_schema', schema: CLAIMS_SCHEMA } });
    expect(request.messages).toHaveLength(1);
    expect(request.messages[0]!.role).toBe('user');
    expect(request.messages[0]!.content).toContain('Report data (JSON):');
    expect(request.messages[0]!.content).not.toContain(healthyFixture.description);
  });

  it.each([['--narrative'], ['--json'], ['--fail-on']])('refuses to combine with %s, without writing a report', { timeout: 60_000 }, (flag) => {
    const r = cli('scan', '--demo', '--narrative-preview', flag);
    expect(r.status).toBe(1);
    expect(r.stderr.split('\n')[0]).toBe(
      "gtm-trust-kernel: --narrative-preview prints the request only; it can't be combined with --narrative, --json or --fail-on.",
    );
    expect(r.wroteOut).toBe(false);
  });

  it('in process: the same request, with the model the environment selects; the sampling plan stays off stdout', async () => {
    const outDir = path.join(await mkdtemp(path.join(os.tmpdir(), 'gtm-cli-preview-')), 'out');
    const chunks: string[] = [];
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      await runScan({
        outDir,
        useNarrative: false,
        useJson: false,
        narrativePreview: true,
        verbose: true,
        stdout: (text) => void chunks.push(text),
      });
      const stdout = chunks.join('');
      const request = JSON.parse(stdout) as { model: string };
      expect(request.model).toBe(resolveNarrativeModel(process.env));
      expect(stdout).not.toContain('Stratified sample plan');
      expect(errorSpy.mock.calls.flat().join('\n')).toContain('Stratified sample plan');
      expect(existsSync(outDir)).toBe(false);
    } finally {
      errorSpy.mockRestore();
      await rm(path.dirname(outDir), { recursive: true, force: true });
    }
  });
});

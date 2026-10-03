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
import type { ReportData } from '@gtm-trust-kernel/readiness/report/buildReport.js';
import {
  NARRATIVE_CONSENT_DECLINED,
  NARRATIVE_CONSENT_PROMPT,
  NARRATIVE_CONSENT_REQUIRED,
} from '@gtm-trust-kernel/readiness/report/narrativeConsent.js';
import {
  buildNarrativeRequest,
  buildNarrativeRequestFromInput,
  resolveNarrativeModel,
} from '@gtm-trust-kernel/readiness/report/narrativeRequest.js';
import { runScan, type NarrativeClient } from '../src/scan.js';

type NarrativePromptInput = Parameters<NarrativeClient['generate']>[0];

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

describe('scan --demo --narrative consent (in process, at a terminal, stubbed model client)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    process.exitCode = undefined;
  });

  /**
   * A NarrativeModelClient stub in place of the Anthropic client: nothing
   * loads the SDK and nothing is sent. It records the prompt input it gets
   * and turns it into the request the real client would send
   * (buildNarrativeRequestFromInput, which narrativeRequest.test.ts proves
   * the real client passes to the API unchanged).
   */
  function stubClient() {
    const received: NarrativePromptInput[] = [];
    const client: NarrativeClient = {
      generate: vi.fn(async (input: NarrativePromptInput) => {
        received.push(input);
        return { claims: [] };
      }),
    };
    return { client, received };
  }

  async function scanAnswering(answer: string) {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'gtm-cli-consent-'));
    const outDir = path.join(dir, 'out');
    const stub = stubClient();
    const ask = vi.fn(async () => answer);
    const chunks: string[] = [];
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    await runScan({
      outDir,
      useNarrative: true,
      useJson: true,
      stdout: (text) => void chunks.push(text),
      interactive: true,
      ask,
      createNarrativeClient: async () => stub.client,
    });
    return {
      dir,
      outDir,
      stub,
      ask,
      data: JSON.parse(chunks.join('')) as ReportData,
      stderr: errorSpy.mock.calls.flat().map(String),
    };
  }

  const roundTrip = (v: unknown): unknown => JSON.parse(JSON.stringify(v));

  it('"y": the stub gets exactly the buildNarrativeRequest() payload, and the report is written', async () => {
    const r = await scanAnswering('y');
    try {
      expect(r.ask).toHaveBeenCalledTimes(1);
      expect(r.ask).toHaveBeenCalledWith(NARRATIVE_CONSENT_PROMPT);
      expect(r.stub.received).toHaveLength(1);
      const sent = buildNarrativeRequestFromInput(r.stub.received[0]!, resolveNarrativeModel(process.env));
      expect(roundTrip(sent)).toEqual(roundTrip(buildNarrativeRequest(r.data, process.env)));
      expect(existsSync(path.join(r.outDir, 'latest.html'))).toBe(true);
      expect(existsSync(path.join(r.outDir, 'latest-plain.html'))).toBe(true);
      expect(process.exitCode ?? 0).toBe(0);
      expect(r.stderr).not.toContain(NARRATIVE_CONSENT_DECLINED);
    } finally {
      await rm(r.dir, { recursive: true, force: true });
    }
  });

  it('"n": the stub is never called, the report is written without the AI summary, exit 0', async () => {
    const r = await scanAnswering('n');
    try {
      expect(r.ask).toHaveBeenCalledTimes(1);
      expect(r.stub.client.generate).not.toHaveBeenCalled();
      expect(existsSync(path.join(r.outDir, 'latest.html'))).toBe(true);
      expect(existsSync(path.join(r.outDir, 'latest-plain.html'))).toBe(true);
      expect(process.exitCode ?? 0).toBe(0);
      expect(r.stderr).toContain('AI summary skipped; nothing was sent.');
    } finally {
      await rm(r.dir, { recursive: true, force: true });
    }
  });
});

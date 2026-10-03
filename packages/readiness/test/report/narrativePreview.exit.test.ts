/**
 * `npm run report -- --narrative-preview`, from a real process: the exact
 * request --narrative would send on stdout, nothing written, no key needed
 * (the process runs without ANTHROPIC_API_KEY). Fixture mode only; --live
 * takes the same path after reading the org. Each case runs in its own temp
 * directory.
 */

import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { buildFromFixture } from '../../src/report/buildFromFixture.js';
import { buildNarrativeRequest } from '../../src/report/narrativeRequest.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
const TSX = path.join(ROOT, 'node_modules', 'tsx', 'dist', 'cli.mjs');
const CLI = path.join(ROOT, 'packages', 'readiness', 'src', 'report', 'cli.ts');

function report(...args: string[]): { status: number | null; stdout: string; stderr: string; wroteOut: boolean } {
  const cwd = mkdtempSync(path.join(os.tmpdir(), 'gtm-report-preview-'));
  try {
    const env = { ...process.env };
    delete env.ANTHROPIC_API_KEY;
    const r = spawnSync(process.execPath, [TSX, '--conditions=source', CLI, ...args], { cwd, env, encoding: 'utf8' });
    return { status: r.status, stdout: r.stdout, stderr: r.stderr, wroteOut: existsSync(path.join(cwd, 'out')) };
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
}

/** generatedAt is the run's clock time; everything else is deterministic for a fixture. */
function withoutGeneratedAt(request: { messages: { content: string }[] }): unknown {
  return {
    ...request,
    messages: request.messages.map((m) => ({ ...m, content: m.content.replace(/"generatedAt":"[^"]*"/g, '"generatedAt":"<t>"') })),
  };
}

describe.concurrent('report --narrative-preview', { timeout: 60_000 }, () => {
  it('prints exactly buildNarrativeRequest() for the fixture, writes nothing, and needs no key', async () => {
    const r = report('--fixture', 'legacy', '--narrative-preview');
    expect(r.status).toBe(0);
    expect(r.wroteOut).toBe(false);
    expect(r.stderr).toContain('Nothing was sent and no report was written.');

    const expected = buildNarrativeRequest(await buildFromFixture('legacy'), process.env);
    expect(withoutGeneratedAt(JSON.parse(r.stdout))).toEqual(withoutGeneratedAt(expected));
  });

  it.each([['--all'], ['--narrative'], ['--json'], ['--fail-on']])('refuses to combine with %s, without writing a report', (flag) => {
    const r = report('--narrative-preview', flag);
    expect(r.status).toBe(1);
    expect(r.wroteOut).toBe(false);
    expect(r.stderr).toContain("--narrative-preview prints the request only; it can't be combined with --all, --narrative, --json or --fail-on.");
  });
});

/**
 * The Anthropic SDK is loaded only for --narrative: scan.ts must reach the
 * narrative client through a dynamic import, and --narrative without
 * ANTHROPIC_API_KEY must still fail loudly through that path. No network:
 * the client's constructor fails before any request.
 */

import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const TSX = path.join(ROOT, 'node_modules', 'tsx', 'dist', 'cli.mjs');
const CLI = path.join(ROOT, 'packages', 'cli', 'src', 'cli.ts');
const SCAN = path.join(ROOT, 'packages', 'cli', 'src', 'scan.ts');

describe('--narrative loads the SDK lazily', () => {
  it('scan.ts has no static import of the narrative client or the SDK', () => {
    const source = readFileSync(SCAN, 'utf8');
    expect(source).not.toMatch(/^import[^;]*anthropicNarrativeModelClient/m);
    expect(source).not.toMatch(/^import[^;]*@anthropic-ai\/sdk/m);
    expect(source).toMatch(/await import\('@gtm-trust-kernel\/readiness\/report\/anthropicNarrativeModelClient\.js'\)/);
  });

  it('fails with exit 1 and names the missing key when --narrative has no ANTHROPIC_API_KEY', { timeout: 60_000 }, () => {
    const cwd = mkdtempSync(path.join(os.tmpdir(), 'gtm-cli-narrative-'));
    try {
      const env = { ...process.env };
      delete env.ANTHROPIC_API_KEY;
      const r = spawnSync(process.execPath, [TSX, '--conditions=source', CLI, 'scan', '--demo', '--narrative'], { cwd, env, encoding: 'utf8' });
      expect(r.status).toBe(1);
      expect(r.stderr).toContain('ANTHROPIC_API_KEY');
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });
});

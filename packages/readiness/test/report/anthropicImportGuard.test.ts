/**
 * Structural guard (Phase E commit 2): @anthropic-ai/sdk must be imported by
 * exactly one file in this package -- anthropicNarrativeModelClient.ts, per
 * docs/narrative-design.md's Test strategy ("no test file imports it or
 * sets ANTHROPIC_API_KEY"). Scans actual source text for the import
 * specifier rather than trusting the docblock claim, same pattern as
 * reportDataStringPaths.test.ts's structural-guard framing.
 */

import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PACKAGE_ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const THIS_FILE = fileURLToPath(import.meta.url);
const IMPORT_SPECIFIER = '@anthropic-ai/sdk';

function collectTsFiles(dir: string, into: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      collectTsFiles(full, into);
    } else if (entry.isFile() && entry.name.endsWith('.ts')) {
      into.push(full);
    }
  }
  return into;
}

describe('@anthropic-ai/sdk import guard (structural)', () => {
  it('is imported by exactly one file: src/report/anthropicNarrativeModelClient.ts', () => {
    const files = [
      ...collectTsFiles(path.join(PACKAGE_ROOT, 'src')),
      ...collectTsFiles(path.join(PACKAGE_ROOT, 'test')),
      ...collectTsFiles(path.join(PACKAGE_ROOT, 'scripts')),
    ].filter((f) => f !== THIS_FILE);

    const importers = files
      .filter((f) => readFileSync(f, 'utf8').includes(IMPORT_SPECIFIER))
      .map((f) => path.relative(PACKAGE_ROOT, f).split(path.sep).join('/'));

    expect(importers).toEqual(['src/report/anthropicNarrativeModelClient.ts']);
  });
});

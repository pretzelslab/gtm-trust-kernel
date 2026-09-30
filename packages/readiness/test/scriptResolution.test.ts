/**
 * Repo scripts run workspace packages from source; published bins run them
 * from dist. A repo script that resolved @gtm-trust-kernel/adapters to its
 * dist/ would run whatever was last built, which can be stale, so every tsx
 * script must pass --conditions=source (the condition vitest.config.ts
 * already adds for tests). A published bin must not: an npm install has no
 * src/, only dist/.
 */

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const PACKAGES_DIR = path.resolve(import.meta.dirname, '../..');

interface PackageJson {
  readonly name: string;
  readonly bin?: Readonly<Record<string, string>>;
  readonly scripts?: Readonly<Record<string, string>>;
  readonly exports?: Readonly<Record<string, string | Readonly<Record<string, string>>>>;
}

const packages = readdirSync(PACKAGES_DIR)
  .map((dir) => path.join(PACKAGES_DIR, dir))
  .filter((dir) => existsSync(path.join(dir, 'package.json')))
  .map((dir) => ({ dir, pkg: JSON.parse(readFileSync(path.join(dir, 'package.json'), 'utf8')) as PackageJson }));

describe('script resolution', () => {
  it('finds the workspace packages', () => {
    expect(packages.map((p) => p.pkg.name)).toEqual(
      expect.arrayContaining(['@gtm-trust-kernel/adapters', '@gtm-trust-kernel/readiness', 'gtm-trust-kernel']),
    );
  });

  it('runs every tsx repo script with the source condition', () => {
    const tsxScripts = packages.flatMap(({ pkg }) =>
      Object.entries(pkg.scripts ?? {})
        .filter(([, command]) => /\btsx\b/.test(command))
        .map(([name, command]) => ({ script: `${pkg.name} ${name}`, command })),
    );
    expect(tsxScripts.length).toBeGreaterThan(0);
    for (const { script, command } of tsxScripts) {
      expect(command, script).toMatch(/\btsx --conditions=source /);
    }
  });

  it('keeps published bins on dist, run by plain node', () => {
    const bins = packages.flatMap(({ dir, pkg }) => Object.values(pkg.bin ?? {}).map((bin) => ({ dir, bin })));
    expect(bins.length).toBeGreaterThan(0);
    for (const { dir, bin } of bins) {
      expect(bin).toMatch(/^(\.\/)?dist\//);
      const source = path.join(dir, 'src', `${path.basename(bin, '.js')}.ts`);
      expect(readFileSync(source, 'utf8').split('\n')[0]).toBe('#!/usr/bin/env node');
    }
  });

  it("keeps the adapters package's default export entries on dist", () => {
    const adapters = packages.find((p) => p.pkg.name === '@gtm-trust-kernel/adapters')!.pkg;
    for (const [subpath, target] of Object.entries(adapters.exports ?? {})) {
      expect(typeof target, subpath).toBe('object');
      const entry = target as Readonly<Record<string, string>>;
      expect(entry.default, subpath).toMatch(/^\.\/dist\//);
      expect(entry.source, subpath).not.toMatch(/dist/);
    }
  });
});

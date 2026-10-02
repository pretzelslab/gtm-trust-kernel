#!/usr/bin/env node
/**
 * Packs both published packages and lints the tarballs exactly as npm would
 * ship them:
 *
 *  - publint --strict: package.json and file layout; warnings fail too (a
 *    CommonJS require() in an ESM file, which shipped in adapters 0.2.0, is
 *    a warning without --strict).
 *  - @arethetypeswrong/cli --profile esm-only: type resolution for the
 *    package's entry points. Both packages are ESM-only on purpose, so the
 *    legacy node10 and require() resolutions are not checked. The CLI ships
 *    no types (it is a bin), which attw reports and passes.
 *
 * Run from the repo root: npm run lint:pack. Exits 1 if any check fails.
 */

import { spawnSync } from 'node:child_process';
import { mkdirSync, readdirSync, rmSync } from 'node:fs';
import path from 'node:path';

const PACKAGES = ['@gtm-trust-kernel/adapters', 'gtm-trust-kernel'];
// Relative and space-free: on Windows the .cmd shims need a shell.
const OUT = '.pack';
const shell = process.platform === 'win32';
const bin = (name) => path.join('node_modules', '.bin', name);
// With a shell, pass one command string (every argument here is a fixed,
// space-free value), so Node doesn't warn about unescaped shell arguments.
const run = (cmd, args) =>
  (shell ? spawnSync([cmd, ...args].join(' '), { stdio: 'inherit', shell }) : spawnSync(cmd, args, { stdio: 'inherit' })).status === 0;

rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT);
const packed = run('npm', ['pack', ...PACKAGES.flatMap((p) => ['-w', p]), '--pack-destination', OUT]);
if (!packed) {
  console.error('npm pack failed');
  process.exit(1);
}

const failures = [];
for (const tarball of readdirSync(OUT).filter((f) => f.endsWith('.tgz'))) {
  const file = path.join(OUT, tarball);
  console.log(`\n== ${tarball}`);
  if (!run(bin('publint'), [file, '--strict'])) failures.push(`publint: ${tarball}`);
  if (!run(bin('attw'), [file, '--profile', 'esm-only', '--format', 'table'])) failures.push(`attw: ${tarball}`);
}
rmSync(OUT, { recursive: true, force: true });

if (failures.length > 0) {
  console.error(`\nPackage lint failed:\n  ${failures.join('\n  ')}`);
  process.exit(1);
}
console.log('\nPackage lint passed.');

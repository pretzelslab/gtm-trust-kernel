#!/usr/bin/env node
/**
 * Deletes every workspace package's dist/ (npm run clean). npm run ci runs
 * it first, so tests and typechecks always resolve workspace packages to
 * their source: a stale build can't hide a broken "source" condition.
 */

import { existsSync, readdirSync, rmSync } from 'node:fs';
import path from 'node:path';

const removed = [];
for (const pkg of readdirSync('packages')) {
  const dist = path.join('packages', pkg, 'dist');
  if (existsSync(dist)) {
    rmSync(dist, { recursive: true, force: true });
    removed.push(dist);
  }
}
console.log(removed.length > 0 ? `Removed ${removed.join(', ')}` : 'No dist/ folders to remove.');

/**
 * Minimal KEY=VALUE .env loader — no dotenv dependency, per this feature's
 * "no new dependencies" scope. Never overrides a var already set in the
 * shell environment. Silently no-ops if .env doesn't exist. Extracted from
 * cli.ts (Phase E commit 2) so scripts/narrativeSmoke.ts can reuse it
 * without importing cli.ts itself — cli.ts runs main() unconditionally at
 * module load, so importing it for this one helper would trigger the CLI.
 */

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const REPO_ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');

export async function loadEnvFileIfPresent(): Promise<void> {
  let raw: string;
  try {
    raw = await readFile(path.join(REPO_ROOT, '.env'), 'utf8');
  } catch {
    return;
  }
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (key && !(key in process.env)) {
      process.env[key] = value;
    }
  }
}

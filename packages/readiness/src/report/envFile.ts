/**
 * Minimal KEY=VALUE .env loader — no dotenv dependency, per this feature's
 * "no new dependencies" scope. Never overrides a var already set in the
 * shell environment. Silently no-ops if no .env exists. Extracted from
 * cli.ts (Phase E commit 2) so scripts/narrativeSmoke.ts can reuse it
 * without importing cli.ts itself — cli.ts runs main() unconditionally at
 * module load, so importing it for this one helper would trigger the CLI.
 *
 * Lookup order (the first file found is the only one read):
 *  1. .env in the folder the command was run from: INIT_CWD, which npm
 *     sets to that folder even when it runs a workspace script from the
 *     package's own folder, else the process's current folder;
 *  2. .env at the repo root.
 */

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const REPO_ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');

/** Which .env was read, for a stderr line that names no full path. */
export type EnvFileSource = 'current folder' | 'repo root';

export interface EnvFileLookup {
  /** The folder the command was run from. Default: env.INIT_CWD, else process.cwd(). */
  readonly cwd?: string;
  /** Default: REPO_ROOT. */
  readonly repoRoot?: string;
  /** Variables to fill in. Default: process.env. */
  readonly env?: NodeJS.ProcessEnv;
}

export async function loadEnvFileIfPresent(lookup: EnvFileLookup = {}): Promise<EnvFileSource | null> {
  const env = lookup.env ?? process.env;
  const cwd = path.resolve(lookup.cwd ?? (env.INIT_CWD || process.cwd()));
  const repoRoot = path.resolve(lookup.repoRoot ?? REPO_ROOT);
  const candidates: [EnvFileSource, string][] = [['current folder', cwd]];
  if (repoRoot !== cwd) candidates.push(['repo root', repoRoot]);

  for (const [source, folder] of candidates) {
    let raw: string;
    try {
      raw = await readFile(path.join(folder, '.env'), 'utf8');
    } catch {
      continue;
    }
    applyEnvFile(raw, env);
    return source;
  }
  return null;
}

function applyEnvFile(raw: string, env: NodeJS.ProcessEnv): void {
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
    if (key && !(key in env)) {
      env[key] = value;
    }
  }
}

/** The stderr line for a loaded .env. */
export function envFileNotice(source: EnvFileSource): string {
  return `Settings from .env in the ${source}.`;
}

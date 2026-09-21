/**
 * D5 hashing (metric-definitions.md's contact_identity_resolution_rate,
 * second-source-adapter-design.md decision 4). Real randomness, not the
 * deterministic mulberry32/xfnv1a seed sample.ts uses for stratified
 * sampling — a deterministic salt would defeat "salt differs across runs".
 * Same createHash('sha256') idiom packages/kernel/src/audit/ledger.ts
 * already uses; no new dependency.
 */

import { createHash, randomBytes } from 'node:crypto';

/** A fresh, unpredictable salt — call once per D5 run, never persisted. */
export function generateRunSalt(): string {
  return randomBytes(16).toString('hex');
}

/**
 * Trims and lowercases the email before hashing, so casing/whitespace
 * differences between the CRM and the second source don't produce a false
 * non-match. Same salt must be passed to every call within one run for
 * hashes to be comparable.
 */
export function hashEmail(rawEmail: string, salt: string): string {
  const normalized = rawEmail.trim().toLowerCase();
  return createHash('sha256').update(`${salt}:${normalized}`).digest('hex');
}

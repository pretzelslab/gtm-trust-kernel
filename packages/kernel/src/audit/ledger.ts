/**
 * Hash-chained audit ledger.
 *
 * Tamper-evident by construction: each entry commits to the hash of the one
 * before it, so any retroactive edit breaks verification from that point on.
 * This is what turns "we log things" into an auditable control.
 *
 * The in-memory implementation below is the reference; a Postgres-backed one
 * appends the same shape with the chain hash stored as a column and the
 * verification query run on a schedule.
 */

import { createHash } from 'node:crypto';

export type AuditKind =
  | 'proposal_created'
  | 'proposal_approved'
  | 'proposal_quarantined'
  | 'proposal_expired'
  | 'applied'
  | 'apply_failed'
  | 'apply_blocked_kill_switch'
  | 'rolled_back'
  | 'rollback_failed'
  | 'partial_rollback_failed'
  | 'canary_tripped'
  | 'sync_started'
  | 'sync_completed'
  | 'sync_failed';

export interface AuditInput {
  readonly kind: AuditKind;
  readonly at: string;
  readonly proposalId?: string;
  readonly actorId?: string;
  readonly detail?: Readonly<Record<string, unknown>>;
}

export interface AuditEntry extends AuditInput {
  readonly seq: number;
  readonly prevHash: string;
  readonly hash: string;
}

const GENESIS = '0'.repeat(64);

function entryHash(e: Omit<AuditEntry, 'hash'>): string {
  // Deterministic serialisation: sorted keys, no undefined.
  const payload = JSON.stringify({
    seq: e.seq,
    kind: e.kind,
    at: e.at,
    proposalId: e.proposalId ?? null,
    actorId: e.actorId ?? null,
    detail: e.detail ? sortKeys(e.detail) : null,
    prevHash: e.prevHash,
  });
  return createHash('sha256').update(payload).digest('hex');
}

function sortKeys(o: Readonly<Record<string, unknown>>): Record<string, unknown> {
  return Object.fromEntries(
    Object.keys(o)
      .sort()
      .map((k) => [k, o[k]]),
  );
}

export interface AuditLedger {
  append(input: AuditInput): AuditEntry;
  entries(): readonly AuditEntry[];
  verify(): { ok: true } | { ok: false; brokenAtSeq: number };
}

export class InMemoryLedger implements AuditLedger {
  private log: AuditEntry[] = [];

  append(input: AuditInput): AuditEntry {
    const prevHash = this.log.length ? this.log[this.log.length - 1]!.hash : GENESIS;
    const base = { ...input, seq: this.log.length, prevHash };
    const entry: AuditEntry = { ...base, hash: entryHash(base) };
    this.log.push(entry);
    return entry;
  }

  entries(): readonly AuditEntry[] {
    return this.log;
  }

  verify(): { ok: true } | { ok: false; brokenAtSeq: number } {
    let prev = GENESIS;
    for (const e of this.log) {
      if (e.prevHash !== prev) return { ok: false, brokenAtSeq: e.seq };
      const { hash, ...rest } = e;
      if (entryHash(rest) !== hash) return { ok: false, brokenAtSeq: e.seq };
      prev = hash;
    }
    return { ok: true };
  }
}

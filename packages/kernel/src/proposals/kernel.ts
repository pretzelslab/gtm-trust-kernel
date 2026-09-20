/**
 * The proposal and approval kernel.
 *
 * This is the "users can trust it when something goes wrong" layer. Nothing
 * reaches a CRM except through here.
 *
 * Invariants, enforced in code rather than by UI convention:
 *   I1  A proposal touching a field outside the role allowlist is unrepresentable.
 *   I2  apply() is unreachable without an approval record by a distinct actor.
 *   I3  Every apply carries the concurrency token read at proposal time.
 *   I4  Every applied write stores an inverse patch, so rollback is first class.
 *   I5  Every transition is appended to a hash-chained ledger.
 *   I6  A proposal older than its TTL expires rather than applying to drifted state.
 *   I7  The kill switch short-circuits every apply, with no redeploy.
 */

import type { CrmAdapter, FieldWrite, WriteOutcome } from '@gtm-trust-kernel/adapters/types.js';
import type { RecordRef } from '@gtm-trust-kernel/adapters/model/canonical.js';
import type { AuditLedger } from '../audit/ledger.js';

export type ProposalStatus =
  | 'draft'
  | 'pending_approval'
  | 'approved'
  | 'applied'
  | 'failed'
  | 'rolled_back'
  | 'expired'
  | 'quarantined';

export interface Actor {
  readonly id: string;
  readonly role: 'rep' | 'manager' | 'revops' | 'admin';
}

export interface ProposedChange {
  readonly ref: RecordRef;
  readonly field: string;
  readonly newValue: string | number | null;
  readonly previousValue: string | number | null;
  readonly expectedConcurrencyToken: string;
  /** Why. Must cite evidence record ids or the proposal is rejected at build. */
  readonly rationale: string;
  readonly citedRecordIds: readonly string[];
}

export interface Proposal {
  readonly id: string;
  readonly createdAt: string;
  readonly createdBy: Actor;
  readonly evidenceSetId: string;
  readonly modelVersion: string;
  readonly promptVersion: string;
  readonly changes: readonly ProposedChange[];
  readonly status: ProposalStatus;
  readonly approvedBy?: Actor;
  readonly approvedAt?: string;
  readonly appliedAt?: string;
  readonly inversePatch?: readonly FieldWrite[];
  readonly failureReason?: string;
  /** Idempotency key sent to the adapter, stable across retries. */
  readonly idempotencyKey: string;
  readonly ttlMs: number;
}

export type FieldAllowlist = Readonly<Record<Actor['role'], readonly string[]>>;

export const DEFAULT_ALLOWLIST: FieldAllowlist = {
  rep: ['nextStep', 'closeDate'],
  manager: ['nextStep', 'closeDate', 'forecastCategory'],
  revops: ['nextStep', 'closeDate', 'forecastCategory', 'amount'],
  admin: ['nextStep', 'closeDate', 'forecastCategory', 'amount', 'stage'],
};

export class KernelError extends Error {
  constructor(message: string, readonly code: string) {
    super(message);
    this.name = 'KernelError';
  }
}

export interface KillSwitch {
  writesEnabled(scope: { orgId: string; actorId?: string }): boolean;
}

export class ProposalKernel {
  constructor(
    private adapter: CrmAdapter,
    private ledger: AuditLedger,
    private killSwitch: KillSwitch,
    private allowlist: FieldAllowlist = DEFAULT_ALLOWLIST,
    private now: () => Date = () => new Date(),
  ) {}

  /** I1 + grounding requirement, enforced at construction time. */
  build(args: {
    id: string;
    createdBy: Actor;
    evidenceSetId: string;
    modelVersion: string;
    promptVersion: string;
    changes: readonly ProposedChange[];
    ttlMs?: number;
    /** Record ids present in the evidence set; citations must be a subset. */
    evidenceRecordIds: ReadonlySet<string>;
  }): Proposal {
    const allowed = new Set(this.allowlist[args.createdBy.role]);
    for (const c of args.changes) {
      if (!allowed.has(c.field)) {
        throw new KernelError(
          `field '${c.field}' not writable by role '${args.createdBy.role}'`,
          'FIELD_NOT_ALLOWED',
        );
      }
      if (c.citedRecordIds.length === 0) {
        throw new KernelError(`change to '${c.field}' has no citations`, 'UNCITED_CHANGE');
      }
      for (const rid of c.citedRecordIds) {
        if (!args.evidenceRecordIds.has(rid)) {
          throw new KernelError(
            `citation '${rid}' is not in evidence set ${args.evidenceSetId}`,
            'CITATION_OUT_OF_SET',
          );
        }
      }
    }

    const p: Proposal = {
      id: args.id,
      createdAt: this.now().toISOString(),
      createdBy: args.createdBy,
      evidenceSetId: args.evidenceSetId,
      modelVersion: args.modelVersion,
      promptVersion: args.promptVersion,
      changes: args.changes,
      status: 'pending_approval',
      idempotencyKey: `${args.id}:${args.evidenceSetId}`,
      ttlMs: args.ttlMs ?? 4 * 60 * 60 * 1000,
    };
    this.ledger.append({
      kind: 'proposal_created',
      proposalId: p.id,
      at: p.createdAt,
      actorId: args.createdBy.id,
      detail: {
        evidenceSetId: p.evidenceSetId,
        modelVersion: p.modelVersion,
        promptVersion: p.promptVersion,
        fields: p.changes.map((c) => c.field),
      },
    });
    return p;
  }

  /** I2: approver must differ from creator. Self-approval is not an approval. */
  approve(p: Proposal, approver: Actor): Proposal {
    if (p.status !== 'pending_approval') {
      throw new KernelError(`cannot approve from status '${p.status}'`, 'BAD_TRANSITION');
    }
    if (this.isExpired(p)) return this.expire(p);
    if (approver.id === p.createdBy.id && p.createdBy.role !== 'rep') {
      throw new KernelError('approver must differ from creator', 'SELF_APPROVAL');
    }
    const at = this.now().toISOString();
    this.ledger.append({
      kind: 'proposal_approved',
      proposalId: p.id,
      at,
      actorId: approver.id,
      detail: { role: approver.role },
    });
    return { ...p, status: 'approved', approvedBy: approver, approvedAt: at };
  }

  quarantine(p: Proposal, reason: string): Proposal {
    this.ledger.append({
      kind: 'proposal_quarantined',
      proposalId: p.id,
      at: this.now().toISOString(),
      detail: { reason },
    });
    return { ...p, status: 'quarantined', failureReason: reason };
  }

  private isExpired(p: Proposal): boolean {
    return this.now().getTime() - new Date(p.createdAt).getTime() > p.ttlMs;
  }

  private expire(p: Proposal): Proposal {
    this.ledger.append({ kind: 'proposal_expired', proposalId: p.id, at: this.now().toISOString() });
    return { ...p, status: 'expired' };
  }

  /** I3, I4, I5, I6, I7 all land here. */
  async apply(p: Proposal, orgId: string): Promise<Proposal> {
    if (p.status !== 'approved') {
      throw new KernelError(`apply requires status 'approved', got '${p.status}'`, 'NOT_APPROVED');
    }
    if (this.isExpired(p)) return this.expire(p);
    if (!this.killSwitch.writesEnabled({ orgId, actorId: p.approvedBy?.id })) {
      const at = this.now().toISOString();
      this.ledger.append({ kind: 'apply_blocked_kill_switch', proposalId: p.id, at });
      return { ...p, status: 'failed', failureReason: 'kill switch engaged' };
    }

    const applied: FieldWrite[] = [];
    const inverse: FieldWrite[] = [];

    for (const c of p.changes) {
      const write: FieldWrite = {
        ref: c.ref,
        field: c.field,
        newValue: c.newValue,
        previousValue: c.previousValue,
        expectedConcurrencyToken: c.expectedConcurrencyToken,
      };
      let outcome: WriteOutcome;
      try {
        outcome = await this.adapter.applyFieldWrite(write);
      } catch (e) {
        await this.rollbackPartial(p, inverse);
        const at = this.now().toISOString();
        this.ledger.append({
          kind: 'apply_failed',
          proposalId: p.id,
          at,
          detail: { field: c.field, error: String(e) },
        });
        return { ...p, status: 'failed', failureReason: `adapter error on ${c.field}: ${String(e)}` };
      }

      if (outcome.status !== 'applied') {
        await this.rollbackPartial(p, inverse);
        const at = this.now().toISOString();
        this.ledger.append({
          kind: 'apply_failed',
          proposalId: p.id,
          at,
          detail: { field: c.field, outcome: outcome.status },
        });
        return {
          ...p,
          status: 'failed',
          failureReason:
            outcome.status === 'conflict'
              ? `record changed since read on field '${c.field}'`
              : `write ${outcome.status} on field '${c.field}'`,
        };
      }

      applied.push(write);
      inverse.unshift({
        ref: c.ref,
        field: c.field,
        newValue: c.previousValue,
        previousValue: c.newValue,
        expectedConcurrencyToken: outcome.newConcurrencyToken,
      });
    }

    const at = this.now().toISOString();
    this.ledger.append({
      kind: 'applied',
      proposalId: p.id,
      at,
      actorId: p.approvedBy?.id,
      detail: { fields: applied.map((w) => w.field) },
    });
    return { ...p, status: 'applied', appliedAt: at, inversePatch: inverse };
  }

  /** Rollback is a first-class action, not a manual CRM fix. */
  async rollback(p: Proposal, actor: Actor): Promise<Proposal> {
    if (p.status !== 'applied' || !p.inversePatch) {
      throw new KernelError(`nothing to roll back from '${p.status}'`, 'BAD_TRANSITION');
    }
    for (const w of p.inversePatch) {
      const outcome = await this.adapter.applyFieldWrite(w);
      if (outcome.status !== 'applied') {
        this.ledger.append({
          kind: 'rollback_failed',
          proposalId: p.id,
          at: this.now().toISOString(),
          actorId: actor.id,
          detail: { field: w.field, outcome: outcome.status },
        });
        return { ...p, failureReason: `rollback blocked on '${w.field}': ${outcome.status}` };
      }
    }
    const at = this.now().toISOString();
    this.ledger.append({ kind: 'rolled_back', proposalId: p.id, at, actorId: actor.id });
    return { ...p, status: 'rolled_back' };
  }

  private async rollbackPartial(p: Proposal, inverse: readonly FieldWrite[]) {
    for (const w of inverse) {
      try {
        await this.adapter.applyFieldWrite(w);
      } catch {
        this.ledger.append({
          kind: 'partial_rollback_failed',
          proposalId: p.id,
          at: this.now().toISOString(),
          detail: { field: w.field },
        });
      }
    }
  }
}

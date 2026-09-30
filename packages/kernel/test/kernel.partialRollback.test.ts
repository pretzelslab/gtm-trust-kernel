import { describe, expect, it } from 'vitest';
import { InMemoryLedger } from '../src/audit/ledger.js';
import { MockAdapter } from '@gtm-trust-kernel/adapters/mock.js';
import type { CrmAdapter, FieldWrite, WriteOutcome } from '@gtm-trust-kernel/adapters/types.js';
import { ProposalKernel, type Actor, type Proposal, type ProposedChange } from '../src/proposals/kernel.js';
import { makeOrgData } from '@gtm-trust-kernel/adapters/fixtures';

/**
 * apply() writes one field at a time, so a two-field proposal can fail on
 * field 2 after field 1 was written. The proposal may be retried only if
 * the CRM was left as it was (field 1 fully rolled back). Otherwise it is
 * spent and a new proposal is needed.
 */

const rep: Actor = { id: 'user:rep-1', role: 'rep' };
const manager: Actor = { id: 'user:mgr-1', role: 'manager' };
const alwaysOn = { writesEnabled: () => true };
const EVIDENCE_IDS = new Set(['note-1', 'act-1', 'opp-1', 'sh-1']);
const ref = { crm: 'mock', orgId: 'org-test', objectType: 'opportunity', id: 'opp-1' } as const;

type WriteHook = (w: FieldWrite, call: number) => WriteOutcome | 'throw' | 'pass';

/** Wraps the mock adapter so individual applyFieldWrite calls can throw or return a fixed outcome. */
function withWriteHook(inner: MockAdapter, hook: WriteHook): CrmAdapter {
  let call = 0;
  return new Proxy(inner, {
    get(target, prop, receiver) {
      if (prop === 'applyFieldWrite') {
        return async (w: FieldWrite): Promise<WriteOutcome> => {
          call += 1;
          const r = hook(w, call);
          if (r === 'throw') throw new Error(`injected failure on call ${call}`);
          if (r === 'pass') return target.applyFieldWrite(w);
          return r;
        };
      }
      const v: unknown = Reflect.get(target, prop, receiver);
      return typeof v === 'function' ? v.bind(target) : v;
    },
  }) as CrmAdapter;
}

function twoFieldChanges(): ProposedChange[] {
  const base = {
    ref,
    expectedConcurrencyToken: 'tok-opp-1-v1',
    rationale: 'Security questionnaire is the stated gate and no meeting is scheduled.',
    citedRecordIds: ['note-1'],
  };
  return [
    {
      ...base,
      field: 'nextStep',
      newValue: 'Book security review with Dana',
      previousValue: 'Send redlines to legal',
    },
    { ...base, field: 'closeDate', newValue: '2026-12-15', previousValue: '2026-11-30' },
  ];
}

function setup(hook: WriteHook) {
  const data = makeOrgData();
  const adapter = withWriteHook(new MockAdapter('org-test', data, {}), hook);
  const ledger = new InMemoryLedger();
  const k = new ProposalKernel(adapter, ledger, alwaysOn);
  const p: Proposal = k.build({
    id: 'prop-1',
    createdBy: rep,
    evidenceSetId: 'ev-1',
    modelVersion: 'test-model',
    promptVersion: 'v1',
    changes: twoFieldChanges(),
    evidenceRecordIds: EVIDENCE_IDS,
  });
  const opp = () => data.opportunities[0] as unknown as Record<string, unknown>;
  return { k, ledger, approved: k.approve(p, manager), opp };
}

// Call 1 writes nextStep, call 2 (closeDate) fails, call 3 is the inverse write for nextStep.

describe('apply() after a partial write', () => {
  it('spends the proposal when the rollback write throws', async () => {
    const { k, ledger, approved, opp } = setup((_w, call) => (call === 1 ? 'pass' : 'throw'));
    const result = await k.apply(approved, 'org-test');

    expect(result.status).toBe('failed');
    expect(result.failureReason).toMatch(/not fully rolled back.*create a new one/);
    expect(opp().nextStep).toBe('Book security review with Dana'); // the half-applied state is real
    expect(ledger.entries().map((e) => e.kind)).toContain('partial_rollback_failed');

    await expect(k.apply(approved, 'org-test')).rejects.toMatchObject({ code: 'NOT_KERNEL_APPROVED' });
  });

  it('spends the proposal when the rollback write returns a conflict instead of throwing', async () => {
    const { k, approved } = setup((_w, call) => {
      if (call === 1) return 'pass';
      if (call === 2) return 'throw';
      return { status: 'conflict', currentValue: 'someone else', currentToken: 'tok-other' };
    });
    const result = await k.apply(approved, 'org-test');

    expect(result.status).toBe('failed');
    expect(result.failureReason).toMatch(/not fully rolled back/);
    await expect(k.apply(approved, 'org-test')).rejects.toMatchObject({ code: 'NOT_KERNEL_APPROVED' });
  });

  it('logs which field could not be restored when an undo write fails without throwing', async () => {
    const { k, ledger, approved } = setup((_w, call) => {
      if (call === 1) return 'pass';
      if (call === 2) return 'throw';
      return { status: 'conflict', currentValue: 'someone else', currentToken: 'tok-other' };
    });
    await k.apply(approved, 'org-test');

    const failed = ledger.entries().filter((e) => e.kind === 'partial_rollback_failed');
    expect(failed).toHaveLength(1);
    expect(failed[0]!.detail).toMatchObject({ field: 'nextStep', recordId: 'opp-1', outcome: 'conflict' });
    expect(ledger.verify()).toEqual({ ok: true });
  });

  it('spends the proposal when field 2 returns a non-applied outcome and the rollback conflicts', async () => {
    const { k, approved } = setup((_w, call) => {
      if (call === 1) return 'pass';
      return { status: 'conflict', currentValue: 'someone else', currentToken: 'tok-other' };
    });
    const result = await k.apply(approved, 'org-test');

    expect(result.status).toBe('failed');
    expect(result.failureReason).toMatch(/changed since read.*not fully rolled back/);
    await expect(k.apply(approved, 'org-test')).rejects.toMatchObject({ code: 'NOT_KERNEL_APPROVED' });
  });

  it('keeps the proposal retryable when the partial write was fully rolled back', async () => {
    const { k, ledger, approved, opp } = setup((_w, call) => (call === 2 ? 'throw' : 'pass'));
    const result = await k.apply(approved, 'org-test');

    expect(result.status).toBe('failed');
    expect(result.failureReason).not.toMatch(/not fully rolled back/);
    expect(opp().nextStep).toBe('Send redlines to legal');
    expect(ledger.entries().map((e) => e.kind)).not.toContain('partial_rollback_failed');

    // A retry is accepted by the kernel. It then fails on the concurrency
    // token (the record moved on during write + rollback) rather than
    // overwriting; it is not rejected as unapproved.
    const retry = await k.apply(approved, 'org-test');
    expect(retry.status).toBe('failed');
    expect(retry.failureReason).toMatch(/changed since read/);
  });

  it('keeps the proposal retryable when the first write fails and nothing was written', async () => {
    const { k, ledger, approved } = setup((_w, call) => (call === 1 ? 'throw' : 'pass'));
    const result = await k.apply(approved, 'org-test');
    expect(result.status).toBe('failed');
    expect(result.failureReason).not.toMatch(/not fully rolled back/);

    // With I3 token chaining, the retry writes both fields on the same record.
    const retry = await k.apply(approved, 'org-test');
    expect(retry.status).toBe('applied');
    expect(ledger.entries().filter((e) => e.kind === 'applied')).toHaveLength(1);
  });
});

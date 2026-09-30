import { describe, expect, it } from 'vitest';
import { InMemoryLedger } from '../src/audit/ledger.js';
import { MockAdapter } from '@gtm-trust-kernel/adapters/mock.js';
import type { CrmAdapter, FieldWrite, WriteOutcome } from '@gtm-trust-kernel/adapters/types.js';
import { ProposalKernel, type Actor, type ProposedChange } from '../src/proposals/kernel.js';
import { makeOrgData } from '@gtm-trust-kernel/adapters/fixtures';

/**
 * I3 token chaining: apply() writes one field at a time, so a later write to
 * a record that was read at the same token as the first write expects the
 * token the previous write returned. A change read at any other token is sent
 * as-is. An outside edit between writes still conflicts.
 */

const rep: Actor = { id: 'user:rep-1', role: 'rep' };
const manager: Actor = { id: 'user:mgr-1', role: 'manager' };
const alwaysOn = { writesEnabled: () => true };
const EVIDENCE_IDS = new Set(['note-1', 'act-1', 'opp-1', 'sh-1']);
const ref = { crm: 'mock', orgId: 'org-test', objectType: 'opportunity', id: 'opp-1' } as const;

function twoFieldChanges(): ProposedChange[] {
  const base = {
    ref,
    expectedConcurrencyToken: 'tok-opp-1-v1',
    rationale: 'Security questionnaire is the stated gate and no meeting is scheduled.',
    citedRecordIds: ['note-1'],
  };
  return [
    { ...base, field: 'nextStep', newValue: 'Book security review with Dana', previousValue: 'Send redlines to legal' },
    { ...base, field: 'closeDate', newValue: '2026-12-15', previousValue: '2026-11-30' },
  ];
}

/** Runs `beforeCall(n)` before each applyFieldWrite call reaches the mock. */
function withBeforeWrite(inner: MockAdapter, beforeCall: (call: number) => Promise<void>): CrmAdapter {
  let call = 0;
  return new Proxy(inner, {
    get(target, prop, receiver) {
      if (prop === 'applyFieldWrite') {
        return async (w: FieldWrite): Promise<WriteOutcome> => {
          call += 1;
          await beforeCall(call);
          return target.applyFieldWrite(w);
        };
      }
      const v: unknown = Reflect.get(target, prop, receiver);
      return typeof v === 'function' ? v.bind(target) : v;
    },
  }) as CrmAdapter;
}

function setup(
  beforeCall: (call: number, mock: MockAdapter, data: ReturnType<typeof makeOrgData>) => Promise<void> = async () => {},
  changes: ProposedChange[] = twoFieldChanges(),
) {
  const data = makeOrgData();
  const mock = new MockAdapter('org-test', data, {});
  const adapter = withBeforeWrite(mock, (call) => beforeCall(call, mock, data));
  const ledger = new InMemoryLedger();
  const k = new ProposalKernel(adapter, ledger, alwaysOn);
  const p = k.build({
    id: 'prop-1',
    createdBy: rep,
    evidenceSetId: 'ev-1',
    modelVersion: 'test-model',
    promptVersion: 'v1',
    changes,
    evidenceRecordIds: EVIDENCE_IDS,
  });
  const opp = () => data.opportunities[0] as unknown as Record<string, unknown>;
  return { k, ledger, approved: k.approve(p, manager), opp };
}

describe('I3 token chaining for two changes to one record', () => {
  it('applies nextStep and closeDate on the same opportunity, and rolls both back', async () => {
    const { k, ledger, approved, opp } = setup();
    const applied = await k.apply(approved, 'org-test');

    expect(applied.status).toBe('applied');
    expect(opp().nextStep).toBe('Book security review with Dana');
    expect(opp().closeDate).toBe('2026-12-15');

    const rolled = await k.rollback(applied, manager);
    expect(rolled.status).toBe('rolled_back');
    expect(opp().nextStep).toBe('Send redlines to legal');
    expect(opp().closeDate).toBe('2026-11-30');
    expect(ledger.entries().map((e) => e.kind)).toEqual([
      'proposal_created',
      'proposal_approved',
      'applied',
      'rolled_back',
    ]);
  });

  it('conflicts on field 2 when the record is edited outside the kernel between the two writes', async () => {
    const { k, ledger, approved, opp } = setup(async (call, mock, data) => {
      if (call !== 2) return;
      // An outside edit to the same record, through the adapter, between field 1 and field 2.
      const current = data.opportunities[0]!;
      const outside = await mock.applyFieldWrite({
        ref,
        field: 'amount',
        newValue: 123456,
        previousValue: null,
        expectedConcurrencyToken: current.concurrencyToken,
      });
      expect(outside.status).toBe('applied');
    });

    const result = await k.apply(approved, 'org-test');

    expect(result.status).toBe('failed');
    expect(result.failureReason).toMatch(/record changed since read on field 'closeDate'/);
    expect(opp().closeDate).not.toBe('2026-12-15');

    // The rollback path ran. Undoing nextStep also conflicts, because the
    // outside edit moved the token on, so the kernel refuses to overwrite it,
    // logs the field it could not restore, and spends the proposal.
    const kinds = ledger.entries().map((e) => e.kind);
    expect(kinds).toEqual(['proposal_created', 'proposal_approved', 'partial_rollback_failed', 'apply_failed']);
    expect(ledger.entries()[2]!.detail).toMatchObject({ field: 'nextStep', outcome: 'conflict' });
    expect(opp().amount).toBe(123456);
    expect(result.failureReason).toMatch(/not fully rolled back/);
    await expect(k.apply(approved, 'org-test')).rejects.toMatchObject({ code: 'NOT_KERNEL_APPROVED' });
  });

  it('sends a change with a different proposal-time token as-is: it conflicts, earlier writes roll back, later ones never run', async () => {
    const [first, third] = twoFieldChanges();
    const stale: ProposedChange = {
      ...first!,
      field: 'closeDate',
      newValue: '2027-01-31',
      previousValue: '2026-11-30',
      expectedConcurrencyToken: 'stale-token',
    };
    const changes = [first!, stale, { ...third!, field: 'nextStep', newValue: 'Send order form' }];
    const writes: number[] = [];
    const { k, ledger, approved, opp } = setup(async (call) => {
      writes.push(call);
    }, changes);

    const result = await k.apply(approved, 'org-test');

    expect(result.status).toBe('failed');
    expect(result.failureReason).toMatch(/record changed since read on field 'closeDate'/);
    expect(result.failureReason).not.toMatch(/not fully rolled back/);
    // Call 1 writes change 1, call 2 is the stale change 2 (conflict), call 3
    // undoes change 1. Change 3 is never written.
    expect(writes).toEqual([1, 2, 3]);
    expect(opp().nextStep).toBe('Send redlines to legal');
    expect(opp().closeDate).not.toBe('2027-01-31');
    expect(ledger.entries().map((e) => e.kind)).toEqual(['proposal_created', 'proposal_approved', 'apply_failed']);
  });
});

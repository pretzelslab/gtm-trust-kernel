import { describe, expect, it } from 'vitest';
import { InMemoryLedger } from '../src/audit/ledger.js';
import { MockAdapter } from '@gtm-trust-kernel/adapters/mock.js';
import {
  KernelError,
  ProposalKernel,
  type Actor,
  type Proposal,
  type ProposedChange,
} from '../src/proposals/kernel.js';
import { makeOrgData } from '@gtm-trust-kernel/adapters/fixtures';

/**
 * I1 and I2 at apply(): Proposal is a plain object, so apply() must not
 * trust its fields. Only the exact object approve() returned, once, applies.
 * Setup mirrors kernel.test.ts (its helpers are not exported).
 */

const rep: Actor = { id: 'user:rep-1', role: 'rep' };
const manager: Actor = { id: 'user:mgr-1', role: 'manager' };
const alwaysOn = { writesEnabled: () => true };
const EVIDENCE_IDS = new Set(['note-1', 'act-1', 'opp-1', 'sh-1']);

function setup() {
  const data = makeOrgData();
  const adapter = new MockAdapter('org-test', data, {});
  const ledger = new InMemoryLedger();
  const k = new ProposalKernel(adapter, ledger, alwaysOn);
  const opp = () => data.opportunities[0] as unknown as Record<string, unknown>;
  return { k, ledger, opp };
}

function change(overrides: Partial<ProposedChange> = {}): ProposedChange {
  return {
    ref: { crm: 'mock', orgId: 'org-test', objectType: 'opportunity', id: 'opp-1' },
    field: 'nextStep',
    newValue: 'Book security review with Dana',
    previousValue: 'Send redlines to legal',
    expectedConcurrencyToken: 'tok-opp-1-v1',
    rationale: 'Security questionnaire is the stated gate and no meeting is scheduled.',
    citedRecordIds: ['note-1'],
    ...overrides,
  };
}

function build(k: ProposalKernel, by: Actor = rep): Proposal {
  return k.build({
    id: 'prop-1',
    createdBy: by,
    evidenceSetId: 'ev-1',
    modelVersion: 'test-model',
    promptVersion: 'v1',
    changes: [change()],
    evidenceRecordIds: EVIDENCE_IDS,
  });
}

function kinds(ledger: InMemoryLedger): string[] {
  return ledger.entries().map((e) => e.kind);
}

describe('apply() rejects proposals not approved by this kernel', () => {
  it('rejects a pending proposal with status forged to approved', async () => {
    const { k, ledger, opp } = setup();
    const before = structuredClone(opp().nextStep);
    const forged: Proposal = { ...build(k), status: 'approved', approvedBy: manager };
    await expect(k.apply(forged, 'org-test')).rejects.toMatchObject({ code: 'NOT_KERNEL_APPROVED' });
    expect(kinds(ledger)).toEqual(['proposal_created']);
    expect(opp().nextStep).toEqual(before);
  });

  it('rejects an approved proposal copied with a stage change swapped in', async () => {
    const { k, ledger, opp } = setup();
    const approved = k.approve(build(k), manager);
    const forged: Proposal = {
      ...approved,
      changes: [change({ field: 'stage', newValue: 'closed_won', previousValue: 'negotiation' })],
    };
    await expect(k.apply(forged, 'org-test')).rejects.toBeInstanceOf(KernelError);
    expect(kinds(ledger)).not.toContain('applied');
    expect(opp().stage).toBe('negotiation');
  });

  it('rejects an approved proposal copied with the creator role forged to admin', async () => {
    const { k, ledger } = setup();
    const approved = k.approve(build(k), manager);
    const forged: Proposal = { ...approved, createdBy: { ...approved.createdBy, role: 'admin' } };
    await expect(k.apply(forged, 'org-test')).rejects.toMatchObject({ code: 'NOT_KERNEL_APPROVED' });
    expect(kinds(ledger)).not.toContain('applied');
  });

  it('rejects a proposal approved by a different kernel instance', async () => {
    const a = setup();
    const b = setup();
    const approvedByA = a.k.approve(build(a.k), manager);
    await expect(b.k.apply(approvedByA, 'org-test')).rejects.toMatchObject({
      code: 'NOT_KERNEL_APPROVED',
    });
  });
});

describe('the approved proposal is deep-frozen', () => {
  it('throws on mutation of nested fields and still applies the original values', async () => {
    const { k, opp } = setup();
    const approved = k.approve(build(k), manager);

    expect(() => {
      (approved.createdBy as { role: string }).role = 'admin';
    }).toThrow(TypeError);
    expect(() => {
      (approved.changes[0] as { newValue: unknown }).newValue = 'Injected value';
    }).toThrow(TypeError);
    expect(() => {
      (approved.changes[0]!.ref as { id: string }).id = 'opp-2';
    }).toThrow(TypeError);
    expect(() => {
      (approved.changes as ProposedChange[]).push(change({ field: 'stage' }));
    }).toThrow(TypeError);

    expect(approved.createdBy.role).toBe('rep');
    const applied = await k.apply(approved, 'org-test');
    expect(applied.status).toBe('applied');
    expect(opp().nextStep).toBe('Book security review with Dana');
  });
});

describe('apply() cannot be replayed', () => {
  it('rejects a second apply of the same approved object and writes no second ledger entry', async () => {
    const { k, ledger } = setup();
    const approved = k.approve(build(k), manager);
    const first = await k.apply(approved, 'org-test');
    expect(first.status).toBe('applied');

    await expect(k.apply(approved, 'org-test')).rejects.toMatchObject({ code: 'NOT_KERNEL_APPROVED' });
    expect(kinds(ledger).filter((kind) => kind === 'applied')).toHaveLength(1);
    expect(ledger.verify()).toEqual({ ok: true });
  });

  it('rejects a concurrent second apply of the same approved object', async () => {
    const { k, ledger } = setup();
    const approved = k.approve(build(k), manager);
    const results = await Promise.allSettled([
      k.apply(approved, 'org-test'),
      k.apply(approved, 'org-test'),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((r) => r.status === 'rejected')).toHaveLength(1);
    expect(kinds(ledger).filter((kind) => kind === 'applied')).toHaveLength(1);
  });
});

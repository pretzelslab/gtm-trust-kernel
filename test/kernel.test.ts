import { describe, expect, it } from 'vitest';
import { InMemoryLedger } from '../src/audit/ledger.js';
import { MockAdapter } from '../src/adapters/mock.js';
import {
  DEFAULT_ALLOWLIST,
  KernelError,
  ProposalKernel,
  type Actor,
  type ProposedChange,
} from '../src/proposals/kernel.js';
import { makeOrgData } from './fixtures.js';

const rep: Actor = { id: 'user:rep-1', role: 'rep' };
const manager: Actor = { id: 'user:mgr-1', role: 'manager' };

const alwaysOn = { writesEnabled: () => true };
const alwaysOff = { writesEnabled: () => false };

function setup(opts: { faults?: ConstructorParameters<typeof MockAdapter>[3] } = {}) {
  const data = makeOrgData();
  const adapter = new MockAdapter('org-test', data, {}, opts.faults ?? {});
  const ledger = new InMemoryLedger();
  return { data, adapter, ledger };
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

const EVIDENCE_IDS = new Set(['note-1', 'act-1', 'opp-1', 'sh-1']);

function build(k: ProposalKernel, changes = [change()], by: Actor = rep) {
  return k.build({
    id: 'prop-1',
    createdBy: by,
    evidenceSetId: 'ev-1',
    modelVersion: 'test-model',
    promptVersion: 'v1',
    changes,
    evidenceRecordIds: EVIDENCE_IDS,
  });
}

describe('I1 field allowlist', () => {
  it('refuses a field outside the role allowlist', () => {
    const { adapter, ledger } = setup();
    const k = new ProposalKernel(adapter, ledger, alwaysOn, DEFAULT_ALLOWLIST);
    expect(() => build(k, [change({ field: 'amount' })], rep)).toThrow(KernelError);
  });

  it('allows a field the role does own', () => {
    const { adapter, ledger } = setup();
    const k = new ProposalKernel(adapter, ledger, alwaysOn);
    expect(build(k).status).toBe('pending_approval');
  });
});

describe('grounding requirement', () => {
  it('refuses an uncited change', () => {
    const { adapter, ledger } = setup();
    const k = new ProposalKernel(adapter, ledger, alwaysOn);
    expect(() => build(k, [change({ citedRecordIds: [] })])).toThrow(/no citations/);
  });

  it('refuses a citation outside the evidence set', () => {
    const { adapter, ledger } = setup();
    const k = new ProposalKernel(adapter, ledger, alwaysOn);
    expect(() => build(k, [change({ citedRecordIds: ['fabricated-1'] })])).toThrow(
      /not in evidence set/,
    );
  });
});

describe('I2 approval required', () => {
  it('refuses apply without approval', async () => {
    const { adapter, ledger } = setup();
    const k = new ProposalKernel(adapter, ledger, alwaysOn);
    await expect(k.apply(build(k), 'org-test')).rejects.toThrow(/requires status 'approved'/);
  });

  it('refuses self-approval above rep level', () => {
    const { adapter, ledger } = setup();
    const k = new ProposalKernel(adapter, ledger, alwaysOn);
    const p = build(k, [change({ field: 'forecastCategory' })], manager);
    expect(() => k.approve(p, manager)).toThrow(/approver must differ/);
  });
});

describe('I3 optimistic concurrency', () => {
  it('fails rather than overwriting when the record drifted', async () => {
    const { adapter, ledger } = setup({ faults: { driftTokensBeforeWrite: true } });
    const k = new ProposalKernel(adapter, ledger, alwaysOn);
    const applied = await k.apply(k.approve(build(k), manager), 'org-test');
    expect(applied.status).toBe('failed');
    expect(applied.failureReason).toMatch(/changed since read/);
  });

  it('fails cleanly when the record was deleted between read and apply', async () => {
    const { adapter, ledger } = setup({ faults: { deleteBeforeWrite: new Set(['opp-1']) } });
    const k = new ProposalKernel(adapter, ledger, alwaysOn);
    const applied = await k.apply(k.approve(build(k), manager), 'org-test');
    expect(applied.status).toBe('failed');
    expect(applied.failureReason).toMatch(/not_found/);
  });
});

describe('I4 rollback', () => {
  it('restores the previous value', async () => {
    const { data, adapter, ledger } = setup();
    const k = new ProposalKernel(adapter, ledger, alwaysOn);
    const applied = await k.apply(k.approve(build(k), manager), 'org-test');
    expect(applied.status).toBe('applied');
    expect((data.opportunities[0] as unknown as Record<string, unknown>).nextStep).toBe(
      'Book security review with Dana',
    );

    const rolled = await k.rollback(applied, manager);
    expect(rolled.status).toBe('rolled_back');
    expect((data.opportunities[0] as unknown as Record<string, unknown>).nextStep).toBe(
      'Send redlines to legal',
    );
  });
});

describe('I5 audit chain', () => {
  it('records every transition and verifies', async () => {
    const { adapter, ledger } = setup();
    const k = new ProposalKernel(adapter, ledger, alwaysOn);
    const applied = await k.apply(k.approve(build(k), manager), 'org-test');
    await k.rollback(applied, manager);
    const kinds = ledger.entries().map((e) => e.kind);
    expect(kinds).toEqual([
      'proposal_created',
      'proposal_approved',
      'applied',
      'rolled_back',
    ]);
    expect(ledger.verify()).toEqual({ ok: true });
  });

  it('detects tampering', () => {
    const ledger = new InMemoryLedger();
    ledger.append({ kind: 'applied', at: '2026-01-01T00:00:00Z', proposalId: 'a' });
    ledger.append({ kind: 'rolled_back', at: '2026-01-02T00:00:00Z', proposalId: 'a' });
    const entries = ledger.entries() as unknown as { proposalId: string }[];
    entries[0]!.proposalId = 'tampered';
    expect(ledger.verify()).toEqual({ ok: false, brokenAtSeq: 0 });
  });
});

describe('I6 expiry', () => {
  it('expires rather than applying to drifted state', async () => {
    const { adapter, ledger } = setup();
    let t = new Date('2026-09-13T00:00:00Z');
    const k = new ProposalKernel(adapter, ledger, alwaysOn, DEFAULT_ALLOWLIST, () => t);
    const p = build(k);
    t = new Date('2026-09-14T00:00:00Z');
    expect(k.approve(p, manager).status).toBe('expired');
  });
});

describe('I7 kill switch', () => {
  it('blocks apply with no redeploy', async () => {
    const { adapter, ledger } = setup();
    const k = new ProposalKernel(adapter, ledger, alwaysOff);
    const out = await k.apply(k.approve(build(k), manager), 'org-test');
    expect(out.status).toBe('failed');
    expect(out.failureReason).toMatch(/kill switch/);
    expect(ledger.entries().some((e) => e.kind === 'apply_blocked_kill_switch')).toBe(true);
  });
});

describe('partial failure', () => {
  it('rolls back earlier writes when a later one conflicts', async () => {
    const { data, adapter, ledger } = setup();
    const k = new ProposalKernel(adapter, ledger, alwaysOn);
    const p = k.build({
      id: 'prop-2',
      createdBy: { id: 'user:revops', role: 'revops' },
      evidenceSetId: 'ev-1',
      modelVersion: 'test-model',
      promptVersion: 'v1',
      changes: [
        change(),
        change({
          field: 'closeDate',
          newValue: '2026-12-31',
          previousValue: null,
          expectedConcurrencyToken: 'stale-token',
        }),
      ],
      evidenceRecordIds: EVIDENCE_IDS,
    });
    const out = await k.apply(k.approve(p, manager), 'org-test');
    expect(out.status).toBe('failed');
    expect((data.opportunities[0] as unknown as Record<string, unknown>).nextStep).toBe(
      'Send redlines to legal',
    );
  });
});

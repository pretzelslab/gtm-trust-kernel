/**
 * MockAdapter fault injection (MockFaults): each faulted call must throw an
 * AdapterError with the requested kind, not just any error. 0.2.0 shipped
 * these paths with a CommonJS require() that threw ReferenceError under
 * Node's ESM loader, which a bare `.rejects.toThrow()` did not catch.
 */

import { describe, expect, it } from 'vitest';
import { MockAdapter, type MockOrgData } from '../src/mock.js';
import { AdapterError } from '../src/types.js';

const EMPTY: MockOrgData = {
  accounts: [],
  opportunities: [],
  contacts: [],
  activities: [],
  notes: [],
  stageHistory: [],
  ownerChanges: [],
  nextStepChanges: [],
};

const ref = (objectType: 'account' | 'contact', id: string) => ({ crm: 'mock' as const, orgId: 'org', objectType, id });

async function caught(p: Promise<unknown>): Promise<unknown> {
  return p.then(
    () => undefined,
    (e: unknown) => e,
  );
}

describe('MockAdapter fault injection', () => {
  it('fails the nth list call (listOpportunities) with an AdapterError of the requested kind', async () => {
    const adapter = new MockAdapter('org', EMPTY, {}, { failListOnCall: { n: 2, kind: 'rate_limit' } });
    await expect(adapter.listOpportunities({ limit: 10 })).resolves.toBeDefined();
    const err = await caught(adapter.listOpportunities({ limit: 10 }));
    expect(err).toBeInstanceOf(AdapterError);
    expect((err as AdapterError).kind).toBe('rate_limit');
    expect((err as AdapterError).retryable).toBe(true);
    expect((err as AdapterError).retryAfterMs).toBe(1000);
  });

  it('fails listOpportunitiesForSample the same way, and marks auth as not retryable', async () => {
    const adapter = new MockAdapter('org', EMPTY, {}, { failListOnCall: { n: 1, kind: 'auth' } });
    const err = await caught(adapter.listOpportunitiesForSample({ asOf: '2026-09-30T00:00:00.000Z', closedWithinMonths: 12, limit: 10 }));
    expect(err).toBeInstanceOf(AdapterError);
    expect((err as AdapterError).kind).toBe('auth');
    expect((err as AdapterError).retryable).toBe(false);
  });

  it('fails the nth getAccounts call', async () => {
    const adapter = new MockAdapter('org', EMPTY, {}, { failGetAccountsOnCall: { n: 1, kind: 'network' } });
    const err = await caught(adapter.getAccounts([ref('account', 'acc-1')]));
    expect(err).toBeInstanceOf(AdapterError);
    expect((err as AdapterError).kind).toBe('network');
  });

  it('fails the nth getContactsByRef call', async () => {
    const adapter = new MockAdapter('org', EMPTY, {}, { failGetContactsOnCall: { n: 1, kind: 'network' } });
    const err = await caught(adapter.getContactsByRef([ref('contact', 'con-1')]));
    expect(err).toBeInstanceOf(AdapterError);
    expect((err as AdapterError).kind).toBe('network');
  });
});

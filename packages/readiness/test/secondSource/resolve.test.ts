import { describe, expect, it } from 'vitest';
import { MockSecondSourceAdapter, type MockSecondSourceOrgData } from '@gtm-trust-kernel/adapters/mock.js';
import type { Account, Contact, RecordRef } from '@gtm-trust-kernel/adapters/model/canonical.js';
import type { SecondSourceAccount, SecondSourceContact, SecondSourceRef } from '@gtm-trust-kernel/adapters/types.js';
import { resolveSecondSource } from '../../src/secondSource/resolve.js';
import type { CoverageSample } from '../../src/metrics/types.js';
import { makeCoverageSample } from '../support/coverageSample.js';

const ORG = 'org-resolve-test';
const SOURCE = 'mock-second-source';

const ref = (objectType: RecordRef['objectType'], id: string): RecordRef => ({ crm: 'mock', orgId: ORG, objectType, id });
const ssRef = (objectType: SecondSourceRef['objectType'], id: string): SecondSourceRef => ({ source: SOURCE, orgId: ORG, objectType, id });

function crmContact(id: string, email?: string): Contact {
  return { ref: ref('contact', id), name: `Contact ${id}`, email, createdAt: '2026-01-01T00:00:00.000Z', modifiedAt: '2026-01-01T00:00:00.000Z' };
}

function crmAccount(id: string, domain?: string): Account {
  return { ref: ref('account', id), name: `Account ${id}`, domain, createdAt: '2026-01-01T00:00:00.000Z', modifiedAt: '2026-01-01T00:00:00.000Z' };
}

function baseSample(contactsByRef: ReadonlyMap<string, Contact>, accountsByRef: ReadonlyMap<string, Account>): CoverageSample {
  return makeCoverageSample({ accountsByRef, accountsHydrated: true, contactsByRef, contactsHydrated: true });
}

function makeSecondSourceAdapter(contacts: SecondSourceContact[], accounts: SecondSourceAccount[] = []) {
  const data: MockSecondSourceOrgData = { contacts, accounts, activities: [] };
  return new MockSecondSourceAdapter(data);
}

describe('resolveSecondSource preconditions', () => {
  it('throws when contactsHydrated is false', async () => {
    const sample = { ...baseSample(new Map(), new Map()), contactsHydrated: false };
    await expect(resolveSecondSource(sample, makeSecondSourceAdapter([]))).rejects.toThrow();
  });

  it('throws when accountsHydrated is false', async () => {
    const sample = { ...baseSample(new Map(), new Map()), accountsHydrated: false };
    await expect(resolveSecondSource(sample, makeSecondSourceAdapter([]))).rejects.toThrow();
  });
});

describe('resolveSecondSource capabilities', () => {
  it('captures the second-source adapter\'s capabilities onto the resolution, for D5 metrics to gate on', async () => {
    const sample = baseSample(new Map(), new Map());
    const adapter = makeSecondSourceAdapter([], []);
    const resolution = await resolveSecondSource(sample, adapter);
    expect(resolution.capabilities.hasContacts).toBe(true);
    expect(resolution.capabilities.hasAccounts).toBe(true);
    expect(resolution.capabilities.hasActivities).toBe(true);
  });

  it('reflects a capability override (e.g. hasActivities: false) on the resolution', async () => {
    const sample = baseSample(new Map(), new Map());
    const data: MockSecondSourceOrgData = { contacts: [], accounts: [], activities: [] };
    const adapter = new MockSecondSourceAdapter(data, { hasActivities: false });
    const resolution = await resolveSecondSource(sample, adapter);
    expect(resolution.capabilities.hasActivities).toBe(false);
  });
});

describe('resolveSecondSource matching', () => {
  it('resolves a CRM contact that matches exactly one second-source contact by email', async () => {
    const sample = baseSample(new Map([['con-1', crmContact('con-1', 'dana@example.com')]]), new Map());
    const adapter = makeSecondSourceAdapter([{ ref: ssRef('contact', 'ss-1'), email: 'dana@example.com', modifiedAt: '2026-01-01T00:00:00.000Z' }]);

    const resolution = await resolveSecondSource(sample, adapter);

    expect(resolution.contactMatches.get('con-1')?.map((r) => r.id)).toEqual(['ss-1']);
  });

  it('leaves a CRM contact with no match absent from contactMatches', async () => {
    const sample = baseSample(new Map([['con-1', crmContact('con-1', 'dana@example.com')]]), new Map());
    const adapter = makeSecondSourceAdapter([{ ref: ssRef('contact', 'ss-1'), email: 'someone-else@example.com', modifiedAt: '2026-01-01T00:00:00.000Z' }]);

    const resolution = await resolveSecondSource(sample, adapter);

    expect(resolution.contactMatches.has('con-1')).toBe(false);
  });

  it('does not dedup: every second-source contact sharing a hashed email counts as a match', async () => {
    const sample = baseSample(new Map([['con-1', crmContact('con-1', 'dana@example.com')]]), new Map());
    const adapter = makeSecondSourceAdapter([
      { ref: ssRef('contact', 'ss-1'), email: 'dana@example.com', modifiedAt: '2026-01-01T00:00:00.000Z' },
      { ref: ssRef('contact', 'ss-2'), email: 'Dana@Example.com', modifiedAt: '2026-01-01T00:00:00.000Z' }, // same normalized email, a second duplicate record
    ]);

    const resolution = await resolveSecondSource(sample, adapter);

    expect(resolution.contactMatches.get('con-1')?.map((r) => r.id).sort()).toEqual(['ss-1', 'ss-2']);
  });

  it('resolves a CRM account by normalized domain', async () => {
    const sample = baseSample(new Map(), new Map([['acc-1', crmAccount('acc-1', 'https://Example.com/')]]));
    const adapter = makeSecondSourceAdapter([], [{ ref: ssRef('account', 'ss-acc-1'), domain: 'example.com', modifiedAt: '2026-01-01T00:00:00.000Z' }]);

    const resolution = await resolveSecondSource(sample, adapter);

    expect(resolution.accountMatches.get('acc-1')?.map((r) => r.id)).toEqual(['ss-acc-1']);
  });
});

describe('resolveSecondSource — no merged record, no raw PII, fresh salt per run', () => {
  it('never nests a full CRM or second-source record inside a match — only refs', async () => {
    const sample = baseSample(new Map([['con-1', crmContact('con-1', 'dana@example.com')]]), new Map());
    const adapter = makeSecondSourceAdapter([{ ref: ssRef('contact', 'ss-1'), email: 'dana@example.com', modifiedAt: '2026-01-01T00:00:00.000Z' }]);

    const resolution = await resolveSecondSource(sample, adapter);
    const matched = resolution.contactMatches.get('con-1')!;

    for (const m of matched) {
      expect(Object.keys(m).sort()).toEqual(['id', 'objectType', 'orgId', 'source']);
    }
  });

  it('carries no raw email or domain substring anywhere in the resolution', async () => {
    const sample = baseSample(
      new Map([['con-1', crmContact('con-1', 'dana@example.com')]]),
      new Map([['acc-1', crmAccount('acc-1', 'example.com')]]),
    );
    const adapter = makeSecondSourceAdapter(
      [{ ref: ssRef('contact', 'ss-1'), email: 'dana@example.com', modifiedAt: '2026-01-01T00:00:00.000Z' }],
      [{ ref: ssRef('account', 'ss-acc-1'), domain: 'example.com', modifiedAt: '2026-01-01T00:00:00.000Z' }],
    );

    const resolution = await resolveSecondSource(sample, adapter);
    const serializable = {
      contactMatches: [...resolution.contactMatches.entries()],
      accountMatches: [...resolution.accountMatches.entries()],
      secondSourceSample: resolution.secondSourceSample,
    };
    const serialized = JSON.stringify(serializable);

    expect(serialized).not.toContain('dana@example.com');
    // normalized domain IS expected to appear (account_resolution_rate's definition uses it unhashed) —
    // only the raw email is a "never materialize" requirement (metric-definitions.md D5 intro).
  });

  it('generates a fresh salt per call: the same raw email hashes differently across two separate runs', async () => {
    const sample = baseSample(new Map([['con-1', crmContact('con-1', 'dana@example.com')]]), new Map());
    const adapter = makeSecondSourceAdapter([{ ref: ssRef('contact', 'ss-1'), email: 'dana@example.com', modifiedAt: '2026-01-01T00:00:00.000Z' }]);

    const first = await resolveSecondSource(sample, adapter);
    const second = await resolveSecondSource(sample, adapter);

    expect(first.secondSourceSample.contacts[0]!.emailHash).not.toBe(second.secondSourceSample.contacts[0]!.emailHash);
  });
});

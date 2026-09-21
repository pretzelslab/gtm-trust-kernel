import { describe, expect, it } from 'vitest';
import { MockSecondSourceAdapter, type MockSecondSourceOrgData } from '@gtm-trust-kernel/adapters/mock.js';
import type {
  SecondSourceAccount,
  SecondSourceActivity,
  SecondSourceCapabilities,
  SecondSourceContact,
  SecondSourceRef,
} from '@gtm-trust-kernel/adapters/types.js';
import { sampleSecondSource } from '../../src/secondSource/sample.js';

const ORG = 'org-second-source-sample-test';
const SOURCE = 'mock-second-source';
const ref = (objectType: SecondSourceRef['objectType'], id: string): SecondSourceRef => ({ source: SOURCE, orgId: ORG, objectType, id });
const iso = (daysAgo: number) => new Date(Date.UTC(2026, 8, 20) - daysAgo * 86_400_000).toISOString();

function makeData(counts: { contacts: number; accounts: number; activities: number }): MockSecondSourceOrgData {
  const contacts: SecondSourceContact[] = Array.from({ length: counts.contacts }, (_, i) => ({
    ref: ref('contact', `con-${i}`),
    email: `person${i}@example.com`,
    modifiedAt: iso(i),
  }));
  const accounts: SecondSourceAccount[] = Array.from({ length: counts.accounts }, (_, i) => ({
    ref: ref('account', `acc-${i}`),
    domain: `company${i}.com`,
    modifiedAt: iso(i),
  }));
  const activities: SecondSourceActivity[] = Array.from({ length: counts.activities }, (_, i) => ({
    ref: ref('activity', `act-${i}`),
    contactRef: null,
    accountRef: null,
    occurredAt: iso(i),
    kind: 'email',
    createdAt: iso(i),
    lastModifiedAt: iso(i),
  }));
  return { contacts, accounts, activities };
}

function makeAdapter(counts: { contacts: number; accounts: number; activities: number }, caps: Partial<SecondSourceCapabilities> = {}) {
  return new MockSecondSourceAdapter(makeData(counts), caps);
}

describe('sampleSecondSource pagination cap', () => {
  it('stops pulling contacts once maxSampleSizePerType is reached, even though more exist', async () => {
    const adapter = makeAdapter({ contacts: 10, accounts: 0, activities: 0 }, { maxSampleSizePerType: 3 });
    const result = await sampleSecondSource(adapter, 'salt');
    expect(result.contacts).toHaveLength(3);
  });

  it('stops pulling accounts once maxSampleSizePerType is reached, even though more exist', async () => {
    const adapter = makeAdapter({ contacts: 0, accounts: 10, activities: 0 }, { maxSampleSizePerType: 4 });
    const result = await sampleSecondSource(adapter, 'salt');
    expect(result.accounts).toHaveLength(4);
  });

  it('stops pulling activities once maxSampleSizePerType is reached, even though more exist', async () => {
    const adapter = makeAdapter({ contacts: 0, accounts: 0, activities: 10 }, { maxSampleSizePerType: 2 });
    const result = await sampleSecondSource(adapter, 'salt');
    expect(result.activities).toHaveLength(2);
  });

  it('caps are independent per type', async () => {
    const adapter = makeAdapter({ contacts: 5, accounts: 5, activities: 5 }, { maxSampleSizePerType: 3 });
    const result = await sampleSecondSource(adapter, 'salt');
    expect(result.contacts).toHaveLength(3);
    expect(result.accounts).toHaveLength(3);
    expect(result.activities).toHaveLength(3);
  });

  it('returns everything when well under the cap', async () => {
    const adapter = makeAdapter({ contacts: 2, accounts: 2, activities: 2 }, { maxSampleSizePerType: 200 });
    const result = await sampleSecondSource(adapter, 'salt');
    expect(result.contacts).toHaveLength(2);
    expect(result.accounts).toHaveLength(2);
    expect(result.activities).toHaveLength(2);
  });
});

describe('sampleSecondSource truncated flags', () => {
  it('sets contactsTruncated/accountsTruncated/activitiesTruncated true when the cap was hit', async () => {
    const adapter = makeAdapter({ contacts: 5, accounts: 5, activities: 5 }, { maxSampleSizePerType: 3 });
    const result = await sampleSecondSource(adapter, 'salt');
    expect(result.contactsTruncated).toBe(true);
    expect(result.accountsTruncated).toBe(true);
    expect(result.activitiesTruncated).toBe(true);
  });

  it('leaves the flags false when every record fit under the cap', async () => {
    const adapter = makeAdapter({ contacts: 2, accounts: 2, activities: 2 }, { maxSampleSizePerType: 200 });
    const result = await sampleSecondSource(adapter, 'salt');
    expect(result.contactsTruncated).toBe(false);
    expect(result.accountsTruncated).toBe(false);
    expect(result.activitiesTruncated).toBe(false);
  });

  it('leaves the flag false when the record count exactly equals the cap — genuinely exhausted, not truncated', async () => {
    const adapter = makeAdapter({ contacts: 3, accounts: 0, activities: 0 }, { maxSampleSizePerType: 3 });
    const result = await sampleSecondSource(adapter, 'salt');
    expect(result.contacts).toHaveLength(3);
    expect(result.contactsTruncated).toBe(false);
  });

  it('flags are independent per type', async () => {
    const adapter = makeAdapter({ contacts: 5, accounts: 2, activities: 0 }, { maxSampleSizePerType: 3 });
    const result = await sampleSecondSource(adapter, 'salt');
    expect(result.contactsTruncated).toBe(true);
    expect(result.accountsTruncated).toBe(false);
    expect(result.activitiesTruncated).toBe(false);
  });
});

describe('sampleSecondSource sanitization at ingestion', () => {
  it('hashes contact emails instead of carrying the raw value', async () => {
    const adapter = makeAdapter({ contacts: 1, accounts: 0, activities: 0 });
    const result = await sampleSecondSource(adapter, 'salt-x');
    expect(result.contacts[0]).not.toHaveProperty('email');
    expect(result.contacts[0]!.emailHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('normalizes account domains instead of carrying the raw value', async () => {
    const adapter = makeAdapter({ contacts: 0, accounts: 1, activities: 0 });
    const result = await sampleSecondSource(adapter, 'salt-x');
    expect(result.accounts[0]).not.toHaveProperty('domain');
    expect(result.accounts[0]!.normalizedDomain).toBe('company0.com');
  });

  it('passes activities through unmodified — no PII field exists on that type', async () => {
    const adapter = makeAdapter({ contacts: 0, accounts: 0, activities: 1 });
    const result = await sampleSecondSource(adapter, 'salt-x');
    expect(result.activities[0]!.ref.id).toBe('act-0');
  });

  it('respects has*: false, returning empty for that type rather than throwing', async () => {
    const adapter = makeAdapter({ contacts: 3, accounts: 0, activities: 0 }, { hasContacts: false });
    const result = await sampleSecondSource(adapter, 'salt-x');
    expect(result.contacts).toHaveLength(0);
  });

  it('never carries a raw email substring in the returned sample', async () => {
    // Domains are NOT PII-sensitive here: account_resolution_rate's locked
    // definition (metric-definitions.md) normalizes but never hashes
    // domains, unlike emails — so a normalized domain legitimately still
    // contains recognizable domain text (e.g. 'company0.com' normalizes to
    // itself). Only raw email is a "never materialize" requirement.
    const adapter = makeAdapter({ contacts: 2, accounts: 2, activities: 0 });
    const result = await sampleSecondSource(adapter, 'salt-x');
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain('person0@example.com');
    expect(serialized).not.toContain('person1@example.com');
  });
});

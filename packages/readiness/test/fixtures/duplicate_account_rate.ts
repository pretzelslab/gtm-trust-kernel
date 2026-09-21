import type { AdapterCapabilities } from '@gtm-trust-kernel/adapters/types.js';
import type { Account, RecordRef } from '@gtm-trust-kernel/adapters/model/canonical.js';
import type { CoverageSample } from '../../src/metrics/types.js';

const ORG = 'org-duplicate-account-test';
const ASOF = '2026-06-15T00:00:00.000Z';

function ref(objectType: RecordRef['objectType'], id: string): RecordRef {
  return { crm: 'mock', orgId: ORG, objectType, id };
}

const CAPABILITIES: AdapterCapabilities = {
  stageHistory: true,
  ownerHistory: true,
  activitySync: true,
  incrementalSync: true,
  bulkRead: true,
  writeGranularity: 'field',
  nativeConcurrencyCheck: false,
  rateLimit: { kind: 'none', value: 0 },
  stageMap: {},
  accountBatchLimit: 200,
  contactBatchLimit: 200,
  childRecordBatchLimit: 200,
  notesPerOpportunityLimit: 200,
  activitiesPerOpportunityLimit: 200,
};

function account(id: string, domain?: string): Account {
  return {
    ref: ref('account', id),
    name: `Account ${id}`,
    domain,
    createdAt: ASOF,
    modifiedAt: ASOF,
  };
}

function byRef(accounts: readonly Account[]): ReadonlyMap<string, Account> {
  return new Map(accounts.map((a) => [a.ref.id, a]));
}

function coverageSample(
  accountsByRef: ReadonlyMap<string, Account>,
  accountsHydrated: boolean,
  missingAccountCount = 0,
  oppsWithoutAccountRef = 0,
): CoverageSample {
  return {
    openOpportunities: [],
    closedOpportunities: [],
    notesByOpportunity: new Map(),
    activitiesByOpportunity: new Map(),
    notesTruncatedOpportunityIds: new Set(),
    activitiesTruncatedOpportunityIds: new Set(),
    accountsByRef,
    accountsHydrated,
    stageHistoryEarliestChangedAt: null,
    stageHistoryHydrated: false,
    missingAccountCount,
    oppsWithoutAccountRef,
    contactsByRef: new Map(),
    contactsHydrated: false,
    missingContactCount: 0,
    capabilities: CAPABILITIES,
  };
}

/**
 * Golden fixture: 7 hydrated accounts.
 *  - 'acme-hq' (acme.com), 'acme-eu' (www.acme.com -> acme.com), 'acme-apac'
 *    (sales.acme.com -> acme.com): one duplicate group of 3, all members
 *    count toward the numerator (this session's group-counting decision).
 *  - 'globex' (globex.io): unique domain, not a duplicate.
 *  - 'gmail-user' (gmail.com): excluded, on the default shared-provider
 *    denylist.
 *  - 'no-domain' (undefined) and 'bad-domain' ("n/a"): excluded, no
 *    resolvable domain.
 * Denominator = 7 - 2 (null domain) - 1 (denylisted) = 4. Numerator = 3
 * (the one duplicate group). Expected value = 3 / 4 = 0.75.
 * missingAccountCount = 2, oppsWithoutAccountRef = 1 (illustrative,
 * asserted verbatim in the note).
 */
export function duplicateAccountRateFixture(): CoverageSample {
  const accounts = [
    account('acme-hq', 'acme.com'),
    account('acme-eu', 'www.acme.com'),
    account('acme-apac', 'sales.acme.com'),
    account('globex', 'globex.io'),
    account('gmail-user', 'gmail.com'),
    account('no-domain', undefined),
    account('bad-domain', 'n/a'),
  ];
  return coverageSample(byRef(accounts), true, 2, 1);
}

export const DUPLICATE_ACCOUNT_RATE_EXPECTED = {
  value: 3 / 4,
  sampleSize: 4,
  excludedNullDomain: 2,
  excludedDenylisted: 1,
  duplicateGroupCount: 1,
  missingAccountCount: 2,
  oppsWithoutAccountRef: 1,
};

/** Every account is excluded (null or denylisted domain) — denominator is 0 after filtering, not from an empty sample. */
export function duplicateAccountRateAllExcludedFixture(): CoverageSample {
  const accounts = [account('gmail-user', 'gmail.com'), account('no-domain', undefined)];
  return coverageSample(byRef(accounts), true);
}

/** No hydrated accounts at all — denominator is 0 from an empty sample. */
export function duplicateAccountRateEmptyFixture(): CoverageSample {
  return coverageSample(new Map(), true);
}

/** accountsHydrated is false — must gate to not_instrumented without reading accountsByRef. */
export function duplicateAccountRateGateOffFixture(): CoverageSample {
  const accounts = [account('acme-hq', 'acme.com'), account('acme-eu', 'acme.com')];
  return coverageSample(byRef(accounts), false);
}

/**
 * Verifies a config-supplied denylist entry is normalized before
 * comparison, same as a sampled account's domain: config entry
 * " Gmail.COM " must still exclude an account whose domain is the literal
 * string "gmail.com". 'kept' (acme.com) is unique and not denylisted.
 * Denominator = 1 ('kept'). Expected value = 0.
 */
export function duplicateAccountRateConfigDenylistFixture(): CoverageSample {
  const accounts = [account('excluded-by-config', 'gmail.com'), account('kept', 'acme.com')];
  return coverageSample(byRef(accounts), true);
}

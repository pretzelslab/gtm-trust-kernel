/**
 * D5 golden fixtures. One shared file for all 4 metrics (contact/account/
 * activity/temporal), not one file each like D1-D4's convention — D5's
 * fixtures need both a CoverageSample AND a SecondSourceResolution built
 * together, and duplicating that boilerplate 4x would cost more than the
 * convention buys here. See docs/STATUS.md.
 */

import type { Account, Activity, Contact, Opportunity, RecordRef } from '@gtm-trust-kernel/adapters/model/canonical.js';
import type { AdapterCapabilities, SecondSourceCapabilities, SecondSourceRef } from '@gtm-trust-kernel/adapters/types.js';
import type { CoverageSample, MetricConfig } from '../../src/metrics/types.js';
import type { SecondSourceResolution } from '../../src/secondSource/resolve.js';
import type { SecondSourceSampleResult } from '../../src/secondSource/sample.js';

export const ORG = 'org-joinability-test';
export const SOURCE = 'mock-second-source';
export const ASOF = '2026-06-15T00:00:00.000Z';

export function ref(objectType: RecordRef['objectType'], id: string): RecordRef {
  return { crm: 'mock', orgId: ORG, objectType, id };
}

export function ssRef(objectType: SecondSourceRef['objectType'], id: string): SecondSourceRef {
  return { source: SOURCE, orgId: ORG, objectType, id };
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

export function opportunity(o: {
  id: string;
  accountId: string;
  contactIds?: readonly string[];
  createdAt: string;
  closeDate?: string;
  isClosed?: boolean;
}): Opportunity {
  return {
    ref: ref('opportunity', o.id),
    accountRef: ref('account', o.accountId),
    name: `Deal ${o.id}`,
    stage: o.isClosed ? 'closed_won' : 'negotiation',
    stageConfidence: 'mapped',
    vendorStageLabel: o.isClosed ? 'closed_won' : 'negotiation',
    closeDate: o.closeDate,
    isClosed: o.isClosed ?? false,
    contactLinks: (o.contactIds ?? []).map((cid, i) => ({ contactRef: ref('contact', cid), isPrimary: i === 0 })),
    createdAt: o.createdAt,
    modifiedAt: o.createdAt,
    concurrencyToken: `tok-${o.id}`,
  };
}

export function crmContact(id: string, email?: string): Contact {
  return { ref: ref('contact', id), name: `Contact ${id}`, email, createdAt: ASOF, modifiedAt: ASOF };
}

export function crmAccount(id: string, domain?: string): Account {
  return { ref: ref('account', id), name: `Account ${id}`, domain, createdAt: ASOF, modifiedAt: ASOF };
}

export function crmActivity(id: string, opportunityId: string, occurredAt: string): Activity {
  return {
    ref: ref('activity', id),
    relatedTo: [ref('opportunity', opportunityId)],
    kind: 'call',
    direction: 'outbound',
    occurredAt,
    participantIds: [],
  };
}

export function secondSourceActivity(o: {
  id: string;
  contactId?: string;
  accountId?: string;
  occurredAt: string;
  createdAt?: string;
  lastModifiedAt?: string;
}): SecondSourceSampleResult['activities'][number] {
  return {
    ref: ssRef('activity', o.id),
    contactRef: o.contactId ? ssRef('contact', o.contactId) : null,
    accountRef: o.accountId ? ssRef('account', o.accountId) : null,
    occurredAt: o.occurredAt,
    kind: 'email',
    createdAt: o.createdAt ?? o.occurredAt,
    lastModifiedAt: o.lastModifiedAt ?? o.occurredAt,
  };
}

export function coverageSample(overrides: {
  openOpportunities?: readonly Opportunity[];
  closedOpportunities?: readonly Opportunity[];
  activitiesByOpportunity?: ReadonlyMap<string, readonly Activity[]>;
  contactsByRef?: ReadonlyMap<string, Contact>;
  contactsHydrated?: boolean;
  accountsByRef?: ReadonlyMap<string, Account>;
  accountsHydrated?: boolean;
}): CoverageSample {
  return {
    openOpportunities: overrides.openOpportunities ?? [],
    closedOpportunities: overrides.closedOpportunities ?? [],
    notesByOpportunity: new Map(),
    activitiesByOpportunity: overrides.activitiesByOpportunity ?? new Map(),
    notesTruncatedOpportunityIds: new Set(),
    activitiesTruncatedOpportunityIds: new Set(),
    accountsByRef: overrides.accountsByRef ?? new Map(),
    accountsHydrated: overrides.accountsHydrated ?? true,
    stageHistoryEarliestChangedAt: null,
    stageHistoryHydrated: false,
    missingAccountCount: 0,
    oppsWithoutAccountRef: 0,
    contactsByRef: overrides.contactsByRef ?? new Map(),
    contactsHydrated: overrides.contactsHydrated ?? true,
    missingContactCount: 0,
    capabilities: CAPABILITIES,
  };
}

export function secondSourceCapabilities(overrides: Partial<SecondSourceCapabilities> = {}): SecondSourceCapabilities {
  return {
    kind: 'engagement',
    hasContacts: true,
    hasAccounts: true,
    hasActivities: true,
    refBatchLimit: 200,
    activitiesPerRefLimit: 200,
    maxSampleSizePerType: 500,
    ...overrides,
  };
}

export function secondSourceSample(overrides: Partial<SecondSourceSampleResult> = {}): SecondSourceSampleResult {
  return {
    contacts: [],
    contactsTruncated: false,
    accounts: [],
    accountsTruncated: false,
    activities: [],
    activitiesTruncated: false,
    apiCallsConsumed: 0,
    ...overrides,
  };
}

export function resolution(overrides: Partial<SecondSourceResolution> = {}): SecondSourceResolution {
  return {
    contactMatches: new Map(),
    accountMatches: new Map(),
    secondSourceSample: secondSourceSample(),
    capabilities: secondSourceCapabilities(),
    ...overrides,
  };
}

export function config(secondSourceResolution?: SecondSourceResolution): MetricConfig {
  return { asOf: ASOF, secondSourceResolution };
}

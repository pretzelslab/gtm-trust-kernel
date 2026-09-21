import type { AdapterCapabilities } from '@gtm-trust-kernel/adapters/types.js';
import type { Opportunity, OpportunityContactLink, RecordRef } from '@gtm-trust-kernel/adapters/model/canonical.js';
import type { CoverageSample } from '../../src/metrics/types.js';

const ORG = 'org-coverage-test';

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
};

function baseOpportunity(
  id: string,
  contactLinks: readonly OpportunityContactLink[],
  overrides: Partial<Opportunity> = {},
): Opportunity {
  return {
    ref: ref('opportunity', id),
    accountRef: ref('account', 'acc-1'),
    name: `Deal ${id}`,
    stage: 'discovery',
    stageConfidence: 'mapped',
    vendorStageLabel: 'Discovery',
    isClosed: false,
    contactLinks,
    createdAt: '2026-01-01T00:00:00.000Z',
    modifiedAt: '2026-01-01T00:00:00.000Z',
    concurrencyToken: `tok-${id}`,
    ...overrides,
  };
}

export function coverageSample(openOpportunities: readonly Opportunity[]): CoverageSample {
  return {
    openOpportunities,
    closedOpportunities: [],
    notesByOpportunity: new Map(),
    activitiesByOpportunity: new Map(),
    accountsByRef: new Map(),
    accountsHydrated: false,
    missingAccountCount: 0,
    oppsWithoutAccountRef: 0,
    capabilities: CAPABILITIES,
  };
}

/**
 * Golden fixture: 5 open opportunities. 3 have at least one contact link
 * (one with two, to confirm the metric counts opportunities, not links); 2
 * have none. Expected value: 3 / 5 = 0.6.
 */
export function contactLinkageRateFixture(): CoverageSample {
  return coverageSample([
    baseOpportunity('single-link', [{ contactRef: ref('contact', 'con-1'), isPrimary: true }]),
    baseOpportunity('two-links', [
      { contactRef: ref('contact', 'con-2'), role: 'Decision Maker', isPrimary: true },
      { contactRef: ref('contact', 'con-3'), role: 'Champion' },
    ]),
    baseOpportunity('role-only-link', [{ contactRef: ref('contact', 'con-4'), role: 'Economic Buyer' }]),
    baseOpportunity('unlinked-1', []),
    baseOpportunity('unlinked-2', []),
  ]);
}

export const CONTACT_LINKAGE_RATE_EXPECTED = { value: 0.6, sampleSize: 5 };

import type { AdapterCapabilities } from '@gtm-trust-kernel/adapters/types.js';
import type { Opportunity, RecordRef } from '@gtm-trust-kernel/adapters/model/canonical.js';
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
  contactBatchLimit: 200,
  childRecordBatchLimit: 200,
  notesPerOpportunityLimit: 200,
  activitiesPerOpportunityLimit: 200,
};

function baseOpportunity(id: string, overrides: Partial<Opportunity> = {}): Opportunity {
  return {
    ref: ref('opportunity', id),
    accountRef: ref('account', 'acc-1'),
    name: `Deal ${id}`,
    stage: 'discovery',
    stageConfidence: 'mapped',
    vendorStageLabel: 'Discovery',
    isClosed: false,
    contactLinks: [],
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
    notesTruncatedOpportunityIds: new Set(),
    activitiesTruncatedOpportunityIds: new Set(),
    accountsByRef: new Map(),
    accountsHydrated: false,
    stageHistoryEarliestChangedAt: null,
    stageHistoryHydrated: false,
    missingAccountCount: 0,
    oppsWithoutAccountRef: 0,
    contactsByRef: new Map(),
    contactsHydrated: false,
    missingContactCount: 0,
    capabilities: CAPABILITIES,
  };
}

export const CLOSE_DATE_FILL_RATE_ASOF = '2026-06-15T00:00:00.000Z';

/**
 * Golden fixture: 5 open opportunities. 3 have a non-null close date (one of
 * them dated exactly asOf, which still counts as filled per the metric's
 * documented edge case); 2 have none. Expected value: 3 / 5 = 0.6.
 */
export function closeDateFillRateFixture(): CoverageSample {
  return coverageSample([
    baseOpportunity('filled-past', { closeDate: '2026-05-01T00:00:00.000Z' }),
    baseOpportunity('filled-future', { closeDate: '2026-07-01T00:00:00.000Z' }),
    baseOpportunity('filled-exactly-asof', { closeDate: CLOSE_DATE_FILL_RATE_ASOF }),
    baseOpportunity('unfilled-1'),
    baseOpportunity('unfilled-2'),
  ]);
}

export const CLOSE_DATE_FILL_RATE_EXPECTED = { value: 0.6, sampleSize: 5 };

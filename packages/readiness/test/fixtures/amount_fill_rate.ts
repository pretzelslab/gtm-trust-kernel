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
    notesByOpportunity: new Map(),
    activitiesByOpportunity: new Map(),
    capabilities: CAPABILITIES,
  };
}

/**
 * Golden fixture: 5 open opportunities. 2 have a non-null, non-zero amount;
 * 1 has amount: 0 (the edge case — must count as UNFILLED, not "filled with
 * a zero value"); 2 have no amount at all. Expected value: 2 / 5 = 0.4.
 */
export function amountFillRateFixture(): CoverageSample {
  return coverageSample([
    baseOpportunity('filled-large', { amount: 120_000 }),
    baseOpportunity('filled-small', { amount: 1 }),
    baseOpportunity('zero-amount', { amount: 0 }), // edge case: 0 is unfilled, not a filled zero value
    baseOpportunity('unfilled-a'),
    baseOpportunity('unfilled-b'),
  ]);
}

export const AMOUNT_FILL_RATE_EXPECTED = { value: 0.4, sampleSize: 5 };

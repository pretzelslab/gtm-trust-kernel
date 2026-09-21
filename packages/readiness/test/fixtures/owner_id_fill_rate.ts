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

function baseOpportunity(id: string, ownerId?: string): Opportunity {
  return {
    ref: ref('opportunity', id),
    accountRef: ref('account', 'acc-1'),
    name: `Deal ${id}`,
    stage: 'discovery',
    stageConfidence: 'mapped',
    vendorStageLabel: 'Discovery',
    isClosed: false,
    contactLinks: [],
    ownerId,
    createdAt: '2026-01-01T00:00:00.000Z',
    modifiedAt: '2026-01-01T00:00:00.000Z',
    concurrencyToken: `tok-${id}`,
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
 * Golden fixture: 5 open opportunities. 2 filled, with distinct owner ids
 * (proves the predicate isn't hardcoded to one value). 3 unfilled: one with
 * no ownerId at all, one with an empty string, one with whitespace only —
 * the latter two are the edge case: `.trim().length ?? 0 > 0`, not a bare
 * non-null check. Expected value: 2 / 5 = 0.4.
 */
export function ownerIdFillRateFixture(): CoverageSample {
  const opportunities = [
    baseOpportunity('filled-a', 'user:rep-1'),
    baseOpportunity('filled-b', 'user:rep-2'),
    baseOpportunity('unfilled-undefined', undefined),
    baseOpportunity('unfilled-empty', ''),
    baseOpportunity('unfilled-whitespace', '   '),
  ];
  return coverageSample(opportunities);
}

export const OWNER_ID_FILL_RATE_EXPECTED = { value: 0.4, sampleSize: 5 };

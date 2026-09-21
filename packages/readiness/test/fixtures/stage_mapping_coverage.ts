import type { AdapterCapabilities } from '@gtm-trust-kernel/adapters/types.js';
import type { CanonicalStage, Opportunity, RecordRef, StageConfidence } from '@gtm-trust-kernel/adapters/model/canonical.js';
import type { CoverageSample } from '../../src/metrics/types.js';

const ORG = 'org-stage-mapping-test';
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
};

function opportunity(
  id: string,
  stage: CanonicalStage,
  stageConfidence: StageConfidence,
  isClosed: boolean,
): Opportunity {
  return {
    ref: ref('opportunity', id),
    accountRef: ref('account', 'acc-1'),
    name: `Deal ${id}`,
    stage,
    stageConfidence,
    vendorStageLabel: stageConfidence === 'unmapped' ? 'Legacy Label' : 'Discovery',
    isClosed,
    contactLinks: [],
    createdAt: ASOF,
    modifiedAt: ASOF,
    concurrencyToken: `tok-${id}`,
  };
}

function coverageSample(open: readonly Opportunity[], closed: readonly Opportunity[]): CoverageSample {
  return {
    openOpportunities: open,
    closedOpportunities: closed,
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
 * Golden fixture: 4 open + 2 closed = 6 sampled opportunities (denominator
 * is open + closed, per metric-definitions.md D3's resolved ambiguity).
 * mapped: 3, inferred: 1, unmapped: 2. Numerator (mapped + inferred) = 4.
 * Expected value: 4 / 6.
 */
export function stageMappingCoverageFixture(): CoverageSample {
  const open = [
    opportunity('mapped-1', 'discovery', 'mapped', false),
    opportunity('mapped-2', 'evaluation', 'mapped', false),
    opportunity('inferred-1', 'proposal', 'inferred', false),
    opportunity('unmapped-1', 'discovery', 'unmapped', false),
  ];
  const closed = [
    opportunity('mapped-3', 'closed_won', 'mapped', true),
    opportunity('unmapped-2', 'closed_lost', 'unmapped', true),
  ];
  return coverageSample(open, closed);
}

export const STAGE_MAPPING_COVERAGE_EXPECTED = {
  value: 4 / 6,
  sampleSize: 6,
  mapped: 3,
  inferred: 1,
  unmapped: 2,
};

/** No open or closed opportunities at all — denominator is 0 from an empty sample. */
export function stageMappingCoverageEmptyFixture(): CoverageSample {
  return coverageSample([], []);
}

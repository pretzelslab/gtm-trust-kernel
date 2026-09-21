import type { AdapterCapabilities } from '@gtm-trust-kernel/adapters/types.js';
import type { Opportunity, RecordRef } from '@gtm-trust-kernel/adapters/model/canonical.js';
import { TrustTier, tag } from '@gtm-trust-kernel/adapters/model/trust.js';
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

function nextStep(id: string, value: string) {
  return tag(TrustTier.UserAuthored, value, {
    recordId: `opportunity:${id}`,
    field: 'nextStep',
    capturedAt: '2026-01-01T00:00:00.000Z',
  });
}

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
    accountsByRef: new Map(),
    accountsHydrated: false,
    stageHistoryEarliestChangedAt: null,
    stageHistoryHydrated: false,
    missingAccountCount: 0,
    oppsWithoutAccountRef: 0,
    capabilities: CAPABILITIES,
  };
}

/**
 * Golden fixture: 5 open opportunities. 2 have a real Next Step (one of them
 * just 2 characters, to confirm short-but-real values still count); 1 has
 * "-" (the single-character edge case — trim().length is 1, must count as
 * UNFILLED); 1 has whitespace only (trim().length is 0, also unfilled); 1
 * has no Next Step at all. Expected value: 2 / 5 = 0.4.
 */
export function nextStepFillRateFixture(): CoverageSample {
  return coverageSample([
    baseOpportunity('filled-real', { nextStep: nextStep('filled-real', 'Send redlines to legal') }),
    baseOpportunity('filled-short', { nextStep: nextStep('filled-short', 'ok') }),
    baseOpportunity('single-dash', { nextStep: nextStep('single-dash', '-') }), // edge case: length 1, unfilled
    baseOpportunity('whitespace-only', { nextStep: nextStep('whitespace-only', '   ') }), // edge case: trims to length 0, unfilled
    baseOpportunity('unfilled-missing'),
  ]);
}

export const NEXT_STEP_FILL_RATE_EXPECTED = { value: 0.4, sampleSize: 5 };

import type { AdapterCapabilities } from '@gtm-trust-kernel/adapters/types.js';
import type { Opportunity, RecordRef } from '@gtm-trust-kernel/adapters/model/canonical.js';
import type { CoverageSample } from '../../src/metrics/types.js';

const ORG = 'org-freshness-test';
export const PAST_DUE_CLOSE_DATE_RATE_ASOF = '2026-06-15T00:00:00.000Z';
const ASOF_MS = new Date(PAST_DUE_CLOSE_DATE_RATE_ASOF).getTime();
const DAY_MS = 86_400_000;

function daysFromAsOf(days: number): string {
  return new Date(ASOF_MS + days * DAY_MS).toISOString();
}

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

function baseOpportunity(id: string, closeDate?: string): Opportunity {
  return {
    ref: ref('opportunity', id),
    accountRef: ref('account', 'acc-1'),
    name: `Deal ${id}`,
    stage: 'discovery',
    stageConfidence: 'mapped',
    vendorStageLabel: 'Discovery',
    isClosed: false,
    contactLinks: [],
    closeDate,
    createdAt: daysFromAsOf(-365),
    modifiedAt: daysFromAsOf(-1),
    concurrencyToken: `tok-${id}`,
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
 * Golden fixture: 6 open opportunities.
 *
 * Denominator excludes the 2 with a null closeDate ('no-close-date-a/b') —
 * that gap is close_date_fill_rate's concern, not this metric's. Denominator
 * = 4.
 *
 * Of those 4, 2 are past-due:
 *  - 'past-due-far': closeDate 30 days before asOf.
 *  - 'past-due-near': closeDate 1 day before asOf.
 * The other 2 are not:
 *  - 'exactly-asof': closeDate exactly at asOf — the edge case; strict `<`
 *    means exactly-asOf is NOT past-due (mirrors close_date_fill_rate's own
 *    exactly-asOf edge case).
 *  - 'future': closeDate 30 days after asOf.
 *
 * Expected value: 2 / 4 = 0.5.
 */
export function pastDueCloseDateRateFixture(): CoverageSample {
  const opportunities = [
    baseOpportunity('past-due-far', daysFromAsOf(-30)),
    baseOpportunity('past-due-near', daysFromAsOf(-1)),
    baseOpportunity('exactly-asof', daysFromAsOf(0)),
    baseOpportunity('future', daysFromAsOf(30)),
    baseOpportunity('no-close-date-a', undefined),
    baseOpportunity('no-close-date-b', undefined),
  ];
  return coverageSample(opportunities);
}

export const PAST_DUE_CLOSE_DATE_RATE_EXPECTED = { value: 0.5, sampleSize: 4 };

/** Every open opportunity has a null closeDate — denominator is 0 after filtering, not 0 from an empty sample. */
export function pastDueCloseDateRateAllNullFixture(): CoverageSample {
  return coverageSample([baseOpportunity('no-close-date-a', undefined), baseOpportunity('no-close-date-b', undefined)]);
}

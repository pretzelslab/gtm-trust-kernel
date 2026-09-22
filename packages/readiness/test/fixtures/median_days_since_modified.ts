import type { Opportunity, RecordRef } from '@gtm-trust-kernel/adapters/model/canonical.js';
import type { CoverageSample } from '../../src/metrics/types.js';
import { makeCoverageSample } from '../support/coverageSample.js';

const ORG = 'org-freshness-test';
export const MEDIAN_DAYS_SINCE_MODIFIED_ASOF = '2026-06-15T00:00:00.000Z';
const ASOF_MS = new Date(MEDIAN_DAYS_SINCE_MODIFIED_ASOF).getTime();
const DAY_MS = 86_400_000;

function daysFromAsOf(days: number): string {
  return new Date(ASOF_MS + days * DAY_MS).toISOString();
}

function ref(objectType: RecordRef['objectType'], id: string): RecordRef {
  return { crm: 'mock', orgId: ORG, objectType, id };
}

function baseOpportunity(id: string, modifiedAt: string): Opportunity {
  return {
    ref: ref('opportunity', id),
    accountRef: ref('account', 'acc-1'),
    name: `Deal ${id}`,
    stage: 'discovery',
    stageConfidence: 'mapped',
    vendorStageLabel: 'Discovery',
    isClosed: false,
    contactLinks: [],
    createdAt: daysFromAsOf(-365),
    modifiedAt,
    concurrencyToken: `tok-${id}`,
  };
}

export function coverageSample(openOpportunities: readonly Opportunity[]): CoverageSample {
  return makeCoverageSample({ openOpportunities });
}

/**
 * Golden fixture: 4 open opportunities, modified 2/4/8/16 days before asOf.
 * Even count deliberately, so the median lands on the average of the two
 * middle values (4 and 8) rather than a single element: median = 6.
 */
export function medianDaysSinceModifiedFixture(): CoverageSample {
  const opportunities = [
    baseOpportunity('mod-2d', daysFromAsOf(-2)),
    baseOpportunity('mod-4d', daysFromAsOf(-4)),
    baseOpportunity('mod-8d', daysFromAsOf(-8)),
    baseOpportunity('mod-16d', daysFromAsOf(-16)),
  ];
  return coverageSample(opportunities);
}

export const MEDIAN_DAYS_SINCE_MODIFIED_EXPECTED = { value: 6, sampleSize: 4 };

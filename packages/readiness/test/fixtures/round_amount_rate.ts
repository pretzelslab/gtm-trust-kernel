import type { Opportunity, RecordRef } from '@gtm-trust-kernel/adapters/model/canonical.js';
import type { CoverageSample } from '../../src/metrics/types.js';
import { makeCoverageSample } from '../support/coverageSample.js';

const ORG = 'org-consistency-test';
const ASOF = '2026-06-15T00:00:00.000Z';
const ASOF_MS = new Date(ASOF).getTime();
const DAY_MS = 86_400_000;

function daysFromAsOf(days: number): string {
  return new Date(ASOF_MS + days * DAY_MS).toISOString();
}

function ref(objectType: RecordRef['objectType'], id: string): RecordRef {
  return { crm: 'mock', orgId: ORG, objectType, id };
}

function baseOpportunity(id: string, amount?: number): Opportunity {
  return {
    ref: ref('opportunity', id),
    accountRef: ref('account', 'acc-1'),
    name: `Deal ${id}`,
    stage: 'discovery',
    stageConfidence: 'mapped',
    vendorStageLabel: 'Discovery',
    isClosed: false,
    contactLinks: [],
    amount,
    createdAt: daysFromAsOf(-365),
    modifiedAt: daysFromAsOf(-1),
    concurrencyToken: `tok-${id}`,
  };
}

export function coverageSample(openOpportunities: readonly Opportunity[]): CoverageSample {
  return makeCoverageSample({ openOpportunities });
}

/**
 * Golden fixture: 7 open opportunities.
 *
 * Denominator excludes the 2 with null/zero amount ('null-amount',
 * 'zero-amount') — that gap is amount_fill_rate's concern, not this
 * metric's, per metric-definitions.md D3's "don't double count" edge case.
 * Denominator = 5. excludedCount = 2.
 *
 * Of those 5, 3 are round (evenly divisible by 1,000):
 *  - 'round-50000': 50000.
 *  - 'round-25000': 25000.
 *  - 'negative-round': -5000 — negative amounts are left in the denominator
 *    and evaluated by the same rule as any other amount (open question for
 *    v0.2, see docs/STATUS.md; not resolved here). -5000 % 1000 === 0 in
 *    JS, so this counts as round under the current rule.
 * The other 2 are not round:
 *  - 'non-round-24999': 24999.
 *  - 'non-round-50500': 50500.
 *
 * Expected value: 3 / 5 = 0.6.
 */
export function roundAmountRateFixture(): CoverageSample {
  const opportunities = [
    baseOpportunity('round-50000', 50000),
    baseOpportunity('round-25000', 25000),
    baseOpportunity('non-round-24999', 24999),
    baseOpportunity('non-round-50500', 50500),
    baseOpportunity('negative-round', -5000),
    baseOpportunity('null-amount', undefined),
    baseOpportunity('zero-amount', 0),
  ];
  return coverageSample(opportunities);
}

export const ROUND_AMOUNT_RATE_EXPECTED = { value: 0.6, sampleSize: 5, excludedCount: 2 };

/** Every open opportunity has a null or zero amount — denominator is 0 after filtering, not 0 from an empty sample. */
export function roundAmountRateAllExcludedFixture(): CoverageSample {
  return coverageSample([baseOpportunity('null-amount', undefined), baseOpportunity('zero-amount', 0)]);
}

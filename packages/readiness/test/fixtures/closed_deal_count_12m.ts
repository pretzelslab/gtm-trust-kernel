import type { Opportunity, RecordRef } from '@gtm-trust-kernel/adapters/model/canonical.js';
import type { CoverageSample } from '../../src/metrics/types.js';
import { makeCoverageSample } from '../support/coverageSample.js';

const ORG = 'org-labels-test';
export const CLOSED_DEAL_COUNT_12M_ASOF = '2026-06-15T00:00:00.000Z';

function ref(objectType: RecordRef['objectType'], id: string): RecordRef {
  return { crm: 'mock', orgId: ORG, objectType, id };
}

function closedOpportunity(id: string, isWon: boolean): Opportunity {
  return {
    ref: ref('opportunity', id),
    accountRef: ref('account', 'acc-1'),
    name: `Deal ${id}`,
    stage: isWon ? 'closed_won' : 'closed_lost',
    stageConfidence: 'mapped',
    vendorStageLabel: isWon ? 'Closed Won' : 'Closed Lost',
    isClosed: true,
    isWon,
    closeDate: '2026-05-01T00:00:00.000Z',
    contactLinks: [],
    createdAt: '2025-01-01T00:00:00.000Z',
    modifiedAt: '2026-05-01T00:00:00.000Z',
    concurrencyToken: `tok-${id}`,
  };
}

function coverageSample(
  closedOpportunities: readonly Opportunity[],
  closedWonUnderfilled: boolean,
  closedLostUnderfilled: boolean,
  closedInWindowCount: number | null = closedOpportunities.length,
): CoverageSample {
  return makeCoverageSample({ closedOpportunities, closedWonUnderfilled, closedLostUnderfilled, closedInWindowCount });
}

/**
 * Golden fixture: 5 closed opportunities, neither closed stratum's
 * reservoir filled to target — no floor. Expected value: 5.
 */
export function closedDealCount12mFixture(): CoverageSample {
  const closedOpportunities = [
    closedOpportunity('won-1', true),
    closedOpportunity('won-2', true),
    closedOpportunity('won-3', true),
    closedOpportunity('lost-1', false),
    closedOpportunity('lost-2', false),
  ];
  return coverageSample(closedOpportunities, true, true);
}

export const CLOSED_DEAL_COUNT_12M_EXPECTED = { value: 5, sampleSize: 5 };

/** No closed opportunities in the sample at all — still 'ok', value 0 (a real, meaningful reading, not an absent one). */
export function closedDealCount12mEmptyFixture(): CoverageSample {
  return coverageSample([], true, true);
}

/**
 * The closed_won reservoir stratum filled to target (underfilled: false) —
 * closedOpportunities.length is a sample-size ceiling here, not the org's
 * true closed-deal volume. floor: true, with a note explaining why, even
 * though closed_lost's own reservoir was not full.
 */
export function closedDealCount12mFloorFixture(): CoverageSample {
  const closedOpportunities = [closedOpportunity('won-1', true), closedOpportunity('lost-1', false)];
  return coverageSample(closedOpportunities, false, true, 60);
}

/** A sample built without a population count (a hand-built CoverageSample). */
export function closedDealCount12mNoCountFixture(): CoverageSample {
  return coverageSample([closedOpportunity('won-1', true)], true, true, null);
}

import type { Opportunity, RecordRef, StageHistoryEntry } from '@gtm-trust-kernel/adapters/model/canonical.js';
import type { CoverageSample } from '../../src/metrics/types.js';
import { makeCoverageSample, DEFAULT_TEST_CAPABILITIES } from '../support/coverageSample.js';

const ORG = 'org-win-rate-dispersion-test';
export const WIN_RATE_DISPERSION_ASOF = '2026-06-15T00:00:00.000Z';

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

function stageEntry(id: string, opportunityId: string, toStage: StageHistoryEntry['toStage']): StageHistoryEntry {
  return { ref: ref('stage_history', id), opportunityRef: ref('opportunity', opportunityId), toStage, changedAt: '2026-03-01T00:00:00.000Z' };
}

function coverageSample(
  closedOpportunities: readonly Opportunity[],
  stageHistoryByOpportunity: ReadonlyMap<string, readonly StageHistoryEntry[]>,
  capabilitiesOverride: { stageHistory?: boolean } = {},
): CoverageSample {
  return makeCoverageSample({
    closedOpportunities,
    stageHistoryByOpportunity,
    capabilities: { ...DEFAULT_TEST_CAPABILITIES, ...capabilitiesOverride },
  });
}

/**
 * Golden fixture: 10 closed opportunities across exactly 2 qualifying
 * stages (5 each, exactly at MIN_CLOSED_OPPORTUNITIES_PER_STAGE) —
 * discovery: 4 won + 1 lost (rate 0.8); proposal: 1 won + 4 lost (rate
 * 0.2). standardDeviation([0.8, 0.2]) = 0.3 exactly (mean 0.5, both
 * deviate by 0.3).
 */
export function winRateDispersionFixture(): CoverageSample {
  const opportunities: Opportunity[] = [];
  const changes = new Map<string, readonly StageHistoryEntry[]>();
  const discoveryOutcomes = [true, true, true, true, false]; // 4 won, 1 lost
  const proposalOutcomes = [true, false, false, false, false]; // 1 won, 4 lost
  discoveryOutcomes.forEach((won, i) => {
    const id = `disc-${i}`;
    opportunities.push(closedOpportunity(id, won));
    changes.set(id, [stageEntry(`sh-${id}`, id, 'discovery')]);
  });
  proposalOutcomes.forEach((won, i) => {
    const id = `prop-${i}`;
    opportunities.push(closedOpportunity(id, won));
    changes.set(id, [stageEntry(`sh-${id}`, id, 'proposal')]);
  });
  return coverageSample(opportunities, changes);
}

export const WIN_RATE_DISPERSION_EXPECTED = { value: 0.3, sampleSize: 10 };

/**
 * Same as the golden fixture, plus 3 more closed opportunities that only
 * ever passed through "negotiation" (2 won, 1 lost) — below
 * MIN_CLOSED_OPPORTUNITIES_PER_STAGE (5), so negotiation is excluded from
 * the calculation entirely. Expected value/sampleSize-of-computation
 * unchanged from the golden fixture (0.3 over the same 2 qualifying
 * stages); sampleSize (eligible count) rises to 13; note reports exactly
 * 1 stage excluded.
 */
export function winRateDispersionExcludedStageFixture(): CoverageSample {
  const base = winRateDispersionFixture();
  const extra: Opportunity[] = [];
  const negotiationOutcomes = [true, true, false];
  negotiationOutcomes.forEach((won, i) => {
    const id = `neg-${i}`;
    extra.push(closedOpportunity(id, won));
  });
  const changes = new Map(base.stageHistoryByOpportunity);
  negotiationOutcomes.forEach((_won, i) => {
    const id = `neg-${i}`;
    changes.set(id, [stageEntry(`sh-${id}`, id, 'negotiation')]);
  });
  return { ...base, closedOpportunities: [...base.closedOpportunities, ...extra], stageHistoryByOpportunity: changes };
}

export const WIN_RATE_DISPERSION_EXCLUDED_STAGE_EXPECTED = { value: 0.3, sampleSize: 13, excludedStageCount: 1 };

/** Only 1 canonical stage ever qualifies (5 opportunities through discovery, nothing else) — not_applicable, dispersion across 1 stage is undefined. */
export function winRateDispersionFewerThanTwoStagesFixture(): CoverageSample {
  const opportunities: Opportunity[] = [];
  const changes = new Map<string, readonly StageHistoryEntry[]>();
  [true, true, true, false, false].forEach((won, i) => {
    const id = `disc-${i}`;
    opportunities.push(closedOpportunity(id, won));
    changes.set(id, [stageEntry(`sh-${id}`, id, 'discovery')]);
  });
  return coverageSample(opportunities, changes);
}

/**
 * Every eligible opportunity's only stage-history entry is the closing
 * transition itself (toStage: closed_won/closed_lost) — proves the
 * closed-stage filter actually excludes these, not just intermediate ones:
 * without the filter this would read as 2 "stages" (closed_won,
 * closed_lost) trivially at rates 1.0/0.0; with it, zero intermediate
 * stages ever appear, so this is not_applicable, not a manufactured
 * dispersion.
 */
export function winRateDispersionOnlyClosingTransitionFixture(): CoverageSample {
  const opportunities: Opportunity[] = [];
  const changes = new Map<string, readonly StageHistoryEntry[]>();
  for (let i = 0; i < 5; i++) {
    const id = `won-${i}`;
    opportunities.push(closedOpportunity(id, true));
    changes.set(id, [stageEntry(`sh-${id}`, id, 'closed_won')]);
  }
  for (let i = 0; i < 5; i++) {
    const id = `lost-${i}`;
    opportunities.push(closedOpportunity(id, false));
    changes.set(id, [stageEntry(`sh-${id}`, id, 'closed_lost')]);
  }
  return coverageSample(opportunities, changes);
}

export function winRateDispersionGateOffFixture(): CoverageSample {
  return coverageSample([closedOpportunity('opp-1', true)], new Map(), { stageHistory: false });
}

export function winRateDispersionNoEligibleFixture(): CoverageSample {
  return coverageSample([closedOpportunity('opp-1', true), closedOpportunity('opp-2', false)], new Map());
}

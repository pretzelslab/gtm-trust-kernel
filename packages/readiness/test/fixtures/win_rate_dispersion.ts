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

/**
 * Builds one opportunity's stage-history entries from an ordered list of
 * intermediate stages it passed through before closing — the multi-hop
 * shape every real org's stage history actually has (STATUS.md's "Known
 * Gaps": until this fixture, only `generateHealthy()` exercised it; every
 * fixture above gives each opportunity exactly one entry).
 */
function multiHopEntries(opportunityId: string, stages: readonly StageHistoryEntry['toStage'][]): StageHistoryEntry[] {
  return stages.map((stage, i) => stageEntry(`sh-${opportunityId}-${i}`, opportunityId, stage));
}

/**
 * Multi-hop, high dispersion: 10 opportunities, each passing through 2
 * adjacent stages (discovery->proposal, or proposal->negotiation) rather
 * than a single stage. 5 discovery->proposal deals all won; 5
 * proposal->negotiation deals all lost. discovery: 5/5 won (rate 1.0);
 * negotiation: 0/5 won (rate 0.0); proposal, fed by both groups: 5/10 won
 * (rate 0.5). winRates [1.0, 0.5, 0.0]: this is the maximum-variance
 * 3-point configuration bounded to [0, 1] with mean 0.5 (push two points to
 * the opposite bounds, the third makes the mean work) -> standardDeviation
 * sqrt(1/6) ~= 0.4082, the highest this metric can read for 3 qualifying
 * stages centered at a 0.5 mean win rate.
 */
export function winRateDispersionMultiHopHighFixture(): CoverageSample {
  const opportunities: Opportunity[] = [];
  const changes = new Map<string, readonly StageHistoryEntry[]>();
  for (let i = 0; i < 5; i++) {
    const id = `early-won-${i}`;
    opportunities.push(closedOpportunity(id, true));
    changes.set(id, multiHopEntries(id, ['discovery', 'proposal']));
  }
  for (let i = 0; i < 5; i++) {
    const id = `late-lost-${i}`;
    opportunities.push(closedOpportunity(id, false));
    changes.set(id, multiHopEntries(id, ['proposal', 'negotiation']));
  }
  return coverageSample(opportunities, changes);
}

export const WIN_RATE_DISPERSION_MULTI_HOP_HIGH_EXPECTED = { value: Math.sqrt(1 / 6), sampleSize: 10 };

/**
 * Multi-hop, low (zero) dispersion: same two-stage-chain shape as the high
 * fixture above, but each group is an even 50/50 split. discovery: 3/6 won
 * (rate 0.5); proposal, fed by both groups: 6/12 won (rate 0.5);
 * negotiation: 3/6 won (rate 0.5). All three stages read exactly the same
 * rate -> standardDeviation exactly 0, proving pipeline stage carries zero
 * predictive signal in this org, not just "some" signal.
 */
export function winRateDispersionMultiHopLowFixture(): CoverageSample {
  const opportunities: Opportunity[] = [];
  const changes = new Map<string, readonly StageHistoryEntry[]>();
  const groupAOutcomes = [true, true, true, false, false, false];
  const groupBOutcomes = [true, true, true, false, false, false];
  groupAOutcomes.forEach((won, i) => {
    const id = `chainA-${i}`;
    opportunities.push(closedOpportunity(id, won));
    changes.set(id, multiHopEntries(id, ['discovery', 'proposal']));
  });
  groupBOutcomes.forEach((won, i) => {
    const id = `chainB-${i}`;
    opportunities.push(closedOpportunity(id, won));
    changes.set(id, multiHopEntries(id, ['proposal', 'negotiation']));
  });
  return coverageSample(opportunities, changes);
}

export const WIN_RATE_DISPERSION_MULTI_HOP_LOW_EXPECTED = { value: 0, sampleSize: 12 };

/**
 * Degenerate multi-hop shape: one opportunity's stage history revisits an
 * earlier stage (discovery -> proposal -> discovery, e.g. a real CRM
 * "stage regression"), so `entries.map(e => e.toStage)` contains
 * 'discovery' twice for this single deal. Locks in that `winRateDispersion`
 * dedupes per-opportunity stage visits (its `stagesVisited` Set) rather
 * than counting the same closed deal twice within one stage's tally: 4
 * discovery-only opportunities (2 won/2 lost) plus this one won revisiting
 * opportunity puts discovery at 3/5 won (rate 0.6); 4 proposal-only
 * opportunities (2 won/2 lost) plus the same opportunity's single proposal
 * visit puts proposal at 3/5 won (rate 0.6) too -> standardDeviation
 * exactly 0. Without the dedup, the revisiting opportunity would count
 * twice toward discovery's total (6 instead of 5), giving discovery a rate
 * of 4/6 != proposal's 3/5 and a nonzero, wrong dispersion value instead.
 */
export function winRateDispersionRevisitedStageFixture(): CoverageSample {
  const opportunities: Opportunity[] = [];
  const changes = new Map<string, readonly StageHistoryEntry[]>();
  [true, false, true, false].forEach((won, i) => {
    const id = `disc-only-${i}`;
    opportunities.push(closedOpportunity(id, won));
    changes.set(id, multiHopEntries(id, ['discovery']));
  });
  [true, false, true, false].forEach((won, i) => {
    const id = `prop-only-${i}`;
    opportunities.push(closedOpportunity(id, won));
    changes.set(id, multiHopEntries(id, ['proposal']));
  });
  const revisitId = 'revisits-discovery';
  opportunities.push(closedOpportunity(revisitId, true));
  changes.set(revisitId, multiHopEntries(revisitId, ['discovery', 'proposal', 'discovery']));
  return coverageSample(opportunities, changes);
}

export const WIN_RATE_DISPERSION_REVISITED_STAGE_EXPECTED = { value: 0, sampleSize: 9 };

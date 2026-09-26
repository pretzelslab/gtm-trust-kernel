import type { NextStepChange, Opportunity, RecordRef } from '@gtm-trust-kernel/adapters/model/canonical.js';
import { TrustTier, tag } from '@gtm-trust-kernel/adapters/model/trust.js';
import type { CoverageSample } from '../../src/metrics/types.js';
import { makeCoverageSample, DEFAULT_TEST_CAPABILITIES } from '../support/coverageSample.js';

const ORG = 'org-next-step-age-test';
export const MEDIAN_NEXT_STEP_AGE_DAYS_ASOF = '2026-06-15T00:00:00.000Z';
const ASOF_MS = new Date(MEDIAN_NEXT_STEP_AGE_DAYS_ASOF).getTime();
const DAY_MS = 86_400_000;

function daysFromAsOf(days: number): string {
  return new Date(ASOF_MS + days * DAY_MS).toISOString();
}

function ref(objectType: RecordRef['objectType'], id: string): RecordRef {
  return { crm: 'mock', orgId: ORG, objectType, id };
}

function opportunity(id: string, nextStepValue: string | undefined): Opportunity {
  return {
    ref: ref('opportunity', id),
    accountRef: ref('account', 'acc-1'),
    name: `Deal ${id}`,
    stage: 'discovery',
    stageConfidence: 'mapped',
    vendorStageLabel: 'Discovery',
    isClosed: false,
    contactLinks: [],
    nextStep: nextStepValue
      ? tag(TrustTier.UserAuthored, nextStepValue, { recordId: `opportunity:${id}`, field: 'nextStep', capturedAt: daysFromAsOf(-30) })
      : undefined,
    createdAt: daysFromAsOf(-365),
    modifiedAt: daysFromAsOf(-1),
    concurrencyToken: `tok-${id}`,
  };
}

function nextStepChange(id: string, opportunityId: string, daysAgo: number): NextStepChange {
  return { ref: ref('next_step_change', id), opportunityRef: ref('opportunity', opportunityId), changedAt: daysFromAsOf(-daysAgo) };
}

function coverageSample(
  opportunities: readonly Opportunity[],
  nextStepChangesByOpportunity: ReadonlyMap<string, readonly NextStepChange[]>,
  capabilitiesOverride: { nextStepHistory?: boolean } = {},
): CoverageSample {
  return makeCoverageSample({
    openOpportunities: opportunities,
    nextStepChangesByOpportunity,
    capabilities: { ...DEFAULT_TEST_CAPABILITIES, ...capabilitiesOverride },
  });
}

/**
 * Golden fixture: 4 open opportunities with a meaningfully-filled Next
 * Step. 3 have a NextStepChange entry (ages 2/4/8 days -> median 4); the
 * 4th has none, so it's excluded (1 of 4 eligible excluded).
 */
export function medianNextStepAgeDaysFixture(): CoverageSample {
  const opportunities = [
    opportunity('opp-2d', 'Confirm budget with champion'),
    opportunity('opp-4d', 'Schedule technical deep-dive'),
    opportunity('opp-8d', 'Send updated proposal'),
    opportunity('opp-no-history', 'Follow up on redlines'),
  ];
  const nextStepChangesByOpportunity = new Map<string, readonly NextStepChange[]>([
    ['opp-2d', [nextStepChange('nsc-1', 'opp-2d', 2)]],
    ['opp-4d', [nextStepChange('nsc-2', 'opp-4d', 4)]],
    ['opp-8d', [nextStepChange('nsc-3', 'opp-8d', 8)]],
  ]);
  return coverageSample(opportunities, nextStepChangesByOpportunity);
}

export const MEDIAN_NEXT_STEP_AGE_DAYS_EXPECTED = { value: 4, sampleSize: 3, excludedCount: 1, eligibleCount: 4 };

/** Takes the latest (last) entry when an opportunity has more than one change — proves "latest", not "first" or "any". */
export function medianNextStepAgeDaysLatestEntryFixture(): CoverageSample {
  const opportunities = [opportunity('opp-multi', 'Confirm signature date')];
  const nextStepChangesByOpportunity = new Map<string, readonly NextStepChange[]>([
    ['opp-multi', [nextStepChange('nsc-old', 'opp-multi', 40), nextStepChange('nsc-new', 'opp-multi', 3)]],
  ]);
  return coverageSample(opportunities, nextStepChangesByOpportunity);
}

export function medianNextStepAgeDaysGateOffFixture(): CoverageSample {
  return coverageSample([opportunity('opp-1', 'Some next step')], new Map(), { nextStepHistory: false });
}

export function medianNextStepAgeDaysNoEligibleFixture(): CoverageSample {
  const opportunities = [opportunity('opp-empty', undefined), opportunity('opp-dash', '-')];
  return coverageSample(opportunities, new Map());
}

export function medianNextStepAgeDaysAllExcludedFixture(): CoverageSample {
  const opportunities = [opportunity('opp-1', 'Next step one'), opportunity('opp-2', 'Next step two')];
  return coverageSample(opportunities, new Map());
}

/**
 * 80 eligible opportunities, 35 with a NextStepChange entry, all dated
 * exactly 10 days before asOf (45/80 = 56.25% excluded, median trivially
 * 10). 35 is deliberately >= LOW_CONFIDENCE_SAMPLE_SIZE (30), so
 * lowConfidence here is isolated to the exclusion-rate trigger, not the
 * raw-sample-size one — proves the two triggers are independent.
 */
export function medianNextStepAgeDaysMajorityExcludedFixture(): CoverageSample {
  const opportunities: Opportunity[] = [];
  const changes = new Map<string, readonly NextStepChange[]>();
  for (let i = 0; i < 80; i++) {
    const id = `opp-${i}`;
    opportunities.push(opportunity(id, `Next step ${i}`));
    if (i < 35) {
      changes.set(id, [nextStepChange(`nsc-${i}`, id, 10)]);
    }
  }
  return coverageSample(opportunities, changes);
}

export const MEDIAN_NEXT_STEP_AGE_DAYS_MAJORITY_EXCLUDED_EXPECTED = { value: 10, sampleSize: 35, excludedCount: 45, eligibleCount: 80 };

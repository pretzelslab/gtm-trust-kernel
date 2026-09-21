import type { AdapterCapabilities } from '@gtm-trust-kernel/adapters/types.js';
import type { Activity, ActivityKind, Opportunity, RecordRef } from '@gtm-trust-kernel/adapters/model/canonical.js';
import type { CoverageSample } from '../../src/metrics/types.js';

const ORG = 'org-coverage-test';
const ASOF = '2026-06-15T00:00:00.000Z';
const ASOF_MS = new Date(ASOF).getTime();
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

function baseOpportunity(id: string, createdAt: string): Opportunity {
  return {
    ref: ref('opportunity', id),
    accountRef: ref('account', 'acc-1'),
    name: `Deal ${id}`,
    stage: 'discovery',
    stageConfidence: 'mapped',
    vendorStageLabel: 'Discovery',
    isClosed: false,
    contactLinks: [],
    createdAt,
    modifiedAt: createdAt,
    concurrencyToken: `tok-${id}`,
  };
}

function activity(id: string, opportunityId: string, occurredAt: string, kind: ActivityKind = 'call'): Activity {
  return {
    ref: ref('activity', id),
    relatedTo: [ref('opportunity', opportunityId)],
    kind,
    direction: 'outbound',
    occurredAt,
    participantIds: [],
  };
}

export function coverageSample(
  openOpportunities: readonly Opportunity[],
  activitiesByOpportunity: ReadonlyMap<string, readonly Activity[]>,
  capabilities: AdapterCapabilities = CAPABILITIES,
): CoverageSample {
  return {
    openOpportunities,
    notesByOpportunity: new Map(),
    activitiesByOpportunity,
    capabilities,
  };
}

export const ACTIVITY_CAPTURE_RATE_ASOF = ASOF;

/**
 * Golden fixture: 9 open opportunities.
 *
 * Denominator (excludes 'new-opp', created 3 days ago — inside the trailing
 * 7-day new-opportunity exclusion): 8 opportunities.
 *
 * Of those 8, 4 qualify:
 *  - 'boundary-30d': activity exactly 30 days before asOf — the window's
 *    lower edge is inclusive, so this counts.
 *  - 'exactly-asof': activity exactly at asOf — the window's upper edge is
 *    also inclusive.
 *  - 'other-kind-activity': activity of kind 'other' — no kind restriction;
 *    there's no separate Task representation, so 'other' must qualify too.
 *  - 'covered-normal': activity 5 days before asOf — comfortably inside the
 *    window.
 *
 * The other 4 eligible opportunities each fail exactly one condition:
 *  - 'boundary-31d': activity 31 days before asOf — one day outside the
 *    30-day window.
 *  - 'future-activity': activity 1 day after asOf — not yet in the past.
 *  - 'pre-creation-activity': activity 20 days before asOf, but the
 *    opportunity was only created 10 days before asOf — the activity
 *    predates the opportunity's own creation.
 *  - 'no-activity': no activity at all.
 *
 * Expected value: 4 / 8.
 */
export function activityCaptureRateFixture(): CoverageSample {
  const opportunities: Opportunity[] = [
    baseOpportunity('boundary-30d', daysFromAsOf(-100)),
    baseOpportunity('boundary-31d', daysFromAsOf(-100)),
    baseOpportunity('exactly-asof', daysFromAsOf(-100)),
    baseOpportunity('other-kind-activity', daysFromAsOf(-100)),
    baseOpportunity('future-activity', daysFromAsOf(-100)),
    baseOpportunity('pre-creation-activity', daysFromAsOf(-10)),
    baseOpportunity('new-opp', daysFromAsOf(-3)), // edge case: excluded from the denominator entirely
    baseOpportunity('covered-normal', daysFromAsOf(-60)),
    baseOpportunity('no-activity', daysFromAsOf(-60)),
  ];

  const activitiesByOpportunity = new Map<string, readonly Activity[]>([
    ['boundary-30d', [activity('act-1', 'boundary-30d', daysFromAsOf(-30))]], // edge case: exactly at the window's lower (inclusive) bound
    ['boundary-31d', [activity('act-2', 'boundary-31d', daysFromAsOf(-31))]], // edge case: one day outside the window
    ['exactly-asof', [activity('act-7', 'exactly-asof', daysFromAsOf(0))]], // edge case: exactly at the window's upper (inclusive) bound
    ['other-kind-activity', [activity('act-8', 'other-kind-activity', daysFromAsOf(-5), 'other')]], // edge case: kind 'other' still qualifies
    ['future-activity', [activity('act-3', 'future-activity', daysFromAsOf(1))]], // edge case: future-dated
    ['pre-creation-activity', [activity('act-4', 'pre-creation-activity', daysFromAsOf(-20))]], // edge case: predates the opportunity's own createdAt (-10d)
    // 'new-opp' has an activity that WOULD qualify if it weren't excluded by age, to prove the exclusion is about the opportunity's age, not a lack of activity.
    ['new-opp', [activity('act-5', 'new-opp', daysFromAsOf(-1))]],
    ['covered-normal', [activity('act-6', 'covered-normal', daysFromAsOf(-5))]],
    // 'no-activity' intentionally has no map entry.
  ]);

  return coverageSample(opportunities, activitiesByOpportunity);
}

export const ACTIVITY_CAPTURE_RATE_EXPECTED = { value: 4 / 8, sampleSize: 8 };

/** Gate-off fixture: activitySync is false. Content of the sample is irrelevant — the gate short-circuits before reading it. */
export function activityCaptureRateGateOffFixture(): CoverageSample {
  return coverageSample(
    [baseOpportunity('any-opp', daysFromAsOf(-60))],
    new Map(),
    { ...CAPABILITIES, activitySync: false },
  );
}

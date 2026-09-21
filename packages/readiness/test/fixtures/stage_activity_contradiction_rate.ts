import type { AdapterCapabilities } from '@gtm-trust-kernel/adapters/types.js';
import type {
  Activity,
  CanonicalStage,
  Opportunity,
  RecordRef,
} from '@gtm-trust-kernel/adapters/model/canonical.js';
import type { CoverageSample } from '../../src/metrics/types.js';

const ORG = 'org-consistency-test';
export const STAGE_ACTIVITY_CONTRADICTION_RATE_ASOF = '2026-06-15T00:00:00.000Z';
const ASOF_MS = new Date(STAGE_ACTIVITY_CONTRADICTION_RATE_ASOF).getTime();
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

function baseOpportunity(id: string, stage: CanonicalStage, createdAt: string): Opportunity {
  return {
    ref: ref('opportunity', id),
    accountRef: ref('account', 'acc-1'),
    name: `Deal ${id}`,
    stage,
    stageConfidence: 'mapped',
    vendorStageLabel: stage,
    isClosed: false,
    contactLinks: [],
    createdAt,
    modifiedAt: createdAt,
    concurrencyToken: `tok-${id}`,
  };
}

function activity(id: string, opportunityId: string, occurredAt: string): Activity {
  return {
    ref: ref('activity', id),
    relatedTo: [ref('opportunity', opportunityId)],
    kind: 'call',
    direction: 'outbound',
    occurredAt,
    participantIds: [],
  };
}

export function coverageSample(
  openOpportunities: readonly Opportunity[],
  activitiesByOpportunity: ReadonlyMap<string, readonly Activity[]> = new Map(),
  capabilities: AdapterCapabilities = CAPABILITIES,
): CoverageSample {
  return {
    openOpportunities,
    closedOpportunities: [],
    notesByOpportunity: new Map(),
    activitiesByOpportunity,
    accountsByRef: new Map(),
    accountsHydrated: false,
    missingAccountCount: 0,
    oppsWithoutAccountRef: 0,
    capabilities,
  };
}

/**
 * Golden fixture: 7 open opportunities.
 *
 * Denominator = the 5 in proposal/negotiation (the top two canonical
 * stages). 'discovery-no-activity' and 'evaluation-no-activity' are outside
 * that stage set and excluded entirely, same as new-opportunity exclusion in
 * activity_capture_rate — not counted in numerator or denominator.
 *
 * Of the 5 in the denominator, 3 are contradictions (no qualifying activity
 * in the trailing 21 days):
 *  - 'proposal-no-activity': no activity at all.
 *  - 'negotiation-boundary-22d': activity 22 days before asOf — one day
 *    outside the 21-day window (activity_capture_rate's window is 30, this
 *    metric's is 21 — this case would qualify under the wrong window).
 *  - 'negotiation-pre-creation': activity 20 days before asOf, but the
 *    opportunity was only created 10 days before asOf — predates the
 *    opportunity's own creation, same disqualifying rule as
 *    activity_capture_rate.
 * The other 2 are not contradictions:
 *  - 'proposal-recent-activity': activity 5 days before asOf.
 *  - 'negotiation-boundary-21d': activity exactly 21 days before asOf — the
 *    window's lower (inclusive) edge, so this qualifies.
 *
 * Expected value: 3 / 5 = 0.6.
 */
export function stageActivityContradictionRateFixture(): CoverageSample {
  const opportunities: Opportunity[] = [
    baseOpportunity('proposal-no-activity', 'proposal', daysFromAsOf(-100)),
    baseOpportunity('proposal-recent-activity', 'proposal', daysFromAsOf(-100)),
    baseOpportunity('negotiation-boundary-21d', 'negotiation', daysFromAsOf(-100)),
    baseOpportunity('negotiation-boundary-22d', 'negotiation', daysFromAsOf(-100)),
    baseOpportunity('negotiation-pre-creation', 'negotiation', daysFromAsOf(-10)),
    baseOpportunity('discovery-no-activity', 'discovery', daysFromAsOf(-100)),
    baseOpportunity('evaluation-no-activity', 'evaluation', daysFromAsOf(-100)),
  ];

  const activitiesByOpportunity = new Map<string, readonly Activity[]>([
    // 'proposal-no-activity' intentionally has no map entry.
    ['proposal-recent-activity', [activity('act-1', 'proposal-recent-activity', daysFromAsOf(-5))]],
    ['negotiation-boundary-21d', [activity('act-2', 'negotiation-boundary-21d', daysFromAsOf(-21))]], // edge case: exactly at the window's lower (inclusive) bound
    ['negotiation-boundary-22d', [activity('act-3', 'negotiation-boundary-22d', daysFromAsOf(-22))]], // edge case: one day outside the 21-day window
    ['negotiation-pre-creation', [activity('act-4', 'negotiation-pre-creation', daysFromAsOf(-20))]], // edge case: predates the opportunity's own createdAt (-10d)
  ]);

  return coverageSample(opportunities, activitiesByOpportunity);
}

export const STAGE_ACTIVITY_CONTRADICTION_RATE_EXPECTED = { value: 0.6, sampleSize: 5 };

/** Zero-denominator fixture: open opportunities exist, but none in proposal/negotiation. */
export function stageActivityContradictionRateNoLateStageFixture(): CoverageSample {
  return coverageSample([
    baseOpportunity('discovery-only', 'discovery', daysFromAsOf(-100)),
    baseOpportunity('evaluation-only', 'evaluation', daysFromAsOf(-100)),
  ]);
}

/** Gate-off fixture: activitySync is false. Content of the sample is irrelevant — the gate short-circuits before reading it. */
export function stageActivityContradictionRateGateOffFixture(): CoverageSample {
  return coverageSample(
    [baseOpportunity('any-opp', 'proposal', daysFromAsOf(-100))],
    new Map(),
    { ...CAPABILITIES, activitySync: false },
  );
}

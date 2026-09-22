import type { Activity, Note, Opportunity, RecordRef } from '@gtm-trust-kernel/adapters/model/canonical.js';
import { TrustTier, tag } from '@gtm-trust-kernel/adapters/model/trust.js';
import type { CoverageSample } from '../../src/metrics/types.js';
import { makeCoverageSample } from '../support/coverageSample.js';

const ORG = 'org-labels-test';
export const OUTCOME_EVIDENCE_RETENTION_RATE_ASOF = '2026-06-15T00:00:00.000Z';

function ref(objectType: RecordRef['objectType'], id: string): RecordRef {
  return { crm: 'mock', orgId: ORG, objectType, id };
}

function closedOpportunity(id: string): Opportunity {
  return {
    ref: ref('opportunity', id),
    accountRef: ref('account', 'acc-1'),
    name: `Deal ${id}`,
    stage: 'closed_won',
    stageConfidence: 'mapped',
    vendorStageLabel: 'Closed Won',
    isClosed: true,
    isWon: true,
    closeDate: '2026-05-01T00:00:00.000Z',
    contactLinks: [],
    createdAt: '2025-01-01T00:00:00.000Z',
    modifiedAt: '2026-05-01T00:00:00.000Z',
    concurrencyToken: `tok-${id}`,
  };
}

function note(id: string, opportunityId: string): Note {
  return {
    ref: ref('note', id),
    relatedTo: [ref('opportunity', opportunityId)],
    createdAt: OUTCOME_EVIDENCE_RETENTION_RATE_ASOF,
    body: tag(TrustTier.UserAuthored, `Note body for ${id}`, {
      recordId: `note:${id}`,
      field: 'body',
      capturedAt: OUTCOME_EVIDENCE_RETENTION_RATE_ASOF,
    }),
  };
}

function activity(id: string, opportunityId: string): Activity {
  return {
    ref: ref('activity', id),
    relatedTo: [ref('opportunity', opportunityId)],
    kind: 'call',
    direction: 'outbound',
    occurredAt: OUTCOME_EVIDENCE_RETENTION_RATE_ASOF,
    participantIds: [],
  };
}

const CLOSED_OPPORTUNITIES = [
  closedOpportunity('has-note'),
  closedOpportunity('has-activity'),
  closedOpportunity('has-both'),
  closedOpportunity('no-entry'),
  closedOpportunity('empty-array'),
];

const NOTES_BY_OPPORTUNITY = new Map<string, readonly Note[]>([
  ['has-note', [note('n1', 'has-note')]],
  ['has-both', [note('n2', 'has-both')]],
  ['empty-array', []],
  // 'no-entry' and 'has-activity' intentionally have no notes map entry.
]);

const ACTIVITIES_BY_OPPORTUNITY = new Map<string, readonly Activity[]>([
  ['has-activity', [activity('a1', 'has-activity')]],
  ['has-both', [activity('a2', 'has-both')]],
  ['empty-array', []],
  // 'no-entry' and 'has-note' intentionally have no activities map entry.
]);

/**
 * Golden fixture: 5 sampled closed opportunities. 3 retain at least one Note
 * or Activity ('has-note', 'has-activity', 'has-both'); 2 don't
 * ('no-entry': no map entry in either map; 'empty-array': a present but
 * empty array in both maps — same "purged" reading as no entry at all).
 * Expected: 3 / 5 = 0.6.
 */
export function outcomeEvidenceRetentionRateFixture(): CoverageSample {
  return makeCoverageSample({
    closedOpportunities: CLOSED_OPPORTUNITIES,
    notesByOpportunity: NOTES_BY_OPPORTUNITY,
    activitiesByOpportunity: ACTIVITIES_BY_OPPORTUNITY,
  });
}

export const OUTCOME_EVIDENCE_RETENTION_RATE_EXPECTED = { value: 0.6, sampleSize: 5 };

/**
 * Same as the golden fixture, but 'has-activity' (one of the 3 retained
 * opportunities) is flagged as truncated. Unlike note_coverage_rate/
 * activity_capture_rate, this metric does NOT apply applyTruncationFloor
 * (metric-definitions.md D7, reversed from this session's first pass) — the
 * value must stay 0.6 AND floor must stay false/absent, with no floor note.
 */
export function outcomeEvidenceRetentionRateTruncatedFixture(): CoverageSample {
  const sample = outcomeEvidenceRetentionRateFixture();
  return { ...sample, activitiesTruncatedOpportunityIds: new Set(['has-activity']) };
}

/** No closed opportunities in the sample at all — not_applicable, not a computed 0. */
export function outcomeEvidenceRetentionRateEmptyFixture(): CoverageSample {
  return makeCoverageSample({ closedOpportunities: [] });
}

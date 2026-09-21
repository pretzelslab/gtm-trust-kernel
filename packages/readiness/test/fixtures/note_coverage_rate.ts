import type { AdapterCapabilities } from '@gtm-trust-kernel/adapters/types.js';
import type { Note, Opportunity, RecordRef } from '@gtm-trust-kernel/adapters/model/canonical.js';
import { TrustTier, tag } from '@gtm-trust-kernel/adapters/model/trust.js';
import type { CoverageSample } from '../../src/metrics/types.js';

const ORG = 'org-coverage-test';

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

function baseOpportunity(id: string, overrides: Partial<Opportunity> = {}): Opportunity {
  return {
    ref: ref('opportunity', id),
    accountRef: ref('account', 'acc-1'),
    name: `Deal ${id}`,
    stage: 'discovery',
    stageConfidence: 'mapped',
    vendorStageLabel: 'Discovery',
    isClosed: false,
    contactLinks: [],
    createdAt: '2026-01-01T00:00:00.000Z',
    modifiedAt: '2026-01-01T00:00:00.000Z',
    concurrencyToken: `tok-${id}`,
    ...overrides,
  };
}

function note(id: string, opportunityId: string, body: string): Note {
  return {
    ref: ref('note', id),
    relatedTo: [ref('opportunity', opportunityId)],
    authorId: 'user:rep-1',
    createdAt: '2026-01-01T00:00:00.000Z',
    body: tag(TrustTier.UserAuthored, body, {
      recordId: `note:${id}`,
      field: 'body',
      capturedAt: '2026-01-01T00:00:00.000Z',
    }),
  };
}

export function coverageSample(
  openOpportunities: readonly Opportunity[],
  notesByOpportunity: ReadonlyMap<string, readonly Note[]> = new Map(),
): CoverageSample {
  return {
    openOpportunities,
    notesByOpportunity,
    activitiesByOpportunity: new Map(),
    capabilities: CAPABILITIES,
  };
}

/**
 * Golden fixture: 5 open opportunities. 3 have at least one Note — one of
 * them a single two-character note (the edge case: no length threshold
 * applies here, presence is all that counts; that judgment is
 * substantive_note_rate's job, not this metric's); one has two notes, to
 * confirm the metric counts opportunities, not notes. 2 have none (one with
 * no map entry at all, one with an empty array). Expected value: 3 / 5 = 0.6.
 */
export function noteCoverageRateFixture(): CoverageSample {
  const opportunities = [
    baseOpportunity('short-note'),
    baseOpportunity('normal-note'),
    baseOpportunity('two-notes'),
    baseOpportunity('no-entry'),
    baseOpportunity('empty-array'),
  ];

  const notesByOpportunity = new Map<string, readonly Note[]>([
    ['short-note', [note('n1', 'short-note', 'ok')]], // edge case: 2-char note still counts, presence only
    ['normal-note', [note('n2', 'normal-note', 'Legal review is the gate; security questionnaire outstanding.')]],
    [
      'two-notes',
      [note('n3', 'two-notes', 'Called, left VM.'), note('n4', 'two-notes', 'Follow-up scheduled.')],
    ],
    ['empty-array', []],
    // 'no-entry' intentionally has no map key at all.
  ]);

  return coverageSample(opportunities, notesByOpportunity);
}

export const NOTE_COVERAGE_RATE_EXPECTED = { value: 0.6, sampleSize: 5 };

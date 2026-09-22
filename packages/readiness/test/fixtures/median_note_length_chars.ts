import type { Note, RecordRef } from '@gtm-trust-kernel/adapters/model/canonical.js';
import { TrustTier, tag } from '@gtm-trust-kernel/adapters/model/trust.js';
import type { CoverageSample } from '../../src/metrics/types.js';
import { makeCoverageSample } from '../support/coverageSample.js';

const ORG = 'org-text-substrate-test';
export const MEDIAN_NOTE_LENGTH_CHARS_ASOF = '2026-06-15T00:00:00.000Z';

function ref(objectType: RecordRef['objectType'], id: string): RecordRef {
  return { crm: 'mock', orgId: ORG, objectType, id };
}

function note(id: string, opportunityId: string, body: string): Note {
  return {
    ref: ref('note', id),
    relatedTo: [ref('opportunity', opportunityId)],
    createdAt: MEDIAN_NOTE_LENGTH_CHARS_ASOF,
    body: tag(TrustTier.UserAuthored, body, {
      recordId: `note:${id}`,
      field: 'body',
      capturedAt: MEDIAN_NOTE_LENGTH_CHARS_ASOF,
    }),
  };
}

function coverageSample(notesByOpportunity: ReadonlyMap<string, readonly Note[]>): CoverageSample {
  return makeCoverageSample({ notesByOpportunity });
}

/**
 * Golden fixture: 5 sampled notes of trimmed length 10, 20, 30, 40, 50 —
 * same denominator as substantive_note_rate (all sampled notes, not just
 * the substantive ones). 'whitespace-padded' proves trimming happens before
 * measuring: its raw string is longer than 30 chars, but trims to exactly
 * 30. Median of [10, 20, 30, 40, 50] = 30.
 */
export function medianNoteLengthCharsFixture(): CoverageSample {
  const notesByOpportunity = new Map<string, readonly Note[]>([
    ['opp-1', [note('n1', 'opp-1', 'A'.repeat(10))]],
    ['opp-2', [note('n2', 'opp-2', 'A'.repeat(20))]],
    ['opp-3', [note('n3', 'opp-3', `   ${'A'.repeat(30)}   `)]], // edge case: trims to exactly 30, not its raw (padded) length
    ['opp-4', [note('n4', 'opp-4', 'A'.repeat(40))]],
    ['opp-5', [note('n5', 'opp-5', 'A'.repeat(50))]],
  ]);

  return coverageSample(notesByOpportunity);
}

export const MEDIAN_NOTE_LENGTH_CHARS_EXPECTED = { value: 30, sampleSize: 5 };

/** No sampled notes at all — not_applicable, not a computed value. */
export function medianNoteLengthCharsEmptyFixture(): CoverageSample {
  return coverageSample(new Map());
}

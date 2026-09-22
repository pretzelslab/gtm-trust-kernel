import type { Note, RecordRef } from '@gtm-trust-kernel/adapters/model/canonical.js';
import { TrustTier, tag } from '@gtm-trust-kernel/adapters/model/trust.js';
import type { CoverageSample } from '../../src/metrics/types.js';
import { makeCoverageSample } from '../support/coverageSample.js';

const ORG = 'org-text-substrate-test';
export const SUBSTANTIVE_NOTE_RATE_ASOF = '2026-06-15T00:00:00.000Z';

function ref(objectType: RecordRef['objectType'], id: string): RecordRef {
  return { crm: 'mock', orgId: ORG, objectType, id };
}

function note(id: string, opportunityId: string, body: string): Note {
  return {
    ref: ref('note', id),
    relatedTo: [ref('opportunity', opportunityId)],
    createdAt: SUBSTANTIVE_NOTE_RATE_ASOF,
    body: tag(TrustTier.UserAuthored, body, {
      recordId: `note:${id}`,
      field: 'body',
      capturedAt: SUBSTANTIVE_NOTE_RATE_ASOF,
    }),
  };
}

function coverageSample(notesByOpportunity: ReadonlyMap<string, readonly Note[]>): CoverageSample {
  return makeCoverageSample({ notesByOpportunity });
}

/**
 * Golden fixture: 5 sampled notes (population pooled across open + closed
 * opportunities — notesByOpportunity is already hydrated for both, see
 * metric-definitions.md D6's resolved population ambiguity).
 *  - 'long-real': a genuine multi-sentence note, well over 40 chars —
 *    substantive.
 *  - 'exactly-40': exactly 40 chars after trim — the length boundary is
 *    inclusive (>= 40), so this counts as substantive.
 *  - 'just-under-40': exactly 39 chars after trim — one under the boundary,
 *    not substantive.
 *  - 'denylist-short': "no answer" — an exact filler-denylist match, also
 *    under 40 chars (every denylist entry is), not substantive on either
 *    condition.
 *  - 'denylist-mixed-case-whitespace': "  Left VM  " — trims to "Left VM",
 *    which must match the denylist's "left vm" case-insensitively.
 * Expected: 2 / 5 = 0.4 substantive.
 */
export function substantiveNoteRateFixture(): CoverageSample {
  const notesByOpportunity = new Map<string, readonly Note[]>([
    ['opp-1', [note('n1', 'opp-1', 'Customer confirmed budget approval and wants to proceed with the rollout plan next quarter.')]],
    ['opp-2', [note('n2', 'opp-2', 'A'.repeat(40))]], // edge case: exactly 40 chars, inclusive boundary
    ['opp-3', [note('n3', 'opp-3', 'A'.repeat(39))]], // edge case: exactly 39 chars, one under
    ['opp-4', [note('n4', 'opp-4', 'no answer')]], // edge case: exact denylist match
    ['opp-5', [note('n5', 'opp-5', '  Left VM  ')]], // edge case: denylist match is case-insensitive after trim
  ]);

  return coverageSample(notesByOpportunity);
}

export const SUBSTANTIVE_NOTE_RATE_EXPECTED = { value: 0.4, sampleSize: 5 };

/** No sampled notes at all — not_applicable, not a computed 0. */
export function substantiveNoteRateEmptyFixture(): CoverageSample {
  return coverageSample(new Map());
}

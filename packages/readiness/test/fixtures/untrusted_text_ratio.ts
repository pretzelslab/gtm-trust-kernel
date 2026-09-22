import type { Activity, Note, RecordRef } from '@gtm-trust-kernel/adapters/model/canonical.js';
import { TrustTier, tag } from '@gtm-trust-kernel/adapters/model/trust.js';
import type { CoverageSample } from '../../src/metrics/types.js';
import { makeCoverageSample } from '../support/coverageSample.js';

const ORG = 'org-text-substrate-test';
export const UNTRUSTED_TEXT_RATIO_ASOF = '2026-06-15T00:00:00.000Z';

function ref(objectType: RecordRef['objectType'], id: string): RecordRef {
  return { crm: 'mock', orgId: ORG, objectType, id };
}

function note(id: string, opportunityId: string, tier: TrustTier): Note {
  return {
    ref: ref('note', id),
    relatedTo: [ref('opportunity', opportunityId)],
    createdAt: UNTRUSTED_TEXT_RATIO_ASOF,
    body: tag(tier, `Note body for ${id}`, { recordId: `note:${id}`, field: 'body', capturedAt: UNTRUSTED_TEXT_RATIO_ASOF }),
  };
}

function activity(
  id: string,
  opportunityId: string,
  fields: { subjectTier?: TrustTier; bodyTier?: TrustTier },
): Activity {
  return {
    ref: ref('activity', id),
    relatedTo: [ref('opportunity', opportunityId)],
    kind: 'email',
    direction: 'inbound',
    occurredAt: UNTRUSTED_TEXT_RATIO_ASOF,
    participantIds: [],
    subject:
      fields.subjectTier !== undefined
        ? tag(fields.subjectTier, `Subject for ${id}`, { recordId: `activity:${id}`, field: 'subject', capturedAt: UNTRUSTED_TEXT_RATIO_ASOF })
        : undefined,
    body:
      fields.bodyTier !== undefined
        ? tag(fields.bodyTier, `Body for ${id}`, { recordId: `activity:${id}`, field: 'body', capturedAt: UNTRUSTED_TEXT_RATIO_ASOF })
        : undefined,
  };
}

/**
 * Golden fixture: 7 sampled free-text FIELDS (per-field denominator, not
 * per-record — an Activity with both subject and body contributes 2
 * entries, unlike pii_density's per-record counting).
 *  - 'note-internal': body, UserAuthored.
 *  - 'note-external': body, ExternallySourced.
 *  - 'activity-inbound': subject AND body, both ExternallySourced — proves
 *    a single Activity can contribute 2 fields.
 *  - 'activity-outbound': subject only, UserAuthored (no body field at all,
 *    so it contributes exactly 1, not 2).
 *  - 'activity-mixed': subject UserAuthored, body ExternallySourced — one
 *    Activity contributing to both sides, proving fields are judged
 *    independently, not the whole record at once.
 * External fields: note-external(1) + activity-inbound(2) +
 * activity-mixed.body(1) = 4. Internal: note-internal(1) +
 * activity-outbound.subject(1) + activity-mixed.subject(1) = 3.
 * Expected: 4 / 7.
 */
export function untrustedTextRatioFixture(): CoverageSample {
  const notesByOpportunity = new Map<string, readonly Note[]>([
    ['opp-1', [note('note-internal', 'opp-1', TrustTier.UserAuthored)]],
    ['opp-2', [note('note-external', 'opp-2', TrustTier.ExternallySourced)]],
  ]);

  const activitiesByOpportunity = new Map<string, readonly Activity[]>([
    [
      'opp-3',
      [
        activity('activity-inbound', 'opp-3', { subjectTier: TrustTier.ExternallySourced, bodyTier: TrustTier.ExternallySourced }),
        activity('activity-outbound', 'opp-3', { subjectTier: TrustTier.UserAuthored }),
        activity('activity-mixed', 'opp-3', { subjectTier: TrustTier.UserAuthored, bodyTier: TrustTier.ExternallySourced }),
      ],
    ],
  ]);

  return makeCoverageSample({ notesByOpportunity, activitiesByOpportunity });
}

export const UNTRUSTED_TEXT_RATIO_EXPECTED = { value: 4 / 7, sampleSize: 7 };

/** No sampled note bodies or activity subject/body fields at all — not_applicable. */
export function untrustedTextRatioEmptyFixture(): CoverageSample {
  return makeCoverageSample({});
}

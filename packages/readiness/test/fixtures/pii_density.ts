import type { Activity, Note, Opportunity, RecordRef } from '@gtm-trust-kernel/adapters/model/canonical.js';
import { TrustTier, tag } from '@gtm-trust-kernel/adapters/model/trust.js';
import type { CoverageSample } from '../../src/metrics/types.js';
import { makeCoverageSample } from '../support/coverageSample.js';

const ORG = 'org-text-substrate-test';
export const PII_DENSITY_ASOF = '2026-06-15T00:00:00.000Z';

function ref(objectType: RecordRef['objectType'], id: string): RecordRef {
  return { crm: 'mock', orgId: ORG, objectType, id };
}

function trustedText(recordId: string, field: string, value: string) {
  return tag(TrustTier.UserAuthored, value, { recordId, field, capturedAt: PII_DENSITY_ASOF });
}

function note(id: string, opportunityId: string, body: string): Note {
  return {
    ref: ref('note', id),
    relatedTo: [ref('opportunity', opportunityId)],
    createdAt: PII_DENSITY_ASOF,
    body: trustedText(`note:${id}`, 'body', body),
  };
}

function activity(id: string, opportunityId: string, overrides: { subject?: string; body?: string }): Activity {
  return {
    ref: ref('activity', id),
    relatedTo: [ref('opportunity', opportunityId)],
    kind: 'call',
    direction: 'outbound',
    occurredAt: PII_DENSITY_ASOF,
    participantIds: [],
    subject: overrides.subject ? trustedText(`activity:${id}`, 'subject', overrides.subject) : undefined,
    body: overrides.body ? trustedText(`activity:${id}`, 'body', overrides.body) : undefined,
  };
}

function opportunity(id: string, nextStep?: string): Opportunity {
  return {
    ref: ref('opportunity', id),
    accountRef: ref('account', 'acc-1'),
    name: `Deal ${id}`,
    stage: 'discovery',
    stageConfidence: 'mapped',
    vendorStageLabel: 'Discovery',
    isClosed: false,
    contactLinks: [],
    nextStep: nextStep ? trustedText(`opportunity:${id}`, 'nextStep', nextStep) : undefined,
    createdAt: PII_DENSITY_ASOF,
    modifiedAt: PII_DENSITY_ASOF,
    concurrencyToken: `tok-${id}`,
  };
}

/**
 * Golden fixture: 9 records, 7 with at least one candidate free-text field
 * (the denominator), 4 of which match a PII pattern.
 *
 * Matches (4):
 *  - 'note-email': body contains an email address.
 *  - 'activity-phone': body contains a parenthesized-area-code phone
 *    number — separators present, so it qualifies under the tightened rule.
 *  - 'activity-ssn': subject contains a hyphenated SSN-like string.
 *  - 'opp-card': nextStep contains the standard Luhn-valid Visa test PAN
 *    (4111111111111111) — a well-known placeholder, not a real card number.
 *
 * Non-matches with a candidate field (3):
 *  - 'note-clean': ordinary note text, no pattern present.
 *  - 'note-amount-negative': a dollar amount ("$45,000") — the comma breaks
 *    the digit run so it can't Luhn-validate as card-like, and it doesn't
 *    fit any other pattern. Proves the tightened patterns don't fire on
 *    ordinary currency text.
 *  - 'opp-id-negative': a bare 9-digit internal reference id, no hyphens —
 *    proves the tightened SSN-like pattern (hyphenated-only) correctly
 *    excludes an unhyphenated 9-digit run that used to be a false positive.
 *
 * Excluded from the denominator entirely, not counted as non-matches (2):
 *  - 'activity-no-text': neither subject nor body set.
 *  - 'opp-no-nextstep': no nextStep at all.
 *
 * Expected: 4 / 7 matches.
 */
export function piiDensityFixture(): CoverageSample {
  const openOpportunities: Opportunity[] = [
    opportunity('opp-card', 'Card on file ends 4111111111111111, confirm renewal before the next billing cycle.'),
    opportunity('opp-id-negative', 'Reference ticket 482910337 needs follow-up with support.'),
    opportunity('opp-no-nextstep'),
  ];

  const notesByOpportunity = new Map<string, readonly Note[]>([
    ['opp-card', [note('note-email', 'opp-card', 'Reach me at jane.doe@example.com for details.')]],
    ['opp-id-negative', [note('note-clean', 'opp-id-negative', 'Customer happy with proposal, moving to procurement.')]],
    ['opp-no-nextstep', [note('note-amount-negative', 'opp-no-nextstep', 'Deal size is $45,000 with net 30 terms.')]],
  ]);

  const activitiesByOpportunity = new Map<string, readonly Activity[]>([
    [
      'opp-card',
      [
        activity('activity-phone', 'opp-card', { body: 'Call back at (415) 555-0100 tomorrow.' }),
        activity('activity-ssn', 'opp-card', { subject: 'Verify SSN 123-45-6789 for background check' }),
        activity('activity-no-text', 'opp-card', {}),
      ],
    ],
  ]);

  return makeCoverageSample({ openOpportunities, notesByOpportunity, activitiesByOpportunity });
}

export const PII_DENSITY_EXPECTED = { value: 4 / 7, sampleSize: 7 };

/** No sampled notes, activities, or opportunity next steps at all — not_applicable. */
export function piiDensityEmptyFixture(): CoverageSample {
  return makeCoverageSample({});
}

/**
 * D5 cross-system joinability metrics. See docs/metric-definitions.md,
 * section D5, for the locked definitions this implements, and
 * docs/second-source-adapter-design.md for the resolution layer
 * (src/secondSource/resolve.ts) these read from.
 *
 * Every metric gates on config.secondSourceResolution being present first
 * (undefined = no second source connected = not_instrumented, same
 * capability-matrix-gate-off convention as D1-D4), then on the specific
 * SecondSourceCapabilities flag(s) it needs — never on "is a second
 * source connected" alone (second-source-adapter-design.md decision 5).
 */

import type { Activity, Opportunity } from '@gtm-trust-kernel/adapters/model/canonical.js';
import type { SecondSourceActivity } from '@gtm-trust-kernel/adapters/types.js';
import { DAY_MS } from './shared.js';
import type { CoverageSample, MetricConfig, MetricResult } from './types.js';
import { LOW_CONFIDENCE_SAMPLE_SIZE } from './types.js';
import type { SecondSourceResolution } from '../secondSource/resolve.js';
import type { MetricId } from '../rubric.js';

function notInstrumented(metric: MetricId, note: string): MetricResult {
  return { metric, status: 'not_instrumented', value: null, sampleSize: 0, lowConfidence: false, note };
}

function notApplicable(metric: MetricId, note: string): MetricResult {
  return { metric, status: 'not_applicable', value: null, sampleSize: 0, lowConfidence: false, note };
}

/** Sets floor: true (and appends to note) when condition holds and the result is otherwise 'ok'. Same "general data-completeness signal, not a proven-direction correction" philosophy as shared.ts's applyTruncationFloor, generalized from a per-record truncated-id set to a plain per-type boolean (D5's truncation signal, unlike D1's, isn't per-record). */
function withFloorIf(result: MetricResult, condition: boolean, floorNote: string): MetricResult {
  if (result.status !== 'ok' || !condition) {
    return result;
  }
  return { ...result, floor: true, note: result.note ? `${result.note} ${floorNote}` : floorNote };
}

// ---------------------------------------------------------------------------
// contact_identity_resolution_rate / account_resolution_rate
// ---------------------------------------------------------------------------

export function contactIdentityResolutionRate(sample: CoverageSample, config: MetricConfig): MetricResult {
  const resolution = config.secondSourceResolution;
  if (!resolution) {
    return notInstrumented('contact_identity_resolution_rate', 'no second source connected');
  }
  if (!resolution.capabilities.hasContacts) {
    return notInstrumented('contact_identity_resolution_rate', 'second source reports no contact data (hasContacts is false)');
  }
  if (!sample.contactsHydrated) {
    return notInstrumented('contact_identity_resolution_rate', 'contact hydration has not run for this sample (contactsHydrated is false)');
  }

  const contacts = [...sample.contactsByRef.values()].filter((c) => c.email);
  const sampleSize = contacts.length;
  if (sampleSize === 0) {
    return notApplicable('contact_identity_resolution_rate', 'no sampled CRM contacts with an email in this sample');
  }

  const resolved = contacts.filter((c) => resolution.contactMatches.has(c.ref.id)).length;
  const result: MetricResult = {
    metric: 'contact_identity_resolution_rate',
    status: 'ok',
    value: resolved / sampleSize,
    sampleSize,
    lowConfidence: sampleSize < LOW_CONFIDENCE_SAMPLE_SIZE,
  };

  return withFloorIf(
    result,
    resolution.secondSourceSample.contactsTruncated,
    'second source contact sample was truncated at maxSampleSizePerType — value is a floor, not exact',
  );
}

export function accountResolutionRate(sample: CoverageSample, config: MetricConfig): MetricResult {
  const resolution = config.secondSourceResolution;
  if (!resolution) {
    return notInstrumented('account_resolution_rate', 'no second source connected');
  }
  if (!resolution.capabilities.hasAccounts) {
    return notInstrumented('account_resolution_rate', 'second source reports no account data (hasAccounts is false)');
  }
  if (!sample.accountsHydrated) {
    return notInstrumented('account_resolution_rate', 'account hydration has not run for this sample (accountsHydrated is false)');
  }

  const accounts = [...sample.accountsByRef.values()];
  const sampleSize = accounts.length;
  if (sampleSize === 0) {
    return notApplicable('account_resolution_rate', 'no hydrated CRM accounts in this sample');
  }

  const resolved = accounts.filter((a) => resolution.accountMatches.has(a.ref.id)).length;
  const result: MetricResult = {
    metric: 'account_resolution_rate',
    status: 'ok',
    value: resolved / sampleSize,
    sampleSize,
    lowConfidence: sampleSize < LOW_CONFIDENCE_SAMPLE_SIZE,
  };

  return withFloorIf(
    result,
    resolution.secondSourceSample.accountsTruncated,
    'second source account sample was truncated at maxSampleSizePerType — value is a floor, not exact',
  );
}

// ---------------------------------------------------------------------------
// activity_attribution_rate / temporal_anomaly_rate share one join: which
// sampled CRM opportunities a second-source activity could plausibly
// belong to, via the contact/account resolution above. "At least one
// candidate" is the rule throughout — same style as the resolution match
// counting (metric-definitions.md's "Matching count" notes).
// ---------------------------------------------------------------------------

function candidateOpportunities(
  activity: SecondSourceActivity,
  resolution: SecondSourceResolution,
  sample: CoverageSample,
): Opportunity[] {
  const allOpportunities = [...sample.openOpportunities, ...sample.closedOpportunities];
  const candidates = new Map<string, Opportunity>();

  if (activity.contactRef) {
    const contactRefId = activity.contactRef.id;
    for (const [crmContactId, matches] of resolution.contactMatches) {
      if (!matches.some((r) => r.id === contactRefId)) continue;
      for (const o of allOpportunities) {
        if (o.contactLinks.some((l) => l.contactRef.id === crmContactId)) {
          candidates.set(o.ref.id, o);
        }
      }
    }
  }

  if (activity.accountRef) {
    const accountRefId = activity.accountRef.id;
    for (const [crmAccountId, matches] of resolution.accountMatches) {
      if (!matches.some((r) => r.id === accountRefId)) continue;
      for (const o of allOpportunities) {
        if (o.accountRef.id === crmAccountId) {
          candidates.set(o.ref.id, o);
        }
      }
    }
  }

  return [...candidates.values()];
}

/** closeDate is deliberately excluded from "future-dated" checks elsewhere in this file — a forecasted future close date on an open deal is normal, not an anomaly. This window check is the one place closeDate is used as an upper bound, per its own definition. */
function windowEnd(o: Opportunity, asOf: string): number | null {
  if (!o.isClosed) return new Date(asOf).getTime();
  return o.closeDate ? new Date(o.closeDate).getTime() : null; // closed but no closeDate: can't compute a valid window, exclude rather than guess
}

function isAttributed(activity: SecondSourceActivity, resolution: SecondSourceResolution, sample: CoverageSample, asOf: string): boolean {
  const occurredAt = new Date(activity.occurredAt).getTime();
  return candidateOpportunities(activity, resolution, sample).some((o) => {
    const end = windowEnd(o, asOf);
    if (end === null) return false;
    return occurredAt >= new Date(o.createdAt).getTime() && occurredAt <= end;
  });
}

export function activityAttributionRate(sample: CoverageSample, config: MetricConfig): MetricResult {
  const resolution = config.secondSourceResolution;
  if (!resolution) {
    return notInstrumented('activity_attribution_rate', 'no second source connected');
  }
  if (!resolution.capabilities.hasActivities) {
    return notInstrumented('activity_attribution_rate', 'second source reports no activity data (hasActivities is false)');
  }
  // A low rate must never stand in for a missing capability: if neither
  // side of the resolution is available, attribution has nothing to run
  // against at all, so this is a gate, not a degraded-toward-zero rate.
  if (!resolution.capabilities.hasContacts && !resolution.capabilities.hasAccounts) {
    return notInstrumented('activity_attribution_rate', 'no contact or account data in second source to attribute through');
  }

  const activities = resolution.secondSourceSample.activities;
  const sampleSize = activities.length;
  if (sampleSize === 0) {
    return notApplicable('activity_attribution_rate', 'no sampled second-source activities in this sample');
  }

  const attributed = activities.filter((a) => isAttributed(a, resolution, sample, config.asOf)).length;
  const result: MetricResult = {
    metric: 'activity_attribution_rate',
    status: 'ok',
    value: attributed / sampleSize,
    sampleSize,
    lowConfidence: sampleSize < LOW_CONFIDENCE_SAMPLE_SIZE,
  };

  const truncated =
    resolution.secondSourceSample.activitiesTruncated ||
    resolution.secondSourceSample.contactsTruncated ||
    resolution.secondSourceSample.accountsTruncated;
  return withFloorIf(
    result,
    truncated,
    'second source sample (activities and/or the contacts/accounts used to attribute them) was truncated at maxSampleSizePerType — value is a floor, not exact',
  );
}

// ---------------------------------------------------------------------------
// temporal_anomaly_rate
//
// Scope locked this session (metric-definitions.md): the pooled
// denominator is CRM opportunities + CRM activities + second-source
// activities — CRM/second-source contacts and accounts are excluded.
// Second-source contacts/accounts have no createdAt at all (only
// modifiedAt), so the created>modified check couldn't apply to them
// regardless; the close-date check is activity-specific by definition.
//
// Gates only on hasActivities (its own type on the second-source side) —
// unlike activity_attribution_rate, this metric can still meaningfully
// compute the created>modified and future-dated checks without any
// contact/account resolution at all; only the close-date check needs
// attribution, and degrades naturally (that check just doesn't fire for
// an unattributable activity) rather than blocking the whole metric.
// ---------------------------------------------------------------------------

function isFutureDated(timestamps: readonly string[], asOf: string): boolean {
  const cutoff = new Date(asOf).getTime() + DAY_MS;
  return timestamps.some((t) => new Date(t).getTime() > cutoff);
}

function opportunityIsAnomalous(o: Opportunity, asOf: string): boolean {
  if (new Date(o.createdAt).getTime() > new Date(o.modifiedAt).getTime()) return true;
  return isFutureDated([o.createdAt, o.modifiedAt], asOf); // closeDate excluded — a future close date is expected, not an anomaly
}

/** CRM Activity has no createdAt/modifiedAt (only occurredAt) — the created>modified check can't apply here. */
function crmActivityIsAnomalous(a: Activity, relatedOpportunities: readonly Opportunity[], asOf: string): boolean {
  const occurredAt = new Date(a.occurredAt).getTime();
  const pastCloseDate = relatedOpportunities.some(
    (o) => o.isClosed && o.closeDate && occurredAt > new Date(o.closeDate).getTime(),
  );
  return pastCloseDate || isFutureDated([a.occurredAt], asOf);
}

function secondSourceActivityIsAnomalous(
  a: SecondSourceActivity,
  resolution: SecondSourceResolution,
  sample: CoverageSample,
  asOf: string,
): boolean {
  if (new Date(a.createdAt).getTime() > new Date(a.lastModifiedAt).getTime()) return true;
  const pastCloseDate = candidateOpportunities(a, resolution, sample).some(
    (o) => o.isClosed && o.closeDate && new Date(a.occurredAt).getTime() > new Date(o.closeDate).getTime(),
  );
  return pastCloseDate || isFutureDated([a.occurredAt, a.createdAt, a.lastModifiedAt], asOf);
}

export function temporalAnomalyRate(sample: CoverageSample, config: MetricConfig): MetricResult {
  const resolution = config.secondSourceResolution;
  if (!resolution) {
    return notInstrumented('temporal_anomaly_rate', 'no second source connected');
  }
  if (!resolution.capabilities.hasActivities) {
    return notInstrumented('temporal_anomaly_rate', 'second source reports no activity data (hasActivities is false)');
  }

  const allOpportunities = [...sample.openOpportunities, ...sample.closedOpportunities];

  const crmActivitiesById = new Map<string, Activity>();
  for (const list of sample.activitiesByOpportunity.values()) {
    for (const a of list) crmActivitiesById.set(a.ref.id, a);
  }
  const crmActivities = [...crmActivitiesById.values()];

  const secondSourceActivities = resolution.secondSourceSample.activities;

  const sampleSize = allOpportunities.length + crmActivities.length + secondSourceActivities.length;
  if (sampleSize === 0) {
    return notApplicable('temporal_anomaly_rate', 'no sampled records (CRM or second-source) in this run');
  }

  let anomalous = 0;
  for (const o of allOpportunities) {
    if (opportunityIsAnomalous(o, config.asOf)) anomalous += 1;
  }
  for (const a of crmActivities) {
    const related = a.relatedTo
      .filter((r) => r.objectType === 'opportunity')
      .map((r) => allOpportunities.find((o) => o.ref.id === r.id))
      .filter((o): o is Opportunity => o !== undefined);
    if (crmActivityIsAnomalous(a, related, config.asOf)) anomalous += 1;
  }
  for (const a of secondSourceActivities) {
    if (secondSourceActivityIsAnomalous(a, resolution, sample, config.asOf)) anomalous += 1;
  }

  const result: MetricResult = {
    metric: 'temporal_anomaly_rate',
    status: 'ok',
    value: anomalous / sampleSize,
    sampleSize,
    lowConfidence: sampleSize < LOW_CONFIDENCE_SAMPLE_SIZE,
  };

  return withFloorIf(
    result,
    resolution.secondSourceSample.activitiesTruncated,
    'second source activity sample was truncated at maxSampleSizePerType — value is a floor, not exact',
  );
}

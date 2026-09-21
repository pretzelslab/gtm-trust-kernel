/**
 * D1 coverage metrics. See docs/metric-definitions.md, section D1.
 */

import type { CoverageSample, MetricConfig, MetricResult } from './types.js';
import { DAY_MS, rateOverOpportunities } from './shared.js';

export function closeDateFillRate(sample: CoverageSample, _config: MetricConfig): MetricResult {
  return rateOverOpportunities('close_date_fill_rate', sample.openOpportunities, (o) => o.closeDate != null);
}

export function contactLinkageRate(sample: CoverageSample, _config: MetricConfig): MetricResult {
  return rateOverOpportunities(
    'contact_linkage_rate',
    sample.openOpportunities,
    (o) => o.contactLinks.length > 0,
  );
}

/** Amount = 0 counts as unfilled, same as null — a genuinely free deal is rare enough that treating it as missing data is the safer default. */
export function amountFillRate(sample: CoverageSample, _config: MetricConfig): MetricResult {
  return rateOverOpportunities(
    'amount_fill_rate',
    sample.openOpportunities,
    (o) => o.amount != null && o.amount !== 0,
  );
}

/** Whitespace-only or single-character values ("-", ".") count as unfilled. */
export function nextStepFillRate(sample: CoverageSample, _config: MetricConfig): MetricResult {
  return rateOverOpportunities(
    'next_step_fill_rate',
    sample.openOpportunities,
    (o) => (o.nextStep?.value.trim().length ?? 0) > 1,
  );
}

/** Presence only — no length or content-quality judgment. That's substantive_note_rate's job (D6), not this metric's. */
export function noteCoverageRate(sample: CoverageSample, _config: MetricConfig): MetricResult {
  return rateOverOpportunities(
    'note_coverage_rate',
    sample.openOpportunities,
    (o) => (sample.notesByOpportunity.get(o.ref.id)?.length ?? 0) > 0,
  );
}

/** Whitespace-only or empty-string ownerId counts as unfilled, same as undefined. Not currently wired into any CapabilitySpec's gates — report-only. */
export function ownerIdFillRate(sample: CoverageSample, _config: MetricConfig): MetricResult {
  return rateOverOpportunities(
    'owner_id_fill_rate',
    sample.openOpportunities,
    (o) => (o.ownerId?.trim().length ?? 0) > 0,
  );
}

/** Trailing window a qualifying activity must fall within, relative to asOf. Per metric-definitions.md D1. */
const ACTIVITY_CAPTURE_WINDOW_DAYS = 30;
/**
 * Opportunities created more recently than this are excluded from the
 * denominator — they haven't had time to accrue activity yet. Per
 * metric-definitions.md D1.
 */
const NEW_OPPORTUNITY_EXCLUSION_DAYS = 7;

/**
 * Gated on the adapter's activitySync capability: returns not_instrumented
 * rather than a score when it's false, per metric-definitions.md D1.
 * Qualifying activity: occurredAt within [asOf - 30d, asOf] inclusive, and
 * not before the opportunity's own createdAt. No completion-status check
 * (the model has none) and no kind restriction (every ActivityKind
 * qualifies, including 'other' — there is no separate Task representation).
 */
export function activityCaptureRate(sample: CoverageSample, config: MetricConfig): MetricResult {
  if (!sample.capabilities.activitySync) {
    return {
      metric: 'activity_capture_rate',
      status: 'not_instrumented',
      value: null,
      sampleSize: 0,
      lowConfidence: false,
      note: 'adapter capability matrix reports no activity-sync capability for this org',
    };
  }

  const asOf = new Date(config.asOf).getTime();
  const windowStart = asOf - ACTIVITY_CAPTURE_WINDOW_DAYS * DAY_MS;
  const newOpportunityCutoff = asOf - NEW_OPPORTUNITY_EXCLUSION_DAYS * DAY_MS;

  const eligible = sample.openOpportunities.filter(
    (o) => new Date(o.createdAt).getTime() < newOpportunityCutoff,
  );

  return rateOverOpportunities('activity_capture_rate', eligible, (o) => {
    const createdAt = new Date(o.createdAt).getTime();
    const activities = sample.activitiesByOpportunity.get(o.ref.id) ?? [];
    return activities.some((a) => {
      const occurredAt = new Date(a.occurredAt).getTime();
      return occurredAt >= windowStart && occurredAt <= asOf && occurredAt >= createdAt;
    });
  });
}

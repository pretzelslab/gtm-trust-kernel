/**
 * D3 consistency/hygiene metrics. See docs/metric-definitions.md, section D3.
 *
 * stage_mapping_coverage and duplicate_account_rate are not implemented
 * here — both are blocked on sample-pipeline gaps (docs/STATUS.md).
 */

import { CANONICAL_STAGE_ORDER } from '@gtm-trust-kernel/adapters/model/canonical.js';
import type { CanonicalStage } from '@gtm-trust-kernel/adapters/model/canonical.js';
import type { CoverageSample, MetricConfig, MetricResult } from './types.js';
import { DAY_MS, hasQualifyingActivity, rateOverOpportunities } from './shared.js';

/**
 * Contradiction window, per metric-definitions.md D3: 21 days, not
 * activity_capture_rate's 30 — a late-stage deal implies more frequent
 * expected touchpoints than an early-stage one.
 */
const CONTRADICTION_WINDOW_DAYS = 21;

/**
 * "Late-stage" = the top two stages of the canonical ladder, derived rather
 * than hardcoded so it tracks CANONICAL_STAGE_ORDER if that ladder changes.
 * Today: proposal, negotiation.
 */
const CONTRADICTION_STAGES: ReadonlySet<CanonicalStage> = new Set(CANONICAL_STAGE_ORDER.slice(-2));

/**
 * Gated on the adapter's activitySync capability, same as activity_capture_rate
 * (it needs the same activity data). Contradiction = an open opportunity in
 * the top two canonical stages with zero qualifying activities (same
 * predicate as activity_capture_rate, imported via hasQualifyingActivity) in
 * the trailing 21 days.
 */
export function stageActivityContradictionRate(sample: CoverageSample, config: MetricConfig): MetricResult {
  if (!sample.capabilities.activitySync) {
    return {
      metric: 'stage_activity_contradiction_rate',
      status: 'not_instrumented',
      value: null,
      sampleSize: 0,
      lowConfidence: false,
      note: 'adapter capability matrix reports no activity-sync capability for this org',
    };
  }

  const asOf = new Date(config.asOf).getTime();
  const windowStart = asOf - CONTRADICTION_WINDOW_DAYS * DAY_MS;

  const lateStage = sample.openOpportunities.filter((o) => CONTRADICTION_STAGES.has(o.stage));

  return rateOverOpportunities(
    'stage_activity_contradiction_rate',
    lateStage,
    (o) => {
      const activities = sample.activitiesByOpportunity.get(o.ref.id) ?? [];
      return !hasQualifyingActivity(o, activities, windowStart, asOf);
    },
    'no open opportunities in proposal or negotiation stage in sample',
  );
}

/**
 * Denominator excludes null and zero amount — mirrors amount_fill_rate's
 * zero-exclusion and past_due_close_date_rate's null-exclusion pattern
 * (metric-definitions.md D3: amount = 0 is already counted as unfilled by
 * amount_fill_rate, don't double count it here).
 *
 * Negative amounts are left in the denominator and evaluated by the same
 * `% 1000 === 0` rule as any other amount — open question for v0.2, noted in
 * docs/STATUS.md, not resolved here.
 */
export function roundAmountRate(sample: CoverageSample, _config: MetricConfig): MetricResult {
  const raw = sample.openOpportunities;
  const withAmount = raw.filter((o) => o.amount != null && o.amount !== 0);
  const excludedCount = raw.length - withAmount.length;
  const emptyNote =
    raw.length === 0
      ? 'no open opportunities in sample'
      : 'no open opportunities with a non-null, non-zero amount in sample';

  const result = rateOverOpportunities('round_amount_rate', withAmount, (o) => o.amount! % 1000 === 0, emptyNote);

  if (result.status !== 'ok') {
    return result;
  }

  return {
    ...result,
    note: `${excludedCount} opportunities excluded from the denominator (null or zero amount)`,
  };
}

/**
 * D2 freshness metrics. See docs/metric-definitions.md, section D2.
 */

import type { CoverageSample, MetricConfig, MetricResult } from './types.js';
import { LOW_CONFIDENCE_SAMPLE_SIZE } from './types.js';
import { DAY_MS, median, rateOverOpportunities } from './shared.js';

/** Same "meaningfully filled" predicate as next_step_fill_rate (metrics/coverage.ts) — don't re-derive a different definition of "empty" for the same field. */
function hasMeaningfulNextStep(o: { nextStep?: { value: string } }): boolean {
  return (o.nextStep?.value.trim().length ?? 0) > 1;
}

/**
 * Gate cascade: capabilities.nextStepHistory false -> not_instrumented,
 * standard capability-gate pattern. No open opportunities with a
 * meaningfully-filled Next Step -> not_applicable.
 *
 * Per-opportunity exclusion and low-confidence rule, locked 2026-09-26
 * (docs/metric-definitions.md): an eligible opportunity (meaningfully-filled
 * Next Step) with zero NextStepChange entries is excluded from the
 * denominator entirely — not treated as age 0, and never falls back to the
 * opportunity's whole-record modifiedAt. sampleSize reports the count
 * actually computed over (post-exclusion), same "filtered sample size"
 * convention activity_capture_rate uses. lowConfidence fires when that
 * count is below LOW_CONFIDENCE_SAMPLE_SIZE OR when more than 50% of
 * eligible opportunities were excluded — this is a report-only flag, not a
 * forced tier: gradeGate() only ever grades from value + threshold, and
 * this metric gates zero capabilities today regardless (confirmed by
 * exhaustively grepping rubric.ts's CAPABILITIES).
 */
export function medianNextStepAgeDays(sample: CoverageSample, config: MetricConfig): MetricResult {
  if (!sample.capabilities.nextStepHistory) {
    return {
      metric: 'median_next_step_age_days',
      status: 'not_instrumented',
      value: null,
      sampleSize: 0,
      lowConfidence: false,
      note: 'adapter capability matrix reports no Next Step change-history capability for this org',
    };
  }

  const eligible = sample.openOpportunities.filter(hasMeaningfulNextStep);
  if (eligible.length === 0) {
    return {
      metric: 'median_next_step_age_days',
      status: 'not_applicable',
      value: null,
      sampleSize: 0,
      lowConfidence: false,
      note: 'no open opportunities in sample with a meaningfully-filled Next Step',
    };
  }

  const asOf = new Date(config.asOf).getTime();
  const ages: number[] = [];
  let excludedCount = 0;
  for (const o of eligible) {
    const changes = sample.nextStepChangesByOpportunity.get(o.ref.id) ?? [];
    const latest = changes[changes.length - 1];
    if (!latest) {
      excludedCount++;
      continue;
    }
    ages.push((asOf - new Date(latest.changedAt).getTime()) / DAY_MS);
  }

  if (ages.length === 0) {
    return {
      metric: 'median_next_step_age_days',
      status: 'not_applicable',
      value: null,
      sampleSize: 0,
      lowConfidence: false,
      note: `all ${excludedCount} eligible opportunit${excludedCount === 1 ? 'y has' : 'ies have'} no Next Step change history`,
    };
  }

  const excludedFraction = excludedCount / eligible.length;
  return {
    metric: 'median_next_step_age_days',
    status: 'ok',
    value: median(ages),
    sampleSize: ages.length,
    lowConfidence: ages.length < LOW_CONFIDENCE_SAMPLE_SIZE || excludedFraction > 0.5,
    ...(excludedCount > 0 ? { note: `${excludedCount} of ${eligible.length} eligible opportunities excluded: no Next Step change history` } : {}),
  };
}

export function medianDaysSinceModified(sample: CoverageSample, config: MetricConfig): MetricResult {
  const sampleSize = sample.openOpportunities.length;
  if (sampleSize === 0) {
    return {
      metric: 'median_days_since_modified',
      status: 'not_applicable',
      value: null,
      sampleSize: 0,
      lowConfidence: false,
      note: 'no open opportunities in sample',
    };
  }

  const asOf = new Date(config.asOf).getTime();
  const daysSinceModified = sample.openOpportunities.map(
    (o) => (asOf - new Date(o.modifiedAt).getTime()) / DAY_MS,
  );

  return {
    metric: 'median_days_since_modified',
    status: 'ok',
    value: median(daysSinceModified),
    sampleSize,
    lowConfidence: sampleSize < LOW_CONFIDENCE_SAMPLE_SIZE,
  };
}

/**
 * Null closeDate is excluded from both numerator and denominator — that gap
 * belongs to close_date_fill_rate, not this metric (metric-definitions.md D2).
 * past-due = closeDate < asOf, strict: exactly asOf counts as not past-due.
 */
export function pastDueCloseDateRate(sample: CoverageSample, config: MetricConfig): MetricResult {
  const asOf = new Date(config.asOf).getTime();
  const withCloseDate = sample.openOpportunities.filter((o) => o.closeDate != null);
  const emptyNote =
    sample.openOpportunities.length === 0
      ? 'no open opportunities in sample'
      : 'no open opportunities with a non-null close date in sample';

  return rateOverOpportunities(
    'past_due_close_date_rate',
    withCloseDate,
    (o) => new Date(o.closeDate!).getTime() < asOf,
    emptyNote,
  );
}

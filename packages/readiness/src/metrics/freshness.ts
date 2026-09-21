/**
 * D2 freshness metrics. See docs/metric-definitions.md, section D2.
 *
 * median_next_step_age_days is deferred (no adapter can report a per-field
 * Next Step change timestamp yet) and is not implemented here.
 */

import type { CoverageSample, MetricConfig, MetricResult } from './types.js';
import { LOW_CONFIDENCE_SAMPLE_SIZE } from './types.js';
import { DAY_MS, median, rateOverOpportunities } from './shared.js';

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

/**
 * Helpers shared by more than one metric family (D1 coverage, D2 freshness).
 */

import type { Opportunity } from '@gtm-trust-kernel/adapters/model/canonical.js';
import type { MetricId } from '../rubric.js';
import type { MetricResult } from './types.js';
import { LOW_CONFIDENCE_SAMPLE_SIZE } from './types.js';

export const DAY_MS = 86_400_000;

/** Share of some denominator of opportunities meeting a per-metric predicate. */
export function rateOverOpportunities(
  metric: MetricId,
  opportunities: readonly Opportunity[],
  isFilled: (o: Opportunity) => boolean,
  emptyNote = 'no open opportunities in sample',
): MetricResult {
  const sampleSize = opportunities.length;
  if (sampleSize === 0) {
    return {
      metric,
      status: 'not_applicable',
      value: null,
      sampleSize: 0,
      lowConfidence: false,
      note: emptyNote,
    };
  }

  const filled = opportunities.filter(isFilled).length;

  return {
    metric,
    status: 'ok',
    value: filled / sampleSize,
    sampleSize,
    lowConfidence: sampleSize < LOW_CONFIDENCE_SAMPLE_SIZE,
  };
}

/** Callers must guard the empty case themselves; this throws rather than return a misleading number. */
export function median(values: readonly number[]): number {
  if (values.length === 0) {
    throw new Error('median called on an empty array');
  }
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) {
    return sorted[mid]!;
  }
  return (sorted[mid - 1]! + sorted[mid]!) / 2;
}

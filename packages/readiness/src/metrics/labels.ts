/**
 * D7 label availability metrics. See docs/metric-definitions.md, section D7.
 *
 * win_rate_dispersion is not implemented here — deferred, bundled with the
 * two D2/D4 deferrals into one adapter-contract change (no by-opportunity-
 * ref stage-history read exists yet). See docs/STATUS.md.
 */

import type { CoverageSample, MetricConfig, MetricResult } from './types.js';
import { LOW_CONFIDENCE_SAMPLE_SIZE } from './types.js';
import { rateOverOpportunities } from './shared.js';

/**
 * closedOpportunities.length, trusting sample.ts's own trailing-12-month
 * window (CLOSED_WINDOW_MONTHS) rather than re-deriving it against
 * closeDate/config.asOf — a sample.ts-level regression test asserts that
 * window holds, so this metric doesn't re-check it (metric-definitions.md
 * D7). "org-wide" (per the doc) means not sliced by segment, not an
 * unbounded full-org count.
 *
 * floor: true whenever EITHER the closed_won or closed_lost reservoir
 * stratum filled to its target (underfilled: false) — closedOpportunities
 * is a stratified reservoir sample bounded by a caller-chosen
 * perStratumSampleSize, not derived from the org, so a full reservoir means
 * this count is a sample-size ceiling, not the org's true closed-deal
 * volume. Same "lower bound, not exact" contract as MetricResult.floor's
 * other cause (per-opportunity child-record truncation), different
 * underlying reason — see that field's docblock (metrics/types.ts).
 */
export function closedDealCountTwelveMonths(sample: CoverageSample, _config: MetricConfig): MetricResult {
  const count = sample.closedOpportunities.length;
  const floor = !sample.closedWonUnderfilled || !sample.closedLostUnderfilled;

  return {
    metric: 'closed_deal_count_12m',
    status: 'ok',
    value: count,
    sampleSize: count,
    lowConfidence: count < LOW_CONFIDENCE_SAMPLE_SIZE,
    floor,
    ...(floor
      ? {
          note: 'the closed_won or closed_lost sample stratum filled to its target — this count is a sample-size ceiling, not necessarily the org\'s true closed-deal volume',
        }
      : {}),
  };
}

/**
 * rateOverOpportunities over closedOpportunities (already windowed to
 * CLOSED_WINDOW_MONTHS by sample.ts — see closedDealCountTwelveMonths'
 * docblock, same trust-the-window reasoning applies here). Predicate: at
 * least one entry in notesByOpportunity or activitiesByOpportunity for that
 * opportunity.
 *
 * Deliberately does NOT get applyTruncationFloor, unlike note_coverage_rate/
 * activity_capture_rate — reversed from this session's own first pass (see
 * metric-definitions.md D7's "no truncation floor" entry for the reasoning
 * this doc corrects). Truncation can't turn this metric's real "≥1 record"
 * into a wrong "0" either, same as those two metrics, but that fact isn't
 * being treated as reason enough to flag it here — a policy call, not a
 * logical necessity, made the other way for this metric.
 */
export function outcomeEvidenceRetentionRate(sample: CoverageSample, _config: MetricConfig): MetricResult {
  return rateOverOpportunities(
    'outcome_evidence_retention_rate',
    sample.closedOpportunities,
    (o) =>
      (sample.notesByOpportunity.get(o.ref.id)?.length ?? 0) > 0 ||
      (sample.activitiesByOpportunity.get(o.ref.id)?.length ?? 0) > 0,
    'no closed opportunities (won or lost, trailing 12 months) in sample',
  );
}

/**
 * D7 label availability metrics. See docs/metric-definitions.md, section D7.
 */

import { CANONICAL_STAGE_ORDER, type CanonicalStage } from '@gtm-trust-kernel/adapters/model/canonical.js';

const INTERMEDIATE_STAGES: ReadonlySet<CanonicalStage> = new Set(CANONICAL_STAGE_ORDER);
import type { CoverageSample, MetricConfig, MetricResult } from './types.js';
import { LOW_CONFIDENCE_SAMPLE_SIZE } from './types.js';
import { rateOverOpportunities, standardDeviation } from './shared.js';

/** A canonical stage needs at least this many closed opportunities passing through it to contribute a meaningful per-stage win rate. */
const MIN_CLOSED_OPPORTUNITIES_PER_STAGE = 5;

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

/**
 * Gate cascade: capabilities.stageHistory false -> not_instrumented (same
 * capability getStageHistoryByOpportunity itself gates on). No closed
 * opportunity with a resolvable stage-history entry -> not_applicable.
 *
 * Intermediate stages only (CANONICAL_STAGE_ORDER — prospecting through
 * negotiation), never closed_won/closed_lost: this measures whether the
 * PIPELINE stage a deal passed through predicts its outcome, not the
 * tautology that closed_won deals ended in closed_won. A real adapter's
 * stage-history object (e.g. Salesforce OpportunityHistory) may well
 * include a final snapshot row for the closing transition itself — that
 * row is filtered out here, not assumed absent from adapter data.
 *
 * Per-stage exclusion and not_applicable boundary, locked 2026-09-26
 * (docs/metric-definitions.md): a canonical stage needs at least
 * MIN_CLOSED_OPPORTUNITIES_PER_STAGE (5) closed opportunities passing
 * through it (deduped per opportunity — a deal that revisited a stage
 * counts once for that stage, not once per visit) to contribute a per-stage
 * win rate; fewer than 2 stages remaining after that exclusion ->
 * not_applicable (dispersion across fewer than 2 stages is undefined, not
 * zero). Excluded-stage COUNT (not which stages) goes in note.
 *
 * sampleSize: count of eligible closed opportunities (>=1 resolvable
 * stage-history entry) — same "filtered subset" convention as every other
 * metric whose real denominator isn't the raw sample. This is NOT the same
 * as the count of (opportunity, stage) pairs feeding standardDeviation.
 */
export function winRateDispersion(sample: CoverageSample, _config: MetricConfig): MetricResult {
  if (!sample.capabilities.stageHistory) {
    return {
      metric: 'win_rate_dispersion',
      status: 'not_instrumented',
      value: null,
      sampleSize: 0,
      lowConfidence: false,
      note: 'adapter capability matrix reports no stage-history capability for this org',
    };
  }

  const eligible = sample.closedOpportunities.filter((o) => (sample.stageHistoryByOpportunity.get(o.ref.id)?.length ?? 0) > 0);
  if (eligible.length === 0) {
    return {
      metric: 'win_rate_dispersion',
      status: 'not_applicable',
      value: null,
      sampleSize: 0,
      lowConfidence: false,
      note: 'no closed opportunities in sample with a resolvable stage-history entry',
    };
  }

  const wonByStage = new Map<CanonicalStage, number>();
  const lostByStage = new Map<CanonicalStage, number>();
  for (const o of eligible) {
    const entries = sample.stageHistoryByOpportunity.get(o.ref.id) ?? [];
    const stagesVisited = new Set(entries.map((e) => e.toStage).filter((stage) => INTERMEDIATE_STAGES.has(stage)));
    const bucket = o.isWon ? wonByStage : lostByStage;
    for (const stage of stagesVisited) {
      bucket.set(stage, (bucket.get(stage) ?? 0) + 1);
    }
  }

  const allStages = new Set<CanonicalStage>([...wonByStage.keys(), ...lostByStage.keys()]);
  const winRates: number[] = [];
  let excludedStageCount = 0;
  for (const stage of allStages) {
    const won = wonByStage.get(stage) ?? 0;
    const lost = lostByStage.get(stage) ?? 0;
    const total = won + lost;
    if (total < MIN_CLOSED_OPPORTUNITIES_PER_STAGE) {
      excludedStageCount++;
      continue;
    }
    winRates.push(won / total);
  }

  if (winRates.length < 2) {
    return {
      metric: 'win_rate_dispersion',
      status: 'not_applicable',
      value: null,
      sampleSize: 0,
      lowConfidence: false,
      note: `fewer than 2 canonical stages have at least ${MIN_CLOSED_OPPORTUNITIES_PER_STAGE} closed opportunities (${excludedStageCount} stage${excludedStageCount === 1 ? '' : 's'} excluded)`,
    };
  }

  return {
    metric: 'win_rate_dispersion',
    status: 'ok',
    value: standardDeviation(winRates),
    sampleSize: eligible.length,
    lowConfidence: eligible.length < LOW_CONFIDENCE_SAMPLE_SIZE,
    ...(excludedStageCount > 0
      ? { note: `${excludedStageCount} stage${excludedStageCount === 1 ? '' : 's'} excluded: fewer than ${MIN_CLOSED_OPPORTUNITIES_PER_STAGE} closed opportunities` }
      : {}),
  };
}

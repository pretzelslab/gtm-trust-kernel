/**
 * D4 history depth metrics. See docs/metric-definitions.md, section D4.
 *
 * close_date_history_enabled is not implemented here — deferred, no
 * adapter capability exists for it yet. See docs/STATUS.md.
 */

import type { CoverageSample, MetricConfig, MetricResult } from './types.js';
import { wholeCalendarMonthsBetween } from './shared.js';

/**
 * Pure capability check — reports AdapterCapabilities.ownerHistory as-is.
 * Always 'ok': there's no gate to fail here, the capability read itself
 * IS the metric, so a "not_instrumented" status would be meaningless.
 *
 * First unit: 'bool' metric implemented (rubric.ts). Per
 * metric-definitions.md's cross-cutting notes: true -> value 1, false ->
 * value 0.
 *
 * sampleSize/lowConfidence: this isn't a statistical sample of records —
 * it's a single deterministic capability-matrix read, always equally
 * trustworthy regardless of how many opportunities happen to be in the
 * sample. sampleSize is reported as 0 and lowConfidence is hardcoded
 * false (not mechanically derived from sampleSize < LOW_CONFIDENCE_SAMPLE_SIZE,
 * which would incorrectly flag every result as low-confidence forever).
 */
export function ownerHistoryEnabled(sample: CoverageSample, _config: MetricConfig): MetricResult {
  return {
    metric: 'owner_history_enabled',
    status: 'ok',
    value: sample.capabilities.ownerHistory ? 1 : 0,
    sampleSize: 0,
    lowConfidence: false,
  };
}

/**
 * Gate cascade, in order:
 *  1. capabilities.stageHistory false -> not_instrumented (standard
 *     capability-gate pattern, same phrasing style as activitySync).
 *  2. stageHistoryHydrated false -> not_instrumented (build-order
 *     precondition, same rule as duplicate_account_rate's accountsHydrated
 *     gate — hydrateStageHistory, coverageSample.ts, hasn't run yet).
 *  3. stageHistoryEarliestChangedAt null (hydrated, zero entries) -> ok,
 *     value 0, note "history enabled, no entries yet" (this session's
 *     explicit decision — a freshly-enabled org isn't the same as a
 *     missing capability).
 *  4. otherwise -> ok, value = wholeCalendarMonthsBetween(earliest entry,
 *     config.asOf), partial months dropped (shared.ts).
 *
 * Scope resolved this session (metric-definitions.md, was previously
 * self-contradictory): ORG-WIDE earliest entry, not scoped to this
 * sample's opportunities.
 *
 * sampleSize/lowConfidence: same reasoning as ownerHistoryEnabled above —
 * this isn't a per-opportunity or per-account rate, it's a single global
 * fact about the org's history retention (found via exactly one boundary
 * record, or confirmed absent). sampleSize is 0 and lowConfidence is
 * hardcoded false in every 'ok' branch, not mechanically derived from
 * LOW_CONFIDENCE_SAMPLE_SIZE.
 */
export function stageHistoryMonths(sample: CoverageSample, config: MetricConfig): MetricResult {
  if (!sample.capabilities.stageHistory) {
    return {
      metric: 'stage_history_months',
      status: 'not_instrumented',
      value: null,
      sampleSize: 0,
      lowConfidence: false,
      note: 'adapter capability matrix reports no stage-history capability for this org',
    };
  }

  if (!sample.stageHistoryHydrated) {
    return {
      metric: 'stage_history_months',
      status: 'not_instrumented',
      value: null,
      sampleSize: 0,
      lowConfidence: false,
      note: 'stage history has not been hydrated for this sample (stageHistoryHydrated is false)',
    };
  }

  if (sample.stageHistoryEarliestChangedAt === null) {
    return {
      metric: 'stage_history_months',
      status: 'ok',
      value: 0,
      sampleSize: 0,
      lowConfidence: false,
      note: 'history enabled, no entries yet',
    };
  }

  return {
    metric: 'stage_history_months',
    status: 'ok',
    value: wholeCalendarMonthsBetween(sample.stageHistoryEarliestChangedAt, config.asOf),
    sampleSize: 0,
    lowConfidence: false,
  };
}

/**
 * Orchestrates one readiness assessment run into a single, testable
 * ReportData object: sample -> hydrate accounts -> hydrate stage history ->
 * hydrate notes -> hydrate activities -> every implemented metric -> grade
 * every gradeable reading -> grade every capability. This is the JSON shape
 * (--json) and the input to render.ts.
 *
 * Not itself pure (runs real sampling I/O against the given adapter), but
 * everything past sampling is deterministic given the adapter's data.
 */

import type { CrmAdapter, SecondSourceAdapter } from '@gtm-trust-kernel/adapters/types.js';
import {
  buildCoverageSample,
  hydrateAccounts,
  hydrateActivities,
  hydrateContacts,
  hydrateNextStepChanges,
  hydrateNotes,
  hydrateStageHistory,
  hydrateStageHistoryByOpportunity,
} from '../coverageSample.js';
import type { CoverageSample, MetricConfig, MetricResult } from '../metrics/types.js';
import {
  closeDateFillRate,
  contactLinkageRate,
  amountFillRate,
  nextStepFillRate,
  noteCoverageRate,
  ownerIdFillRate,
  activityCaptureRate,
} from '../metrics/coverage.js';
import { medianDaysSinceModified, medianNextStepAgeDays, pastDueCloseDateRate } from '../metrics/freshness.js';
import { stageActivityContradictionRate, roundAmountRate, stageMappingCoverage, duplicateAccountRate } from '../metrics/consistency.js';
import { closeDateHistoryEnabled, ownerHistoryEnabled, stageHistoryMonths } from '../metrics/history.js';
import { accountResolutionRate, activityAttributionRate, contactIdentityResolutionRate, temporalAnomalyRate } from '../metrics/joinability.js';
import { medianNoteLengthChars, piiDensity, substantiveNoteRate, untrustedTextRatio } from '../metrics/textSubstrate.js';
import { closedDealCountTwelveMonths, outcomeEvidenceRetentionRate, winRateDispersion } from '../metrics/labels.js';
import { resolveSecondSource } from '../secondSource/resolve.js';
import { runSample } from '../sample.js';
import type { SampleConfig, StopReason } from '../sample.js';
import {
  CAPABILITIES,
  THRESHOLDS,
  gradeAll,
  gradeGate,
  type CapabilityId,
  type CapabilityVerdict,
  type MetricId,
  type MetricReading,
  type Unit,
  type Verdict,
} from '../rubric.js';

// ---------------------------------------------------------------------------
// Dimension grouping (matches docs/metric-definitions.md's D1-D7 sections
// and rubric.ts's MetricId comment groupings — not exported anywhere else).
// ---------------------------------------------------------------------------

export type MetricDimension = 'D1' | 'D2' | 'D3' | 'D4' | 'D5' | 'D6' | 'D7';

const DIMENSION_LABELS: Readonly<Record<MetricDimension, string>> = {
  D1: 'Coverage',
  D2: 'Freshness',
  D3: 'Consistency and hygiene',
  D4: 'History depth',
  D5: 'Cross-system joinability',
  D6: 'Text substrate',
  D7: 'Label availability',
};

const DIMENSION_BY_METRIC: Readonly<Record<MetricId, MetricDimension>> = {
  close_date_fill_rate: 'D1',
  amount_fill_rate: 'D1',
  owner_id_fill_rate: 'D1',
  next_step_fill_rate: 'D1',
  activity_capture_rate: 'D1',
  contact_linkage_rate: 'D1',
  note_coverage_rate: 'D1',
  median_days_since_modified: 'D2',
  past_due_close_date_rate: 'D2',
  median_next_step_age_days: 'D2',
  stage_mapping_coverage: 'D3',
  duplicate_account_rate: 'D3',
  stage_activity_contradiction_rate: 'D3',
  round_amount_rate: 'D3',
  close_date_history_enabled: 'D4',
  stage_history_months: 'D4',
  owner_history_enabled: 'D4',
  contact_identity_resolution_rate: 'D5',
  account_resolution_rate: 'D5',
  activity_attribution_rate: 'D5',
  temporal_anomaly_rate: 'D5',
  substantive_note_rate: 'D6',
  median_note_length_chars: 'D6',
  pii_density: 'D6',
  untrusted_text_ratio: 'D6',
  closed_deal_count_12m: 'D7',
  win_rate_dispersion: 'D7',
  outcome_evidence_retention_rate: 'D7',
};

// ---------------------------------------------------------------------------
// The 25 implemented metric functions (D1-D5, plus D6's 4 and D7's 2
// shippable metrics), plus explicit reasons for the 3 that aren't: all
// deferred, pending the same bundled adapter-contract change (see
// docs/STATUS.md). D5's 4 gate on config.secondSourceResolution internally
// (see joinability.ts) rather than being excluded from IMPLEMENTED — same
// pattern as any other capability-gated metric (e.g. activityCaptureRate
// gating on sample.capabilities.activitySync).
// ---------------------------------------------------------------------------

type MetricFn = (sample: CoverageSample, config: MetricConfig) => MetricResult;

const IMPLEMENTED: Readonly<Partial<Record<MetricId, MetricFn>>> = {
  close_date_fill_rate: closeDateFillRate,
  amount_fill_rate: amountFillRate,
  owner_id_fill_rate: ownerIdFillRate,
  next_step_fill_rate: nextStepFillRate,
  activity_capture_rate: activityCaptureRate,
  contact_linkage_rate: contactLinkageRate,
  note_coverage_rate: noteCoverageRate,
  median_days_since_modified: medianDaysSinceModified,
  past_due_close_date_rate: pastDueCloseDateRate,
  median_next_step_age_days: medianNextStepAgeDays,
  stage_mapping_coverage: stageMappingCoverage,
  duplicate_account_rate: duplicateAccountRate,
  stage_activity_contradiction_rate: stageActivityContradictionRate,
  round_amount_rate: roundAmountRate,
  owner_history_enabled: ownerHistoryEnabled,
  stage_history_months: stageHistoryMonths,
  close_date_history_enabled: closeDateHistoryEnabled,
  contact_identity_resolution_rate: contactIdentityResolutionRate,
  account_resolution_rate: accountResolutionRate,
  activity_attribution_rate: activityAttributionRate,
  temporal_anomaly_rate: temporalAnomalyRate,
  substantive_note_rate: substantiveNoteRate,
  median_note_length_chars: medianNoteLengthChars,
  pii_density: piiDensity,
  untrusted_text_ratio: untrustedTextRatio,
  closed_deal_count_12m: closedDealCountTwelveMonths,
  outcome_evidence_retention_rate: outcomeEvidenceRetentionRate,
  win_rate_dispersion: winRateDispersion,
};

/**
 * Every dimension in the original seven-dimension scope now has a shipped
 * metric — nothing left to defer. Kept as an empty record, not deleted,
 * so buildReportData's fallback branch (status: 'not_implemented') has
 * something to fall through to if a future MetricId is added to
 * rubric.ts's THRESHOLDS before its metric function exists.
 */
const DEFERRED_REASONS: Readonly<Partial<Record<MetricId, string>>> = {};

// ---------------------------------------------------------------------------
// Report shape
// ---------------------------------------------------------------------------

export type MetricRowStatus = 'ok' | 'not_applicable' | 'not_instrumented' | 'deferred' | 'not_implemented';

export interface CapabilityRef {
  readonly id: CapabilityId;
  readonly label: string;
}

export interface MetricRow {
  readonly metric: MetricId;
  readonly dimension: MetricDimension;
  readonly dimensionLabel: string;
  readonly status: MetricRowStatus;
  readonly value: number | null;
  readonly sampleSize: number;
  readonly lowConfidence: boolean;
  readonly note: string | null;
  /** Set only when status is 'ok' and the reading could be graded against rubric.ts. */
  readonly tier: Verdict | null;
  /** True when value is a lower bound, not exact — see MetricResult.floor. Always false for a row with no computed value. */
  readonly floor: boolean;
  readonly unit: Unit;
  readonly viableAt: number | null;
  readonly degradedAt: number | null;
  readonly gatesCapabilities: readonly CapabilityRef[];
  /**
   * True when this scan could not see the data the metric needs (see
   * docs/metric-definitions.md, "Blocked vs Not measured"): the adapter or a
   * connected second source lacks the capability, or the metric is deferred
   * or not implemented. False for everything else, including a D5 metric
   * with no second source connected, which is missing data.
   */
  readonly notMeasured: boolean;
}

export interface ReportOrgSummary {
  readonly orgLabel: string;
  readonly orgDescription: string;
  readonly asOf: string;
  readonly openSampleSize: number;
  readonly closedSampleSize: number;
  readonly recordsScanned: number;
  readonly stopReason: StopReason;
  readonly capabilityVerdictCounts: Readonly<Record<CapabilityVerdict, number>>;
  readonly metricStatusCounts: Readonly<Record<MetricRowStatus, number>>;
}

export interface ReportCapabilityRow {
  readonly id: CapabilityId;
  readonly label: string;
  readonly description: string;
  readonly verdict: CapabilityVerdict;
  readonly coverageCeiling: number | null;
  readonly blockerCount: number;
}

export interface ReportData {
  readonly generatedAt: string;
  readonly org: ReportOrgSummary;
  readonly metrics: readonly MetricRow[];
  readonly capabilities: readonly ReportCapabilityRow[];
}

export interface BuildReportOptions {
  readonly orgLabel: string;
  readonly orgDescription: string;
  readonly asOf: string;
  /** Fixed for reproducible sampling; not exposed as a CLI flag (this report is a fixed, minimal dev view, not a tunable run). */
  readonly seed?: string;
  readonly perStratumSampleSize?: number;
  readonly maxRecordsToScan?: number;
}

function capabilitiesGating(metric: MetricId): readonly CapabilityRef[] {
  return CAPABILITIES.filter((c) => c.gates.includes(metric)).map((c) => ({ id: c.id, label: c.label }));
}

export async function buildReportData(
  adapter: CrmAdapter,
  secondSourceAdapter: SecondSourceAdapter | undefined,
  options: BuildReportOptions,
): Promise<ReportData> {
  const sampleConfig: SampleConfig = {
    seed: options.seed ?? 'report',
    perStratumSampleSize: options.perStratumSampleSize ?? 20,
    maxRecordsToScan: options.maxRecordsToScan ?? 5000,
    pageSizeBulk: 2000,
    pageSizeStandard: 200,
    asOf: options.asOf,
  };

  const sampleResult = await runSample(adapter, sampleConfig, () => true);
  if ('cancelled' in sampleResult) {
    throw new Error('unreachable: report always auto-confirms sampling');
  }

  let sample = buildCoverageSample(sampleResult, adapter.capabilities());
  sample = (await hydrateAccounts(sample, adapter)).sample;
  sample = (await hydrateStageHistory(sample, adapter)).sample;
  sample = (await hydrateNotes(sample, adapter)).sample;
  sample = (await hydrateActivities(sample, adapter)).sample;
  sample = (await hydrateNextStepChanges(sample, adapter)).sample;
  sample = (await hydrateStageHistoryByOpportunity(sample, adapter)).sample;

  // D5: only hydrate contacts / resolve the second source when one is
  // actually connected — otherwise this is pure wasted I/O for data
  // nothing downstream reads (see docs/STATUS.md, D5 part 2a).
  let secondSourceResolution: MetricConfig['secondSourceResolution'];
  if (secondSourceAdapter) {
    sample = (await hydrateContacts(sample, adapter)).sample;
    secondSourceResolution = await resolveSecondSource(sample, secondSourceAdapter);
  }

  const metricConfig: MetricConfig = { asOf: options.asOf, secondSourceResolution };
  const readings = new Map<MetricId, MetricReading>();
  const unmeasured = new Set<MetricId>();
  const rows: MetricRow[] = [];

  for (const metric of Object.keys(THRESHOLDS) as MetricId[]) {
    const dimension = DIMENSION_BY_METRIC[metric];
    const unit = THRESHOLDS[metric].unit;
    const gatesCapabilities = capabilitiesGating(metric);

    const fn = IMPLEMENTED[metric];
    if (fn) {
      const result = fn(sample, metricConfig);
      const note = result.note ?? null;
      // D5 with no second source connected is missing data (Blocked), not
      // an unseen capability: docs/metric-definitions.md, section D5.
      const notMeasured =
        result.status === 'not_instrumented' && !(dimension === 'D5' && secondSourceAdapter === undefined);
      if (notMeasured) unmeasured.add(metric);

      let tier: Verdict | null = null;
      let viableAt: number | null = null;
      let degradedAt: number | null = null;
      if (result.status === 'ok' && result.value !== null) {
        readings.set(metric, { metric, value: result.value, sampleSize: result.sampleSize });
        const gate = gradeGate({ metric, value: result.value, sampleSize: result.sampleSize });
        tier = gate.verdict;
        viableAt = gate.viableAt;
        degradedAt = gate.degradedAt;
      }

      rows.push({
        metric,
        dimension,
        dimensionLabel: DIMENSION_LABELS[dimension],
        status: result.status,
        value: result.value,
        sampleSize: result.sampleSize,
        lowConfidence: result.lowConfidence,
        note,
        tier,
        floor: result.floor ?? false,
        unit,
        viableAt,
        degradedAt,
        gatesCapabilities,
        notMeasured,
      });
      continue;
    }

    const deferredReason = DEFERRED_REASONS[metric];
    const status: MetricRowStatus = deferredReason ? 'deferred' : 'not_implemented';
    unmeasured.add(metric);
    const note = deferredReason ?? 'Not yet implemented.';

    rows.push({
      metric,
      dimension,
      dimensionLabel: DIMENSION_LABELS[dimension],
      status,
      value: null,
      sampleSize: 0,
      lowConfidence: false,
      note,
      tier: null,
      floor: false,
      unit,
      viableAt: null,
      degradedAt: null,
      gatesCapabilities,
      notMeasured: true,
    });
  }

  const capabilityResults = gradeAll(readings, unmeasured);
  const capabilities: ReportCapabilityRow[] = capabilityResults.map((r) => {
    const spec = CAPABILITIES.find((c) => c.id === r.capability)!;
    return {
      id: r.capability,
      label: spec.label,
      description: spec.description,
      verdict: r.verdict,
      coverageCeiling: r.coverageCeiling,
      blockerCount: r.blockers.length,
    };
  });

  const capabilityVerdictCounts: Record<CapabilityVerdict, number> = { viable: 0, degraded: 0, not_measured: 0, blocked: 0 };
  for (const c of capabilities) {
    capabilityVerdictCounts[c.verdict] += 1;
  }

  const metricStatusCounts: Record<MetricRowStatus, number> = {
    ok: 0,
    not_applicable: 0,
    not_instrumented: 0,
    deferred: 0,
    not_implemented: 0,
  };
  for (const row of rows) {
    metricStatusCounts[row.status] += 1;
  }

  return {
    generatedAt: new Date().toISOString(),
    org: {
      orgLabel: options.orgLabel,
      orgDescription: options.orgDescription,
      asOf: options.asOf,
      openSampleSize: sample.openOpportunities.length,
      closedSampleSize: sample.closedOpportunities.length,
      recordsScanned: sampleResult.recordsScanned,
      stopReason: sampleResult.stopReason,
      capabilityVerdictCounts,
      metricStatusCounts,
    },
    metrics: rows,
    capabilities,
  };
}

/**
 * The verdict a metric row contributes as a gate, the same one
 * gradeCapability gives it: its graded tier when it has a value;
 * 'not_measured' when the scan couldn't see the data (row.notMeasured);
 * 'blocked' otherwise, because the data it needs is missing. Used by the
 * renderers to list a capability's gates.
 */
export function gateVerdictOf(row: MetricRow): CapabilityVerdict {
  if (row.status === 'ok' && row.tier) return row.tier;
  return row.notMeasured ? 'not_measured' : 'blocked';
}

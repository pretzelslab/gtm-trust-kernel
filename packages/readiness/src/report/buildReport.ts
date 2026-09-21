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

import type { CrmAdapter } from '@gtm-trust-kernel/adapters/types.js';
import { buildCoverageSample, hydrateAccounts, hydrateActivities, hydrateNotes, hydrateStageHistory } from '../coverageSample.js';
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
import { medianDaysSinceModified, pastDueCloseDateRate } from '../metrics/freshness.js';
import { stageActivityContradictionRate, roundAmountRate, stageMappingCoverage, duplicateAccountRate } from '../metrics/consistency.js';
import { ownerHistoryEnabled, stageHistoryMonths } from '../metrics/history.js';
import { runSample } from '../sample.js';
import type { SampleConfig, StopReason } from '../sample.js';
import {
  CAPABILITIES,
  THRESHOLDS,
  gradeAll,
  gradeGate,
  type CapabilityId,
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
// The 15 implemented metric functions, plus explicit reasons for the 13
// that aren't. Three buckets for "not implemented": explicit deferrals (2),
// D5 (4, blocked on a second-source adapter that doesn't exist), and D6/D7
// (7, simply not built yet).
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
  stage_mapping_coverage: stageMappingCoverage,
  duplicate_account_rate: duplicateAccountRate,
  stage_activity_contradiction_rate: stageActivityContradictionRate,
  round_amount_rate: roundAmountRate,
  owner_history_enabled: ownerHistoryEnabled,
  stage_history_months: stageHistoryMonths,
};

const DEFERRED_REASONS: Readonly<Partial<Record<MetricId, string>>> = {
  close_date_history_enabled:
    'Deferred: no adapter capability exists yet for Close Date field history (docs/STATUS.md).',
  median_next_step_age_days:
    'Deferred: no adapter can report a per-field "Next Step last changed" timestamp yet; needs a nextStepHistory capability (docs/STATUS.md).',
};

const D5_METRICS: ReadonlySet<MetricId> = new Set([
  'contact_identity_resolution_rate',
  'account_resolution_rate',
  'activity_attribution_rate',
  'temporal_anomaly_rate',
]);

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
  readonly unit: Unit;
  readonly viableAt: number | null;
  readonly degradedAt: number | null;
  readonly gatesCapabilities: readonly CapabilityRef[];
}

export interface ReportOrgSummary {
  readonly orgLabel: string;
  readonly orgDescription: string;
  readonly asOf: string;
  readonly openSampleSize: number;
  readonly closedSampleSize: number;
  readonly recordsScanned: number;
  readonly stopReason: StopReason;
  readonly capabilityVerdictCounts: Readonly<Record<Verdict, number>>;
  readonly metricStatusCounts: Readonly<Record<MetricRowStatus, number>>;
}

export interface ReportCapabilityRow {
  readonly id: CapabilityId;
  readonly label: string;
  readonly description: string;
  readonly verdict: Verdict;
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

export async function buildReportData(adapter: CrmAdapter, options: BuildReportOptions): Promise<ReportData> {
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

  const metricConfig: MetricConfig = { asOf: options.asOf };
  const readings = new Map<MetricId, MetricReading>();
  const rows: MetricRow[] = [];

  for (const metric of Object.keys(THRESHOLDS) as MetricId[]) {
    const dimension = DIMENSION_BY_METRIC[metric];
    const unit = THRESHOLDS[metric].unit;
    const gatesCapabilities = capabilitiesGating(metric);

    const fn = IMPLEMENTED[metric];
    if (fn) {
      const result = fn(sample, metricConfig);
      const note = result.note ?? null;

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
        unit,
        viableAt,
        degradedAt,
        gatesCapabilities,
      });
      continue;
    }

    const deferredReason = DEFERRED_REASONS[metric];
    const status: MetricRowStatus = deferredReason ? 'deferred' : D5_METRICS.has(metric) ? 'not_instrumented' : 'not_implemented';
    const note = deferredReason ?? (D5_METRICS.has(metric) ? 'no second source connected' : 'Not yet implemented.');

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
      unit,
      viableAt: null,
      degradedAt: null,
      gatesCapabilities,
    });
  }

  const capabilityResults = gradeAll(readings);
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

  const capabilityVerdictCounts: Record<Verdict, number> = { viable: 0, degraded: 0, blocked: 0 };
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

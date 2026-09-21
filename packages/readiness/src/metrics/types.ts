/**
 * Shared types for Phase C readiness metrics (src/metrics/*.ts).
 *
 * See docs/metric-definitions.md for what each metric measures and
 * src/rubric.ts for how a computed value becomes a verdict. A metric never
 * grades itself — it reports a number (or an absent-reading status) and
 * nothing else.
 */

import type { AdapterCapabilities } from '@gtm-trust-kernel/adapters/types.js';
import type { Activity, Note, Opportunity } from '@gtm-trust-kernel/adapters/model/canonical.js';
import type { MetricId } from '../rubric.js';

/**
 * A metric fails to produce a number for exactly one of these two reasons.
 * Both are absent readings, not bad results: gradeCapability in rubric.ts
 * already treats an absent reading as blocked (metric-definitions.md,
 * "Cross-cutting notes for every Phase C session"), so a metric must only
 * use these when it genuinely cannot compute a value.
 */
export type MetricStatus = 'ok' | 'not_instrumented' | 'not_applicable';

export interface MetricResult {
  readonly metric: MetricId;
  readonly status: MetricStatus;
  /** null unless status is 'ok'. */
  readonly value: number | null;
  readonly sampleSize: number;
  /** Set when status is 'ok' and sampleSize < LOW_CONFIDENCE_SAMPLE_SIZE. */
  readonly lowConfidence: boolean;
  /** Required when status isn't 'ok' (the reason); optional stated assumption otherwise. */
  readonly note?: string;
}

/**
 * Below this many sampled records, an 'ok' result is lowConfidence. Fixed by
 * metric-definitions.md's cross-cutting notes — not a rubric.ts threshold,
 * not per-org tunable.
 */
export const LOW_CONFIDENCE_SAMPLE_SIZE = 30;

/**
 * Shared input for the per-opportunity metrics (D1-D3). Built by hydrating
 * the open strata of a stratified sample (sample.ts) with the notes and
 * activities related to each sampled opportunity. That hydration is a
 * separate, bounded fetch (by sampled opportunity ref, not a full-org scan)
 * and is not implemented yet — out of scope for this file.
 */
export interface CoverageSample {
  /** Open-stage opportunities only; closed strata already excluded by the caller. */
  readonly openOpportunities: readonly Opportunity[];
  /** Notes related to a sampled opportunity, keyed by Opportunity.ref.id. */
  readonly notesByOpportunity: ReadonlyMap<string, readonly Note[]>;
  /**
   * Activities related to a sampled opportunity, keyed by Opportunity.ref.id.
   * Unfiltered: each metric applies its own "qualifying activity" rule.
   */
  readonly activitiesByOpportunity: ReadonlyMap<string, readonly Activity[]>;
  readonly capabilities: AdapterCapabilities;
}

export interface MetricConfig {
  /** Reference "now" for date-window math, ISO timestamp. Pass explicitly for reproducible tests. */
  readonly asOf: string;
}

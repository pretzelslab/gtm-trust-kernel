/**
 * Types for Phase E's narrative pass (docs/narrative-design.md). This file
 * holds only the shapes shared by the model-calling layer, the grounding
 * validator, and (not yet built) narrative.ts's orchestration -- no model
 * call and no orchestration logic lives here.
 */

import type { CapabilityId, MetricId, Unit, Verdict } from '../rubric.js';
import type { CapabilityRef, MetricDimension, MetricRowStatus, ReportData, ReportOrgSummary } from './buildReport.js';

/**
 * Per-metric row sent to the model -- MetricRow copied field-for-field,
 * except viableAt/degradedAt (decision 18, commit 2e). Those two are
 * rubric.ts's literal gate-boundary field names ("At or better than this:
 * the gate is Viable" / "...Degraded. Worse: Blocked."), and the live
 * smoke run showed the model echoing them verbatim when describing a
 * threshold number ("the 95% viable threshold", "the 20-deal degraded
 * threshold") -- a mismatch decision 16's prompt-only tier-word rule
 * couldn't fully suppress, since the model was reading the tier word
 * directly off a JSON key, not just reasoning about the metric's state.
 * Renamed to target/limit -- tier-neutral, and not `floor`, since a row
 * already has an unrelated `floor: boolean` (the truncation-floor flag).
 * This is a rename, not a strip: the model still needs the numbers to
 * write a comparative claim (e.g. "at 66%, below the 95% target").
 * `tier` itself is unchanged and still carries the metric's own real tier
 * -- that citation is legitimate (decision 6) and is not the leak.
 */
export interface NarrativePromptMetricRow {
  readonly metric: MetricId;
  readonly dimension: MetricDimension;
  readonly dimensionLabel: string;
  readonly status: MetricRowStatus;
  readonly value: number | null;
  readonly sampleSize: number;
  readonly lowConfidence: boolean;
  readonly note: string | null;
  readonly tier: Verdict | null;
  readonly floor: boolean;
  readonly unit: Unit;
  /** Renamed from MetricRow.viableAt (decision 18). */
  readonly target: number | null;
  /** Renamed from MetricRow.degradedAt (decision 18). */
  readonly limit: number | null;
  readonly gatesCapabilities: readonly CapabilityRef[];
}

/**
 * What narrative.ts sends to the model. Deliberately not ReportData itself
 * -- org.orgDescription is excluded at the type level (decision 11), not
 * filtered at runtime, so there's no code path that could forget to strip
 * it. metrics is NarrativePromptMetricRow, not ReportData['metrics']
 * (decision 18) -- same "excluded at the type level" guarantee, applied to
 * the tier-labeled threshold field names instead of a whole field. See
 * narrativePromptInput.ts for the builder.
 *
 * org also excludes capabilityVerdictCounts/metricStatusCounts (decision
 * 19, commit 2f). Both are aggregate tier-keyed counts (e.g. "5 blocked, 2
 * viable"); the live smoke run showed the model using exactly these
 * numbers to write a closing "N of M blocked" claim with no single id to
 * cite -- decision 18's "the model echoes what it sees" logic applies here
 * too, so the fix is removing the data, not just instructing against the
 * sentence (decision 5's amendment already established the 3 SUMMARY_IDS
 * as the one exception for plain org-level counts; these two are
 * tier-keyed breakdowns, not plain counts, and stay excluded).
 */
export interface NarrativePromptInput {
  readonly generatedAt: string;
  readonly org: Omit<ReportOrgSummary, 'orgDescription' | 'capabilityVerdictCounts' | 'metricStatusCounts'>;
  readonly metrics: readonly NarrativePromptMetricRow[];
  readonly capabilities: ReportData['capabilities'];
}

/**
 * Decision 5 amendment (commit 2b): three additional, namespaced ids are
 * citable alongside MetricId/CapabilityId -- one per ReportOrgSummary field
 * that is a plain count rather than a scored metric or capability. Closed
 * set, not a wildcard `summary.*` acceptance -- see narrativeGrounding.ts.
 */
export const SUMMARY_IDS = ['summary.recordsScanned', 'summary.openSampleSize', 'summary.closedSampleSize'] as const;
export type SummaryId = (typeof SUMMARY_IDS)[number];

/**
 * One sentence (or short span) of model-generated prose, plus the ids it
 * claims to be grounded in. `groundedIn` must be non-empty -- decision 5.
 */
export interface NarrativeClaim {
  readonly text: string;
  readonly groundedIn: readonly (MetricId | CapabilityId | SummaryId)[];
}

/** Token usage for one generate() call. Optional -- FakeNarrativeModelClient callers have no real usage to report. */
export interface NarrativeModelUsage {
  readonly inputTokens: number;
  readonly outputTokens: number;
}

/** The model's raw structured response, before grounding validation. */
export interface NarrativeModelResponse {
  readonly claims: readonly NarrativeClaim[];
  readonly usage?: NarrativeModelUsage;
  /**
   * Set only when the model returned more than 8 claims and
   * AnthropicNarrativeModelClient's capClaims() trimmed them client-side
   * (decision 17, commit 2d, since the schema itself can't express
   * `maxItems`). The value is the count before trimming; `claims` above is
   * already the capped array. Absent when no capping occurred.
   */
  readonly originalClaimCount?: number;
}

/**
 * Swappable model-calling layer. `AnthropicNarrativeModelClient` (commit 2,
 * real) and `FakeNarrativeModelClient` (test/support, canned/queued
 * responses) both implement this -- same dependency-injection shape
 * `CrmAdapter`/`MockAdapter` already establish.
 */
export interface NarrativeModelClient {
  generate(input: NarrativePromptInput): Promise<NarrativeModelResponse>;
}

/**
 * Shared types for Phase C readiness metrics (src/metrics/*.ts).
 *
 * See docs/metric-definitions.md for what each metric measures and
 * src/rubric.ts for how a computed value becomes a verdict. A metric never
 * grades itself — it reports a number (or an absent-reading status) and
 * nothing else.
 */

import type { AdapterCapabilities } from '@gtm-trust-kernel/adapters/types.js';
import type { Account, Activity, Note, Opportunity } from '@gtm-trust-kernel/adapters/model/canonical.js';
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
 * Shared input for the per-opportunity metrics (D1-D3). Built in
 * src/coverageSample.ts: buildCoverageSample(sampleResult) is pure/sync and
 * wires up openOpportunities/closedOpportunities from a stratified sample
 * (sample.ts), leaving every hydrated field below as a placeholder
 * empty/zero value. Everything else is a separate, independent async
 * hydration step — hydrateAccounts, hydrateStageHistory,
 * hydrateNotes, hydrateActivities — each fetching its own field via a
 * batched by-ref CrmAdapter read, never a full-org scan. A metric only
 * needs to await the hydration step(s) whose fields it actually reads.
 */
export interface CoverageSample {
  /** Open-stage opportunities only. */
  readonly openOpportunities: readonly Opportunity[];
  /** closed_won/closed_lost opportunities from the sample's closed strata. No D1/D2/D3-part-1 metric reads this — they only ever read openOpportunities. */
  readonly closedOpportunities: readonly Opportunity[];
  /**
   * Notes related to a sampled opportunity, keyed by Opportunity.ref.id.
   * Empty (not absent) until hydrateNotes runs; a genuinely note-less
   * opportunity is indistinguishable from an unhydrated one by this field
   * alone, but no D1-D4 metric needs that distinction — note_coverage_rate
   * (the only reader) has no capability or precondition gate of its own,
   * by design: presence-of-notes is always a meaningful question,
   * unconditionally.
   */
  readonly notesByOpportunity: ReadonlyMap<string, readonly Note[]>;
  /**
   * Activities related to a sampled opportunity, keyed by Opportunity.ref.id.
   * Unfiltered: each metric applies its own "qualifying activity" rule.
   * Empty until hydrateActivities runs, same as notesByOpportunity — no
   * separate "hydrated" gate here either: activity_capture_rate and
   * stage_activity_contradiction_rate already gate on
   * capabilities.activitySync before ever reading this map, which is
   * sufficient (hydrateActivities always fetches whatever exists,
   * regardless of activitySync — that capability governs interpretation,
   * not readability; see CrmAdapter.getActivitiesByOpportunity).
   */
  readonly activitiesByOpportunity: ReadonlyMap<string, readonly Activity[]>;
  /** Hydrated accounts for the sampled opportunities' accountRefs, keyed by Account.ref.id. Empty and meaningless until accountsHydrated is true. */
  readonly accountsByRef: ReadonlyMap<string, Account>;
  /**
   * True once hydrateAccounts has run. A metric that reads accountsByRef
   * MUST return not_instrumented (not a computed score, and not a silent
   * "no accounts" reading) when this is false — the same
   * gate-off-means-not_instrumented rule established for
   * AdapterCapabilities.activitySync, applied here to a build-order
   * precondition instead of a capability.
   */
  readonly accountsHydrated: boolean;
  /** Count of distinct sampled accountRefs that did not resolve to an Account via getAccounts. Meaningless until accountsHydrated is true. */
  readonly missingAccountCount: number;
  /** Count of sampled opportunities (open + closed) with no usable accountRef (absent, or ref.id empty/whitespace-only) — excluded from account hydration entirely, not counted in missingAccountCount. */
  readonly oppsWithoutAccountRef: number;
  /**
   * changedAt of the org's single earliest retained StageHistoryEntry
   * (org-wide, not scoped to this sample's opportunities — see
   * metric-definitions.md D4's stage_history_months for why), or null if
   * the org has the capability enabled but zero history entries exist.
   * Meaningless until stageHistoryHydrated is true.
   */
  readonly stageHistoryEarliestChangedAt: string | null;
  /**
   * True once hydrateStageHistory (coverageSample.ts) has run. Same
   * gate-off-means-not_instrumented rule as accountsHydrated, applied here:
   * stage_history_months must return not_instrumented, not a computed
   * value, when this is false (after first checking
   * capabilities.stageHistory itself, which is a separate, earlier gate).
   */
  readonly stageHistoryHydrated: boolean;
  readonly capabilities: AdapterCapabilities;
}

export interface MetricConfig {
  /** Reference "now" for date-window math, ISO timestamp. Pass explicitly for reproducible tests. */
  readonly asOf: string;
  /**
   * duplicate_account_rate's (D3) shared-provider denylist. Entries are
   * compared on normalized domain — a caller-supplied entry is passed
   * through normalizeDomain (metrics/shared.ts) before comparison, same as
   * a sampled account's domain, so casing/whitespace in config doesn't need
   * separate handling. Defaults to DEFAULT_SHARED_PROVIDER_DENYLIST when
   * omitted.
   */
  readonly sharedProviderDenylist?: readonly string[];
}

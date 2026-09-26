/**
 * Types for Phase E's narrative pass (docs/narrative-design.md). This file
 * holds only the shapes shared by the model-calling layer, the grounding
 * validator, and (not yet built) narrative.ts's orchestration -- no model
 * call and no orchestration logic lives here.
 */

import type { CapabilityId, MetricId } from '../rubric.js';
import type { ReportData, ReportOrgSummary } from './buildReport.js';

/**
 * What narrative.ts sends to the model. Deliberately not ReportData itself
 * -- org.orgDescription is excluded at the type level (decision 11), not
 * filtered at runtime, so there's no code path that could forget to strip
 * it. See narrativePromptInput.ts for the builder.
 */
export interface NarrativePromptInput {
  readonly generatedAt: string;
  readonly org: Omit<ReportOrgSummary, 'orgDescription'>;
  readonly metrics: ReportData['metrics'];
  readonly capabilities: ReportData['capabilities'];
}

/**
 * One sentence (or short span) of model-generated prose, plus the ids it
 * claims to be grounded in. `groundedIn` must be non-empty -- decision 5.
 */
export interface NarrativeClaim {
  readonly text: string;
  readonly groundedIn: readonly (MetricId | CapabilityId)[];
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

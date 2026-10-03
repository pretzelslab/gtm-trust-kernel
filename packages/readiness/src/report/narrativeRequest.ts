/**
 * The exact request the narrative feature sends to Anthropic's Messages API,
 * built without the API client so it can be printed for review and tested
 * without loading the SDK or needing a key.
 * AnthropicNarrativeModelClient.generate() sends exactly what
 * buildNarrativeRequestFromInput() returns, so what is printed and the real call
 * can't drift apart. The design notes behind the prompt (decisions 14-19)
 * are in anthropicNarrativeModelClient.ts's docblock.
 *
 * Nothing here may import the SDK: anthropicImportGuard.test.ts allows
 * exactly one importer.
 */

import { SUMMARY_IDS } from './narrativeTypes.js';
import type { NarrativePromptInput } from './narrativeTypes.js';
import type { ReportData } from './buildReport.js';
import { buildNarrativePromptInput } from './narrativePromptInput.js';

const DEFAULT_MODEL = 'claude-haiku-4-5-20251001';
export const MAX_TOKENS = 1536;

/** NARRATIVE_MODEL env override, same convention as loadSalesforceConfigFromEnv's env param. */
export function resolveNarrativeModel(env: NodeJS.ProcessEnv = process.env): string {
  return env.NARRATIVE_MODEL || DEFAULT_MODEL;
}

/**
 * Exported for direct unit testing (no network). No `maxItems` on the
 * `claims` array (decision 17, commit 2d): the API rejected it outright --
 * `output_config.format.schema: For 'array' type, property 'maxItems' is not
 * supported` -- on every one of commit 2c's 12 live smoke-run calls, so the
 * cap the prompt still asks for ("at most 8 claims") is enforced client-side
 * instead, by capClaims() in anthropicNarrativeModelClient.ts.
 */
export const CLAIMS_SCHEMA = {
  type: 'object',
  properties: {
    claims: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          text: { type: 'string' },
          groundedIn: { type: 'array', items: { type: 'string' } },
        },
        required: ['text', 'groundedIn'],
        additionalProperties: false,
      },
    },
  },
  required: ['claims'],
  additionalProperties: false,
};

/**
 * Every id the model may legally put in a claim's groundedIn -- decisions 5
 * (+ its commit-2b amendment) and 14. Exported for direct unit testing (no
 * network): asserts the structural field names (capabilityVerdictCounts,
 * metricStatusCounts, gatesCapabilities) are never in this list, separately
 * from asserting the prompt text still names and forbids them.
 */
export function listValidIds(input: NarrativePromptInput): readonly string[] {
  return [...input.metrics.map((m) => m.metric), ...input.capabilities.map((c) => c.id), ...SUMMARY_IDS];
}

/**
 * Exported for direct unit testing (no network) -- decisions 14/15 (commit
 * 2b), motivated by the commit-2 live smoke run's 100% grounding-fallback
 * rate: the model was citing structural JSON field names it could see in
 * the data dump (capabilityVerdictCounts, metricStatusCounts,
 * gatesCapabilities, and the 3 now-legitimate summary counts) as if they
 * were valid ids, and writing aggregate tier-count sentences with no single
 * id a real claim could cite. capabilityVerdictCounts/metricStatusCounts no
 * longer reach the model at all as of decision 19 (commit 2f) -- this
 * function's list is unaffected either way, since it was never built from
 * those fields.
 */
export function buildPrompt(input: NarrativePromptInput): string {
  return [
    'You are generating a short, plain-English narrative summary of a CRM',
    'data-readiness report. You are given computed metrics and capabilities',
    'only -- never raw CRM records.',
    '',
    'Write at most 8 claims. If there are more noteworthy findings than',
    'that, prioritize the most decision-relevant ones.',
    '',
    "Every claim you make must cite at least one id in `groundedIn`. The ONLY",
    'valid ids are exactly these, verbatim -- no other string is acceptable,',
    'even if it looks like a reasonable field name in the JSON below:',
    listValidIds(input).join(', '),
    '',
    'Do NOT cite structural field names such as "gatesCapabilities" -- that',
    'is a grouping in the JSON shape, not a valid id, even though it appears',
    'in the data.',
    '',
    'Do not write a sentence that summarizes a COUNT across multiple',
    'capabilities or metrics by tier (e.g. "2 capabilities are blocked, 5',
    'are viable") -- no single id exists that such a sentence could',
    'correctly cite. A claim about one specific capability\'s or metric\'s',
    'own tier (e.g. "the pipeline_risk_signals capability is blocked") is',
    'fine and encouraged.',
    '',
    'Do not write a closing, summary, or overview claim -- one that',
    'describes the report, or a group of capabilities/metrics, as a whole',
    '(e.g. "All 8 capabilities are blocked", "5 of 8 metrics are',
    'degraded", "Overall, this org is not ready"). There is no wrap-up',
    'sentence: every claim, including your last one, must be about one',
    'specific, cited metric or capability, exactly like every other claim.',
    'Stop after your last per-item claim.',
    '',
    'A tier word ("viable"/"degraded"/"blocked", or their listed synonyms',
    'ready/strong/not ready/weak) may ONLY state the cited item\'s own',
    'current tier -- never use a tier word to describe a threshold,',
    'benchmark, or comparison. Write "below the 95% threshold", never "short',
    'of viable" or "against a viable benchmark": the threshold is a number,',
    'not a tier. Use at most one tier word per claim, and it must describe',
    'only that claim\'s own cited item -- if you want to mention that one',
    'metric contributes to a different capability\'s tier, write that as a',
    'separate claim citing that capability, not combined with it in the',
    'same sentence. Never tack a second tier word onto an otherwise-valid',
    'claim to describe a different item, a group of items, or the report',
    'overall (e.g. do not follow a specific claim with ", overall still',
    'degraded" or similar) -- that phrase would have no cited id of its own.',
    '',
    'A capability\'s verdict may also be "not_measured": this scan could not',
    'see the data it needs, so it says nothing about the data either way.',
    'Describe that verdict only as "not measured", never as "blocked" or',
    '"not ready".',
    '',
    'Each metric below carries a `target` and a `limit` -- these are plain',
    'numbers, not tiers. Never call a target or limit "viable" or',
    '"degraded": state the number, then state the item\'s own tier',
    'separately. Two examples:',
    '  WRONG: "at 66%, below the 95% viable threshold"',
    '  RIGHT: "at 66%, below the 95% target; tier: degraded"',
    '  WRONG: "24 deals, below the 40-deal viable threshold and above the',
    '  20-deal degraded threshold"',
    '  RIGHT: "24 deals, below the 40 target and above the 20 limit; tier:',
    '  degraded"',
    '',
    'Any number you write must cite that number\'s own metric id in',
    '`groundedIn` -- citing only a capability id (or only a different',
    'metric) does not justify a number, since capabilities have no single',
    'numeric value to check it against.',
    '',
    'Never invent a number, id, or qualitative tier word',
    '(e.g. "viable"/"degraded"/"blocked") that is not directly supported by',
    'the cited id(s).',
    '',
    'Report data (JSON):',
    JSON.stringify(input),
  ].join('\n');
}

/** The body of the Messages API request, minus the API key (sent as a header by the client). */
export interface NarrativeRequest {
  readonly model: string;
  readonly max_tokens: number;
  readonly messages: [{ readonly role: 'user'; readonly content: string }];
  readonly output_config: { readonly format: { readonly type: 'json_schema'; readonly schema: typeof CLAIMS_SCHEMA } };
}

export function buildNarrativeRequestFromInput(input: NarrativePromptInput, model: string): NarrativeRequest {
  return {
    model,
    max_tokens: MAX_TOKENS,
    messages: [{ role: 'user', content: buildPrompt(input) }],
    output_config: { format: { type: 'json_schema', schema: CLAIMS_SCHEMA } },
  };
}

/** What --narrative would send for this report. */
export function buildNarrativeRequest(data: ReportData, env: NodeJS.ProcessEnv = process.env): NarrativeRequest {
  return buildNarrativeRequestFromInput(buildNarrativePromptInput(data), resolveNarrativeModel(env));
}

/** --narrative-preview's stdout: the request JSON and nothing else. */
export function formatNarrativePreview(data: ReportData, env: NodeJS.ProcessEnv = process.env): string {
  return `${JSON.stringify(buildNarrativeRequest(data, env), null, 2)}\n`;
}

/** --narrative-preview's stderr line, printed after the request. */
export const NARRATIVE_PREVIEW_NOTICE =
  "Narrative preview: stdout has the exact request --narrative would send to Anthropic's API " +
  '(the API key goes separately, in a header). Nothing was sent and no report was written.';

/**
 * Real NarrativeModelClient backed by the Anthropic Messages API (Phase E
 * commit 2, docs/narrative-design.md decision 2). The only file in this
 * package that imports @anthropic-ai/sdk -- enforced by
 * test/report/anthropicImportGuard.test.ts, not just this docblock.
 *
 * Structured output: output_config.format with a fixed JSON schema for
 * NarrativeModelResponse's shape (decision 2). commit 2c switched from the
 * SDK's messages.parse() to messages.create() plus manual JSON.parse of the
 * first text block: .parse() discards the raw Message (usage, stop_reason)
 * on a parse failure, since the parsing happens inside its own .then() and
 * only the thrown error escapes -- that made it structurally impossible to
 * capture token usage on a truncated/malformed response, which decision 16
 * requires. A defensive runtime shape-guard still runs on top of the manual
 * parse, since the schema is meant to make a shape mismatch unreachable,
 * not proven unreachable.
 *
 * Timeout/retries (confirmed with the user, commit 2): 30s timeout,
 * maxRetries 0. max_tokens raised 1024 -> 1536 (decision 16, commit 2c)
 * after the commit-2b live run showed responses were long enough to hit the
 * old cap and truncate mid-JSON. Claims are capped at 8, but not via the
 * schema -- the API rejects `maxItems` on an array property outright
 * (decision 17, commit 2d) -- so capClaims() enforces it client-side, after
 * the shape-guard, on the parsed response. A failed call here has a free,
 * always-correct fallback -- the deterministic plainSummary -- so this
 * client fails fast rather than retrying or making a report viewer wait a
 * long time before narrative.ts (commit 3) falls back.
 *
 * generate() either returns a well-shaped NarrativeModelResponse or throws
 * NarrativeGenerationError (never a partial response). Its `kind` lets a
 * caller (the smoke script, and eventually commit 3's orchestration)
 * distinguish a max_tokens truncation from every other failure, and its
 * `usage` is populated whenever the SDK returned a Message at all -- even
 * when parsing failed or the shape didn't match -- so token totals stay
 * complete regardless of outcome (decision 16). `originalClaimCount` is set
 * only when capClaims() actually trimmed the response, so a caller can tell
 * "8 claims, none dropped" apart from "12 claims, capped to 8" (decision 17).
 *
 * buildPrompt() also carries decision 18's two WRONG/RIGHT few-shot pairs,
 * added after a live run showed the model echoing MetricRow's literal
 * viableAt/degradedAt field names as tier words describing the threshold
 * itself, not the cited item's own tier. NarrativePromptMetricRow
 * (narrativeTypes.ts) renamed those fields to target/limit to remove the
 * literal word from the data the model reads; these examples reinforce
 * the resulting target/limit vocabulary in the prompt's own text.
 *
 * Never logs or includes the API key in any error: only error.status/
 * .name/.message are read from a caught SDK error, never headers or the raw
 * request/response body.
 */

import Anthropic, { APIError } from '@anthropic-ai/sdk';
import { SUMMARY_IDS } from './narrativeTypes.js';
import type {
  NarrativeClaim,
  NarrativeModelClient,
  NarrativeModelResponse,
  NarrativeModelUsage,
  NarrativePromptInput,
} from './narrativeTypes.js';

const DEFAULT_MODEL = 'claude-haiku-4-5-20251001';
const MAX_TOKENS = 1536;
const MAX_CLAIMS = 8;
const TIMEOUT_MS = 30_000;
const MAX_RETRIES = 0;

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
 * instead, by capClaims() below.
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
 * Thrown by generate() on any failure. `kind` distinguishes a max_tokens
 * truncation from everything else -- decision 16, commit 2c. `usage` is set
 * whenever the SDK returned a Message at all, regardless of what went wrong
 * after that, so a caller never silently loses token accounting on failure.
 */
export class NarrativeGenerationError extends Error {
  constructor(
    message: string,
    readonly kind: 'api_error' | 'truncation' | 'parse_failure' | 'shape_mismatch',
    readonly usage?: NarrativeModelUsage,
  ) {
    super(message);
    this.name = 'NarrativeGenerationError';
  }
}

function isNarrativeClaim(value: unknown): value is NarrativeClaim {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate['text'] === 'string' &&
    Array.isArray(candidate['groundedIn']) &&
    candidate['groundedIn'].every((id: unknown) => typeof id === 'string')
  );
}

/** Defensive shape-guard on the parsed output -- see this file's docblock. Exported for direct unit testing (no network). */
export function isClaimsShape(value: unknown): value is { claims: NarrativeClaim[] } {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return Array.isArray(candidate['claims']) && candidate['claims'].every(isNarrativeClaim);
}

/**
 * Enforces the "at most 8 claims" cap client-side (decision 17, commit 2d),
 * since the schema itself can no longer express it. Keeps the first
 * MAX_CLAIMS claims, in order, and drops the rest -- each claim is grounded
 * independently (validateGrounding() checks one claim at a time), so
 * dropping extras never introduces unverified content into the ones kept.
 * `originalCount` lets a caller (the smoke script) log how often the cap
 * actually fired. Exported for direct unit testing (no network).
 */
export function capClaims(claims: readonly NarrativeClaim[]): { claims: readonly NarrativeClaim[]; originalCount: number } {
  return {
    claims: claims.length > MAX_CLAIMS ? claims.slice(0, MAX_CLAIMS) : claims,
    originalCount: claims.length,
  };
}

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
 * id a real claim could cite.
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
    'Do NOT cite structural field names such as "capabilityVerdictCounts",',
    '"metricStatusCounts", or "gatesCapabilities" -- those are groupings in',
    'the JSON shape, not valid ids, even though they appear in the data.',
    '',
    'Do not write a sentence that summarizes a COUNT across multiple',
    'capabilities or metrics by tier (e.g. "2 capabilities are blocked, 5',
    'are viable") -- no single id exists that such a sentence could',
    'correctly cite. A claim about one specific capability\'s or metric\'s',
    'own tier (e.g. "the pipeline_risk_signals capability is blocked") is',
    'fine and encouraged.',
    '',
    'A tier word ("viable"/"degraded"/"blocked", or their listed synonyms',
    'ready/strong/not ready/weak) may ONLY state the cited item\'s own',
    'current tier -- never use a tier word to describe a threshold,',
    'benchmark, or comparison. Write "below the 95% threshold", never "short',
    'of viable" or "against a viable benchmark": the threshold is a number,',
    'not a tier. Use at most one tier word per claim -- if you want to',
    'mention that one metric contributes to a different capability\'s tier,',
    'write that as a separate claim, not combined with the capability\'s own',
    'tier word in the same sentence.',
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

/** Never includes headers or the raw request/response body -- see this file's docblock. */
function describeError(error: unknown): string {
  if (error instanceof APIError) {
    return `Anthropic API error (status ${error.status ?? 'unknown'}): ${error.message}`;
  }
  if (error instanceof Error) {
    return `${error.name}: ${error.message}`;
  }
  return String(error);
}

export class AnthropicNarrativeModelClient implements NarrativeModelClient {
  private readonly client: Anthropic;
  private readonly model: string;

  constructor(env: NodeJS.ProcessEnv = process.env) {
    const apiKey = env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      throw new Error(
        'Missing required env var: ANTHROPIC_API_KEY. Set it in .env (see .env.example) or your shell environment.',
      );
    }
    this.model = resolveNarrativeModel(env);
    this.client = new Anthropic({ apiKey, timeout: TIMEOUT_MS, maxRetries: MAX_RETRIES });
  }

  async generate(input: NarrativePromptInput): Promise<NarrativeModelResponse> {
    let message;
    try {
      message = await this.client.messages.create({
        model: this.model,
        max_tokens: MAX_TOKENS,
        messages: [{ role: 'user', content: buildPrompt(input) }],
        output_config: { format: { type: 'json_schema', schema: CLAIMS_SCHEMA } },
      });
    } catch (error) {
      // No Message came back at all -- no usage to report (decision 16: usage is only
      // ever available once the SDK has returned a Message, which didn't happen here).
      throw new NarrativeGenerationError(describeError(error), 'api_error');
    }

    const usage: NarrativeModelUsage = { inputTokens: message.usage.input_tokens, outputTokens: message.usage.output_tokens };

    // Checked before attempting to parse, unconditionally -- decision 16: a max_tokens
    // stop is classified as truncation regardless of whether the cut-off text happens
    // to still parse, since the model may have been forced to omit content either way.
    if (message.stop_reason === 'max_tokens') {
      throw new NarrativeGenerationError(
        `Anthropic response was truncated at max_tokens (${MAX_TOKENS}) before completing.`,
        'truncation',
        usage,
      );
    }

    const textBlock = message.content.find((block): block is Anthropic.TextBlock => block.type === 'text');
    if (!textBlock) {
      throw new NarrativeGenerationError('Anthropic response contained no text content block.', 'parse_failure', usage);
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(textBlock.text);
    } catch (error) {
      throw new NarrativeGenerationError(
        `Failed to parse structured output as JSON: ${error instanceof Error ? error.message : String(error)}`,
        'parse_failure',
        usage,
      );
    }

    if (!isClaimsShape(parsed)) {
      throw new NarrativeGenerationError('Anthropic response did not match the expected narrative claims shape.', 'shape_mismatch', usage);
    }

    const { claims, originalCount } = capClaims(parsed.claims);
    return {
      claims,
      usage,
      ...(originalCount > MAX_CLAIMS ? { originalClaimCount: originalCount } : {}),
    };
  }
}

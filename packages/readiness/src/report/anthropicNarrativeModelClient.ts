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
 * buildPrompt() also carries decision 19's "no closing/summary claim" and
 * "one tier word per claim, only for the cited item" rules, added after
 * 2e's live run (schema fix + target/limit rename both live) still showed
 * a 25% grounding-fallback rate, all 3 failures on the last claim: an
 * aggregate/closing sentence ("All 8 capabilities are blocked", "5 of 8
 * blocked") or an otherwise-valid claim with an uncited tier word tacked
 * on. NarrativePromptInput's org no longer carries
 * capabilityVerdictCounts/metricStatusCounts at all (narrativePromptInput.ts,
 * narrativeTypes.ts) -- same "fix the input, not just the instructions"
 * logic as decision 18 -- and the prompt gained an explicit rule against a
 * final wrap-up claim.
 *
 * Never logs or includes the API key in any error: only error.status/
 * .name/.message are read from a caught SDK error, never headers or the raw
 * request/response body.
 */

import Anthropic, { APIError } from '@anthropic-ai/sdk';
import type {
  NarrativeClaim,
  NarrativeModelClient,
  NarrativeModelResponse,
  NarrativeModelUsage,
  NarrativePromptInput,
} from './narrativeTypes.js';
import { MAX_TOKENS, buildNarrativeRequestFromInput, resolveNarrativeModel } from './narrativeRequest.js';

// Moved to narrativeRequest.ts (SDK-free); re-exported so existing importers keep working.
export { CLAIMS_SCHEMA, buildPrompt, listValidIds, resolveNarrativeModel } from './narrativeRequest.js';

const MAX_CLAIMS = 8;
const TIMEOUT_MS = 30_000;
const MAX_RETRIES = 0;

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
      message = await this.client.messages.create(buildNarrativeRequestFromInput(input, this.model));
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

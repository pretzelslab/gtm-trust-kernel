/**
 * Real NarrativeModelClient backed by the Anthropic Messages API (Phase E
 * commit 2, docs/narrative-design.md decision 2). The only file in this
 * package that imports @anthropic-ai/sdk -- enforced by
 * test/report/anthropicImportGuard.test.ts, not just this docblock.
 *
 * Structured output: output_config.format with a fixed JSON schema for
 * NarrativeModelResponse's shape (decision 2), via the SDK's messages.parse()
 * -- it JSON.parses the model's text block itself and throws an
 * AnthropicError on malformed JSON, so this file doesn't hand-roll that step.
 * A defensive runtime shape-guard still runs on top, since the schema is
 * meant to make a shape mismatch unreachable, not proven unreachable.
 *
 * Timeout/retries/max_tokens (decision, confirmed with the user, not in the
 * design doc): 30s timeout, maxRetries 0, max_tokens 1024. A failed call
 * here has a free, always-correct fallback -- the deterministic
 * plainSummary -- so this client fails fast rather than retrying or making a
 * report viewer wait a long time before narrative.ts (commit 3) falls back.
 *
 * generate() either returns a well-shaped NarrativeModelResponse or throws.
 * It never returns a best-effort/partial response -- commit 3's
 * orchestration is expected to catch a thrown error as one of its fallback
 * triggers, the same way it catches a grounding-validation failure.
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
  NarrativePromptInput,
} from './narrativeTypes.js';

const DEFAULT_MODEL = 'claude-haiku-4-5-20251001';
const MAX_TOKENS = 1024;
const TIMEOUT_MS = 30_000;
const MAX_RETRIES = 0;

/** NARRATIVE_MODEL env override, same convention as loadSalesforceConfigFromEnv's env param. */
export function resolveNarrativeModel(env: NodeJS.ProcessEnv = process.env): string {
  return env.NARRATIVE_MODEL || DEFAULT_MODEL;
}

const CLAIMS_SCHEMA = {
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
      message = await this.client.messages.parse({
        model: this.model,
        max_tokens: MAX_TOKENS,
        messages: [{ role: 'user', content: buildPrompt(input) }],
        output_config: { format: { type: 'json_schema', schema: CLAIMS_SCHEMA } },
      });
    } catch (error) {
      throw new Error(describeError(error));
    }

    // message.parsed_output's static type is derived from a Parseable output-format
    // helper (e.g. zodOutputFormat) that we deliberately don't use -- no new
    // dependency, per this feature's scope. Its declared type is narrower than what
    // the SDK actually produces at runtime for a plain json_schema format (it always
    // JSON.parses the text block -- see this file's docblock), so treat it as unknown
    // and let the shape-guard do the real narrowing.
    const parsedOutput: unknown = message.parsed_output;
    if (!isClaimsShape(parsedOutput)) {
      throw new Error('Anthropic response did not match the expected narrative claims shape.');
    }

    return {
      claims: parsedOutput.claims,
      usage: { inputTokens: message.usage.input_tokens, outputTokens: message.usage.output_tokens },
    };
  }
}

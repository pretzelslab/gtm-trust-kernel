#!/usr/bin/env node
/**
 * Manual smoke script for Phase E's narrative pass (docs/narrative-design.md
 * decision 4). Runs the real AnthropicNarrativeModelClient against every
 * fixture and reports, per fixture, whether the narrative would be accepted
 * or would fall back -- tagged as one of two kinds:
 *
 *   - transport: generate() itself threw (network error, timeout, API
 *     error, or a malformed/shape-invalid response that never became a
 *     gradable set of claims).
 *   - grounding: generate() returned a well-formed response, but
 *     validateGrounding() found at least one claim that fails id-citation,
 *     tier-word, or numeric-tolerance checks.
 *
 * The ~20% escalation threshold (decision 4: "switch the hardcoded default
 * to claude-sonnet-5") is about claim quality, not network flakiness, so it
 * is called out against the grounding fallback rate only -- transport
 * failures are reported but never counted toward it.
 *
 * Excluded from `npm run ci`: this file's name doesn't match vitest's
 * default *.test.ts/*.spec.ts glob, so it's never picked up as a test, and
 * no ci script invokes it. It IS included in tsconfig.json's `include`, so
 * `npm run typecheck` (part of ci) still catches a broken build here --
 * "excluded from ci" means never executed automatically, not never
 * typechecked.
 *
 * Usage (from packages/readiness): npm run narrative:smoke
 * Requires ANTHROPIC_API_KEY in .env or the shell environment -- prints a
 * message and exits 0 (not a failure) if it's unset.
 *
 * Token/cost output: per-fixture and total input/output token counts are
 * always printed. An estimated-cost line is printed only when BOTH
 * NARRATIVE_INPUT_COST_PER_MTOK and NARRATIVE_OUTPUT_COST_PER_MTOK (USD per
 * million tokens) are set -- this script does not hardcode a price table,
 * since published rates change independently of this code.
 */

import { AnthropicNarrativeModelClient } from '../src/report/anthropicNarrativeModelClient.js';
import { buildFromFixture } from '../src/report/buildFromFixture.js';
import { loadEnvFileIfPresent } from '../src/report/envFile.js';
import { FIXTURE_NAMES, type FixtureName } from '../src/fixtures/mockOrgs.js';
import { validateGrounding } from '../src/report/narrativeGrounding.js';
import { buildNarrativePromptInput } from '../src/report/narrativePromptInput.js';

const GROUNDING_FALLBACK_THRESHOLD = 0.2;

interface Usage {
  readonly inputTokens: number;
  readonly outputTokens: number;
}

interface FixtureOutcome {
  readonly fixture: FixtureName;
  readonly kind: 'ok' | 'transport' | 'grounding';
  readonly reasons: readonly string[];
  readonly usage?: Usage;
}

async function runFixture(client: AnthropicNarrativeModelClient, fixture: FixtureName): Promise<FixtureOutcome> {
  const data = await buildFromFixture(fixture);
  const promptInput = buildNarrativePromptInput(data);

  let response;
  try {
    response = await client.generate(promptInput);
  } catch (error) {
    return {
      fixture,
      kind: 'transport',
      reasons: [error instanceof Error ? error.message : String(error)],
    };
  }

  const grounding = validateGrounding(response.claims, data);
  if (!grounding.ok) {
    return {
      fixture,
      kind: 'grounding',
      reasons: grounding.failures.map((f) => `claim ${f.claimIndex}: ${f.reason}`),
      usage: response.usage,
    };
  }

  return { fixture, kind: 'ok', reasons: [], usage: response.usage };
}

function formatUsage(usage: Usage | undefined): string {
  return usage ? `in=${usage.inputTokens} out=${usage.outputTokens}` : 'n/a';
}

function formatStatus(kind: FixtureOutcome['kind']): string {
  if (kind === 'ok') return 'OK (grounded)';
  if (kind === 'transport') return 'FALLBACK (transport)';
  return 'FALLBACK (grounding)';
}

/** Only prints a cost line when both rate env vars are set and parse as finite numbers -- see this file's docblock. */
function maybeCostLine(totalInputTokens: number, totalOutputTokens: number): string | null {
  const inputRateRaw = process.env['NARRATIVE_INPUT_COST_PER_MTOK'];
  const outputRateRaw = process.env['NARRATIVE_OUTPUT_COST_PER_MTOK'];
  if (!inputRateRaw || !outputRateRaw) return null;

  const inputCostPerMillion = Number(inputRateRaw);
  const outputCostPerMillion = Number(outputRateRaw);
  if (!Number.isFinite(inputCostPerMillion) || !Number.isFinite(outputCostPerMillion)) return null;

  const cost = (totalInputTokens / 1_000_000) * inputCostPerMillion + (totalOutputTokens / 1_000_000) * outputCostPerMillion;
  return `Estimated cost: $${cost.toFixed(4)} (at $${inputCostPerMillion}/M in, $${outputCostPerMillion}/M out)`;
}

async function main(): Promise<void> {
  await loadEnvFileIfPresent();
  if (!process.env['ANTHROPIC_API_KEY']) {
    console.log('ANTHROPIC_API_KEY not set (checked .env and the shell environment) -- skipping narrative smoke run.');
    return;
  }

  const client = new AnthropicNarrativeModelClient();
  const outcomes: FixtureOutcome[] = [];
  for (const fixture of FIXTURE_NAMES) {
    outcomes.push(await runFixture(client, fixture));
  }

  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  for (const outcome of outcomes) {
    console.log(`${outcome.fixture}: ${formatStatus(outcome.kind)}  [usage: ${formatUsage(outcome.usage)}]`);
    for (const reason of outcome.reasons) {
      console.log(`  - ${reason}`);
    }
    if (outcome.usage) {
      totalInputTokens += outcome.usage.inputTokens;
      totalOutputTokens += outcome.usage.outputTokens;
    }
  }

  const groundingFallbacks = outcomes.filter((o) => o.kind === 'grounding').length;
  const transportFailures = outcomes.filter((o) => o.kind === 'transport').length;
  const groundingRate = groundingFallbacks / outcomes.length;

  console.log('');
  console.log(
    `Grounding fallback rate: ${(groundingRate * 100).toFixed(0)}% (${groundingFallbacks}/${outcomes.length})` +
      (groundingRate > GROUNDING_FALLBACK_THRESHOLD
        ? ' -- ABOVE the ~20% escalation threshold (decision 4); consider switching NARRATIVE_MODEL\'s default to claude-sonnet-5.'
        : ' -- within the ~20% escalation threshold.'),
  );
  console.log(`Transport failures: ${transportFailures}/${outcomes.length} (not counted toward the escalation threshold above)`);
  console.log(`Total tokens: in=${totalInputTokens} out=${totalOutputTokens}`);

  const costLine = maybeCostLine(totalInputTokens, totalOutputTokens);
  if (costLine) {
    console.log(costLine);
  } else {
    console.log('(set NARRATIVE_INPUT_COST_PER_MTOK and NARRATIVE_OUTPUT_COST_PER_MTOK, USD per million tokens, to see an estimated cost line)');
  }
}

main().catch((err: unknown) => {
  console.error(err);
  process.exitCode = 1;
});

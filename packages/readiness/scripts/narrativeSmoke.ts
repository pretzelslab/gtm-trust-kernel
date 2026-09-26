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
 *     tier-word, or numeric-tolerance checks. Each failure line includes
 *     the offending claim's own text (commit 2b), not just the reason, so
 *     a specific hypothesis about a failure (e.g. a claim quoting a
 *     metric's own note-derived count) can be confirmed from this output
 *     alone.
 *
 * The ~20% escalation threshold (decision 4: "switch the hardcoded default
 * to claude-sonnet-5") is about claim quality, not network flakiness, so it
 * is called out against the grounding fallback rate only -- transport
 * failures are reported but never counted toward it. With --runs N > 1,
 * the threshold call-out and per-fixture pass rate are both computed over
 * every fixture x run.
 *
 * Excluded from `npm run ci`: this file's name doesn't match vitest's
 * default *.test.ts/*.spec.ts glob, so it's never picked up as a test, and
 * no ci script invokes it. It IS included in tsconfig.json's `include`, so
 * `npm run typecheck` (part of ci) still catches a broken build here --
 * "excluded from ci" means never executed automatically, not never
 * typechecked.
 *
 * Usage (from packages/readiness):
 *   npm run narrative:smoke                 # 1 run per fixture (default)
 *   npm run narrative:smoke -- --runs 3      # 3 runs per fixture
 * Requires ANTHROPIC_API_KEY in .env or the shell environment -- prints a
 * message and exits 0 (not a failure) if it's unset.
 *
 * Token/cost output: per-fixture-per-run and grand-total input/output token
 * counts are always printed. An estimated-cost line is printed only when
 * BOTH NARRATIVE_INPUT_COST_PER_MTOK and NARRATIVE_OUTPUT_COST_PER_MTOK
 * (USD per million tokens) are set -- this script does not hardcode a
 * price table, since published rates change independently of this code.
 */

import { parseArgs } from 'node:util';
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
  readonly runIndex: number;
  readonly kind: 'ok' | 'transport' | 'grounding';
  readonly reasons: readonly string[];
  readonly usage?: Usage;
}

function parseRunsArg(): number {
  const { values } = parseArgs({ options: { runs: { type: 'string', default: '1' } } });
  const runs = Number(values.runs);
  if (!Number.isInteger(runs) || runs < 1) {
    throw new Error(`--runs must be a positive integer, got "${values.runs}"`);
  }
  return runs;
}

async function runFixture(client: AnthropicNarrativeModelClient, fixture: FixtureName, runIndex: number): Promise<FixtureOutcome> {
  const data = await buildFromFixture(fixture);
  const promptInput = buildNarrativePromptInput(data);

  let response;
  try {
    response = await client.generate(promptInput);
  } catch (error) {
    return {
      fixture,
      runIndex,
      kind: 'transport',
      reasons: [error instanceof Error ? error.message : String(error)],
    };
  }

  const grounding = validateGrounding(response.claims, data);
  if (!grounding.ok) {
    return {
      fixture,
      runIndex,
      kind: 'grounding',
      reasons: grounding.failures.map((f) => {
        const claimText = response.claims[f.claimIndex]?.text ?? '(claim text unavailable)';
        return `claim ${f.claimIndex} ["${claimText}"]: ${f.reason}`;
      }),
      usage: response.usage,
    };
  }

  return { fixture, runIndex, kind: 'ok', reasons: [], usage: response.usage };
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
  const runs = parseRunsArg();

  await loadEnvFileIfPresent();
  if (!process.env['ANTHROPIC_API_KEY']) {
    console.log('ANTHROPIC_API_KEY not set (checked .env and the shell environment) -- skipping narrative smoke run.');
    return;
  }

  const client = new AnthropicNarrativeModelClient();
  const outcomes: FixtureOutcome[] = [];
  for (let runIndex = 1; runIndex <= runs; runIndex++) {
    for (const fixture of FIXTURE_NAMES) {
      const outcome = await runFixture(client, fixture, runIndex);
      outcomes.push(outcome);

      const label = runs > 1 ? `[run ${runIndex}/${runs}] ${outcome.fixture}` : outcome.fixture;
      console.log(`${label}: ${formatStatus(outcome.kind)}  [usage: ${formatUsage(outcome.usage)}]`);
      for (const reason of outcome.reasons) {
        console.log(`  - ${reason}`);
      }
    }
  }

  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  for (const outcome of outcomes) {
    if (outcome.usage) {
      totalInputTokens += outcome.usage.inputTokens;
      totalOutputTokens += outcome.usage.outputTokens;
    }
  }

  console.log('');
  if (runs > 1) {
    for (const fixture of FIXTURE_NAMES) {
      const forFixture = outcomes.filter((o) => o.fixture === fixture);
      const passed = forFixture.filter((o) => o.kind === 'ok').length;
      console.log(`${fixture}: ${passed}/${runs} passed`);
    }
    console.log('');
  }

  const groundingFallbacks = outcomes.filter((o) => o.kind === 'grounding').length;
  const transportFailures = outcomes.filter((o) => o.kind === 'transport').length;
  const groundingRate = groundingFallbacks / outcomes.length;

  console.log(
    `Grounding fallback rate: ${(groundingRate * 100).toFixed(0)}% (${groundingFallbacks}/${outcomes.length})` +
      (groundingRate > GROUNDING_FALLBACK_THRESHOLD
        ? " -- ABOVE the ~20% escalation threshold (decision 4); consider switching NARRATIVE_MODEL's default to claude-sonnet-5."
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

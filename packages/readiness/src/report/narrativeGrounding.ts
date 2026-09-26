/**
 * Grounding validation for Phase E's narrative pass (docs/narrative-design.md
 * decisions 5-7). Pure: takes the model's claimed output plus the ReportData
 * it was generated from, and reports which claims (if any) fail. Deciding
 * what to DO on failure -- discard the whole narrative, per decision 8 --
 * is narrative.ts's job (not yet built), not this function's.
 *
 * Three independent checks per claim, all must pass:
 *  1. every cited id must exist in this ReportData (metric or capability).
 *  2. any tier/qualitative word in the claim's text must match every cited
 *     id's actual tier/verdict.
 *  3. the unmatched-number rule: if the claim's text contains any number at
 *     all, at least one of it cited METRIC ids (never capabilities -- see
 *     below) must have a value that number matches, within tolerance.
 *     Otherwise the claim fails, regardless of citation type. This is
 *     deliberately not scoped to "only check a number against a metric
 *     whose unit matches the number's shape" -- it applies even when every
 *     cited id is a capability, or a bool-unit metric, neither of which has
 *     a matchable value: a number appearing in a claim that cites only
 *     those must fail, since there is nothing for it to be grounded in.
 *
 * Known v1 strictness tradeoff (accepted, not an oversight): an aggregate
 * figure derived from several rows at once (e.g. "2 of 8 capabilities are
 * blocked") has no single cited metric/capability whose own value it
 * matches, so it fails check 3 even when every underlying number is
 * correct. Revisit if the manual smoke script (decision 4) shows a high
 * fallback rate driven by this.
 *
 * Known v1 vocabulary limit (also accepted): the tier-word check below
 * only recognizes decision 6's literal 7 terms. Other qualitative words a
 * model might reach for -- "healthy", "poor", "risky", and similar -- are
 * not checked at all; a claim using one of those neither passes nor fails
 * on that basis. Revisit if the smoke script surfaces model output that
 * leans on unchecked vocabulary to imply a tier.
 */

import type { CapabilityId, MetricId, Verdict } from '../rubric.js';
import type { MetricRow, ReportCapabilityRow, ReportData } from './buildReport.js';
import type { NarrativeClaim } from './narrativeTypes.js';

export interface GroundingFailure {
  readonly claimIndex: number;
  readonly reason: string;
}

export interface GroundingResult {
  readonly ok: boolean;
  readonly failures: readonly GroundingFailure[];
}

const PERCENT_TOLERANCE_POINTS = 0.5;

// ---------------------------------------------------------------------------
// Check 2: tier-word check. Decision 6's literal word list -- 'degraded' has
// no listed synonym, so only the bare word is checked for it.
// ---------------------------------------------------------------------------

const TIER_WORDS: Readonly<Record<Verdict, readonly string[]>> = {
  viable: ['viable', 'ready', 'strong'],
  degraded: ['degraded'],
  blocked: ['blocked', 'not ready', 'weak'],
};

const ALL_TIER_TERMS: readonly { readonly term: string; readonly verdict: Verdict }[] = (
  Object.entries(TIER_WORDS) as [Verdict, readonly string[]][]
)
  .flatMap(([verdict, terms]) => terms.map((term) => ({ term, verdict })))
  // Longest phrase first, so "not ready" is matched (and consumed) before
  // the bare "ready" it contains would otherwise also match.
  .sort((a, b) => b.term.length - a.term.length);

function findTierWordMismatches(text: string, expectedTiers: ReadonlySet<Verdict>): string[] {
  let remaining = text.toLowerCase();
  const mismatches: string[] = [];
  for (const { term, verdict } of ALL_TIER_TERMS) {
    const pattern = new RegExp(`\\b${term.replace(/ /g, '\\s+')}\\b`);
    if (pattern.test(remaining)) {
      if (!expectedTiers.has(verdict)) {
        mismatches.push(
          `claim uses tier word "${term}" (implies ${verdict}) but cited id(s) have tier(s) ${[...expectedTiers].sort().join('/') || 'none'}`,
        );
      }
      // Consume the matched span so this phrase's substring isn't re-matched as a shorter term below it in the list.
      remaining = remaining.replace(pattern, ' ');
    }
  }
  return mismatches;
}

// ---------------------------------------------------------------------------
// Check 3: numeric tolerance. Decision 7.
// ---------------------------------------------------------------------------

function extractPercents(text: string): number[] {
  const percentMatches = [...text.matchAll(/(-?\d+(?:\.\d+)?)\s*%/g)].map((m) => Number(m[1]));
  // Bare fractions between 0 and 1 (e.g. "0.203"), normalized to percent -- decision 7's "0.203 == 20.3%".
  const fractionMatches = [...text.matchAll(/\b(0?\.\d+|1\.0+)\b/g)].map((m) => Number(m[1]) * 100);
  return [...percentMatches, ...fractionMatches];
}

function extractBareNumbers(text: string): number[] {
  // Excludes numbers immediately followed by '%' -- those belong to extractPercents, not this check.
  return [...text.matchAll(/-?\d+(?:\.\d+)?(?!\s*%)/g)].map((m) => Number(m[0]));
}

function hasAnyNumericContent(text: string): boolean {
  return extractPercents(text).length > 0 || extractBareNumbers(text).length > 0;
}

/** Whether `metric` has a value this claim's text could plausibly be citing, and it matches within tolerance. Bool-unit and valueless metrics never match -- they aren't matchable targets for a number at all. */
function metricMatchesSomeNumber(metric: MetricRow, claimText: string): boolean {
  if (metric.value === null || metric.unit === 'bool') return false;
  if (metric.unit === 'rate') {
    const expectedPercent = metric.value * 100;
    return extractPercents(claimText).some((p) => Math.abs(p - expectedPercent) <= PERCENT_TOLERANCE_POINTS);
  }
  // Non-percent units (count/days/months/chars): render.ts shows the raw value with no rounding, so exact match.
  return extractBareNumbers(claimText).some((n) => n === metric.value);
}

// ---------------------------------------------------------------------------

function validateClaim(
  claim: NarrativeClaim,
  claimIndex: number,
  metricsById: ReadonlyMap<MetricId, MetricRow>,
  capabilitiesById: ReadonlyMap<CapabilityId, ReportCapabilityRow>,
): GroundingFailure[] {
  const failures: GroundingFailure[] = [];

  if (claim.groundedIn.length === 0) {
    return [{ claimIndex, reason: 'claim cites no metric or capability id' }];
  }

  const expectedTiers = new Set<Verdict>();
  const citedMetrics: MetricRow[] = [];
  for (const id of claim.groundedIn) {
    const metric = metricsById.get(id as MetricId);
    const capability = capabilitiesById.get(id as CapabilityId);

    if (!metric && !capability) {
      failures.push({ claimIndex, reason: `cited id "${id}" does not exist in this report` });
      continue;
    }
    if (metric?.tier) expectedTiers.add(metric.tier);
    if (capability) expectedTiers.add(capability.verdict);
    if (metric) citedMetrics.push(metric);
  }

  // Unmatched-number rule (see this file's docblock): applies whether the
  // claim cites metrics, capabilities, or both -- a capability-only or
  // bool-metric-only citation has no matchable value, so any number in the
  // text fails here, not silently passing for lack of a shape to check.
  if (hasAnyNumericContent(claim.text) && !citedMetrics.some((m) => metricMatchesSomeNumber(m, claim.text))) {
    const citedIds = citedMetrics.length > 0 ? citedMetrics.map((m) => m.metric).join(', ') : 'none (capability-only citation, or no matchable metric cited)';
    failures.push({
      claimIndex,
      reason: `claim's number doesn't match any cited metric's value (cited metric ids: ${citedIds})`,
    });
  }

  for (const reason of findTierWordMismatches(claim.text, expectedTiers)) {
    failures.push({ claimIndex, reason });
  }

  return failures;
}

export function validateGrounding(claims: readonly NarrativeClaim[], data: ReportData): GroundingResult {
  const metricsById = new Map(data.metrics.map((m) => [m.metric, m] as const));
  const capabilitiesById = new Map(data.capabilities.map((c) => [c.id, c] as const));

  const failures: GroundingFailure[] = [];
  claims.forEach((claim, index) => {
    failures.push(...validateClaim(claim, index, metricsById, capabilitiesById));
  });

  return { ok: failures.length === 0, failures };
}

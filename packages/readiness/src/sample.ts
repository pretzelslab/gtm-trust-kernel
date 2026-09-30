/**
 * Stratified opportunity sampler for the readiness assessment.
 *
 * Strata: the five open canonical stages (CANONICAL_STAGE_ORDER), each sampled
 * with no time window, plus closed_won and closed_lost as separate strata,
 * each windowed to the trailing CLOSED_WINDOW_MONTHS by closeDate. Split
 * rather than combined so a low-win-rate org can't starve the won-deal
 * reservoir: win_rate_dispersion and outcome_evidence_retention_rate both
 * need both outcomes represented regardless of the org's actual win rate.
 *
 * CrmAdapter.listOpportunities has no server-side stage filter — it is a
 * time-windowed, cursor-paginated stream over all opportunities. So
 * stratification happens client-side: page through the stream, classify each
 * record by stratum, and keep a fixed-size reservoir per stratum (Algorithm
 * R) so the kept subset is a uniform sample of everything seen in that
 * stratum so far, without needing to know the stratum's total population up
 * front.
 *
 * Deterministic given a seed: reservoir accept/evict decisions are driven by
 * a PRNG seeded from SampleConfig.seed, so the same seed against the same
 * underlying adapter data always keeps the same records. If the underlying
 * CRM data changes between runs, the sample can still change — determinism
 * holds for a fixed data snapshot, not across time.
 *
 * Budgeted: the scan stops at whichever of these comes first: every stratum's
 * reservoir is full, config.maxRecordsToScan is reached, or the adapter's
 * stream is exhausted. Stopping as soon as every reservoir is full trades
 * strict reservoir uniformity over the whole population (which would require
 * scanning to the budget or to exhaustion) for cost: a stratum that fills
 * early is a uniform sample of the records seen up to that point, not of the
 * full population. planSample() computes a worst-case API call count from
 * maxRecordsToScan and the adapter's declared bulkRead capability before any
 * adapter call is made, and runSample() prints and requires confirmation of
 * that plan before scanning starts.
 */

import type { AdapterCapabilities, CrmAdapter } from '@gtm-trust-kernel/adapters/types.js';
import type { CanonicalStage, Opportunity } from '@gtm-trust-kernel/adapters/model/canonical.js';
import { CANONICAL_STAGE_ORDER } from '@gtm-trust-kernel/adapters/model/canonical.js';

// ---------------------------------------------------------------------------
// Strata
// ---------------------------------------------------------------------------

export type SampleStratum = CanonicalStage;

export const SAMPLE_STRATA: readonly SampleStratum[] = [...CANONICAL_STAGE_ORDER, 'closed_won', 'closed_lost'];

/** Fixed by spec, not tunable. */
export const CLOSED_WINDOW_MONTHS = 12;

const OPEN_STAGES: ReadonlySet<string> = new Set(CANONICAL_STAGE_ORDER);

function isWithinClosedWindow(closeDate: Date, asOf: Date): boolean {
  const cutoff = new Date(asOf);
  cutoff.setUTCMonth(cutoff.getUTCMonth() - CLOSED_WINDOW_MONTHS);
  return closeDate.getTime() >= cutoff.getTime() && closeDate.getTime() <= asOf.getTime();
}

/**
 * Which stratum an opportunity belongs to as of `asOf`. Open stages are
 * unwindowed. closed_won/closed_lost require a parseable closeDate within
 * CLOSED_WINDOW_MONTHS of asOf. Anything else (unparseable or out-of-window
 * closeDate) returns null and is excluded from sampling.
 */
export function classifyStratum(opportunity: Opportunity, asOf: Date): SampleStratum | null {
  if (OPEN_STAGES.has(opportunity.stage)) {
    return opportunity.stage;
  }

  if (opportunity.stage === 'closed_won' || opportunity.stage === 'closed_lost') {
    if (!opportunity.closeDate) return null;
    const closeDate = new Date(opportunity.closeDate);
    if (Number.isNaN(closeDate.getTime())) return null;
    return isWithinClosedWindow(closeDate, asOf) ? opportunity.stage : null;
  }

  return null;
}

// ---------------------------------------------------------------------------
// Config and plan
// ---------------------------------------------------------------------------

export interface SampleConfig {
  /** Deterministic seed for the per-stratum reservoir sampling. */
  readonly seed: string;
  /**
   * Target number of opportunities to keep in each of the seven strata for
   * the detailed checks (the hydration tier). A floor for a full stratum,
   * not a reason to stop scanning: see stopWhenStrataFull.
   */
  readonly perStratumSampleSize: number;
  /** Hard ceiling on total opportunities scanned from the adapter, across all pages. */
  readonly maxRecordsToScan: number;
  /**
   * --quick: stop scanning once every stratum holds perStratumSampleSize.
   * Off by default, so the scan reads the whole eligible population (up to
   * maxRecordsToScan) and each stratum's sample is drawn uniformly from all
   * of it rather than from the newest deals.
   */
  readonly stopWhenStrataFull?: boolean;
  /** Page size to request when the adapter declares bulkRead support. */
  readonly pageSizeBulk: number;
  /** Page size to request when it does not. */
  readonly pageSizeStandard: number;
  /**
   * Reference "now" for the closed-deal window, as an ISO timestamp.
   * Defaults to the current time; pass an explicit value for reproducible
   * tests.
   */
  readonly asOf?: string;
}

/**
 * So the CLI doesn't have to ask for page sizes every run. seed,
 * perStratumSampleSize and maxRecordsToScan aren't defaultable — they are
 * per-run judgment calls, not tooling constants.
 */
export const DEFAULT_SAMPLE_CONFIG: Pick<SampleConfig, 'pageSizeBulk' | 'pageSizeStandard'> = {
  pageSizeBulk: 2000,
  pageSizeStandard: 200,
};

export interface SamplePlan {
  readonly seed: string;
  readonly strata: readonly SampleStratum[];
  readonly perStratumSampleSize: number;
  readonly maxRecordsToScan: number;
  readonly effectivePageSize: number;
  /** Math.ceil(maxRecordsToScan / effectivePageSize) — the worst case; the actual run may stop earlier. */
  readonly plannedApiCalls: number;
  /**
   * Worst-case getAccounts() calls for account hydration (coverageSample.ts),
   * computed as if every sampled opportunity resolved to a distinct account:
   * Math.ceil((strata.length * perStratumSampleSize) / accountBatchLimit).
   * Real orgs share accounts across opportunities, so the actual hydration
   * call count is almost always lower — this is a budget ceiling, not an
   * estimate of the typical case, same "worst case" framing as plannedApiCalls.
   */
  readonly plannedAccountApiCalls: number;
  readonly rateLimit: AdapterCapabilities['rateLimit'];
}

/** Pure. Reads only adapter.capabilities(), makes no adapter calls. */
export function planSample(adapter: CrmAdapter, config: SampleConfig): SamplePlan {
  const caps = adapter.capabilities();
  const effectivePageSize = caps.bulkRead ? config.pageSizeBulk : config.pageSizeStandard;
  const plannedApiCalls = Math.ceil(config.maxRecordsToScan / effectivePageSize);
  const worstCaseAccountRefs = SAMPLE_STRATA.length * config.perStratumSampleSize;
  const plannedAccountApiCalls = Math.ceil(worstCaseAccountRefs / caps.accountBatchLimit);

  return {
    seed: config.seed,
    strata: SAMPLE_STRATA,
    perStratumSampleSize: config.perStratumSampleSize,
    maxRecordsToScan: config.maxRecordsToScan,
    effectivePageSize,
    plannedApiCalls,
    plannedAccountApiCalls,
    rateLimit: caps.rateLimit,
  };
}

/** Quota impact of the full run, opportunity scan plus account hydration — understating it would defeat the point of the quota-discipline display. */
function formatRateLimit(rateLimit: AdapterCapabilities['rateLimit'], totalPlannedApiCalls: number): string {
  if (rateLimit.kind === 'none' || rateLimit.value <= 0) {
    return 'Quota: adapter reports no rate limit';
  }
  if (rateLimit.kind === 'daily_quota') {
    const pct = ((100 * totalPlannedApiCalls) / rateLimit.value).toFixed(1);
    return `Quota: up to ${pct}% of the daily quota of ${rateLimit.value}`;
  }
  const seconds = (totalPlannedApiCalls / rateLimit.value).toFixed(1);
  return `Quota: at least ~${seconds}s at ${rateLimit.value} calls/sec`;
}

/** Pure. Renders the plan for the confirmation prompt. */
export function formatSamplePlan(plan: SamplePlan): string {
  const totalPlannedApiCalls = plan.plannedApiCalls + plan.plannedAccountApiCalls;
  return [
    `Stratified sample plan (seed: ${plan.seed})`,
    `  Strata (${plan.strata.length}): ${plan.strata.join(', ')}`,
    `  Target per stratum: ${plan.perStratumSampleSize}`,
    `  Max records to scan: ${plan.maxRecordsToScan}`,
    `  Page size: ${plan.effectivePageSize}`,
    `  Planned API calls: up to ${plan.plannedApiCalls} (worst case; stops earlier when the population runs out)`,
    `  Planned account hydration API calls: up to ${plan.plannedAccountApiCalls} (worst case: every sampled opportunity has a distinct account)`,
    `  ${formatRateLimit(plan.rateLimit, totalPlannedApiCalls)}`,
  ].join('\n');
}

// ---------------------------------------------------------------------------
// Deterministic sampling primitives
// ---------------------------------------------------------------------------

/** Seeded PRNG, [0, 1). Same seed => same sequence. */
export interface SeededRng {
  next(): number;
}

/** xfnv1a string hash into a 32-bit seed for mulberry32. Both are standard, small, public-domain PRNG techniques — chosen for determinism, not cryptographic quality. */
function hashSeed(seed: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function makeSeededRng(seed: string): SeededRng {
  const next = mulberry32(hashSeed(seed));
  return { next };
}

/** Algorithm-R reservoir: uniform random sample of a stream of unknown length. */
export interface Reservoir<T> {
  offer(item: T): void;
  readonly items: readonly T[];
  readonly seen: number;
}

class ReservoirImpl<T> implements Reservoir<T> {
  private readonly kept: T[] = [];
  private count = 0;

  constructor(
    private readonly size: number,
    private readonly rng: SeededRng,
  ) {}

  offer(item: T): void {
    this.count += 1;
    if (this.kept.length < this.size) {
      this.kept.push(item);
      return;
    }
    const j = Math.floor(this.rng.next() * this.count);
    if (j < this.size) {
      this.kept[j] = item;
    }
  }

  get items(): readonly T[] {
    return this.kept;
  }

  get seen(): number {
    return this.count;
  }
}

export function createReservoir<T>(size: number, rng: SeededRng): Reservoir<T> {
  return new ReservoirImpl<T>(size, rng);
}

// ---------------------------------------------------------------------------
// Orchestration
// ---------------------------------------------------------------------------

export interface StratumSampleResult {
  readonly stratum: SampleStratum;
  readonly target: number;
  readonly opportunities: readonly Opportunity[];
  /** True if the scan ended before this stratum reached target. */
  readonly underfilled: boolean;
}

export type StopReason = 'all_strata_full' | 'budget_exhausted' | 'source_exhausted';

export interface SampleResult {
  readonly plan: SamplePlan;
  readonly apiCallsConsumed: number;
  readonly recordsScanned: number;
  readonly strata: readonly StratumSampleResult[];
  readonly stopReason: StopReason;
}

/** What runSample returns: the sample, plus how much of the population the scan covered. */
export interface SampleRunResult extends SampleResult {
  /** Size of the sample population (open, and closed within the window), counted before the scan. */
  readonly population: { readonly open: number; readonly closedInWindow: number };
  /** Open opportunities the scan read, sampled or not. population.open minus this is how many older open deals it never reached. */
  readonly openScanned: number;
  /** Every eligible opportunity the scan read (the scan tier), in listing order. */
  readonly scanned: { readonly open: readonly Opportunity[]; readonly closed: readonly Opportunity[] };
}

/**
 * Confirmation gate, injected so callers choose their own UI (stdin prompt,
 * --yes flag, test double, ...). Called with the plan; must resolve true to
 * proceed.
 */
export type ConfirmFn = (plan: SamplePlan) => Promise<boolean> | boolean;

function allStrataFull(reservoirs: ReadonlyMap<SampleStratum, Reservoir<Opportunity>>, target: number): boolean {
  for (const reservoir of reservoirs.values()) {
    if (reservoir.items.length < target) return false;
  }
  return true;
}

/**
 * Orchestrates: plan -> print (via console.log(formatSamplePlan(plan))) ->
 * confirm -> scan. Returns { cancelled: true } without calling the adapter
 * if confirm() resolves false.
 */
export async function runSample(
  adapter: CrmAdapter,
  config: SampleConfig,
  confirm: ConfirmFn,
): Promise<SampleRunResult | { readonly cancelled: true }> {
  const plan = planSample(adapter, config);
  console.log(formatSamplePlan(plan));

  const proceed = await confirm(plan);
  if (!proceed) {
    return { cancelled: true };
  }

  const asOf = config.asOf ? new Date(config.asOf) : new Date();
  const rng = makeSeededRng(config.seed);
  const reservoirs = new Map<SampleStratum, Reservoir<Opportunity>>(
    SAMPLE_STRATA.map((stratum) => [stratum, createReservoir<Opportunity>(config.perStratumSampleSize, rng)]),
  );

  let recordsScanned = 0;
  let apiCallsConsumed = 0;
  let openScanned = 0;
  const scanned = { open: [] as Opportunity[], closed: [] as Opportunity[] };
  let cursor: string | undefined;
  let stopReason: StopReason = 'source_exhausted';

  // The population, newest created first: a scan that stops early (budget,
  // or full strata under --quick) has read the most recently created deals,
  // and the counts let the report say how many it never reached. A scan
  // that runs to the end offers every deal to the reservoirs, so each
  // stratum's sample is uniform over the whole population.
  const population = { asOf: asOf.toISOString(), closedWithinMonths: CLOSED_WINDOW_MONTHS };
  const count = await adapter.countOpportunitiesForSample(population);
  apiCallsConsumed += count.apiCallsConsumed;

  while (true) {
    const page = await adapter.listOpportunitiesForSample({ ...population, limit: plan.effectivePageSize, cursor });
    apiCallsConsumed += page.apiCallsConsumed;

    let stop: StopReason | null = null;
    for (const opportunity of page.items) {
      recordsScanned += 1;
      const stratum = classifyStratum(opportunity, asOf);
      if (stratum) {
        reservoirs.get(stratum)!.offer(opportunity);
        if (OPEN_STAGES.has(stratum)) {
          openScanned += 1;
          scanned.open.push(opportunity);
        } else {
          scanned.closed.push(opportunity);
        }
      }
      if (recordsScanned >= config.maxRecordsToScan) {
        stop = 'budget_exhausted';
        break;
      }
      if (config.stopWhenStrataFull && allStrataFull(reservoirs, config.perStratumSampleSize)) {
        stop = 'all_strata_full';
        break;
      }
    }

    if (stop) {
      stopReason = stop;
      break;
    }
    if (!page.nextCursor) {
      stopReason = 'source_exhausted';
      break;
    }
    cursor = page.nextCursor;
  }

  const strata: StratumSampleResult[] = SAMPLE_STRATA.map((stratum) => {
    const reservoir = reservoirs.get(stratum)!;
    return {
      stratum,
      target: config.perStratumSampleSize,
      opportunities: reservoir.items,
      underfilled: reservoir.items.length < config.perStratumSampleSize,
    };
  });

  return {
    plan,
    apiCallsConsumed,
    recordsScanned,
    population: { open: count.open, closedInWindow: count.closedInWindow },
    openScanned,
    scanned,
    strata,
    stopReason,
  };
}

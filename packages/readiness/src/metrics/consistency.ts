/**
 * D3 consistency/hygiene metrics. See docs/metric-definitions.md, section D3.
 */

import { CANONICAL_STAGE_ORDER } from '@gtm-trust-kernel/adapters/model/canonical.js';
import type { Account, CanonicalStage } from '@gtm-trust-kernel/adapters/model/canonical.js';
import type { CoverageSample, MetricConfig, MetricResult } from './types.js';
import { LOW_CONFIDENCE_SAMPLE_SIZE } from './types.js';
import {
  DAY_MS,
  DEFAULT_SHARED_PROVIDER_DENYLIST,
  NEW_OPPORTUNITY_EXCLUSION_DAYS,
  applyTruncationFloor,
  hasQualifyingActivity,
  normalizeDomain,
  rateOverOpportunities,
} from './shared.js';

/**
 * Contradiction window, per metric-definitions.md D3: 21 days, not
 * activity_capture_rate's 30 — a late-stage deal implies more frequent
 * expected touchpoints than an early-stage one.
 */
const CONTRADICTION_WINDOW_DAYS = 21;

/**
 * "Late-stage" = the top two stages of the canonical ladder, derived rather
 * than hardcoded so it tracks CANONICAL_STAGE_ORDER if that ladder changes.
 * Today: proposal, negotiation.
 */
const CONTRADICTION_STAGES: ReadonlySet<CanonicalStage> = new Set(CANONICAL_STAGE_ORDER.slice(-2));

/**
 * Gated on the adapter's activitySync capability, same as activity_capture_rate
 * (it needs the same activity data). Contradiction = an open opportunity in
 * the top two canonical stages with zero qualifying activities (same
 * predicate as activity_capture_rate, imported via hasQualifyingActivity) in
 * the trailing 21 days. Opportunities created in the last
 * NEW_OPPORTUNITY_EXCLUSION_DAYS are left out, as in activity_capture_rate.
 */
export function stageActivityContradictionRate(sample: CoverageSample, config: MetricConfig): MetricResult {
  if (!sample.capabilities.activitySync) {
    return {
      metric: 'stage_activity_contradiction_rate',
      status: 'not_instrumented',
      value: null,
      sampleSize: 0,
      lowConfidence: false,
      note: 'adapter capability matrix reports no activity-sync capability for this org',
    };
  }

  const asOf = new Date(config.asOf).getTime();
  const windowStart = asOf - CONTRADICTION_WINDOW_DAYS * DAY_MS;

  const newOpportunityCutoff = asOf - NEW_OPPORTUNITY_EXCLUSION_DAYS * DAY_MS;

  const lateStage = sample.openOpportunities.filter((o) => CONTRADICTION_STAGES.has(o.stage));
  const eligible = lateStage.filter((o) => new Date(o.createdAt).getTime() < newOpportunityCutoff);

  const result = rateOverOpportunities(
    'stage_activity_contradiction_rate',
    eligible,
    (o) => {
      const activities = sample.activitiesByOpportunity.get(o.ref.id) ?? [];
      return !hasQualifyingActivity(o, activities, windowStart, asOf);
    },
    lateStage.length === 0
      ? 'no open opportunities in proposal or negotiation stage in sample'
      : `every open opportunity in proposal or negotiation stage was created in the last ${NEW_OPPORTUNITY_EXCLUSION_DAYS} days`,
  );
  return applyTruncationFloor(result, eligible, sample.activitiesTruncatedOpportunityIds);
}

/**
 * Denominator excludes null and zero amount — mirrors amount_fill_rate's
 * zero-exclusion and past_due_close_date_rate's null-exclusion pattern
 * (metric-definitions.md D3: amount = 0 is already counted as unfilled by
 * amount_fill_rate, don't double count it here).
 *
 * Negative amounts are left in the denominator and evaluated by the same
 * `% 1000 === 0` rule as any other amount — open question for v0.2, noted in
 * docs/STATUS.md, not resolved here.
 */
export function roundAmountRate(sample: CoverageSample, _config: MetricConfig): MetricResult {
  const raw = sample.openOpportunities;
  const withAmount = raw.filter((o) => o.amount != null && o.amount !== 0);
  const excludedCount = raw.length - withAmount.length;
  const emptyNote =
    raw.length === 0
      ? 'no open opportunities in sample'
      : 'no open opportunities with a non-null, non-zero amount in sample';

  const result = rateOverOpportunities('round_amount_rate', withAmount, (o) => o.amount! % 1000 === 0, emptyNote);

  if (result.status !== 'ok') {
    return result;
  }

  return {
    ...result,
    note: `${excludedCount} opportunities excluded from the denominator (null or zero amount)`,
  };
}

/**
 * Denominator is sampled opportunities (open + closed), not distinct
 * picklist values — a retired stage no live deal uses doesn't count against
 * coverage (metric-definitions.md D3, resolved ambiguity). Numerator is
 * stageConfidence 'mapped' OR 'inferred'; only 'unmapped' counts against
 * coverage. Reports the mapped/inferred/unmapped split via note on the 'ok'
 * path — second use of round_amount_rate's excluded-count-via-note pattern
 * (see docs/STATUS.md tech debt note; a third use should get a real
 * MetricResult field instead).
 */
export function stageMappingCoverage(sample: CoverageSample, _config: MetricConfig): MetricResult {
  const all = [...sample.openOpportunities, ...sample.closedOpportunities];

  const result = rateOverOpportunities(
    'stage_mapping_coverage',
    all,
    (o) => o.stageConfidence === 'mapped' || o.stageConfidence === 'inferred',
    'no sampled opportunities (open or closed) in sample',
  );

  if (result.status !== 'ok') {
    return result;
  }

  const mapped = all.filter((o) => o.stageConfidence === 'mapped').length;
  const inferred = all.filter((o) => o.stageConfidence === 'inferred').length;
  const unmapped = all.filter((o) => o.stageConfidence === 'unmapped').length;

  return {
    ...result,
    note: `${mapped} mapped, ${inferred} inferred, ${unmapped} unmapped`,
  };
}

/**
 * Gated on CoverageSample.accountsHydrated, not an AdapterCapabilities flag
 * — this is a build-order precondition (hydrateAccounts hasn't run yet),
 * same not_instrumented-on-gate-off rule as activitySync-gated metrics,
 * applied to that precondition instead (docs/STATUS.md).
 *
 * Operates over sample.accountsByRef.values() — the distinct, hydrated
 * accounts referenced by the sample, not one row per opportunity. Each
 * account's domain is reduced via normalizeDomain (shared.ts); accounts
 * with no resolvable domain, or whose normalized domain is on the
 * shared-provider denylist (config.sharedProviderDenylist, defaulting to
 * DEFAULT_SHARED_PROVIDER_DENYLIST — config entries are themselves
 * normalized before comparison), are excluded from the denominator.
 *
 * Duplicate-group counting: every account in a group of size >= 2 counts
 * toward the numerator, not just members beyond the first — the doc's
 * "share of sampled accounts that share a normalized domain with at least
 * one other account" is symmetric, so a group's first-created account
 * satisfies it too. Decided this session; the note also reports the
 * duplicate-group count so the alternate ("beyond first") count is
 * derivable (denominator members in groups minus group count) without a
 * second metric. See docs/STATUS.md for the "beyond first" variant as a
 * v0.2 open question.
 */
export function duplicateAccountRate(sample: CoverageSample, config: MetricConfig): MetricResult {
  if (!sample.accountsHydrated) {
    return {
      metric: 'duplicate_account_rate',
      status: 'not_instrumented',
      value: null,
      sampleSize: 0,
      lowConfidence: false,
      note: 'account hydration has not run for this sample (accountsHydrated is false)',
    };
  }

  const rawDenylist = config.sharedProviderDenylist ?? DEFAULT_SHARED_PROVIDER_DENYLIST;
  const denylist = new Set(
    rawDenylist.map((d) => normalizeDomain(d)).filter((d): d is string => d !== null),
  );

  const accounts = [...sample.accountsByRef.values()];
  const byDomain = new Map<string, Account[]>();
  let excludedNullDomain = 0;
  let excludedDenylisted = 0;

  for (const account of accounts) {
    const normalized = normalizeDomain(account.domain);
    if (normalized === null) {
      excludedNullDomain += 1;
      continue;
    }
    if (denylist.has(normalized)) {
      excludedDenylisted += 1;
      continue;
    }
    const group = byDomain.get(normalized);
    if (group) {
      group.push(account);
    } else {
      byDomain.set(normalized, [account]);
    }
  }

  const denominator = accounts.length - excludedNullDomain - excludedDenylisted;

  if (denominator === 0) {
    return {
      metric: 'duplicate_account_rate',
      status: 'not_applicable',
      value: null,
      sampleSize: 0,
      lowConfidence: false,
      note:
        accounts.length === 0
          ? 'no hydrated accounts in sample'
          : 'no accounts with a resolvable, non-denylisted domain in sample',
    };
  }

  const duplicateGroups = [...byDomain.values()].filter((group) => group.length >= 2);
  const numerator = duplicateGroups.reduce((sum, group) => sum + group.length, 0);

  return {
    metric: 'duplicate_account_rate',
    status: 'ok',
    value: numerator / denominator,
    sampleSize: denominator,
    lowConfidence: denominator < LOW_CONFIDENCE_SAMPLE_SIZE,
    note:
      `${excludedNullDomain} accounts excluded (no resolvable domain), ${excludedDenylisted} excluded ` +
      `(shared-provider domain), ${duplicateGroups.length} duplicate group(s) among ${denominator} accounts ` +
      `considered; ${sample.missingAccountCount} accountRefs did not resolve, ${sample.oppsWithoutAccountRef} ` +
      `opportunities had no usable accountRef`,
  };
}

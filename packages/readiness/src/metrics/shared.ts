/**
 * Helpers shared by more than one metric family (D1 coverage, D2 freshness,
 * D3 consistency).
 */

import { getDomain } from 'tldts';
import type { Activity, Opportunity } from '@gtm-trust-kernel/adapters/model/canonical.js';
import type { MetricId } from '../rubric.js';
import type { MetricResult } from './types.js';
import { LOW_CONFIDENCE_SAMPLE_SIZE } from './types.js';

export const DAY_MS = 86_400_000;

/**
 * The qualifying-activity predicate, negotiated for activity_capture_rate
 * (metric-definitions.md D1) and reused as-is by stage_activity_contradiction_rate
 * (D3) with a different window length: occurredAt within [windowStart, asOf]
 * inclusive on both ends, and not before the opportunity's own createdAt. No
 * completion-status filter, no ActivityKind restriction. windowStart/asOf are
 * epoch ms — callers compute their own window length from asOf.
 */
export function hasQualifyingActivity(
  opportunity: Opportunity,
  activities: readonly Activity[],
  windowStart: number,
  asOf: number,
): boolean {
  const createdAt = new Date(opportunity.createdAt).getTime();
  return activities.some((a) => {
    const occurredAt = new Date(a.occurredAt).getTime();
    return occurredAt >= windowStart && occurredAt <= asOf && occurredAt >= createdAt;
  });
}

/** Share of some denominator of opportunities meeting a per-metric predicate. */
export function rateOverOpportunities(
  metric: MetricId,
  opportunities: readonly Opportunity[],
  isFilled: (o: Opportunity) => boolean,
  emptyNote = 'no open opportunities in sample',
): MetricResult {
  const sampleSize = opportunities.length;
  if (sampleSize === 0) {
    return {
      metric,
      status: 'not_applicable',
      value: null,
      sampleSize: 0,
      lowConfidence: false,
      note: emptyNote,
    };
  }

  const filled = opportunities.filter(isFilled).length;

  return {
    metric,
    status: 'ok',
    value: filled / sampleSize,
    sampleSize,
    lowConfidence: sampleSize < LOW_CONFIDENCE_SAMPLE_SIZE,
  };
}

/**
 * Reduces a raw domain-shaped string (a URL, a bare hostname, an email
 * domain) to its registrable domain, for account dedupe (duplicate_account_rate,
 * D3) and any future domain-based metric. This is the ONLY place domain
 * normalization lives — import this, don't re-derive it.
 *
 * Delegates to tldts's getDomain, which already performs every step
 * metric-definitions.md's normalization spec calls for (trim, lowercase,
 * strip protocol/"www."/path/port/trailing dot, resolve via the Public
 * Suffix List) — verified against the exact table in
 * test/metrics/shared.test.ts before writing this, so those steps are not
 * hand-rolled here on top of tldts.
 *
 * allowPrivateDomains: true — a PSL private-section host (herokuapp.com,
 * github.io, etc.) keeps its subdomain as part of the registrable unit
 * (acme.herokuapp.com stays acme.herokuapp.com, distinct from
 * beta.herokuapp.com) instead of collapsing every tenant on a shared PaaS
 * host down to one domain, which would manufacture false-positive
 * duplicate_account_rate groups.
 *
 * Returns null for unresolvable input: empty/whitespace, IPs, localhost,
 * anything with no public suffix (placeholders like "n/a" included).
 */
export function normalizeDomain(raw: string | undefined): string | null {
  if (raw == null) {
    return null;
  }
  return getDomain(raw, { allowPrivateDomains: true });
}

/**
 * duplicate_account_rate's (D3) default shared-provider denylist —
 * consumer/free-mail domains excluded from dedupe because they produce
 * false-positive account duplicates. Compared on NORMALIZED domain, so
 * lowercasing/whitespace in a config override doesn't need to be handled by
 * the caller. Config-extensible: MetricConfig.sharedProviderDenylist
 * replaces or supplements this list (see metrics/types.ts).
 *
 * Regional variants (yahoo.co.uk, etc.) are not included in this v0.1
 * default — addable per-org via config. Not a technical limitation, just
 * scope: see docs/STATUS.md.
 */
export const DEFAULT_SHARED_PROVIDER_DENYLIST: readonly string[] = [
  'gmail.com',
  'googlemail.com',
  'outlook.com',
  'hotmail.com',
  'live.com',
  'yahoo.com',
  'icloud.com',
  'aol.com',
  'proton.me',
  'protonmail.com',
  'gmx.com',
];

/** Callers must guard the empty case themselves; this throws rather than return a misleading number. */
export function median(values: readonly number[]): number {
  if (values.length === 0) {
    throw new Error('median called on an empty array');
  }
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) {
    return sorted[mid]!;
  }
  return (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/**
 * Population standard deviation, not sample (divide by N, not N-1) —
 * win_rate_dispersion (D7) treats the per-stage win rates it computes as
 * the entire population being measured (every eligible stage in this
 * sample), not a sample drawn from some larger population of stages.
 * Callers must guard the empty case themselves, same convention as median.
 */
export function standardDeviation(values: readonly number[]): number {
  if (values.length === 0) {
    throw new Error('standardDeviation called on an empty array');
  }
  const mean = values.reduce((sum, v) => sum + v, 0) / values.length;
  const variance = values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / values.length;
  return Math.sqrt(variance);
}

/**
 * Whole calendar months between two ISO timestamps, partial months
 * dropped (stage_history_months, D4): Jan 15 -> Jun 20 is 5 months; Jan 15
 * -> Jun 10 is 4 (the Jan-15 boundary hasn't been reached again in June
 * yet). Standard "age in whole months" rule, same as most date libraries'
 * diff('months'): raw month difference, minus one if laterIso's
 * day-of-month is earlier than earlierIso's — so a month lacking the
 * earlier date's day-of-month (e.g. Feb has no 31st, or no 29th outside a
 * leap year) is never counted as complete on that day-of-month alone.
 * Uses UTC calendar fields throughout, independent of runtime timezone.
 * Floored at 0 — callers pass (earlier, later) in that order; a caller
 * that gets this backwards gets 0, not a negative count.
 */
export function wholeCalendarMonthsBetween(earlierIso: string, laterIso: string): number {
  const earlier = new Date(earlierIso);
  const later = new Date(laterIso);
  let months = (later.getUTCFullYear() - earlier.getUTCFullYear()) * 12 + (later.getUTCMonth() - earlier.getUTCMonth());
  if (later.getUTCDate() < earlier.getUTCDate()) {
    months -= 1;
  }
  return Math.max(0, months);
}

/**
 * Luhn checksum, used only to validate a card-like digit run before
 * pii_density (D6) counts it — a bare 13-19 digit match on its own is not
 * sufficient (metric-definitions.md D6), since that shape also matches
 * plenty of non-card numbers (long internal IDs, concatenated phone
 * numbers). `digits` must already be a string of digit characters only —
 * callers extract the run via regex before calling this.
 */
export function luhnValid(digits: string): boolean {
  let sum = 0;
  let shouldDouble = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let digit = digits.charCodeAt(i) - 48; // '0'.charCodeAt(0) === 48
    if (shouldDouble) {
      digit *= 2;
      if (digit > 9) {
        digit -= 9;
      }
    }
    sum += digit;
    shouldDouble = !shouldDouble;
  }
  return sum % 10 === 0;
}

/**
 * Email: standard address shape.
 *
 * Phone: MUST have an internal separator (space, dash, dot, parentheses) or
 * a leading '+' international prefix — a bare, unbroken digit run never
 * matches here, so it can't also double-count as SSN-like or card-like
 * (metric-definitions.md D6, locked this session; the single biggest
 * source of false positives before this tightening).
 *
 * SSN-like: hyphenated only, exactly ###-##-####. A bare 9-digit run does
 * NOT match — same false-positive reasoning as phone above.
 *
 * Card-like: 13-19 contiguous digits, but a digit-count match alone is not
 * sufficient — every candidate run is additionally Luhn-validated
 * (luhnValid above) before it counts.
 */
const PII_EMAIL_RE = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/;
const PII_PHONE_RE = /(\+\d[\d\s().-]{6,16}\d)|(\(?\d{3}\)?[-.\s]\d{3}[-.\s]\d{4})/;
const PII_SSN_RE = /\b\d{3}-\d{2}-\d{4}\b/;
const PII_CARD_DIGIT_RUN_RE = /\b\d{13,19}\b/g;

/**
 * pii_density's (D6) sole detection function — returns whether ANY pattern
 * matched, never which one or the matched text itself: the metric reports
 * counts only, never a matched value (metric-definitions.md D6's output
 * constraint; verified by extending the existing no-raw-PII test).
 */
export function detectPii(text: string): boolean {
  if (PII_EMAIL_RE.test(text)) {
    return true;
  }
  if (PII_PHONE_RE.test(text)) {
    return true;
  }
  if (PII_SSN_RE.test(text)) {
    return true;
  }
  const cardCandidates = text.match(PII_CARD_DIGIT_RUN_RE) ?? [];
  return cardCandidates.some((candidate) => luhnValid(candidate));
}

/**
 * The only place MetricResult.floor is ever set. Checks whether any
 * opportunity in a metric's ACTUAL computed denominator (not the raw
 * sample — a metric's own filtering, e.g. activity_capture_rate's 7-day
 * exclusion, may drop a truncated opportunity before it ever mattered)
 * had its related notes/activities truncated at the adapter's
 * per-opportunity limit. When it did, the result's value is a lower
 * bound, not exact, even though truncation doesn't change these
 * particular metrics' arithmetic (presence-only checks can't be fooled by
 * a cap of 200+ records) — flagged anyway, as a general data-completeness
 * signal for anything downstream that reads this result.
 *
 * No-op (returns result unchanged) when status isn't 'ok', when nothing
 * was truncated at all, or when truncation happened only to
 * opportunities outside this metric's denominator.
 */
export function applyTruncationFloor(
  result: MetricResult,
  denominatorOpportunities: readonly Opportunity[],
  truncatedOpportunityIds: ReadonlySet<string>,
): MetricResult {
  if (result.status !== 'ok' || truncatedOpportunityIds.size === 0) {
    return result;
  }

  const truncatedCount = denominatorOpportunities.filter((o) => truncatedOpportunityIds.has(o.ref.id)).length;
  if (truncatedCount === 0) {
    return result;
  }

  const floorNote = `${truncatedCount} opportunit${truncatedCount === 1 ? 'y' : 'ies'} had truncated related records — value is a floor, not exact`;

  return {
    ...result,
    floor: true,
    note: result.note ? `${result.note} ${floorNote}` : floorNote,
  };
}

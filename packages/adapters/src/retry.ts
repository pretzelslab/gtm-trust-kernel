/**
 * Retry timing for rate-limited or temporarily unavailable CRM requests:
 * exponential backoff with full jitter, a server's Retry-After honoured,
 * and caps on both attempts and total time spent waiting. Pure functions;
 * the adapter that uses them does the waiting.
 */

export interface RetryPolicy {
  /** Most attempts per request, the first one included. */
  readonly maxAttempts: number;
  /** Backoff ceiling before the first retry; doubles each attempt. */
  readonly baseDelayMs: number;
  /** Longest single wait, Retry-After included. */
  readonly maxDelayMs: number;
  /** Longest total wait across one request's retries. */
  readonly maxTotalWaitMs: number;
}

/** Approved by the maintainer on 2026-10-03 (reliability batch, D1). */
export const DEFAULT_RETRY_POLICY: RetryPolicy = {
  maxAttempts: 4,
  baseDelayMs: 1_000,
  maxDelayMs: 30_000,
  maxTotalWaitMs: 60_000,
};

/** One wait before a retry, reported to SalesforceAdapterDeps.onRetry. */
export interface RetryInfo {
  /** What the server answered: an HTTP status, plus the error code when it has one. */
  readonly reason: string;
  /** The attempt about to be made (2 for the first retry). */
  readonly attempt: number;
  readonly maxAttempts: number;
  readonly delayMs: number;
}

/**
 * A Retry-After header as milliseconds: delta-seconds or an HTTP date.
 * Undefined when absent or unparsable; a date in the past is 0.
 */
export function parseRetryAfter(header: string | null, nowMs: number): number | undefined {
  if (header === null) return undefined;
  const value = header.trim();
  if (value === '') return undefined;
  if (/^\d+$/.test(value)) return Number(value) * 1000;
  // An HTTP date names its day and month; without letters, Date.parse would
  // read a malformed number such as "1.5" as a date.
  if (!/[A-Za-z]/.test(value)) return undefined;
  const date = Date.parse(value);
  if (Number.isNaN(date)) return undefined;
  return Math.max(0, date - nowMs);
}

/**
 * The wait before the next attempt, or undefined to give up. `failedAttempts`
 * counts the attempts made so far (all failed); `waitedMs` is the total
 * already waited for this request. A Retry-After is honoured exactly, never
 * shortened: if it is longer than one wait or the time left, this gives up
 * at once rather than wait and fail anyway.
 */
export function nextRetryDelay(
  policy: RetryPolicy,
  failedAttempts: number,
  waitedMs: number,
  retryAfterMs: number | undefined,
  random: () => number,
): number | undefined {
  if (failedAttempts >= policy.maxAttempts) return undefined;
  let delay: number;
  if (retryAfterMs !== undefined) {
    if (retryAfterMs > policy.maxDelayMs) return undefined;
    delay = retryAfterMs;
  } else {
    const ceiling = Math.min(policy.maxDelayMs, policy.baseDelayMs * 2 ** (failedAttempts - 1));
    delay = Math.floor(random() * ceiling);
  }
  if (waitedMs + delay > policy.maxTotalWaitMs) return undefined;
  return delay;
}

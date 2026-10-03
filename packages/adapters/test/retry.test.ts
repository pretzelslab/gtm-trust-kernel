/**
 * Retry timing (src/retry.ts): backoff with full jitter, Retry-After, and
 * the attempt and total-wait caps. Pure functions, no adapter.
 */

import { describe, expect, it } from 'vitest';
import { DEFAULT_RETRY_POLICY, nextRetryDelay, parseRetryAfter } from '../src/retry.js';

const P = DEFAULT_RETRY_POLICY;
const max = () => 0.999999;
const zero = () => 0;

describe('DEFAULT_RETRY_POLICY', () => {
  it('is 4 attempts, 1s base, 30s per wait, 60s in total', () => {
    expect(P).toEqual({ maxAttempts: 4, baseDelayMs: 1000, maxDelayMs: 30000, maxTotalWaitMs: 60000 });
  });
});

describe('parseRetryAfter', () => {
  const now = Date.parse('2026-10-03T12:00:00Z');

  it.each([
    ['7', 7000],
    [' 0 ', 0],
    ['Sat, 03 Oct 2026 12:00:05 GMT', 5000],
    ['Sat, 03 Oct 2026 11:59:00 GMT', 0],
  ])('reads %j as %i ms', (header, ms) => {
    expect(parseRetryAfter(header, now)).toBe(ms);
  });

  it.each([[null], [''], ['soon'], ['-3'], ['1.5']])('ignores %j', (header) => {
    expect(parseRetryAfter(header, now)).toBeUndefined();
  });
});

describe('nextRetryDelay', () => {
  it('jitters within base * 2^(n-1), doubling each attempt', () => {
    expect(nextRetryDelay(P, 1, 0, undefined, zero)).toBe(0);
    expect(nextRetryDelay(P, 1, 0, undefined, max)).toBe(999);
    expect(nextRetryDelay(P, 2, 0, undefined, max)).toBe(1999);
    expect(nextRetryDelay(P, 3, 0, undefined, max)).toBe(3999);
  });

  it('never waits longer than maxDelayMs from backoff alone', () => {
    const wide = { ...P, maxAttempts: 20, maxTotalWaitMs: 10_000_000 };
    expect(nextRetryDelay(wide, 10, 0, undefined, max)).toBe(29999);
  });

  it('gives up once maxAttempts have been made', () => {
    expect(nextRetryDelay(P, 3, 0, undefined, zero)).toBe(0);
    expect(nextRetryDelay(P, 4, 0, undefined, zero)).toBeUndefined();
  });

  it('honours Retry-After exactly, ignoring jitter', () => {
    expect(nextRetryDelay(P, 1, 0, 7000, max)).toBe(7000);
    expect(nextRetryDelay(P, 1, 0, 0, max)).toBe(0);
  });

  it('gives up at once when Retry-After is longer than one wait may be', () => {
    expect(nextRetryDelay(P, 1, 0, 30_000, zero)).toBe(30_000);
    expect(nextRetryDelay(P, 1, 0, 30_001, zero)).toBeUndefined();
  });

  it('gives up at once when the wait would pass the total-wait cap', () => {
    expect(nextRetryDelay(P, 2, 40_000, 20_000, zero)).toBe(20_000);
    expect(nextRetryDelay(P, 2, 40_000, 20_001, zero)).toBeUndefined();
    expect(nextRetryDelay(P, 3, 59_000, undefined, max)).toBeUndefined();
  });
});

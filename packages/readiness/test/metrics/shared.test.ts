import { describe, expect, it } from 'vitest';
import type { Opportunity, RecordRef } from '@gtm-trust-kernel/adapters/model/canonical.js';
import { applyTruncationFloor, normalizeDomain, wholeCalendarMonthsBetween } from '../../src/metrics/shared.js';
import type { MetricResult } from '../../src/metrics/types.js';

describe('normalizeDomain', () => {
  /**
   * This table is the behavioral contract for normalizeDomain. normalizeDomain
   * delegates to tldts's getDomain (metrics/shared.ts) rather than hand-rolling
   * trim/lowercase/protocol-strip/etc. A tldts version bump that changes the
   * expected output of any row here must be reviewed and the row updated
   * deliberately — never auto-updated to match whatever tldts now returns.
   */
  const cases: ReadonlyArray<[string, string | null]> = [
    ['sales.acme.com', 'acme.com'],
    ['ACME.COM', 'acme.com'],
    ['https://www.acme.com/path', 'acme.com'],
    ['acme.co.uk', 'acme.co.uk'],
    ['sub.acme.co.uk', 'acme.co.uk'],
    ['acme.com.au', 'acme.com.au'],
    ['192.168.1.1', null],
    ['localhost', null],
    ['', null],
    ['n/a', null],
    ['acme.com.', 'acme.com'],
    // allowPrivateDomains: true keeps a PSL private-section host's subdomain
    // as part of the registrable unit, so tenants on a shared PaaS host
    // don't collapse into one false-positive duplicate_account_rate group.
    ['acme.herokuapp.com', 'acme.herokuapp.com'],
    ['beta.herokuapp.com', 'beta.herokuapp.com'],
    ['someone.github.io', 'someone.github.io'],
  ];

  it.each(cases)('normalizeDomain(%j) -> %j', (input, expected) => {
    expect(normalizeDomain(input)).toBe(expected);
  });

  it('returns null for undefined input', () => {
    expect(normalizeDomain(undefined)).toBeNull();
  });

  it('normalizes a denylist-style entry the same way as a sampled domain (case + whitespace)', () => {
    expect(normalizeDomain(' Gmail.COM ')).toBe('gmail.com');
    expect(normalizeDomain('gmail.com')).toBe('gmail.com');
  });

  it('does not collapse distinct tenants on a shared PaaS host to the same domain', () => {
    expect(normalizeDomain('acme.herokuapp.com')).not.toBe(normalizeDomain('beta.herokuapp.com'));
  });
});

describe('wholeCalendarMonthsBetween', () => {
  it('matches the definitional example: Jan 15 -> Jun 20 is 5 whole months (the Jan-15 boundary is reached in June)', () => {
    expect(wholeCalendarMonthsBetween('2026-01-15T00:00:00.000Z', '2026-06-20T00:00:00.000Z')).toBe(5);
  });

  it('drops the partial month: Jan 15 -> Jun 10 is 4, not 5 (the Jan-15 boundary is not yet reached in June)', () => {
    expect(wholeCalendarMonthsBetween('2026-01-15T00:00:00.000Z', '2026-06-10T00:00:00.000Z')).toBe(4);
  });

  it('same day of month is exactly one whole month: Jan 15 -> Feb 15', () => {
    expect(wholeCalendarMonthsBetween('2026-01-15T00:00:00.000Z', '2026-02-15T00:00:00.000Z')).toBe(1);
  });

  it('month-end boundary: Jan 31 -> Feb 28 (non-leap year) is 0, since February has no 31st to complete the month on', () => {
    expect(wholeCalendarMonthsBetween('2027-01-31T00:00:00.000Z', '2027-02-28T00:00:00.000Z')).toBe(0);
  });

  it('leap year boundary: Feb 29, 2028 -> Feb 28, 2029 is 11, not 12, since 2029 has no 29th to complete the year on', () => {
    expect(wholeCalendarMonthsBetween('2028-02-29T00:00:00.000Z', '2029-02-28T00:00:00.000Z')).toBe(11);
  });

  it('is floored at 0 rather than going negative when later is before earlier', () => {
    expect(wholeCalendarMonthsBetween('2026-06-20T00:00:00.000Z', '2026-01-15T00:00:00.000Z')).toBe(0);
  });
});

describe('applyTruncationFloor', () => {
  function ref(id: string): RecordRef {
    return { crm: 'mock', orgId: 'org-shared-test', objectType: 'opportunity', id };
  }

  function opp(id: string): Opportunity {
    return {
      ref: ref(id),
      accountRef: { crm: 'mock', orgId: 'org-shared-test', objectType: 'account', id: 'acc-1' },
      name: `Deal ${id}`,
      stage: 'discovery',
      stageConfidence: 'mapped',
      vendorStageLabel: 'Discovery',
      isClosed: false,
      contactLinks: [],
      createdAt: '2026-01-01T00:00:00.000Z',
      modifiedAt: '2026-01-01T00:00:00.000Z',
      concurrencyToken: `tok-${id}`,
    };
  }

  const okResult: MetricResult = {
    metric: 'note_coverage_rate',
    status: 'ok',
    value: 0.5,
    sampleSize: 2,
    lowConfidence: true,
  };

  it('is a no-op when status is not ok', () => {
    const notOk: MetricResult = { ...okResult, status: 'not_applicable', value: null };
    const result = applyTruncationFloor(notOk, [opp('a')], new Set(['a']));
    expect(result).toEqual(notOk);
  });

  it('is a no-op when nothing was truncated', () => {
    const result = applyTruncationFloor(okResult, [opp('a'), opp('b')], new Set());
    expect(result).toEqual(okResult);
  });

  it('is a no-op when truncation happened only outside the denominator', () => {
    const result = applyTruncationFloor(okResult, [opp('a'), opp('b')], new Set(['c']));
    expect(result).toEqual(okResult);
  });

  it('sets floor: true and a singular note when exactly one denominator opportunity was truncated', () => {
    const result = applyTruncationFloor(okResult, [opp('a'), opp('b')], new Set(['a']));
    expect(result).toEqual({
      ...okResult,
      floor: true,
      note: '1 opportunity had truncated related records — value is a floor, not exact',
    });
  });

  it('sets floor: true and a plural note when more than one denominator opportunity was truncated', () => {
    const result = applyTruncationFloor(okResult, [opp('a'), opp('b'), opp('c')], new Set(['a', 'c']));
    expect(result.floor).toBe(true);
    expect(result.note).toBe('2 opportunities had truncated related records — value is a floor, not exact');
  });

  it('appends to an existing note rather than overwriting it', () => {
    const withNote: MetricResult = { ...okResult, note: 'some pre-existing note' };
    const result = applyTruncationFloor(withNote, [opp('a')], new Set(['a']));
    expect(result.note).toBe('some pre-existing note 1 opportunity had truncated related records — value is a floor, not exact');
  });
});

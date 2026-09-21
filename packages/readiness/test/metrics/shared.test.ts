import { describe, expect, it } from 'vitest';
import { normalizeDomain } from '../../src/metrics/shared.js';

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

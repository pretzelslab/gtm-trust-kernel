/**
 * The org's daily API limit, against the in-memory fake API: read from
 * Sforce-Limit-Info on each response (or /limits when no response carried
 * it), reported in capabilities().rateLimit, and a stop before any call
 * that would eat into the 10% reserve kept for the org's other tools.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { DAILY_LIMIT_RESERVE_FRACTION, dailyLimitReserve, parseLimitInfo } from '../src/salesforce.js';
import { AdapterError } from '../src/types.js';
import { installFakeSalesforce, sfId } from './support/fakeSalesforce.js';
import { registerPreflightOrg } from './support/preflightOrg.js';

const OPP = { Id: sfId('006', 1), Name: 'Deal', StageName: 'Prospecting', IsClosed: false, IsWon: false, CreatedDate: '2026-01-01T00:00:00.000+0000', SystemModstamp: '2026-09-01T00:00:00.000+0000' };

afterEach(() => {
  vi.unstubAllGlobals();
});

function org() {
  const sf = installFakeSalesforce();
  registerPreflightOrg(sf);
  sf.on(/FROM Opportunity /, [OPP]);
  sf.on(/FROM OpportunityContactRole/, []);
  return sf;
}

const apiCalls = (urls: readonly string[]) => urls.filter((u) => u !== '/services/oauth2/token').length;

describe('parseLimitInfo', () => {
  it.each([
    ['api-usage=18/15000', { used: 18, max: 15000 }],
    ['api-usage=18/15000; per-app-api-usage=2/100(appName=x)', { used: 18, max: 15000 }],
    ['per-app-api-usage=2/100(appName=x), api-usage=7/5000', { used: 7, max: 5000 }],
  ])('reads %j', (header, usage) => {
    expect(parseLimitInfo(header)).toEqual(usage);
  });

  it.each([[null], [''], ['per-app-api-usage=2/100(appName=x)'], ['api-usage=5/0'], ['api-usage=a/b'], ['api-usage=5/100x']])(
    'ignores %j',
    (header) => {
      expect(parseLimitInfo(header)).toBeUndefined();
    },
  );
});

describe('dailyLimitReserve', () => {
  it('keeps 10% of the daily maximum, rounded up', () => {
    expect(DAILY_LIMIT_RESERVE_FRACTION).toBe(0.1);
    expect(dailyLimitReserve(15000)).toBe(1500);
    expect(dailyLimitReserve(15001)).toBe(1501);
  });
});

describe('SalesforceAdapter daily API limit', () => {
  it('reports a static estimate until the org has reported its usage', () => {
    expect(org().adapter().capabilities().rateLimit).toEqual({ kind: 'daily_quota', value: 15000, source: 'estimate' });
  });

  it("reports the org's own maximum and calls left from Sforce-Limit-Info", async () => {
    const sf = org();
    sf.apiUsage(100, 20000);
    const adapter = sf.adapter();
    await adapter.listOpportunities({ limit: 200 });
    // Two calls: the listing and its contact-role batch.
    expect(adapter.capabilities().rateLimit).toEqual({
      kind: 'daily_quota',
      value: 20000,
      remaining: 20000 - 102,
      reserve: 2000,
      source: 'org',
    });
  });

  it('reads /limits once at the end of preflight when no response carried the header', async () => {
    const sf = org();
    sf.apiUsage(null);
    const adapter = sf.adapter();
    const result = await adapter.preflight();
    expect(result.failures).toEqual([]);
    expect(result.apiCallsConsumed).toBe(12);
    expect(sf.urls.filter((u) => u.endsWith('/limits/'))).toHaveLength(1);
    expect(adapter.capabilities().rateLimit).toEqual({ kind: 'daily_quota', value: 15000, remaining: 14990, reserve: 1500, source: 'org' });
  });

  it('does not read /limits in preflight when the header already reported usage', async () => {
    const sf = org();
    await sf.adapter().preflight();
    expect(sf.urls.some((u) => u.endsWith('/limits/'))).toBe(false);
  });

  it('fails preflight, after running its checks, when the calls left are already at the reserve', async () => {
    const sf = org();
    sf.apiUsage(13490);
    const adapter = sf.adapter();
    const result = await adapter.preflight();
    expect(apiCalls(sf.urls)).toBe(11);
    expect(result.failures).toEqual([
      {
        check: 'api_limit',
        message:
          'Stopped to leave Salesforce API calls for your other tools: this org has 1500 of its 15000 daily calls left, and this tool keeps 1500 (10%) in reserve. Nothing was written. Try again once the daily limit frees up.',
      },
    ]);
  });

  it('stops before sending a call once the calls left reach the reserve', async () => {
    const sf = org();
    sf.apiUsage(13498);
    const adapter = sf.adapter();
    await adapter.listOpportunities({ limit: 200 }); // 13500 used: 1500 left, the reserve.
    const before = sf.urls.length;
    const err = (await adapter.listOpportunities({ limit: 200 }).catch((e: unknown) => e)) as AdapterError;
    expect(err).toBeInstanceOf(AdapterError);
    expect(err.kind).toBe('rate_limit');
    expect(err.retryable).toBe(false);
    expect(err.message).toBe(
      'Stopped to leave Salesforce API calls for your other tools: this org has 1500 of its 15000 daily calls left, and this tool keeps 1500 (10%) in reserve. Nothing was written. Try again once the daily limit frees up.',
    );
    expect(sf.urls.length).toBe(before);
  });

  it('keeps going while the calls left stay above the reserve', async () => {
    const sf = org();
    sf.apiUsage(13496);
    const adapter = sf.adapter();
    await adapter.listOpportunities({ limit: 200 });
    expect(adapter.capabilities().rateLimit.remaining).toBe(1502);
    await expect(adapter.listOpportunities({ limit: 200 }).then(() => 'ok')).resolves.toBe('ok');
    expect(adapter.capabilities().rateLimit.remaining).toBe(1500);
  });

  it('lets health() through at the reserve and updates usage from /limits', async () => {
    const sf = org();
    sf.apiUsage(14000);
    const adapter = sf.adapter();
    await adapter.listOpportunities({ limit: 200 }).catch(() => undefined);
    await expect(adapter.health()).resolves.toEqual({ ok: true });
    sf.apiUsage(null);
    await adapter.health();
    expect(adapter.capabilities().rateLimit.remaining).toBe(14990);
  });
});

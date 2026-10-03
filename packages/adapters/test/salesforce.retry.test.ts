/**
 * SalesforceAdapter retry on throttles, against the in-memory fake API:
 * what is retried (429, 503, concurrent REQUEST_LIMIT_EXCEEDED), what
 * fails at once (the daily limit, auth and other 4xx), the waits taken,
 * and the error when retries run out. Waits are recorded, never slept.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { DAILY_LIMIT_MESSAGE, type RetryInfo } from '../src/salesforce.js';
import { AdapterError } from '../src/types.js';
import { installFakeSalesforce, sfId, type QueryResult } from './support/fakeSalesforce.js';

const OPP = { Id: sfId('006', 1), Name: 'Deal', StageName: 'Prospecting', IsClosed: false, IsWon: false, CreatedDate: '2026-01-01T00:00:00.000+0000', SystemModstamp: '2026-09-01T00:00:00.000+0000' };

const CONCURRENT = { status: 403, body: '[{"message":"ConcurrentPerOrgLongTxn Limit exceeded.","errorCode":"REQUEST_LIMIT_EXCEEDED"}]' };
const DAILY = { status: 403, body: '[{"message":"TotalRequests Limit exceeded.","errorCode":"REQUEST_LIMIT_EXCEEDED"}]' };
const SECRET_BODY = '[{"errorCode":"FAKE","message":"echoes 006SECRETRECORD"}]';

afterEach(() => {
  vi.unstubAllGlobals();
});

/** Answers the Opportunity listing with `failures` in order, then the record. */
function sequence(...failures: QueryResult[]) {
  const sf = installFakeSalesforce();
  let calls = 0;
  sf.on(/FROM Opportunity /, () => failures[calls++] ?? [OPP]);
  sf.on(/FROM OpportunityContactRole/, []);
  const waits: number[] = [];
  const retries: RetryInfo[] = [];
  const adapter = sf.adapter({}, {
    sleep: async (ms) => {
      waits.push(ms);
    },
    random: () => 0.5,
    onRetry: (info) => retries.push(info),
  });
  return { sf, adapter, waits, retries, calls: () => calls };
}

const list = (adapter: ReturnType<typeof sequence>['adapter']) =>
  adapter.listOpportunities({ limit: 200 }).catch((e: unknown) => e);

describe('SalesforceAdapter retry', () => {
  it('retries a 429 and returns the page once it succeeds', async () => {
    const t = sequence({ status: 429 });
    const page = await t.adapter.listOpportunities({ limit: 200 });
    expect(page.items).toHaveLength(1);
    expect(t.calls()).toBe(2);
    expect(t.waits).toEqual([500]);
    expect(t.retries).toEqual([{ reason: '429', attempt: 2, maxAttempts: 4, delayMs: 500 }]);
  });

  it('backs off exponentially with jitter across attempts', async () => {
    const t = sequence({ status: 429 }, { status: 429 }, { status: 429 });
    await t.adapter.listOpportunities({ limit: 200 });
    expect(t.waits).toEqual([500, 1000, 2000]);
  });

  it('waits exactly the Retry-After the server sends', async () => {
    const t = sequence({ status: 429, headers: { 'Retry-After': '3' } });
    await t.adapter.listOpportunities({ limit: 200 });
    expect(t.waits).toEqual([3000]);
  });

  it('retries a 503', async () => {
    const t = sequence({ status: 503 });
    await t.adapter.listOpportunities({ limit: 200 });
    expect(t.calls()).toBe(2);
    expect(t.retries[0]!.reason).toBe('503');
  });

  it('retries a concurrent-request REQUEST_LIMIT_EXCEEDED', async () => {
    const t = sequence(CONCURRENT);
    await t.adapter.listOpportunities({ limit: 200 });
    expect(t.calls()).toBe(2);
    expect(t.retries[0]!.reason).toBe('403 REQUEST_LIMIT_EXCEEDED, concurrent requests');
  });

  it('fails the daily REQUEST_LIMIT_EXCEEDED at once, as a non-retryable rate_limit', async () => {
    const t = sequence(DAILY);
    const err = (await list(t.adapter)) as AdapterError;
    expect(err).toBeInstanceOf(AdapterError);
    expect(err.kind).toBe('rate_limit');
    expect(err.retryable).toBe(false);
    expect(err.message).toBe(DAILY_LIMIT_MESSAGE);
    expect(t.calls()).toBe(1);
    expect(t.waits).toEqual([]);
  });

  it('stops after 4 attempts with a plain message and no response body', async () => {
    const throttled = { status: 429, body: SECRET_BODY };
    const t = sequence(throttled, throttled, throttled, throttled, throttled);
    const err = (await list(t.adapter)) as AdapterError;
    expect(t.calls()).toBe(4);
    expect(err.kind).toBe('rate_limit');
    expect(err.retryable).toBe(true);
    expect(err.message).toBe('Salesforce kept rate-limiting requests (429) after 4 attempts over 4s. Nothing was written. Try again later.');
    expect(err.message).not.toContain('SECRET');
  });

  it('reports a 503 that never clears as unavailable, retryable', async () => {
    const t = sequence({ status: 503 }, { status: 503 }, { status: 503 }, { status: 503 });
    const err = (await list(t.adapter)) as AdapterError;
    expect(err.kind).toBe('unknown');
    expect(err.retryable).toBe(true);
    expect(err.message).toMatch(/^Salesforce kept answering 503 \(service unavailable\) after 4 attempts/);
  });

  it('gives up at once when Retry-After is longer than one wait may be', async () => {
    const t = sequence({ status: 429, headers: { 'Retry-After': '120' } });
    const err = (await list(t.adapter)) as AdapterError;
    expect(t.calls()).toBe(1);
    expect(t.waits).toEqual([]);
    expect(err.kind).toBe('rate_limit');
    expect(err.retryAfterMs).toBe(120_000);
  });

  it('gives up before the total wait would pass 60s', async () => {
    const wait = { status: 429, headers: { 'Retry-After': '25' } };
    const t = sequence(wait, wait, wait, wait);
    const err = (await list(t.adapter)) as AdapterError;
    expect(t.waits).toEqual([25_000, 25_000]);
    expect(t.calls()).toBe(3);
    expect(err.message).toContain('after 3 attempts over 50s');
  });

  it.each([
    ['400', { status: 400 }, 'unknown'],
    ['403 permission', { status: 403 }, 'permission'],
    ['404', { status: 404 }, 'unknown'],
    ['500', { status: 500 }, 'unknown'],
  ] as const)('does not retry a %s', async (_label, answer, kind) => {
    const t = sequence(answer);
    const err = (await list(t.adapter)) as AdapterError;
    expect(err.kind).toBe(kind);
    expect(t.calls()).toBe(1);
    expect(t.waits).toEqual([]);
  });

  it('does not retry a 401 beyond the one token refresh', async () => {
    const t = sequence({ status: 401 }, { status: 401 });
    const err = (await list(t.adapter)) as AdapterError;
    expect(err.kind).toBe('auth');
    expect(t.calls()).toBe(2);
    expect(t.waits).toEqual([]);
    expect(t.sf.urls.filter((u) => u === '/services/oauth2/token')).toHaveLength(2);
  });

  it('retries a throttled token request', async () => {
    const sf = installFakeSalesforce();
    sf.tokenAnswers({ status: 503 }, { status: 429 });
    sf.on(/FROM Opportunity /, [OPP]);
    sf.on(/FROM OpportunityContactRole/, []);
    const waits: number[] = [];
    const adapter = sf.adapter({}, { sleep: async (ms) => void waits.push(ms), random: () => 0 });
    await adapter.listOpportunities({ limit: 200 });
    expect(sf.urls.filter((u) => u === '/services/oauth2/token')).toHaveLength(3);
    expect(waits).toEqual([0, 0]);
  });

  it('does not retry a rejected token request', async () => {
    const sf = installFakeSalesforce();
    sf.tokenAnswers({ status: 400, body: '{"error":"invalid_client_id"}' });
    const err = (await sf.adapter().listOpportunities({ limit: 200 }).catch((e: unknown) => e)) as AdapterError;
    expect(err.kind).toBe('auth');
    expect(sf.urls.filter((u) => u === '/services/oauth2/token')).toHaveLength(1);
  });

  it('retries only the throttled page of a paged query', async () => {
    const sf = installFakeSalesforce();
    sf.on(/FROM Opportunity /, { pages: [[OPP], [{ ...OPP, Id: sfId('006', 2) }]] });
    sf.on(/FROM OpportunityContactRole/, []);
    const adapter = sf.adapter();
    const first = await adapter.listOpportunities({ limit: 200 });
    expect(first.nextCursor).toBeDefined();

    const realFetch = globalThis.fetch;
    let throttledOnce = false;
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input instanceof Request ? input.url : input);
      if (url.includes('/query/01gFAKE') && !throttledOnce) {
        throttledOnce = true;
        return new Response('', { status: 429 });
      }
      return realFetch(input, init);
    }));
    const second = await adapter.listOpportunities({ limit: 200, cursor: first.nextCursor! });
    expect(throttledOnce).toBe(true);
    expect(second.items.map((o) => o.ref.id)).toEqual([sfId('006', 2)]);
    // The retry re-sent the locator, not a new Opportunity query.
    expect(sf.queries.filter((q) => q.includes('FROM Opportunity '))).toHaveLength(1);
  });
});

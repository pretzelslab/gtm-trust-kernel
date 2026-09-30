/**
 * An in-memory stand-in for the Salesforce REST API, for unit-testing
 * SalesforceAdapter without a real org. Replaces global `fetch` (via
 * vi.stubGlobal) with a router that answers:
 *
 *  - POST /services/oauth2/token: a fixed access token.
 *  - GET  /services/data/<v>/query?q=<soql>: the first registered handler
 *    whose pattern matches the decoded SOQL. A handler returns records, or
 *    a full SoqlResponse for paging, or an HTTP status to simulate errors.
 *  - GET  a nextRecordsUrl the harness handed out: the queued next page.
 *  - GET  /services/data/<v>/limits/: an empty object (health()).
 *  - GET  /services/data/<v>/sobjects/ContentNote/<id>/Content: the body
 *    registered with noteContent(id, body).
 *
 * Every SOQL string the adapter sends is recorded in `queries`, in order,
 * so tests can assert what was asked as well as what was mapped. A query
 * with no matching handler fails the test loudly rather than returning an
 * empty result, so a new query can't pass by accident.
 */

import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { vi } from 'vitest';
import type { RecordRef } from '../../src/model/canonical.js';
import { SalesforceAdapter, type SalesforceConfig } from '../../src/salesforce.js';

export const INSTANCE_URL = 'https://example.my.salesforce.com';
export const API_VERSION = 'v62.0';

export type QueryResult =
  | readonly Record<string, unknown>[]
  | { readonly pages: readonly (readonly Record<string, unknown>[])[] }
  | { readonly status: number; readonly body?: string; readonly headers?: Record<string, string> };

export type QueryHandler = (soql: string) => QueryResult;

export interface FakeSalesforce {
  /** Answer any SOQL matching `pattern` (tested against the whole decoded query). */
  on(pattern: RegExp, result: QueryResult | QueryHandler): void;
  /** Register an Enhanced Note's full body, served from its Content endpoint. */
  noteContent(id: string, body: string): void;
  /** Every SOQL string sent, in order. */
  readonly queries: string[];
  /** Every URL fetched (token, query, queryMore, limits), in order. */
  readonly urls: string[];
  /** A fresh adapter wired to this fake, with a throwaway token cache. */
  adapter(overrides?: Partial<SalesforceConfig>): SalesforceAdapter;
}

function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...headers } });
}

export function installFakeSalesforce(): FakeSalesforce {
  const handlers: { pattern: RegExp; result: QueryResult | QueryHandler }[] = [];
  const queries: string[] = [];
  const urls: string[] = [];
  const contents = new Map<string, string>();
  const pendingPages = new Map<string, { rest: readonly (readonly Record<string, unknown>[])[] }>();
  let locatorSeq = 0;

  function page(records: readonly Record<string, unknown>[], rest: readonly (readonly Record<string, unknown>[])[]): Response {
    if (rest.length === 0) return json({ totalSize: records.length, done: true, records });
    locatorSeq += 1;
    const nextRecordsUrl = `/services/data/${API_VERSION}/query/01gFAKE-${locatorSeq}`;
    pendingPages.set(nextRecordsUrl, { rest });
    return json({ totalSize: records.length, done: false, nextRecordsUrl, records });
  }

  function answer(result: QueryResult): Response {
    if (Array.isArray(result)) return page(result as readonly Record<string, unknown>[], []);
    if ('pages' in result) {
      const [first = [], ...rest] = result.pages;
      return page(first, rest);
    }
    const r = result as { status: number; body?: string; headers?: Record<string, string> };
    return new Response(r.body ?? '[{"errorCode":"FAKE","message":"fake error"}]', { status: r.status, headers: r.headers });
  }

  const fakeFetch = async (input: string | URL | Request, _init?: RequestInit): Promise<Response> => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
    urls.push(url.pathname + url.search);

    if (url.pathname === '/services/oauth2/token') {
      return json({ access_token: 'FAKE_TOKEN', instance_url: INSTANCE_URL });
    }
    if (url.pathname === `/services/data/${API_VERSION}/limits/`) return json({});
    const content = new RegExp(`^/services/data/${API_VERSION}/sobjects/ContentNote/([A-Za-z0-9]+)/Content$`).exec(url.pathname);
    if (content) {
      const body = contents.get(content[1]!);
      if (body === undefined) throw new Error(`fakeSalesforce: no content registered for ContentNote ${content[1]}`);
      return new Response(body, { status: 200, headers: { 'Content-Type': 'text/html' } });
    }

    const queued = pendingPages.get(url.pathname);
    if (queued) {
      pendingPages.delete(url.pathname);
      const [next = [], ...rest] = queued.rest;
      return page(next, rest);
    }

    if (url.pathname === `/services/data/${API_VERSION}/query`) {
      const soql = url.searchParams.get('q') ?? '';
      queries.push(soql);
      const handler = handlers.find((h) => h.pattern.test(soql));
      if (!handler) throw new Error(`fakeSalesforce: no handler for SOQL: ${soql}`);
      const result = typeof handler.result === 'function' ? handler.result(soql) : handler.result;
      return answer(result);
    }

    throw new Error(`fakeSalesforce: unexpected URL ${url.href}`);
  };

  vi.stubGlobal('fetch', vi.fn(fakeFetch));

  return {
    on(pattern, result) {
      handlers.push({ pattern, result });
    },
    noteContent(id, body) {
      contents.set(id, body);
    },
    queries,
    urls,
    adapter(overrides = {}) {
      const cacheDir = mkdtempSync(path.join(tmpdir(), 'gtk-sf-test-'));
      return new SalesforceAdapter({
        clientId: 'id',
        clientSecret: 'secret',
        instanceUrl: INSTANCE_URL,
        apiVersion: API_VERSION,
        tokenCachePath: path.join(cacheDir, 'token.json'),
        ...overrides,
      });
    },
  };
}

/** Salesforce-shaped 18-character ids: prefix + zero-padded counter. */
export function sfId(prefix: string, n: number): string {
  return `${prefix}${String(n).padStart(18 - prefix.length, '0')}`;
}

/** A RecordRef as SalesforceAdapter builds them for this fake's instance. */
export function sfRef(objectType: RecordRef['objectType'], id: string): RecordRef {
  return { crm: 'salesforce', orgId: new URL(INSTANCE_URL).host, objectType, id };
}

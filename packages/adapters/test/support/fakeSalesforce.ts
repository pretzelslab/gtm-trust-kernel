/**
 * An in-memory stand-in for the Salesforce REST API, for unit-testing
 * SalesforceAdapter without a real org. Replaces global `fetch` (via
 * vi.stubGlobal) with a router that answers:
 *
 *  - POST /services/oauth2/token: a fixed access token, after any error
 *    answers queued with tokenAnswers().
 *  - GET  /services/data/<v>/query?q=<soql>: the first registered handler
 *    whose pattern matches the decoded SOQL. A handler returns records, or
 *    a full SoqlResponse for paging, a COUNT() total, or an HTTP status to
 *    simulate errors.
 *  - GET  a nextRecordsUrl the harness handed out: the queued next page.
 *  - GET  /services/data/: the API version list (v61.0 and v62.0 unless
 *    set with apiVersions()).
 *  - GET  /services/data/<v>/sobjects/: the global describe registered
 *    with globalDescribe(); unregistered fails.
 *  - GET  /services/data/<v>/limits/: DailyApiRequests, Max 15000 and
 *    Remaining 14990 (health()).
 *  - GET  /services/data/<v>/sobjects/ContentNote/<id>/Content: the body
 *    registered with noteContent(id, body).
 *  - GET  /services/data/<v>/sobjects/<name>/describe: the result
 *    registered with sobjectDescribe(name, result); unregistered fails.
 *    A thrown Error in the result simulates a network failure.
 *  - A parent-child subquery, SELECT Id, (SELECT ... FROM <Rel> ... LIMIT n)
 *    FROM Opportunity WHERE Id IN (...): the rows registered with
 *    subqueryRows(<Rel>, ...), checked before the regex handlers; an
 *    unregistered relationship fails like an unhandled query. The
 *    rows are grouped under each parent in the IN list by their parent
 *    field and cut to the subquery's LIMIT, in the order given (so give
 *    them in the query's ORDER BY order). Options split the parents, or a
 *    parent's child rows, into pages served from nextRecordsUrl.
 *
 * adapter() passes a no-op sleep, so retries on a throttle (429, 503,
 * concurrent REQUEST_LIMIT_EXCEEDED) don't really wait; pass deps to
 * record the waits.
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
import { SalesforceAdapter, type SalesforceAdapterDeps, type SalesforceConfig } from '../../src/salesforce.js';

export const INSTANCE_URL = 'https://example.my.salesforce.com';
export const API_VERSION = 'v62.0';

export type QueryResult =
  | readonly Record<string, unknown>[]
  | { readonly pages: readonly (readonly Record<string, unknown>[])[] }
  /** A SELECT COUNT() answer as Salesforce sends it: totalSize n, no records. */
  | { readonly count: number }
  | { readonly status: number; readonly body?: string; readonly headers?: Record<string, string> };

export type QueryHandler = (soql: string) => QueryResult;

/** Child rows for subqueryRows, or a function of the parent ids in the IN list. */
export type ChildRows = readonly Record<string, unknown>[] | ((parentIds: readonly string[]) => readonly Record<string, unknown>[]);

export interface SubqueryOptions {
  /** Parents per outer page; more come from the outer nextRecordsUrl. Default: all on one page. */
  readonly parentPageSize?: number;
  /** Child rows per page within a parent; more come from that child's nextRecordsUrl. Default: all on one page. */
  readonly childPageSize?: number;
}

export interface FakeSalesforce {
  /** Answer any SOQL matching `pattern` (tested against the whole decoded query). */
  on(pattern: RegExp, result: QueryResult | QueryHandler): void;
  /** Register an Enhanced Note's full body, served from its Content endpoint. */
  noteContent(id: string, body: string): void;
  /** Answer sobjects/<name>/describe with a describe body, an HTTP error, or a network failure. */
  sobjectDescribe(name: string, result: Record<string, unknown> | { readonly status: number; readonly body?: string } | Error): void;
  /**
   * Answer the parent-child subquery on relationship `relationship` (e.g.
   * 'Notes') from flat child rows, grouped under their parent by
   * `parentField` (e.g. 'ParentId'). See the module docblock.
   */
  subqueryRows(relationship: string, parentField: string, rows: ChildRows, options?: SubqueryOptions): void;
  /** The versions /services/data/ lists, e.g. ['61.0', '62.0']. */
  apiVersions(versions: readonly string[]): void;
  /** Answer the global describe (sobjects/) with these objects, or an HTTP error. */
  globalDescribe(result: readonly { readonly name: string; readonly queryable: boolean }[] | { readonly status: number; readonly body?: string }): void;
  /** Error answers for the token endpoint, served in order before the token. */
  tokenAnswers(...answers: readonly { readonly status: number; readonly body?: string; readonly headers?: Record<string, string> }[]): void;
  /** Every SOQL string sent, in order. */
  readonly queries: string[];
  /** Every URL fetched (token, query, queryMore, limits), in order. */
  readonly urls: string[];
  /** A fresh adapter wired to this fake, with a throwaway token cache and a no-op sleep. */
  adapter(overrides?: Partial<SalesforceConfig>, deps?: SalesforceAdapterDeps): SalesforceAdapter;
}

function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...headers } });
}

export function installFakeSalesforce(): FakeSalesforce {
  const handlers: { pattern: RegExp; result: QueryResult | QueryHandler }[] = [];
  const queries: string[] = [];
  const urls: string[] = [];
  const contents = new Map<string, string>();
  const describes = new Map<string, Record<string, unknown> | { readonly status: number; readonly body?: string } | Error>();
  const pendingPages = new Map<string, { rest: readonly (readonly Record<string, unknown>[])[] }>();
  const subqueries = new Map<string, { parentField: string; rows: ChildRows; options: SubqueryOptions }>();
  const tokenQueue: { status: number; body?: string; headers?: Record<string, string> }[] = [];
  let versionList: readonly string[] = ['61.0', '62.0'];
  let globalResult: readonly { name: string; queryable: boolean }[] | { status: number; body?: string } | undefined;
  let locatorSeq = 0;

  function chunks<T>(items: readonly T[], size: number | undefined): T[][] {
    if (!size || items.length <= size) return [items.slice()];
    const out: T[][] = [];
    for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
    return out;
  }

  function queue(rest: readonly (readonly Record<string, unknown>[])[]): string {
    locatorSeq += 1;
    const nextRecordsUrl = `/services/data/${API_VERSION}/query/01gFAKE-${locatorSeq}`;
    pendingPages.set(nextRecordsUrl, { rest });
    return nextRecordsUrl;
  }

  /** The response to a parent-child subquery, or undefined if soql isn't one; fails if its relationship isn't registered. */
  function answerSubquery(soql: string): Response | undefined {
    const m = /^SELECT Id, \(SELECT .+ FROM (\w+) .*LIMIT (\d+)\) FROM Opportunity WHERE Id IN \(([^)]*)\)$/.exec(soql);
    if (!m) return undefined;
    const registered = subqueries.get(m[1]!);
    if (!registered) throw new Error(`fakeSalesforce: no subqueryRows registered for ${m[1]}: ${soql}`);
    const limit = Number(m[2]);
    const parentIds = [...m[3]!.matchAll(/'(\w+)'/g)].map((x) => x[1]!);
    const rows = typeof registered.rows === 'function' ? registered.rows(parentIds) : registered.rows;
    const parents = parentIds.map((id) => {
      const children = rows.filter((r) => r[registered.parentField] === id).slice(0, limit);
      if (children.length === 0) return { Id: id, [m[1]!]: null };
      const [first = [], ...rest] = chunks(children, registered.options.childPageSize);
      const child = rest.length === 0
        ? { totalSize: children.length, done: true, records: first }
        : { totalSize: children.length, done: false, nextRecordsUrl: queue(rest), records: first };
      return { Id: id, [m[1]!]: child };
    });
    const [first = [], ...rest] = chunks(parents, registered.options.parentPageSize);
    return page(first, rest);
  }

  function page(records: readonly Record<string, unknown>[], rest: readonly (readonly Record<string, unknown>[])[]): Response {
    if (rest.length === 0) return json({ totalSize: records.length, done: true, records });
    return json({ totalSize: records.length, done: false, nextRecordsUrl: queue(rest), records });
  }

  function answer(result: QueryResult): Response {
    if (Array.isArray(result)) return page(result as readonly Record<string, unknown>[], []);
    if ('pages' in result) {
      const [first = [], ...rest] = result.pages;
      return page(first, rest);
    }
    if ('count' in result) return json({ totalSize: result.count, done: true, records: [] });
    const r = result as { status: number; body?: string; headers?: Record<string, string> };
    return new Response(r.body ?? '[{"errorCode":"FAKE","message":"fake error"}]', { status: r.status, headers: r.headers });
  }

  const fakeFetch = async (input: string | URL | Request, _init?: RequestInit): Promise<Response> => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
    urls.push(url.pathname + url.search);

    if (url.pathname === '/services/oauth2/token') {
      const queuedAnswer = tokenQueue.shift();
      if (queuedAnswer) return answer(queuedAnswer);
      return json({ access_token: 'FAKE_TOKEN', instance_url: INSTANCE_URL });
    }
    if (url.pathname === `/services/data/${API_VERSION}/limits/`) {
      return json({ DailyApiRequests: { Max: 15000, Remaining: 14990 } });
    }
    if (url.pathname === '/services/data/') {
      return json(versionList.map((version) => ({ label: `v${version}`, url: `/services/data/v${version}`, version })));
    }
    if (url.pathname === `/services/data/${API_VERSION}/sobjects/`) {
      if (globalResult === undefined) throw new Error('fakeSalesforce: no global describe registered');
      if ('status' in globalResult) return answer(globalResult);
      return json({ encoding: 'UTF-8', maxBatchSize: 200, sobjects: globalResult });
    }
    const content = new RegExp(`^/services/data/${API_VERSION}/sobjects/ContentNote/([A-Za-z0-9]+)/Content$`).exec(url.pathname);
    if (content) {
      const body = contents.get(content[1]!);
      if (body === undefined) throw new Error(`fakeSalesforce: no content registered for ContentNote ${content[1]}`);
      return new Response(body, { status: 200, headers: { 'Content-Type': 'text/html' } });
    }

    const describe = new RegExp(`^/services/data/${API_VERSION}/sobjects/([A-Za-z]+)/describe$`).exec(url.pathname);
    if (describe) {
      const result = describes.get(describe[1]!);
      if (result === undefined) throw new Error(`fakeSalesforce: no describe registered for ${describe[1]}`);
      if (result instanceof Error) throw result;
      if (typeof result.status === 'number') return answer(result as { status: number; body?: string });
      return json(result);
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
      const sub = answerSubquery(soql);
      if (sub) return sub;
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
    sobjectDescribe(name, result) {
      describes.set(name, result);
    },
    subqueryRows(relationship, parentField, rows, options = {}) {
      subqueries.set(relationship, { parentField, rows, options });
    },
    apiVersions(versions) {
      versionList = versions;
    },
    globalDescribe(result) {
      globalResult = result;
    },
    tokenAnswers(...answers) {
      tokenQueue.push(...answers);
    },
    queries,
    urls,
    adapter(overrides = {}, deps = {}) {
      const cacheDir = mkdtempSync(path.join(tmpdir(), 'gtk-sf-test-'));
      return new SalesforceAdapter({
        clientId: 'id',
        clientSecret: 'secret',
        instanceUrl: INSTANCE_URL,
        apiVersion: API_VERSION,
        tokenCachePath: path.join(cacheDir, 'token.json'),
        ...overrides,
      }, { sleep: async () => {}, ...deps });
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

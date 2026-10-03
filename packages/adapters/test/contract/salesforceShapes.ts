/**
 * The Salesforce response contract: the response shapes SalesforceAdapter
 * depends on, checked against whatever answered its requests. The same
 * checks run against the in-memory fake (salesforce.contract.test.ts, in
 * every CI run), so the fake can't drift from what the adapter reads, and
 * against a real org (salesforce.live.test.ts, opt-in).
 *
 * What is checked, per response:
 *  - Query page (first page or a nextRecordsUrl page, outer or child):
 *    totalSize is a number, done a boolean, records an array, and
 *    nextRecordsUrl a non-empty string whenever done is false.
 *  - Field names: every row has a key for every field its SELECT named
 *    (the value may be null; the key must be there). The field list comes
 *    from the SOQL the adapter actually sent, so it can't go stale.
 *  - Parent-child subquery: each parent row has a key for each subquery's
 *    relationship, and its value is null (no child rows) or a query page
 *    whose rows have the subquery's fields. Not {} and not missing.
 *  - SELECT COUNT(): totalSize is a whole number and records is empty.
 *  - sobjects/<name>/describe: `queryable` is a boolean; `fields`, when
 *    present (preflight() reads it), is an array of objects with a string
 *    `name`.
 *  - /services/data/ (preflight): an array of objects with a string
 *    `version` such as "62.0".
 *  - sobjects/ global describe (preflight): `sobjects` is an array of
 *    objects with a string `name` and a boolean `queryable`.
 *  - limits/ (health()): DailyApiRequests has numeric Max and Remaining.
 */

export interface RecordedResponse {
  /** Path and query string, for messages. */
  readonly path: string;
  readonly kind: 'query' | 'describe' | 'versions' | 'global-describe' | 'limits';
  /** query: the SOQL this page answers; for a nextRecordsUrl page, the query it continues. */
  readonly soql?: string;
  /** query: 'child' for a nextRecordsUrl page of one parent's subquery rows. */
  readonly role?: 'outer' | 'child';
  /** query, first pages only: false when the page came from a nextRecordsUrl. */
  readonly firstPage?: boolean;
  readonly body: unknown;
}

export interface ResponseRecorder {
  /** Every JSON query and describe response, in order. */
  readonly responses: RecordedResponse[];
  /** Every request except the OAuth token request, in order: the API calls a run spent. */
  readonly requests: string[];
  /** Every Sforce-Limit-Info response header seen (e.g. "api-usage=18/15000"), in order. */
  readonly limitInfo: string[];
  /** Put back the fetch that was in place before recording started. */
  restore(): void;
}

/**
 * Wrap the current global fetch (the fake's, or the real one) and record
 * what the adapter received. Install after the fake, if any.
 */
export function recordSalesforceResponses(): ResponseRecorder {
  const inner = globalThis.fetch;
  const responses: RecordedResponse[] = [];
  const requests: string[] = [];
  const limitInfo: string[] = [];
  const continuations = new Map<string, { soql: string; role: 'outer' | 'child' }>();

  const wrapped = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
    const res = await inner(input, init);
    if (url.pathname === '/services/oauth2/token') return res;
    const where = url.pathname + url.search;
    requests.push(where);
    const info = res.headers.get('Sforce-Limit-Info');
    if (info !== null) limitInfo.push(info);
    if (!res.ok || !(res.headers.get('Content-Type') ?? '').includes('application/json')) return res;
    const body: unknown = await res.clone().json();

    const soql = url.searchParams.get('q');
    const continued = continuations.get(url.pathname);
    if (/\/query$/.test(url.pathname) && soql !== null) {
      responses.push({ path: where, kind: 'query', soql, role: 'outer', firstPage: true, body });
      noteContinuations(soql, 'outer', body);
    } else if (continued) {
      responses.push({ path: where, kind: 'query', soql: continued.soql, role: continued.role, firstPage: false, body });
      noteContinuations(continued.soql, continued.role, body);
    } else if (/\/sobjects\/\w+\/describe$/.test(url.pathname)) {
      responses.push({ path: where, kind: 'describe', body });
    } else if (url.pathname === '/services/data/') {
      responses.push({ path: where, kind: 'versions', body });
    } else if (/\/sobjects\/$/.test(url.pathname)) {
      responses.push({ path: where, kind: 'global-describe', body });
    } else if (/\/limits\/?$/.test(url.pathname)) {
      responses.push({ path: where, kind: 'limits', body });
    }
    return res;
  };

  /** Remember which query each nextRecordsUrl continues, at both levels. */
  function noteContinuations(soql: string, role: 'outer' | 'child', body: unknown): void {
    if (!isObject(body)) return;
    if (typeof body.nextRecordsUrl === 'string') continuations.set(body.nextRecordsUrl, { soql, role });
    if (role !== 'outer' || !Array.isArray(body.records)) return;
    const { subqueries } = parseSelect(soql);
    for (const row of body.records) {
      if (!isObject(row)) continue;
      for (const sub of subqueries) {
        const child = row[sub.relationship];
        if (isObject(child) && typeof child.nextRecordsUrl === 'string') {
          continuations.set(child.nextRecordsUrl, { soql: sub.soql, role: 'child' });
        }
      }
    }
  }

  globalThis.fetch = wrapped as typeof fetch;
  return {
    responses,
    requests,
    limitInfo,
    restore() {
      globalThis.fetch = inner;
    },
  };
}

// ---------------------------------------------------------------------------
// SOQL SELECT-list parsing (only as much as the adapter's own queries need)
// ---------------------------------------------------------------------------

export interface ParsedSelect {
  /** Plain fields, e.g. 'Id', 'StageName'; 'COUNT()' for a count query. */
  readonly fields: readonly string[];
  readonly subqueries: readonly { readonly relationship: string; readonly fields: readonly string[]; readonly soql: string }[];
}

/** Split on commas outside parentheses. */
function splitTopLevel(list: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < list.length; i += 1) {
    const ch = list[i];
    if (ch === '(') depth += 1;
    else if (ch === ')') depth -= 1;
    else if (ch === ',' && depth === 0) {
      parts.push(list.slice(start, i).trim());
      start = i + 1;
    }
  }
  parts.push(list.slice(start).trim());
  return parts.filter((p) => p.length > 0);
}

export function parseSelect(soql: string): ParsedSelect {
  const m = /^\s*SELECT\s+/i.exec(soql);
  if (!m) throw new Error(`not a SELECT: ${soql}`);
  let depth = 0;
  let fromAt = -1;
  for (let i = m[0].length; i < soql.length; i += 1) {
    const ch = soql[i];
    if (ch === '(') depth += 1;
    else if (ch === ')') depth -= 1;
    else if (depth === 0 && /^\sFROM\s/i.test(soql.slice(i, i + 6))) {
      fromAt = i;
      break;
    }
  }
  if (fromAt < 0) throw new Error(`no FROM: ${soql}`);
  const fields: string[] = [];
  const subqueries: { relationship: string; fields: string[]; soql: string }[] = [];
  for (const item of splitTopLevel(soql.slice(m[0].length, fromAt))) {
    if (item.startsWith('(') && item.endsWith(')')) {
      const inner = item.slice(1, -1).trim();
      const rel = /\sFROM\s+(\w+)/i.exec(inner);
      if (!rel) throw new Error(`subquery without FROM: ${inner}`);
      subqueries.push({ relationship: rel[1]!, fields: [...parseSelect(inner).fields], soql: inner });
    } else {
      fields.push(item);
    }
  }
  return { fields, subqueries };
}

// ---------------------------------------------------------------------------
// Shape checks
// ---------------------------------------------------------------------------

/** What a set of responses exercised, so a test can show its coverage. */
export type ShapeSeen =
  | 'flat-query'
  | 'count'
  | 'describe'
  | 'describe-fields'
  | 'versions'
  | 'global-describe'
  | 'limits'
  | 'outer-paged'
  | 'next-page'
  | 'child-null'
  | 'child-inline'
  | 'child-paged';

export interface ShapeReport {
  /** One message per broken expectation; empty when every response conforms. */
  readonly violations: string[];
  readonly seen: Set<ShapeSeen>;
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** Checks one query page; recurses into subquery children. */
function checkQueryPage(
  body: unknown,
  fields: readonly string[],
  subqueries: ParsedSelect['subqueries'],
  where: string,
  out: ShapeReport,
): void {
  if (!isObject(body)) {
    out.violations.push(`${where}: query page is not an object`);
    return;
  }
  if (typeof body.totalSize !== 'number') out.violations.push(`${where}: totalSize is not a number`);
  if (typeof body.done !== 'boolean') out.violations.push(`${where}: done is not a boolean`);
  if (body.done === false && (typeof body.nextRecordsUrl !== 'string' || body.nextRecordsUrl.length === 0)) {
    out.violations.push(`${where}: done is false but nextRecordsUrl is not a non-empty string`);
  }
  if (!Array.isArray(body.records)) {
    out.violations.push(`${where}: records is not an array`);
    return;
  }
  body.records.forEach((row, i) => {
    const at = `${where} records[${i}]`;
    if (!isObject(row)) {
      out.violations.push(`${at}: row is not an object`);
      return;
    }
    for (const f of fields) {
      if (!Object.hasOwn(row, f)) out.violations.push(`${at}: missing field ${f}`);
    }
    for (const sub of subqueries) {
      if (!Object.hasOwn(row, sub.relationship)) {
        out.violations.push(`${at}: missing relationship ${sub.relationship}`);
        continue;
      }
      const child = row[sub.relationship];
      if (child === null) {
        out.seen.add('child-null');
        continue;
      }
      out.seen.add('child-inline');
      if (isObject(child) && child.done === false) out.seen.add('child-paged');
      checkQueryPage(child, sub.fields, [], `${at}.${sub.relationship}`, out);
    }
  });
}

export function checkSalesforceShapes(responses: readonly RecordedResponse[]): ShapeReport {
  const out: ShapeReport = { violations: [], seen: new Set() };
  for (const r of responses) {
    if (r.kind === 'describe') {
      out.seen.add('describe');
      if (!isObject(r.body) || typeof r.body.queryable !== 'boolean') {
        out.violations.push(`${r.path}: describe has no boolean queryable`);
      }
      if (isObject(r.body) && r.body.fields !== undefined) {
        out.seen.add('describe-fields');
        if (!Array.isArray(r.body.fields) || !r.body.fields.every((f) => isObject(f) && typeof f.name === 'string')) {
          out.violations.push(`${r.path}: describe fields is not an array of objects with a string name`);
        }
      }
      continue;
    }
    if (r.kind === 'versions') {
      out.seen.add('versions');
      if (!Array.isArray(r.body) || !r.body.every((v) => isObject(v) && typeof v.version === 'string' && /^\d+\.\d+$/.test(v.version))) {
        out.violations.push(`${r.path}: versions is not an array of objects with a string version like "62.0"`);
      }
      continue;
    }
    if (r.kind === 'global-describe') {
      out.seen.add('global-describe');
      const sobjects = isObject(r.body) ? r.body.sobjects : undefined;
      if (!Array.isArray(sobjects) || !sobjects.every((o) => isObject(o) && typeof o.name === 'string' && typeof o.queryable === 'boolean')) {
        out.violations.push(`${r.path}: sobjects is not an array of objects with a string name and a boolean queryable`);
      }
      continue;
    }
    if (r.kind === 'limits') {
      out.seen.add('limits');
      const daily = isObject(r.body) ? r.body.DailyApiRequests : undefined;
      if (!isObject(daily) || typeof daily.Max !== 'number' || typeof daily.Remaining !== 'number') {
        out.violations.push(`${r.path}: DailyApiRequests has no numeric Max and Remaining`);
      }
      continue;
    }
    const parsed = parseSelect(r.soql ?? '');
    if (parsed.fields.length === 1 && parsed.fields[0] === 'COUNT()') {
      out.seen.add('count');
      const body = r.body;
      if (!isObject(body) || !Number.isInteger(body.totalSize) || (body.totalSize as number) < 0) {
        out.violations.push(`${r.path}: COUNT() totalSize is not a whole number`);
      }
      if (!isObject(body) || !Array.isArray(body.records) || body.records.length !== 0) {
        out.violations.push(`${r.path}: COUNT() records is not an empty array`);
      }
      continue;
    }
    if (r.firstPage === false) out.seen.add('next-page');
    if (r.role === 'outer') {
      if (parsed.subqueries.length === 0) out.seen.add('flat-query');
      if (isObject(r.body) && r.body.done === false) out.seen.add('outer-paged');
    } else if (isObject(r.body) && r.body.done === false) {
      out.seen.add('child-paged');
    }
    checkQueryPage(r.body, parsed.fields, r.role === 'outer' ? parsed.subqueries : [], r.path, out);
  }
  return out;
}

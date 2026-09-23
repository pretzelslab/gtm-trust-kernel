/**
 * Salesforce adapter — read-only.
 *
 * Deliberately narrower than CrmAdapter's full real-world surface. This
 * exists to prove the adapter contract against a live org and to unblock a
 * manual smoke test, not to be a production sync engine. Scope decisions
 * made here (and why) are logged in packages/readiness/docs/STATUS.md.
 *
 * Auth: OAuth 2.0 Client Credentials Flow (SF_CLIENT_ID/SF_CLIENT_SECRET
 * against SF_INSTANCE_URL). Chosen because it needs no browser redirect and
 * no refresh-token storage — every call trades client id/secret for a fresh
 * access token, which suits a local CLI. Salesforce does not return an
 * expiry for this flow's token, so this adapter does not try to predict
 * expiry: it reuses a cached token until a request 401s, then refreshes
 * once and retries.
 *
 * Writes: applyFieldWrite() is implemented only because CrmAdapter requires
 * it for type conformance. It never calls Salesforce — it always returns
 * 'rejected'. capabilities().writeGranularity is 'none' for the same
 * reason: any caller that checks capabilities() before attempting a write
 * sees that up front, rather than getting a surprise rejection.
 */

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import type {
  Account,
  Activity,
  CanonicalStage,
  Contact,
  Note,
  Opportunity,
  OpportunityContactLink,
  OwnerChange,
  RecordRef,
  StageConfidence,
  StageHistoryEntry,
} from './model/canonical.js';
import { TrustTier, inferTier, tag } from './model/trust.js';
import {
  AdapterError,
  type AdapterCapabilities,
  type CrmAdapter,
  type FieldWrite,
  type GetAccountsResult,
  type GetChildRecordsResult,
  type GetContactsResult,
  type SyncPage,
  type SyncWindow,
  type WriteOutcome,
} from './types.js';

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const REQUIRED_ENV_VARS = ['SF_CLIENT_ID', 'SF_CLIENT_SECRET', 'SF_INSTANCE_URL'] as const;
const DEFAULT_API_VERSION = 'v62.0';

const THIS_FILE_DIR = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_TOKEN_CACHE_PATH = path.join(THIS_FILE_DIR, '..', '.cache', 'salesforce-token.json');

export interface SalesforceConfig {
  readonly clientId: string;
  readonly clientSecret: string;
  readonly instanceUrl: string;
  readonly apiVersion: string;
  readonly tokenCachePath: string;
}

/** Throws a clear, actionable error listing exactly which env vars are missing. */
export function loadSalesforceConfigFromEnv(env: NodeJS.ProcessEnv = process.env): SalesforceConfig {
  const missing = REQUIRED_ENV_VARS.filter((k) => !env[k]);
  if (missing.length > 0) {
    throw new Error(
      `Missing required Salesforce env var(s): ${missing.join(', ')}. ` +
        'Set them in .env (see .env.example) or your shell environment.',
    );
  }
  return {
    clientId: env.SF_CLIENT_ID!,
    clientSecret: env.SF_CLIENT_SECRET!,
    instanceUrl: env.SF_INSTANCE_URL!.replace(/\/+$/, ''),
    apiVersion: env.SF_API_VERSION || DEFAULT_API_VERSION,
    tokenCachePath: env.SF_TOKEN_CACHE_PATH || DEFAULT_TOKEN_CACHE_PATH,
  };
}

// ---------------------------------------------------------------------------
// Token cache + auth
// ---------------------------------------------------------------------------

interface CachedToken {
  readonly accessToken: string;
  readonly instanceUrl: string;
  readonly obtainedAt: string;
}

async function readTokenCache(cachePath: string): Promise<CachedToken | null> {
  try {
    const raw = await readFile(cachePath, 'utf8');
    return JSON.parse(raw) as CachedToken;
  } catch {
    return null;
  }
}

async function writeTokenCache(cachePath: string, token: CachedToken): Promise<void> {
  await mkdir(path.dirname(cachePath), { recursive: true });
  await writeFile(cachePath, JSON.stringify(token, null, 2), 'utf8');
}

async function safeReadBody(res: Response): Promise<string> {
  try {
    return await res.text();
  } catch {
    return '<unreadable body>';
  }
}

async function fetchAccessToken(config: SalesforceConfig): Promise<CachedToken> {
  const body = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: config.clientId,
    client_secret: config.clientSecret,
  });
  let res: Response;
  try {
    res = await fetch(`${config.instanceUrl}/services/oauth2/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    });
  } catch (err) {
    throw new AdapterError(
      `Network error requesting Salesforce access token: ${err instanceof Error ? err.message : String(err)}`,
      'network',
      true,
    );
  }
  if (!res.ok) {
    const detail = await safeReadBody(res);
    throw new AdapterError(
      `Salesforce token request failed (${res.status}): ${detail}`,
      res.status === 401 || res.status === 400 ? 'auth' : 'unknown',
      false,
    );
  }
  const json = (await res.json()) as { access_token: string; instance_url: string };
  return { accessToken: json.access_token, instanceUrl: json.instance_url, obtainedAt: new Date().toISOString() };
}

// ---------------------------------------------------------------------------
// Stage mapping — Salesforce's default Sales Process labels. An org with a
// customised picklist will simply produce 'unmapped' stages, never a guess
// dressed up as a mapped one (see types.ts's design rule at the top).
// ---------------------------------------------------------------------------

const SALESFORCE_STAGE_MAP: Readonly<Record<string, CanonicalStage>> = {
  Prospecting: 'prospecting',
  Qualification: 'discovery',
  'Needs Analysis': 'discovery',
  'Value Proposition': 'evaluation',
  'Id. Decision Makers': 'evaluation',
  'Perception Analysis': 'evaluation',
  'Proposal/Price Quote': 'proposal',
  'Negotiation/Review': 'negotiation',
  'Closed Won': 'closed_won',
  'Closed Lost': 'closed_lost',
};

function mapStage(vendorLabel: string, isClosed: boolean, isWon: boolean): { stage: CanonicalStage; stageConfidence: StageConfidence } {
  const mapped = SALESFORCE_STAGE_MAP[vendorLabel];
  if (mapped) return { stage: mapped, stageConfidence: 'mapped' };
  // Unmapped custom stage: fall back to what IsClosed/IsWon already tell us
  // rather than a bare guess — those two booleans are always trustworthy
  // regardless of the picklist label.
  if (isClosed) return { stage: isWon ? 'closed_won' : 'closed_lost', stageConfidence: 'unmapped' };
  return { stage: 'prospecting', stageConfidence: 'unmapped' };
}

// ---------------------------------------------------------------------------
// SOQL id safety — the only place raw ids are interpolated into a query
// string. Salesforce ids are always 15 or 18 alphanumeric characters; refuse
// anything else rather than build an unsafe or broken query.
// ---------------------------------------------------------------------------

const SALESFORCE_ID_RE = /^[a-zA-Z0-9]{15,18}$/;

function assertValidSalesforceId(id: string): void {
  if (!SALESFORCE_ID_RE.test(id)) {
    throw new AdapterError(`Refusing to build a SOQL query with a malformed Salesforce id: ${JSON.stringify(id)}`, 'schema', false);
  }
}

function soqlIdList(ids: readonly string[]): string {
  ids.forEach(assertValidSalesforceId);
  return ids.map((id) => `'${id}'`).join(', ');
}

/** A ref list collapsed to distinct ids, in first-seen order. */
function dedupeIds(refs: readonly RecordRef[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const r of refs) {
    if (!seen.has(r.id)) {
      seen.add(r.id);
      out.push(r.id);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Raw Salesforce record shapes (only the fields this adapter queries)
// ---------------------------------------------------------------------------

interface SoqlResponse<T> {
  readonly totalSize: number;
  readonly done: boolean;
  readonly nextRecordsUrl?: string;
  readonly records: readonly T[];
}

interface RawAccount {
  Id: string;
  Name: string;
  Website: string | null;
  Industry: string | null;
  NumberOfEmployees: number | null;
  OwnerId: string | null;
  CreatedDate: string;
  SystemModstamp: string;
}

interface RawOpportunity {
  Id: string;
  AccountId: string | null;
  Name: string;
  Amount: number | null;
  StageName: string;
  CloseDate: string | null;
  OwnerId: string | null;
  IsClosed: boolean;
  IsWon: boolean;
  ForecastCategoryName: string | null;
  NextStep: string | null;
  CreatedDate: string;
  SystemModstamp: string;
}

interface RawContact {
  Id: string;
  AccountId: string | null;
  Name: string;
  Title: string | null;
  Email: string | null;
  CreatedDate: string;
  SystemModstamp: string;
}

interface RawTask {
  Id: string;
  WhoId: string | null;
  WhatId: string | null;
  Subject: string | null;
  Description: string | null;
  ActivityDate: string | null;
  CreatedDate: string;
  SystemModstamp: string;
}

interface RawNote {
  Id: string;
  ParentId: string;
  Title: string | null;
  Body: string | null;
  OwnerId: string | null;
  CreatedDate: string;
  SystemModstamp: string;
}

interface RawOpportunityHistory {
  Id: string;
  OpportunityId: string;
  StageName: string | null;
  CloseDate: string | null;
  CreatedById: string | null;
  CreatedDate: string;
}

interface RawOpportunityContactRole {
  ContactId: string;
  Role: string | null;
  IsPrimary: boolean;
}

const ACCOUNT_FIELDS = ['Id', 'Name', 'Website', 'Industry', 'NumberOfEmployees', 'OwnerId', 'CreatedDate', 'SystemModstamp'];
// NOTE: CurrencyIsoCode deliberately omitted — it only exists on
// multi-currency-enabled orgs, and querying it on a single-currency org
// (the default for a fresh Developer Edition org) fails the whole query.
// Opportunity.currency is left undefined here; see STATUS.md known gaps.
const OPPORTUNITY_FIELDS = [
  'Id',
  'AccountId',
  'Name',
  'Amount',
  'StageName',
  'CloseDate',
  'OwnerId',
  'IsClosed',
  'IsWon',
  'ForecastCategoryName',
  'NextStep',
  'CreatedDate',
  'SystemModstamp',
];
const CONTACT_FIELDS = ['Id', 'AccountId', 'Name', 'Title', 'Email', 'CreatedDate', 'SystemModstamp'];
// Task only — Event (calendar meetings) is out of scope for this adapter;
// see STATUS.md known gaps.
const TASK_FIELDS = ['Id', 'WhoId', 'WhatId', 'Subject', 'Description', 'ActivityDate', 'CreatedDate', 'SystemModstamp'];
// Legacy Note object only — Salesforce's Enhanced Notes (ContentNote) is a
// different object and is out of scope for this adapter; see STATUS.md.
const NOTE_FIELDS = ['Id', 'ParentId', 'Title', 'Body', 'OwnerId', 'CreatedDate', 'SystemModstamp'];
const OPPORTUNITY_HISTORY_FIELDS = ['Id', 'OpportunityId', 'StageName', 'CloseDate', 'CreatedById', 'CreatedDate'];

// ---------------------------------------------------------------------------
// Adapter
// ---------------------------------------------------------------------------

export class SalesforceAdapter implements CrmAdapter {
  readonly vendor = 'salesforce' as const;
  readonly orgId: string;

  private cachedToken: CachedToken | null = null;
  /** opportunityId -> last-seen toStage, for deriving fromStage across listStageHistory pages/calls on this instance. */
  private readonly lastKnownStage = new Map<string, CanonicalStage>();

  constructor(private readonly config: SalesforceConfig) {
    this.orgId = new URL(config.instanceUrl).host;
  }

  capabilities(): AdapterCapabilities {
    return {
      stageHistory: true,
      // Owner-change tracking needs Field History Tracking enabled on
      // Opportunity.OwnerId, which is NOT on by default (any edition) and
      // can't be assumed for an arbitrary org. Declaring false here (and
      // returning empty from listOwnerChanges) is the honest choice per
      // this file's own design rule, rather than guessing and sometimes
      // throwing a schema error.
      ownerHistory: false,
      // Einstein Activity Capture is a separate paid feature, not present
      // by default on a Developer Edition org.
      activitySync: false,
      incrementalSync: true,
      // No Bulk API 2.0 here — REST/SOQL only.
      bulkRead: false,
      writeGranularity: 'none',
      nativeConcurrencyCheck: false,
      // Static Developer-Edition-typical estimate, not queried live via
      // /services/data/vXX/limits/. Flagged as a known gap in STATUS.md.
      rateLimit: { kind: 'daily_quota', value: 15000 },
      stageMap: SALESFORCE_STAGE_MAP,
      accountBatchLimit: 200,
      contactBatchLimit: 200,
      childRecordBatchLimit: 200,
      notesPerOpportunityLimit: 200,
      activitiesPerOpportunityLimit: 200,
    };
  }

  async health(): Promise<{ ok: boolean; detail?: string }> {
    try {
      await this.request(`/services/data/${this.config.apiVersion}/limits/`);
      return { ok: true };
    } catch (err) {
      return { ok: false, detail: err instanceof Error ? err.message : String(err) };
    }
  }

  // -- auth plumbing ---------------------------------------------------

  private async getToken(forceRefresh: boolean): Promise<CachedToken> {
    if (!forceRefresh) {
      if (this.cachedToken) return this.cachedToken;
      const fromDisk = await readTokenCache(this.config.tokenCachePath);
      if (fromDisk) {
        this.cachedToken = fromDisk;
        return fromDisk;
      }
    }
    const fresh = await fetchAccessToken(this.config);
    this.cachedToken = fresh;
    await writeTokenCache(this.config.tokenCachePath, fresh);
    return fresh;
  }

  private async request<T>(pathOrUrl: string, init: RequestInit = {}): Promise<T> {
    return this.requestWithRetry<T>(pathOrUrl, init, false);
  }

  private async requestWithRetry<T>(pathOrUrl: string, init: RequestInit, hasRetried: boolean): Promise<T> {
    const token = await this.getToken(hasRetried);
    const url = pathOrUrl.startsWith('http') ? pathOrUrl : `${token.instanceUrl}${pathOrUrl}`;

    let res: Response;
    try {
      res = await fetch(url, {
        ...init,
        headers: { Authorization: `Bearer ${token.accessToken}`, ...(init.headers ?? {}) },
      });
    } catch (err) {
      throw new AdapterError(`Network error calling Salesforce: ${err instanceof Error ? err.message : String(err)}`, 'network', true);
    }

    if (res.status === 401 && !hasRetried) {
      return this.requestWithRetry<T>(pathOrUrl, init, true);
    }
    if (res.status === 429) {
      const retryAfterHeader = Number(res.headers.get('Retry-After'));
      throw new AdapterError(
        'Salesforce rate limit hit',
        'rate_limit',
        true,
        Number.isFinite(retryAfterHeader) ? retryAfterHeader * 1000 : undefined,
      );
    }
    if (res.status === 401 || res.status === 403) {
      const detail = await safeReadBody(res);
      throw new AdapterError(
        `Salesforce ${res.status === 401 ? 'auth' : 'permission'} error: ${detail}`,
        res.status === 401 ? 'auth' : 'permission',
        false,
      );
    }
    if (!res.ok) {
      const detail = await safeReadBody(res);
      throw new AdapterError(`Salesforce API error (${res.status}): ${detail}`, 'unknown', res.status >= 500);
    }
    try {
      return (await res.json()) as T;
    } catch (err) {
      throw new AdapterError(`Salesforce returned unparsable JSON: ${err instanceof Error ? err.message : String(err)}`, 'schema', false);
    }
  }

  // -- SOQL plumbing ----------------------------------------------------

  private async soqlQuery<T>(soql: string, batchSize?: number): Promise<SoqlResponse<T>> {
    const url = `/services/data/${this.config.apiVersion}/query?q=${encodeURIComponent(soql)}`;
    const headers: Record<string, string> = {};
    if (batchSize) headers['Sforce-Query-Options'] = `batchSize=${batchSize}`;
    return this.request<SoqlResponse<T>>(url, { headers });
  }

  private async soqlQueryMore<T>(nextRecordsUrl: string): Promise<SoqlResponse<T>> {
    return this.request<SoqlResponse<T>>(nextRecordsUrl);
  }

  /**
   * Generic since/cursor list, backed by SOQL + Salesforce's own
   * nextRecordsUrl locator as the (opaque) SyncWindow cursor.
   *
   * SOQL's LIMIT clause caps the TOTAL result set, not the per-page batch
   * size — so w.limit is NOT put into LIMIT. Instead it drives the
   * Sforce-Query-Options batchSize header, clamped to Salesforce's allowed
   * range [200, 2000]. That means a caller asking for a small page (e.g.
   * limit: 20) can get back more than 20 items in one page — a real
   * Salesforce API constraint, not a bug. Documented as a known deviation
   * from the mock's exact-limit behaviour in STATUS.md.
   */
  private async listViaSoql<TRaw, TOut>(args: {
    objectName: string;
    fields: readonly string[];
    where?: string;
    w: SyncWindow;
    tsField?: string;
    map: (raw: TRaw) => TOut;
  }): Promise<SyncPage<TOut>> {
    const tsField = args.tsField ?? 'SystemModstamp';
    let page: SoqlResponse<TRaw>;
    if (args.w.cursor) {
      page = await this.soqlQueryMore<TRaw>(args.w.cursor);
    } else {
      const clauses = [args.where, args.w.since ? `${tsField} >= ${args.w.since}` : undefined].filter(Boolean).join(' AND ');
      const soql =
        `SELECT ${args.fields.join(', ')} FROM ${args.objectName}` +
        (clauses ? ` WHERE ${clauses}` : '') +
        ` ORDER BY ${tsField} ASC`;
      const batchSize = Math.min(2000, Math.max(200, args.w.limit));
      page = await this.soqlQuery<TRaw>(soql, batchSize);
    }
    const items = page.records.map(args.map);
    const lastRaw = page.records[page.records.length - 1] as Record<string, string> | undefined;
    const watermark = lastRaw ? lastRaw[tsField]! : (args.w.since ?? '1970-01-01T00:00:00Z');
    return {
      items,
      nextCursor: page.done ? undefined : page.nextRecordsUrl,
      watermark,
      apiCallsConsumed: 1,
    };
  }

  // -- refs ---------------------------------------------------------------

  private ref(objectType: RecordRef['objectType'], id: string): RecordRef {
    return { crm: 'salesforce', orgId: this.orgId, objectType, id };
  }

  // -- mapping --------------------------------------------------------

  private mapAccount = (raw: RawAccount): Account => ({
    ref: this.ref('account', raw.Id),
    name: raw.Name,
    domain: raw.Website ?? undefined,
    industry: raw.Industry ?? undefined,
    employeeCount: raw.NumberOfEmployees ?? undefined,
    ownerId: raw.OwnerId ?? undefined,
    createdAt: raw.CreatedDate,
    modifiedAt: raw.SystemModstamp,
  });

  private mapOpportunity = (raw: RawOpportunity, contactLinks: readonly OpportunityContactLink[] = []): Opportunity => {
    const { stage, stageConfidence } = mapStage(raw.StageName, raw.IsClosed, raw.IsWon);
    return {
      ref: this.ref('opportunity', raw.Id),
      accountRef: this.ref('account', raw.AccountId ?? raw.Id),
      name: raw.Name,
      amount: raw.Amount ?? undefined,
      stage,
      stageConfidence,
      vendorStageLabel: raw.StageName,
      closeDate: raw.CloseDate ?? undefined,
      ownerId: raw.OwnerId ?? undefined,
      isClosed: raw.IsClosed,
      isWon: raw.IsWon,
      forecastCategory: raw.ForecastCategoryName ?? undefined,
      nextStep: raw.NextStep
        ? tag(TrustTier.UserAuthored, raw.NextStep, {
            recordId: `opportunity:${raw.Id}`,
            field: 'nextStep',
            capturedAt: raw.SystemModstamp,
          })
        : undefined,
      contactLinks,
      createdAt: raw.CreatedDate,
      modifiedAt: raw.SystemModstamp,
      concurrencyToken: raw.SystemModstamp,
    };
  };

  private mapContact = (raw: RawContact): Contact => ({
    ref: this.ref('contact', raw.Id),
    accountRef: raw.AccountId ? this.ref('account', raw.AccountId) : undefined,
    name: raw.Name,
    title: raw.Title ?? undefined,
    email: raw.Email ?? undefined,
    createdAt: raw.CreatedDate,
    modifiedAt: raw.SystemModstamp,
  });

  private mapTask = (raw: RawTask): Activity => {
    const relatedTo: RecordRef[] = [];
    if (raw.WhatId) relatedTo.push(this.ref('opportunity', raw.WhatId));
    if (raw.WhoId) relatedTo.push(this.ref('contact', raw.WhoId));
    const occurredAt = raw.ActivityDate ?? raw.CreatedDate;
    // Stock Task has no reliable inbound/outbound signal (that needs
    // EmailMessage.Incoming or an add-on) — 'unknown' is the honest value,
    // which inferTier() treats conservatively as externally sourced. See
    // this file's header and STATUS.md.
    const tier = inferTier({ objectType: 'activity', field: 'body', authorIsInternalUser: true, activityDirection: 'unknown' });
    return {
      ref: this.ref('activity', raw.Id),
      relatedTo,
      // Type isn't queried (dropped: not present on every org, and not
      // read by any metric or report — see STATUS.md), so there's no
      // signal to distinguish call/email/other here.
      kind: 'other',
      direction: 'unknown',
      occurredAt,
      subject: raw.Subject
        ? tag(tier, raw.Subject, { recordId: `activity:${raw.Id}`, field: 'subject', capturedAt: raw.SystemModstamp })
        : undefined,
      body: raw.Description
        ? tag(tier, raw.Description, { recordId: `activity:${raw.Id}`, field: 'body', capturedAt: raw.SystemModstamp })
        : undefined,
      participantIds: [raw.WhoId, raw.WhatId].filter((x): x is string => Boolean(x)),
    };
  };

  private mapNote = (raw: RawNote): Note => ({
    ref: this.ref('note', raw.Id),
    relatedTo: [this.ref('opportunity', raw.ParentId)],
    authorId: raw.OwnerId ?? undefined,
    createdAt: raw.CreatedDate,
    body: tag(TrustTier.UserAuthored, raw.Body ?? '', {
      recordId: `note:${raw.Id}`,
      field: 'body',
      capturedAt: raw.CreatedDate,
    }),
  });

  private mapStageHistory = (raw: RawOpportunityHistory): StageHistoryEntry => {
    const toStage: CanonicalStage = raw.StageName ? (SALESFORCE_STAGE_MAP[raw.StageName] ?? 'prospecting') : 'prospecting';
    const fromStage = this.lastKnownStage.get(raw.OpportunityId);
    this.lastKnownStage.set(raw.OpportunityId, toStage);
    return {
      ref: this.ref('stage_history', raw.Id),
      opportunityRef: this.ref('opportunity', raw.OpportunityId),
      fromStage,
      toStage,
      changedAt: raw.CreatedDate,
      changedBy: raw.CreatedById ?? undefined,
      closeDateAtChange: raw.CloseDate ?? undefined,
    };
  };

  // -- CrmAdapter: list* ------------------------------------------------

  async listAccounts(w: SyncWindow): Promise<SyncPage<Account>> {
    return this.listViaSoql<RawAccount, Account>({ objectName: 'Account', fields: ACCOUNT_FIELDS, w, map: this.mapAccount });
  }

  async listOpportunities(w: SyncWindow): Promise<SyncPage<Opportunity>> {
    return this.listViaSoql<RawOpportunity, Opportunity>({
      objectName: 'Opportunity',
      fields: OPPORTUNITY_FIELDS,
      w,
      // Bulk listing does not hydrate contactLinks (would need one
      // OpportunityContactRole query per opportunity) — only
      // getOpportunity() does. See STATUS.md known gaps.
      map: (raw) => this.mapOpportunity(raw),
    });
  }

  async listContacts(w: SyncWindow): Promise<SyncPage<Contact>> {
    return this.listViaSoql<RawContact, Contact>({ objectName: 'Contact', fields: CONTACT_FIELDS, w, map: this.mapContact });
  }

  async listActivities(w: SyncWindow): Promise<SyncPage<Activity>> {
    return this.listViaSoql<RawTask, Activity>({ objectName: 'Task', fields: TASK_FIELDS, w, map: this.mapTask });
  }

  async listNotes(w: SyncWindow): Promise<SyncPage<Note>> {
    return this.listViaSoql<RawNote, Note>({ objectName: 'Note', fields: NOTE_FIELDS, w, map: this.mapNote });
  }

  async listStageHistory(w: SyncWindow): Promise<SyncPage<StageHistoryEntry>> {
    return this.listViaSoql<RawOpportunityHistory, StageHistoryEntry>({
      objectName: 'OpportunityHistory',
      fields: OPPORTUNITY_HISTORY_FIELDS,
      w,
      tsField: 'CreatedDate',
      map: this.mapStageHistory,
    });
  }

  async listOwnerChanges(w: SyncWindow): Promise<SyncPage<OwnerChange>> {
    // capabilities().ownerHistory is false — contract requires empty, not a throw.
    return { items: [], watermark: w.since ?? '', apiCallsConsumed: 0 };
  }

  // -- CrmAdapter: batched by-ref reads -----------------------------------

  async getAccounts(refs: readonly RecordRef[]): Promise<GetAccountsResult> {
    if (refs.length === 0) return { items: [], apiCallsConsumed: 0 };
    const ids = dedupeIds(refs);
    const soql = `SELECT ${ACCOUNT_FIELDS.join(', ')} FROM Account WHERE Id IN (${soqlIdList(ids)})`;
    const page = await this.soqlQuery<RawAccount>(soql);
    const items = page.records.map(this.mapAccount).slice().sort((a, b) => a.ref.id.localeCompare(b.ref.id));
    return { items, apiCallsConsumed: 1 };
  }

  async getContactsByRef(refs: readonly RecordRef[]): Promise<GetContactsResult> {
    if (refs.length === 0) return { items: [], apiCallsConsumed: 0 };
    const ids = dedupeIds(refs);
    const soql = `SELECT ${CONTACT_FIELDS.join(', ')} FROM Contact WHERE Id IN (${soqlIdList(ids)})`;
    const page = await this.soqlQuery<RawContact>(soql);
    const items = page.records.map(this.mapContact).slice().sort((a, b) => a.ref.id.localeCompare(b.ref.id));
    return { items, apiCallsConsumed: 1 };
  }

  private async fetchContactLinks(opportunityId: string): Promise<OpportunityContactLink[]> {
    const soql = `SELECT ContactId, Role, IsPrimary FROM OpportunityContactRole WHERE OpportunityId = '${opportunityId}'`;
    const page = await this.soqlQuery<RawOpportunityContactRole>(soql);
    return page.records.map((r) => ({
      contactRef: this.ref('contact', r.ContactId),
      role: r.Role ?? undefined,
      isPrimary: r.IsPrimary,
    }));
  }

  /**
   * Per-opportunity SOQL, one call per distinct oppRef — SOQL has no
   * per-group LIMIT, so a single clever query can't enforce
   * notesPerOpportunityLimit across many opportunities at once. Costs more
   * API calls than the mock's flat 1, but is honestly reported via
   * apiCallsConsumed. Truncation is newest-first-kept per the contract
   * (see AdapterCapabilities.notesPerOpportunityLimit's docblock).
   */
  async getNotesByOpportunity(oppRefs: readonly RecordRef[]): Promise<GetChildRecordsResult<Note>> {
    if (oppRefs.length === 0) return { items: [], truncatedOpportunityIds: new Set(), apiCallsConsumed: 0 };
    const limit = this.capabilities().notesPerOpportunityLimit;
    const ids = dedupeIds(oppRefs);
    const items: Note[] = [];
    const truncatedOpportunityIds = new Set<string>();
    for (const oppId of ids) {
      assertValidSalesforceId(oppId);
      const soql =
        `SELECT ${NOTE_FIELDS.join(', ')} FROM Note WHERE ParentId = '${oppId}' ` +
        `ORDER BY CreatedDate DESC NULLS LAST LIMIT ${limit + 1}`;
      const page = await this.soqlQuery<RawNote>(soql);
      const desc = [...page.records];
      if (desc.length > limit) truncatedOpportunityIds.add(oppId);
      const kept = desc.slice(0, limit).reverse(); // back to ascending, newest-kept
      items.push(...kept.map(this.mapNote));
    }
    return { items, truncatedOpportunityIds, apiCallsConsumed: ids.length };
  }

  /** Same shape/reasoning as getNotesByOpportunity, ordered by ActivityDate (occurredAt), not CreatedDate. */
  async getActivitiesByOpportunity(oppRefs: readonly RecordRef[]): Promise<GetChildRecordsResult<Activity>> {
    if (oppRefs.length === 0) return { items: [], truncatedOpportunityIds: new Set(), apiCallsConsumed: 0 };
    const limit = this.capabilities().activitiesPerOpportunityLimit;
    const ids = dedupeIds(oppRefs);
    const items: Activity[] = [];
    const truncatedOpportunityIds = new Set<string>();
    for (const oppId of ids) {
      assertValidSalesforceId(oppId);
      const soql =
        `SELECT ${TASK_FIELDS.join(', ')} FROM Task WHERE WhatId = '${oppId}' ` +
        `ORDER BY ActivityDate DESC NULLS LAST, CreatedDate DESC LIMIT ${limit + 1}`;
      const page = await this.soqlQuery<RawTask>(soql);
      const desc = [...page.records];
      if (desc.length > limit) truncatedOpportunityIds.add(oppId);
      const kept = desc.slice(0, limit).reverse();
      items.push(...kept.map(this.mapTask));
    }
    return { items, truncatedOpportunityIds, apiCallsConsumed: ids.length };
  }

  async getOpportunity(ref: RecordRef): Promise<Opportunity | null> {
    assertValidSalesforceId(ref.id);
    const soql = `SELECT ${OPPORTUNITY_FIELDS.join(', ')} FROM Opportunity WHERE Id = '${ref.id}' LIMIT 1`;
    const page = await this.soqlQuery<RawOpportunity>(soql);
    const raw = page.records[0];
    if (!raw) return null;
    const contactLinks = await this.fetchContactLinks(ref.id);
    return this.mapOpportunity(raw, contactLinks);
  }

  // -- CrmAdapter: writes (disabled) --------------------------------------

  async applyFieldWrite(_w: FieldWrite): Promise<WriteOutcome> {
    return { status: 'rejected', reason: 'read-only adapter: Salesforce writes are disabled' };
  }
}

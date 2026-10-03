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
 * Rate limits: a 429, a 503 or a concurrent-request REQUEST_LIMIT_EXCEEDED
 * is retried with backoff (retry.ts, DEFAULT_RETRY_POLICY), honouring
 * Retry-After; the org's daily request limit fails at once, since waiting
 * can't lift it. Auth and other 4xx errors are never retried.
 *
 * Writes: applyFieldWrite() is implemented only because CrmAdapter requires
 * it for type conformance. It never calls Salesforce — it always returns
 * 'rejected'. capabilities().writeGranularity is 'none' for the same
 * reason: any caller that checks capabilities() before attempting a write
 * sees that up front, rather than getting a surprise rejection.
 */

import { readFileSync } from 'node:fs';
import os from 'node:os';

import { CANONICAL_STAGE_ORDER } from './model/canonical.js';
import { DEFAULT_RETRY_POLICY, nextRetryDelay, parseRetryAfter, type RetryInfo } from './retry.js';
import {
  type CachedToken,
  defaultTokenCachePath,
  LEGACY_TOKEN_CACHE_PATH,
  readTokenCache,
  removeLegacyTokenCache,
  writeTokenCache,
} from './tokenCache.js';
import type {
  Account,
  Activity,
  CanonicalStage,
  Contact,
  NextStepChange,
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
  type PreflightIssue,
  type PreflightOptions,
  type PreflightResult,
  type SamplePage,
  type SamplePopulation,
  type SamplePopulationCount,
  type SampleWindow,
  type SyncPage,
  type SyncWindow,
  type WriteOutcome,
} from './types.js';

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const REQUIRED_ENV_VARS = ['SF_CLIENT_ID', 'SF_CLIENT_SECRET', 'SF_INSTANCE_URL'] as const;
const DEFAULT_API_VERSION = 'v62.0';


/**
 * How this org captures activity, as declared by the user
 * (SF_ACTIVITY_CAPTURE). 'auto' means email/calendar sync writes Task and
 * Event records without reps logging them; 'manual' means reps log by hand.
 * Declared rather than detected: there is no reliable SOQL check for it
 * (Einstein Activity Capture, for one, does not by default store what it
 * captures as Task/Event records). Unverified against a live org with
 * activity capture on.
 */
export type SalesforceActivityCapture = 'auto' | 'manual';

const ACTIVITY_CAPTURE_VALUES: readonly SalesforceActivityCapture[] = ['auto', 'manual'];

export const ACTIVITY_CAPTURE_HINT = 'Set SF_ACTIVITY_CAPTURE=auto if your team logs activity automatically.';

/** Shown when Enhanced Notes are linked to sampled deals but ContentNote can't be queried. */
export const NOTES_ACCESS_HINT =
  'Enable Notes (Setup, Notes Settings) and give the Run As user read access to Notes (ContentNote), so Enhanced Notes can be read.';

/** Shown when the scan finds a stage with no mapping; names the setting, never a stage label. */
export const STAGE_MAP_HINT = 'Map your custom stages to standard ones in a JSON file and set SF_STAGE_MAP_PATH to its path.';

export interface SalesforceConfig {
  readonly clientId: string;
  readonly clientSecret: string;
  readonly instanceUrl: string;
  readonly apiVersion: string;
  readonly tokenCachePath: string;
  /** Undefined when not declared: treated like 'manual' (activity capture not assumed). */
  readonly activityCapture?: SalesforceActivityCapture;
  /**
   * Most Enhanced Note bodies to fetch in full per adapter instance (one
   * run), for notes whose TextPreview hits ENHANCED_NOTE_PREVIEW_CAP. Past
   * the budget, a note keeps its preview and is marked bodyTruncated.
   * SF_NOTE_FULLTEXT_FETCH_LIMIT; defaults to 200. 0 never fetches.
   */
  readonly noteFullTextFetchLimit?: number;
  /**
   * The org's own stage labels mapped to canonical stages, merged over the
   * default Sales Process map (SF_STAGE_MAP_PATH; see loadStageMapFile).
   */
  readonly stageMap?: Readonly<Record<string, CanonicalStage>>;
}

const CANONICAL_STAGES: readonly CanonicalStage[] = [...CANONICAL_STAGE_ORDER, 'closed_won', 'closed_lost'];

/**
 * Reads a stage map file: a JSON object from the org's stage labels
 * (exactly as Salesforce stores StageName) to canonical stages. Throws an
 * error naming the file and the first bad entry. The labels themselves are
 * org configuration and never appear in the report.
 */
export function loadStageMapFile(filePath: string): Record<string, CanonicalStage> {
  let raw: string;
  try {
    raw = readFileSync(filePath, 'utf8');
  } catch (err) {
    throw new Error(`Cannot read stage map ${filePath}: ${err instanceof Error ? err.message : String(err)}`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error(`Stage map ${filePath} is not valid JSON: ${err instanceof Error ? err.message : String(err)}`);
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`Stage map ${filePath} must be a JSON object of "Stage label": "canonical stage" entries.`);
  }
  const map: Record<string, CanonicalStage> = {};
  for (const [label, stage] of Object.entries(parsed)) {
    if (label.trim().length === 0) {
      throw new Error(`Stage map ${filePath} has an empty stage label.`);
    }
    if (typeof stage !== 'string' || !(CANONICAL_STAGES as readonly string[]).includes(stage)) {
      throw new Error(
        `Stage map ${filePath}: "${label}" maps to ${JSON.stringify(stage)}, which is not a canonical stage. ` +
          `Use one of: ${CANONICAL_STAGES.join(', ')}.`,
      );
    }
    map[label] = stage as CanonicalStage;
  }
  return map;
}

export const DEFAULT_NOTE_FULLTEXT_FETCH_LIMIT = 200;

/**
 * ContentNote.TextPreview's length cap. A preview this long (or longer) may
 * be cut off, so its full text is fetched within the run's budget.
 * Unverified against a live org; confirm on the Developer Edition smoke run.
 */
export const ENHANCED_NOTE_PREVIEW_CAP = 255;

/** Throws a clear, actionable error listing exactly which env vars are missing. */
export function loadSalesforceConfigFromEnv(env: NodeJS.ProcessEnv = process.env): SalesforceConfig {
  const missing = REQUIRED_ENV_VARS.filter((k) => !env[k]);
  if (missing.length > 0) {
    throw new Error(
      `Missing required Salesforce env var(s): ${missing.join(', ')}. ` +
        'Set them in .env (see .env.example) or your shell environment.',
    );
  }
  const activityCaptureRaw = env.SF_ACTIVITY_CAPTURE?.trim().toLowerCase();
  if (activityCaptureRaw && !(ACTIVITY_CAPTURE_VALUES as readonly string[]).includes(activityCaptureRaw)) {
    throw new Error(
      `Invalid SF_ACTIVITY_CAPTURE value ${JSON.stringify(env.SF_ACTIVITY_CAPTURE)}. ` +
        `Use one of: ${ACTIVITY_CAPTURE_VALUES.join(', ')}, or leave it unset.`,
    );
  }
  const fetchLimitRaw = env.SF_NOTE_FULLTEXT_FETCH_LIMIT?.trim();
  if (fetchLimitRaw && !/^\d+$/.test(fetchLimitRaw)) {
    throw new Error(
      `Invalid SF_NOTE_FULLTEXT_FETCH_LIMIT value ${JSON.stringify(env.SF_NOTE_FULLTEXT_FETCH_LIMIT)}. Use a whole number (0 or more), or leave it unset.`,
    );
  }
  const instanceUrl = env.SF_INSTANCE_URL!.replace(/\/+$/, '');
  return {
    clientId: env.SF_CLIENT_ID!,
    clientSecret: env.SF_CLIENT_SECRET!,
    instanceUrl,
    apiVersion: env.SF_API_VERSION || DEFAULT_API_VERSION,
    tokenCachePath: env.SF_TOKEN_CACHE_PATH || defaultTokenCachePath(instanceUrl, env.SF_CLIENT_ID!, process.platform, env, os.homedir()),
    ...(activityCaptureRaw ? { activityCapture: activityCaptureRaw as SalesforceActivityCapture } : {}),
    ...(fetchLimitRaw ? { noteFullTextFetchLimit: Number(fetchLimitRaw) } : {}),
    ...(env.SF_STAGE_MAP_PATH?.trim() ? { stageMap: loadStageMapFile(env.SF_STAGE_MAP_PATH.trim()) } : {}),
  };
}

// ---------------------------------------------------------------------------
// Token cache + auth
// ---------------------------------------------------------------------------

async function safeReadBody(res: Response): Promise<string> {
  try {
    return await res.text();
  } catch {
    return '<unreadable body>';
  }
}

async function fetchAccessToken(config: SalesforceConfig, backoff: Backoff): Promise<CachedToken> {
  const body = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: config.clientId,
    client_secret: config.clientSecret,
  });
  const { res, body: readBody } = await backoff(async () => {
    try {
      return await fetch(`${config.instanceUrl}/services/oauth2/token`, {
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
  });
  if (!res.ok) {
    const detail = readBody ?? (await safeReadBody(res));
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
// Rate limits and retry
// ---------------------------------------------------------------------------

/** A response the retry loop let through, with its body if the loop already read it. */
interface SettledResponse {
  readonly res: Response;
  readonly body?: string;
}

type Backoff = (send: () => Promise<Response>) => Promise<SettledResponse>;

type Throttle =
  | { readonly kind: 'none'; readonly body?: string }
  | { readonly kind: 'daily' }
  | { readonly kind: 'retry'; readonly reason: string; readonly rateLimited: boolean; readonly retryAfterMs?: number };

/**
 * Whether a response is a throttle worth retrying. Salesforce answers
 * REQUEST_LIMIT_EXCEEDED with a 403 whose message names the limit:
 * "ConcurrentPerOrgLongTxn Limit exceeded." clears as long-running
 * requests finish, so it is retried; "TotalRequests Limit exceeded." is
 * the org's daily limit, and any other message is treated the same way
 * (fail at once). Only a 403's body is read here; it is handed back so
 * the caller can still report it.
 */
async function throttleOf(res: Response): Promise<Throttle> {
  if (res.status === 429 || res.status === 503) {
    const retryAfterMs = parseRetryAfter(res.headers.get('Retry-After'), Date.now());
    return {
      kind: 'retry',
      reason: String(res.status),
      rateLimited: res.status === 429,
      ...(retryAfterMs !== undefined ? { retryAfterMs } : {}),
    };
  }
  if (res.status !== 403) return { kind: 'none' };
  const body = await safeReadBody(res);
  let errors: unknown;
  try {
    errors = JSON.parse(body);
  } catch {
    return { kind: 'none', body };
  }
  const limit = Array.isArray(errors)
    ? (errors as ({ errorCode?: unknown; message?: unknown } | null)[]).find((e) => e?.errorCode === 'REQUEST_LIMIT_EXCEEDED')
    : undefined;
  if (!limit) return { kind: 'none', body };
  if (typeof limit.message === 'string' && /^Concurrent/i.test(limit.message.trim())) {
    return { kind: 'retry', reason: '403 REQUEST_LIMIT_EXCEEDED, concurrent requests', rateLimited: true };
  }
  return { kind: 'daily' };
}

export const DAILY_LIMIT_MESSAGE =
  "Salesforce refused the request: this org's daily API request limit is used up (REQUEST_LIMIT_EXCEEDED). " +
  'Nothing was written. The limit frees up over a rolling 24 hours; try again later.';

function gaveUpMessage(reason: string, attempts: number, waitedMs: number): string {
  const what = reason === '503' ? 'answering 503 (service unavailable)' : `rate-limiting requests (${reason})`;
  return `Salesforce kept ${what} after ${attempts} attempts over ${Math.round(waitedMs / 1000)}s. Nothing was written. Try again later.`;
}

// ---------------------------------------------------------------------------
// Stage mapping — Salesforce's default Sales Process labels. An org with a
// customised picklist maps its own labels with a stage map file
// (SalesforceConfig.stageMap); any label still unknown produces an
// 'unmapped' stage, never a guess dressed up as a mapped one (see types.ts's
// design rule at the top).
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

function mapStage(
  stageMap: Readonly<Record<string, CanonicalStage>>,
  vendorLabel: string,
  isClosed: boolean,
  isWon: boolean,
): { stage: CanonicalStage; stageConfidence: StageConfidence } {
  const mapped = stageMap[vendorLabel];
  if (mapped) {
    // A mapping that contradicts Salesforce's own IsClosed/IsWon flags is
    // a map error: the flags win, and the record counts as unmapped so
    // stage_mapping_coverage shows it.
    const mappedClosed = mapped === 'closed_won' || mapped === 'closed_lost';
    const agrees = mappedClosed ? isClosed && (mapped === 'closed_won') === isWon : !isClosed;
    if (agrees) return { stage: mapped, stageConfidence: 'mapped' };
  }
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
// Small helpers
// ---------------------------------------------------------------------------

/** Comparator: newest first by an ISO date or datetime; ties keep input order. */
function newestFirst<T>(at: (x: T) => string): (a: T, b: T) => number {
  return (a, b) => Date.parse(at(b)) - Date.parse(at(a));
}

/**
 * The closed-deal window as SOQL date literals (UTC days), widened to whole
 * days so it is a superset of the sampler's own timestamp check.
 */
function closedWindowDates(p: SamplePopulation): { from: string; to: string } {
  const asOf = new Date(p.asOf);
  const cutoff = new Date(asOf);
  cutoff.setUTCMonth(cutoff.getUTCMonth() - p.closedWithinMonths);
  return { from: cutoff.toISOString().slice(0, 10), to: asOf.toISOString().slice(0, 10) };
}

function samplePopulationWhere(p: SamplePopulation): string {
  const { from, to } = closedWindowDates(p);
  return `(IsClosed = false OR (CloseDate >= ${from} AND CloseDate <= ${to}))`;
}

/** A Task's kind from its TaskSubtype: Call and Email map across, anything else is other. */
function taskKind(subtype: string | null): Activity['kind'] {
  if (subtype === 'Call') return 'call';
  if (subtype === 'Email') return 'email';
  return 'other';
}

/** An Enhanced Note body is stored as simple HTML; reduce it to plain text. */
export function htmlToText(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|h[1-6])>/gi, '\n')
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s*\n+/g, '\n')
    .trim();
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

/** An Opportunity row from a parent-child subquery: Id plus the relationship's rows (null when it has none). */
type RawParentWithChildren<T> = { readonly Id: string } & Readonly<Record<string, SoqlResponse<T> | string | null>>;

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
  /** Call, Email, Task, ListEmail, Cadence or LinkedIn; null on older records. */
  TaskSubtype: string | null;
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

interface RawEvent {
  Id: string;
  WhoId: string | null;
  WhatId: string | null;
  Subject: string | null;
  Description: string | null;
  ActivityDate: string | null;
  ActivityDateTime: string | null;
  CreatedDate: string;
  SystemModstamp: string;
}

interface RawContentDocumentLink {
  ContentDocumentId: string;
  LinkedEntityId: string;
}

interface RawContentNote {
  Id: string;
  Title: string | null;
  TextPreview: string | null;
  OwnerId: string | null;
  CreatedDate: string;
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
  OpportunityId: string;
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
// Tasks. Events (meetings) are read too, with EVENT_FIELDS below.
const TASK_FIELDS = ['Id', 'WhoId', 'WhatId', 'Subject', 'Description', 'ActivityDate', 'TaskSubtype', 'CreatedDate', 'SystemModstamp'];
// Event (meetings) is read by getActivitiesByOpportunity only; listActivities
// stays Task-only (no metric reads it).
const EVENT_FIELDS = ['Id', 'WhoId', 'WhatId', 'Subject', 'Description', 'ActivityDate', 'ActivityDateTime', 'CreatedDate', 'SystemModstamp'];
// Legacy Note. Enhanced Notes (ContentNote, linked through
// ContentDocumentLink) are read separately by getNotesByOpportunity.
const NOTE_FIELDS = ['Id', 'ParentId', 'Title', 'Body', 'OwnerId', 'CreatedDate', 'SystemModstamp'];
const OPPORTUNITY_HISTORY_FIELDS = ['Id', 'OpportunityId', 'StageName', 'CloseDate', 'CreatedById', 'CreatedDate'];
const OPPORTUNITY_CONTACT_ROLE_FIELDS = ['OpportunityId', 'ContactId', 'Role', 'IsPrimary'];
const CONTENT_DOCUMENT_LINK_FIELDS = ['ContentDocumentId', 'LinkedEntityId'];
const CONTENT_NOTE_FIELDS = ['Id', 'Title', 'TextPreview', 'OwnerId', 'CreatedDate'];

/** One object the adapter reads, the fields it reads, and how much a scan needs it. */
export interface SalesforceObjectRead {
  readonly object: string;
  readonly fields: readonly string[];
  /**
   * 'required': a scan can't run without it. 'contacts': required only
   * when contacts are read (a second source is connected). 'notes':
   * without it the scan runs and the note metrics are marked not measured
   * (capabilities().notesComplete false).
   */
  readonly need: 'required' | 'contacts' | 'notes';
}

/**
 * Everything the adapter reads, for preflight() and for a least-privilege
 * permission set. The queries use these same field lists.
 *
 * Event and OpportunityHistory stay required: unlike the note objects, no
 * metric that needs them is marked not measured without them. Missing
 * Events would undercount activity; missing OpportunityHistory would
 * report close-date history as not enabled rather than not measured
 * (maintainer decision D3, 2026-10-03).
 */
export const SALESFORCE_READS: readonly SalesforceObjectRead[] = [
  { object: 'Opportunity', fields: OPPORTUNITY_FIELDS, need: 'required' },
  { object: 'Account', fields: ACCOUNT_FIELDS, need: 'required' },
  { object: 'OpportunityContactRole', fields: OPPORTUNITY_CONTACT_ROLE_FIELDS, need: 'required' },
  { object: 'Task', fields: TASK_FIELDS, need: 'required' },
  { object: 'Event', fields: EVENT_FIELDS, need: 'required' },
  { object: 'OpportunityHistory', fields: OPPORTUNITY_HISTORY_FIELDS, need: 'required' },
  { object: 'Contact', fields: CONTACT_FIELDS, need: 'contacts' },
  { object: 'Note', fields: NOTE_FIELDS, need: 'notes' },
  { object: 'ContentDocumentLink', fields: CONTENT_DOCUMENT_LINK_FIELDS, need: 'notes' },
  { object: 'ContentNote', fields: CONTENT_NOTE_FIELDS, need: 'notes' },
];

/** Shown when preflight() found Note or ContentDocumentLink unreadable. */
export const NOTE_OBJECTS_ACCESS_HINT =
  'Give the Run As user read access to Notes (Note, ContentDocumentLink and ContentNote), so notes can be read.';

/** The OAuth `error` code (and description) in a failed token request's message, if any. */
function tokenErrorOf(err: unknown): { code: string; description: string } | undefined {
  if (!(err instanceof AdapterError) || !err.message.startsWith('Salesforce token request failed')) return undefined;
  const code = /"error"\s*:\s*"([a-z_]+)"/.exec(err.message)?.[1] ?? '';
  const description = /"error_description"\s*:\s*"([^"]*)"/.exec(err.message)?.[1] ?? '';
  return { code, description };
}

/** The Salesforce errorCode in an error's message, if any; never the free text around it. */
function errorCodeOf(err: unknown): string {
  if (!(err instanceof Error)) return 'unexpected error';
  const code = /"errorCode"\s*:\s*"([A-Z_]+)"/.exec(err.message)?.[1];
  if (code) return code;
  const status = /\((\d{3})\)/.exec(err.message)?.[1];
  return status ? `HTTP ${status}` : err instanceof AdapterError ? err.kind : 'unexpected error';
}

/** One sentence for a failure to get a token or reach the org; undefined for other errors. */
function authProblem(err: unknown): string | undefined {
  if (err instanceof AdapterError && err.message.startsWith('Network error requesting Salesforce access token')) {
    return "Couldn't reach Salesforce at SF_INSTANCE_URL. Check the URL and your network connection.";
  }
  const token = tokenErrorOf(err);
  if (token) {
    if (token.code === 'invalid_client_id') {
      return "Salesforce doesn't recognise SF_CLIENT_ID. Use the connected app's Consumer Key (salesforce-setup.md).";
    }
    if (token.code === 'invalid_client') {
      return "Salesforce rejected SF_CLIENT_SECRET. Use the connected app's Consumer Secret (salesforce-setup.md).";
    }
    if (/domain/i.test(token.description)) {
      return "SF_INSTANCE_URL must be your org's My Domain URL, such as https://yourcompany.my.salesforce.com.";
    }
    if (token.code === 'invalid_grant' || token.code === 'unsupported_grant_type') {
      return "The connected app can't use the client credentials flow: turn on Enable Client Credentials Flow and set a Run As user (salesforce-setup.md).";
    }
    return `Salesforce refused the token request (${token.code || errorCodeOf(err)}). Check SF_CLIENT_ID, SF_CLIENT_SECRET and SF_INSTANCE_URL (salesforce-setup.md).`;
  }
  if (err instanceof AdapterError && err.kind === 'auth') {
    return 'Salesforce rejected the access token for this org. Check that the connected app and its Run As user are active (salesforce-setup.md).';
  }
  return undefined;
}

/** Numeric order for API version strings such as '62.0'. */
function versionNumber(v: string): number {
  return Number(v.replace(/^v/, ''));
}

// ---------------------------------------------------------------------------
// Adapter
// ---------------------------------------------------------------------------

export type { RetryInfo } from './retry.js';

/** Optional hooks for SalesforceAdapter, for tests and progress output. */
export interface SalesforceAdapterDeps {
  /** Waits between retries. Default: a real timer. */
  readonly sleep?: (ms: number) => Promise<void>;
  /** Jitter source, in [0, 1). Default: Math.random. */
  readonly random?: () => number;
  /** Called before each wait, e.g. to tell the user why the run paused. The adapter itself prints nothing. */
  readonly onRetry?: (info: RetryInfo) => void;
}

const realSleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

export class SalesforceAdapter implements CrmAdapter {
  readonly vendor = 'salesforce' as const;
  readonly orgId: string;

  private cachedToken: CachedToken | null = null;
  private legacyCacheChecked = false;
  /** Default Sales Process map with the org's own stage map merged over it. */
  private readonly stageMap: Readonly<Record<string, CanonicalStage>>;
  /** Enhanced Note full-text fetches used so far by this instance (one run). */
  private noteFullTextFetchesUsed = 0;
  /** From probe(): whether ContentNote is queryable. null until probed (then the query is tried). */
  private contentNoteQueryable: boolean | null = null;
  /** Set once Enhanced Notes were found linked to a deal but couldn't be read (capabilities().notesComplete). */
  private enhancedNotesUnread = false;
  /** From preflight(): note objects the Run As user can't read; their queries are skipped (capabilities().notesComplete). */
  private readonly unreadableNoteObjects = new Set<'Note' | 'ContentDocumentLink'>();
  /** Set when preflight() decided contentNoteQueryable, so probe() needn't ask again. */
  private contentNoteCheckedByPreflight = false;
  /** opportunityId -> last-seen toStage, for deriving fromStage across listStageHistory pages/calls on this instance. */
  private readonly lastKnownStage = new Map<string, CanonicalStage>();

  constructor(
    private readonly config: SalesforceConfig,
    private readonly deps: SalesforceAdapterDeps = {},
  ) {
    this.orgId = new URL(config.instanceUrl).host;
    this.stageMap = { ...SALESFORCE_STAGE_MAP, ...config.stageMap };
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
      // Backed by the same always-on OpportunityHistory object as
      // stageHistory above, NOT the admin-gated Field History Tracking
      // feature ownerHistory needs — verified against Salesforce docs and a
      // live read-only query/describe against a real dev org: every change
      // to Stage, Amount, Probability, or Close Date (individually) creates
      // a new OpportunityHistory row, unconditionally. See
      // docs/metric-definitions.md's close_date_history_enabled entry for
      // the full evidence. Static true, not a runtime probe — same
      // synchronous capabilities() contract every other field here follows.
      closeDateHistory: true,
      // Unlike closeDateHistory: OpportunityHistory has no NextStep field at
      // all (confirmed via the same describe() call above) — Next Step
      // genuinely has no always-on tracking path and needs Field History
      // Tracking, same as ownerHistory. Declaring false for the same reason.
      nextStepHistory: false,
      // Declared by the user (SF_ACTIVITY_CAPTURE), not detected: see
      // SalesforceActivityCapture. Unset or 'manual' means silence on a
      // deal isn't a reliable signal, so activity_capture_rate reads as
      // not measured rather than scored.
      activitySync: this.config.activityCapture === 'auto',
      // Complete unless Enhanced Notes were found that ContentNote couldn't
      // read (see fetchEnhancedNotes); no linked Enhanced Notes means
      // nothing is missing, queryable or not.
      notesComplete: !this.enhancedNotesUnread && this.unreadableNoteObjects.size === 0,
      ...this.settingHints(),
      // Per run: the ContentNote probe, 2 population counts and the
      // org-wide stage-history read.
      // Per listing page: its contact-role batch. Per sampled deal: none.
      // Per batch of deals: the Notes, Tasks, Events and
      // OpportunityHistories subqueries (childRowsByOpportunity) and
      // ContentDocumentLink. A minimum: extra result pages, and the
      // ContentNote read for a batch with linked Enhanced Notes, aren't
      // counted. Fetch cap: Enhanced Note full-text fetches.
      apiCallEstimate: {
        perRun: 4,
        perScanPage: 1,
        perSampledOpportunity: 0,
        perChildRecordBatch: 5,
        perRunFetchCap: this.config.noteFullTextFetchLimit ?? DEFAULT_NOTE_FULLTEXT_FETCH_LIMIT,
      },
      incrementalSync: true,
      // No Bulk API 2.0 here — REST/SOQL only.
      bulkRead: false,
      writeGranularity: 'none',
      nativeConcurrencyCheck: false,
      // Static Developer-Edition-typical estimate, not queried live via
      // /services/data/vXX/limits/. Flagged as a known gap in STATUS.md.
      rateLimit: { kind: 'daily_quota', value: 15000 },
      stageMap: this.stageMap,
      stageMapHint: STAGE_MAP_HINT,
      accountBatchLimit: 200,
      contactBatchLimit: 200,
      // Salesforce's documented minimum query batch size (the
      // Sforce-Query-Options batchSize header accepts 200 to 2000), so a
      // list call asking for fewer still gets up to 200 rows per page.
      minPageSize: 200,
      childRecordBatchLimit: 200,
      notesPerOpportunityLimit: 200,
      activitiesPerOpportunityLimit: 200,
      historyPerOpportunityLimit: 200,
    };
  }

  private settingHints(): Pick<AdapterCapabilities, 'settingHints'> {
    const hints = {
      ...(this.config.activityCapture === 'auto' ? {} : { activitySync: ACTIVITY_CAPTURE_HINT }),
      ...(this.unreadableNoteObjects.size > 0
        ? { notesComplete: NOTE_OBJECTS_ACCESS_HINT }
        : this.enhancedNotesUnread
          ? { notesComplete: NOTES_ACCESS_HINT }
          : {}),
    };
    return Object.keys(hints).length > 0 ? { settingHints: hints } : {};
  }

  /**
   * One describe call: is ContentNote queryable for the Run As user? It
   * isn't when Notes are off in the org or the user lacks access (the
   * describe answers 404 NOT_FOUND). Any failure counts as not queryable;
   * this never throws. Makes no call when preflight() already checked
   * ContentNote.
   */
  async probe(): Promise<void> {
    if (this.contentNoteCheckedByPreflight) return;
    try {
      const describe = await this.request<{ queryable?: boolean }>(
        `/services/data/${this.config.apiVersion}/sobjects/ContentNote/describe`,
      );
      this.contentNoteQueryable = describe.queryable === true;
    } catch {
      this.contentNoteQueryable = false;
    }
  }

  /**
   * Before any read: credentials (a token), the API version (the org's
   * version list), then object access (one global describe) and field
   * access (one describe per object) for SALESFORCE_READS. Reads no
   * records; at most 12 calls. A credentials or version problem stops the
   * checks there. A 'notes' object that can't be read is a warning: its
   * queries are skipped and notesComplete is false. Messages carry
   * Salesforce error codes, never response text.
   */
  async preflight(options: PreflightOptions = {}): Promise<PreflightResult> {
    const failures: PreflightIssue[] = [];
    const warnings: PreflightIssue[] = [];
    let apiCallsConsumed = 0;
    const result = (): PreflightResult => ({ failures, warnings, apiCallsConsumed });
    const call = async <T>(path: string): Promise<T> => {
      apiCallsConsumed += 1;
      return this.request<T>(path);
    };

    let versions: unknown;
    try {
      versions = await call<unknown>('/services/data/');
    } catch (err) {
      const auth = authProblem(err);
      failures.push(
        auth
          ? { check: 'auth', message: auth }
          : { check: 'api_version', message: `Couldn't list this org's API versions (${errorCodeOf(err)}).` },
      );
      return result();
    }
    const offered = (Array.isArray(versions) ? (versions as { version?: unknown }[]) : [])
      .map((v) => v?.version)
      .filter((v): v is string => typeof v === 'string');
    if (!offered.includes(this.config.apiVersion.replace(/^v/, ''))) {
      const newest = offered.slice().sort((a, b) => versionNumber(b) - versionNumber(a))[0];
      failures.push({
        check: 'api_version',
        message: newest
          ? `This org doesn't offer API version ${this.config.apiVersion}; the newest it offers is v${newest}. Set SF_API_VERSION=v${newest}.`
          : `This org didn't list any API versions, so ${this.config.apiVersion} can't be checked.`,
      });
      return result();
    }

    const base = `/services/data/${this.config.apiVersion}/sobjects`;
    let sobjects: readonly { name?: unknown; queryable?: unknown }[];
    try {
      const global = await call<{ sobjects?: unknown }>(`${base}/`);
      sobjects = Array.isArray(global.sobjects) ? (global.sobjects as { name?: unknown; queryable?: unknown }[]) : [];
    } catch (err) {
      const auth = authProblem(err);
      failures.push(
        auth
          ? { check: 'auth', message: auth }
          : {
              check: 'object_access',
              message: `The Run As user can't list Salesforce objects (${errorCodeOf(err)}). Check that it has the API Enabled permission.`,
            },
      );
      return result();
    }
    const queryable = new Set(sobjects.filter((s) => s?.queryable === true).map((s) => s.name));

    for (const read of SALESFORCE_READS) {
      if (read.need === 'contacts' && !options.contacts) continue;
      let problem: PreflightIssue | undefined;
      if (!queryable.has(read.object)) {
        problem = {
          check: 'object_access',
          message: `The Run As user can't read ${read.object} records. Give it Read access to ${read.object} in a permission set.`,
        };
      } else {
        try {
          const describe = await call<{ fields?: unknown }>(`${base}/${read.object}/describe`);
          const visible = new Set(
            (Array.isArray(describe.fields) ? (describe.fields as { name?: unknown }[]) : []).map((f) => f?.name),
          );
          const missing = read.fields.filter((f) => !visible.has(f));
          if (missing.length > 0) {
            problem = {
              check: 'field_access',
              message: `The Run As user can't read ${missing.map((f) => `${read.object}.${f}`).join(', ')}. Give it Read access to ${missing.length === 1 ? 'that field' : 'those fields'} (field-level security).`,
            };
          }
        } catch (err) {
          const auth = authProblem(err);
          if (auth) {
            failures.push({ check: 'auth', message: auth });
            return result();
          }
          problem = { check: 'object_access', message: `Couldn't check access to ${read.object} (${errorCodeOf(err)}).` };
        }
      }

      if (read.object === 'ContentNote') {
        this.contentNoteQueryable = problem === undefined;
        this.contentNoteCheckedByPreflight = true;
      }
      if (!problem) continue;
      if (read.need !== 'notes') {
        failures.push(problem);
        continue;
      }
      const consequence =
        read.object === 'ContentNote'
          ? 'Until then, Enhanced Notes are not read, and if the scan finds any, note metrics are marked not measured.'
          : 'Until then, note metrics are marked not measured.';
      if (read.object === 'Note' || read.object === 'ContentDocumentLink') this.unreadableNoteObjects.add(read.object);
      warnings.push({ ...problem, message: `${problem.message} ${consequence}` });
    }
    return result();
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
    if (!this.legacyCacheChecked) {
      this.legacyCacheChecked = true;
      await removeLegacyTokenCache(LEGACY_TOKEN_CACHE_PATH, this.config.tokenCachePath);
    }
    if (!forceRefresh) {
      if (this.cachedToken) return this.cachedToken;
      const fromDisk = await readTokenCache(this.config.tokenCachePath);
      if (fromDisk) {
        this.cachedToken = fromDisk;
        return fromDisk;
      }
    }
    const fresh = await fetchAccessToken(this.config, (send) => this.withBackoff(send));
    this.cachedToken = fresh;
    await writeTokenCache(this.config.tokenCachePath, fresh);
    return fresh;
  }

  private async request<T>(pathOrUrl: string, init: RequestInit = {}): Promise<T> {
    return this.requestWithRetry<T>(pathOrUrl, init, 'json');
  }

  /** Same auth, retry and error mapping as request(), for an endpoint that returns a raw body. */
  private async requestText(pathOrUrl: string): Promise<string> {
    return this.requestWithRetry<string>(pathOrUrl, {}, 'text');
  }

  /**
   * Calls send() until the answer is not a retryable throttle (throttleOf),
   * or the retry policy gives up. Each attempt is a fresh send(), so a
   * retried page of a paged query is that one page, not the whole query.
   */
  private async withBackoff(send: () => Promise<Response>): Promise<SettledResponse> {
    const policy = DEFAULT_RETRY_POLICY;
    let waitedMs = 0;
    for (let attempt = 1; ; attempt += 1) {
      const res = await send();
      const throttle = await throttleOf(res);
      if (throttle.kind === 'none') return throttle.body === undefined ? { res } : { res, body: throttle.body };
      if (throttle.kind === 'daily') throw new AdapterError(DAILY_LIMIT_MESSAGE, 'rate_limit', false);
      const delayMs = nextRetryDelay(policy, attempt, waitedMs, throttle.retryAfterMs, this.deps.random ?? Math.random);
      if (delayMs === undefined) {
        throw new AdapterError(
          gaveUpMessage(throttle.reason, attempt, waitedMs),
          throttle.rateLimited ? 'rate_limit' : 'unknown',
          true,
          throttle.retryAfterMs,
        );
      }
      this.deps.onRetry?.({ reason: throttle.reason, attempt: attempt + 1, maxAttempts: policy.maxAttempts, delayMs });
      await (this.deps.sleep ?? realSleep)(delayMs);
      waitedMs += delayMs;
    }
  }

  /** One authorised fetch; after a 401, one new token and one more fetch. */
  private async sendAuthorized(pathOrUrl: string, init: RequestInit): Promise<Response> {
    const send = async (forceRefresh: boolean): Promise<Response> => {
      const token = await this.getToken(forceRefresh);
      const url = pathOrUrl.startsWith('http') ? pathOrUrl : `${token.instanceUrl}${pathOrUrl}`;
      try {
        return await fetch(url, {
          ...init,
          headers: { Authorization: `Bearer ${token.accessToken}`, ...(init.headers ?? {}) },
        });
      } catch (err) {
        throw new AdapterError(`Network error calling Salesforce: ${err instanceof Error ? err.message : String(err)}`, 'network', true);
      }
    };
    const res = await send(false);
    return res.status === 401 ? send(true) : res;
  }

  private async requestWithRetry<T>(pathOrUrl: string, init: RequestInit, as: 'json' | 'text'): Promise<T> {
    const { res, body } = await this.withBackoff(() => this.sendAuthorized(pathOrUrl, init));
    if (res.status === 401 || res.status === 403) {
      const detail = body ?? (await safeReadBody(res));
      throw new AdapterError(
        `Salesforce ${res.status === 401 ? 'auth' : 'permission'} error: ${detail}`,
        res.status === 401 ? 'auth' : 'permission',
        false,
      );
    }
    if (!res.ok) {
      const detail = body ?? (await safeReadBody(res));
      throw new AdapterError(`Salesforce API error (${res.status}): ${detail}`, 'unknown', res.status >= 500);
    }
    if (as === 'text') return (await safeReadBody(res)) as T;
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
    const { stage, stageConfidence } = mapStage(this.stageMap, raw.StageName, raw.IsClosed, raw.IsWon);
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
      // From TaskSubtype, a standard field (Type isn't: it was dropped as
      // not present on every org, see STATUS.md).
      kind: taskKind(raw.TaskSubtype),
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

  /** Same trust handling as mapTask; an Event is always a meeting. */
  private mapEvent = (raw: RawEvent): Activity => {
    const relatedTo: RecordRef[] = [];
    if (raw.WhatId) relatedTo.push(this.ref('opportunity', raw.WhatId));
    if (raw.WhoId) relatedTo.push(this.ref('contact', raw.WhoId));
    const occurredAt = raw.ActivityDateTime ?? raw.ActivityDate ?? raw.CreatedDate;
    const tier = inferTier({ objectType: 'activity', field: 'body', authorIsInternalUser: true, activityDirection: 'unknown' });
    return {
      ref: this.ref('activity', raw.Id),
      relatedTo,
      kind: 'meeting',
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

  /** A history row's stage: mapped, or a 'prospecting' placeholder marked unmapped (never a silent guess). */
  private historyStage(stageName: string | null): { toStage: CanonicalStage; unmapped: boolean } {
    const mapped = stageName ? this.stageMap[stageName] : undefined;
    return mapped ? { toStage: mapped, unmapped: false } : { toStage: 'prospecting', unmapped: true };
  }

  private mapStageHistory = (raw: RawOpportunityHistory): StageHistoryEntry => {
    const { toStage, unmapped } = this.historyStage(raw.StageName);
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
      ...(unmapped ? { toStageConfidence: 'unmapped' as const } : {}),
    };
  };

  // -- CrmAdapter: list* ------------------------------------------------

  async listAccounts(w: SyncWindow): Promise<SyncPage<Account>> {
    return this.listViaSoql<RawAccount, Account>({ objectName: 'Account', fields: ACCOUNT_FIELDS, w, map: this.mapAccount });
  }

  async listOpportunities(w: SyncWindow): Promise<SyncPage<Opportunity>> {
    const page = await this.listViaSoql<RawOpportunity, Opportunity>({
      objectName: 'Opportunity',
      fields: OPPORTUNITY_FIELDS,
      w,
      map: (raw) => this.mapOpportunity(raw),
    });
    // Contact roles for the whole page, one OpportunityContactRole query
    // per childRecordBatchLimit ids, so contactLinks is populated the same
    // as getOpportunity() and the mock (contact_linkage_rate reads it).
    const { linksByOpportunity, apiCallsConsumed } = await this.fetchContactLinksFor(page.items.map((o) => o.ref.id));
    return {
      ...page,
      items: page.items.map((o) => ({ ...o, contactLinks: linksByOpportunity.get(o.ref.id) ?? [] })),
      apiCallsConsumed: page.apiCallsConsumed + apiCallsConsumed,
    };
  }

  async listOpportunitiesForSample(w: SampleWindow): Promise<SamplePage<Opportunity>> {
    let page: SoqlResponse<RawOpportunity>;
    if (w.cursor) {
      page = await this.soqlQueryMore<RawOpportunity>(w.cursor);
    } else {
      const soql =
        `SELECT ${OPPORTUNITY_FIELDS.join(', ')} FROM Opportunity WHERE ${samplePopulationWhere(w)} ` +
        `ORDER BY CreatedDate DESC, Id DESC`;
      page = await this.soqlQuery<RawOpportunity>(soql, Math.min(2000, Math.max(200, w.limit)));
    }
    const items = page.records.map((raw) => this.mapOpportunity(raw));
    const { linksByOpportunity, apiCallsConsumed } = await this.fetchContactLinksFor(items.map((o) => o.ref.id));
    return {
      items: items.map((o) => ({ ...o, contactLinks: linksByOpportunity.get(o.ref.id) ?? [] })),
      nextCursor: page.done ? undefined : page.nextRecordsUrl,
      apiCallsConsumed: 1 + apiCallsConsumed,
    };
  }

  async countOpportunitiesForSample(p: SamplePopulation): Promise<SamplePopulationCount> {
    const { from, to } = closedWindowDates(p);
    const open = await this.soqlQuery<never>('SELECT COUNT() FROM Opportunity WHERE IsClosed = false');
    const closed = await this.soqlQuery<never>(
      `SELECT COUNT() FROM Opportunity WHERE IsClosed = true AND CloseDate >= ${from} AND CloseDate <= ${to}`,
    );
    return { open: open.totalSize, closedInWindow: closed.totalSize, apiCallsConsumed: 2 };
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

  /**
   * Contact roles for many opportunities, batched at childRecordBatchLimit
   * ids per query (an IN list, so the URL stays well under Salesforce's
   * length limit). Follows nextRecordsUrl, since one batch can return more
   * than one page of roles. Order within an opportunity is the query order.
   */
  private async fetchContactLinksFor(
    opportunityIds: readonly string[],
  ): Promise<{ linksByOpportunity: Map<string, OpportunityContactLink[]>; apiCallsConsumed: number }> {
    const linksByOpportunity = new Map<string, OpportunityContactLink[]>();
    let apiCallsConsumed = 0;
    const ids = [...new Set(opportunityIds)];
    const batch = this.capabilities().childRecordBatchLimit;
    for (let i = 0; i < ids.length; i += batch) {
      const chunk = ids.slice(i, i + batch);
      const soql =
        `SELECT ${OPPORTUNITY_CONTACT_ROLE_FIELDS.join(', ')} FROM OpportunityContactRole ` +
        `WHERE OpportunityId IN (${soqlIdList(chunk)}) ORDER BY OpportunityId, Id`;
      let page = await this.soqlQuery<RawOpportunityContactRole>(soql);
      apiCallsConsumed += 1;
      for (;;) {
        for (const r of page.records) {
          const links = linksByOpportunity.get(r.OpportunityId) ?? [];
          links.push({ contactRef: this.ref('contact', r.ContactId), role: r.Role ?? undefined, isPrimary: r.IsPrimary });
          linksByOpportunity.set(r.OpportunityId, links);
        }
        if (page.done || !page.nextRecordsUrl) break;
        page = await this.soqlQueryMore<RawOpportunityContactRole>(page.nextRecordsUrl);
        apiCallsConsumed += 1;
      }
    }
    return { linksByOpportunity, apiCallsConsumed };
  }

  /**
   * Child rows per opportunity through a parent-child subquery,
   * SELECT Id, (<subquery>) FROM Opportunity WHERE Id IN (...), in batches
   * of childRecordBatchLimit ids. The subquery keeps its own ORDER BY and
   * LIMIT, so each deal is capped exactly as a per-deal query would be
   * (SOQL has no per-group LIMIT on a flat IN-list query). Salesforce may
   * return fewer parents per page when a query has subqueries, and may
   * split a parent's child rows; both nextRecordsUrl chains are followed
   * and every page is counted. A parent missing from the result (not found
   * or not visible) has no rows.
   */
  private async childRowsByOpportunity<T>(
    opportunityIds: readonly string[],
    relationship: string,
    subquery: string,
  ): Promise<{ rowsByOpportunity: Map<string, T[]>; apiCallsConsumed: number }> {
    const rowsByOpportunity = new Map<string, T[]>();
    let apiCallsConsumed = 0;
    const batch = this.capabilities().childRecordBatchLimit;
    for (let i = 0; i < opportunityIds.length; i += batch) {
      const chunk = opportunityIds.slice(i, i + batch);
      let page = await this.soqlQuery<RawParentWithChildren<T>>(
        `SELECT Id, (${subquery}) FROM Opportunity WHERE Id IN (${soqlIdList(chunk)})`,
      );
      apiCallsConsumed += 1;
      for (;;) {
        for (const parent of page.records) {
          let child = parent[relationship] as SoqlResponse<T> | null | undefined;
          const rows: T[] = [];
          while (child) {
            rows.push(...child.records);
            if (child.done || !child.nextRecordsUrl) break;
            child = await this.soqlQueryMore<T>(child.nextRecordsUrl);
            apiCallsConsumed += 1;
          }
          rowsByOpportunity.set(parent.Id, rows);
        }
        if (page.done || !page.nextRecordsUrl) break;
        page = await this.soqlQueryMore<RawParentWithChildren<T>>(page.nextRecordsUrl);
        apiCallsConsumed += 1;
      }
    }
    return { rowsByOpportunity, apiCallsConsumed };
  }

  /**
   * Legacy Notes (the Notes subquery, batched by id, see
   * childRowsByOpportunity) merged with Enhanced Notes (ContentNote, found
   * through ContentDocumentLink in batched IN-list queries). The combined
   * list per opportunity is cut to notesPerOpportunityLimit, newest kept,
   * and the opportunity is marked truncated if either source had more.
   * Every call is counted in apiCallsConsumed.
   */
  async getNotesByOpportunity(oppRefs: readonly RecordRef[]): Promise<GetChildRecordsResult<Note>> {
    if (oppRefs.length === 0) return { items: [], truncatedOpportunityIds: new Set(), apiCallsConsumed: 0 };
    const limit = this.capabilities().notesPerOpportunityLimit;
    const ids = dedupeIds(oppRefs);
    ids.forEach(assertValidSalesforceId);
    const truncatedOpportunityIds = new Set<string>();

    // Skipped when preflight() found Note unreadable (notesComplete is then false).
    const legacy = this.unreadableNoteObjects.has('Note')
      ? { rowsByOpportunity: new Map<string, RawNote[]>(), apiCallsConsumed: 0 }
      : await this.childRowsByOpportunity<RawNote>(
          ids,
          'Notes',
          `SELECT ${NOTE_FIELDS.join(', ')} FROM Notes ORDER BY CreatedDate DESC NULLS LAST LIMIT ${limit + 1}`,
        );
    let apiCallsConsumed = legacy.apiCallsConsumed;
    const byOpp = new Map<string, Note[]>();
    for (const oppId of ids) byOpp.set(oppId, (legacy.rowsByOpportunity.get(oppId) ?? []).map(this.mapNote));

    const enhanced = await this.fetchEnhancedNotes(ids);
    apiCallsConsumed += enhanced.apiCallsConsumed;
    for (const [oppId, notes] of enhanced.notesByOpportunity) {
      byOpp.set(oppId, [...(byOpp.get(oppId) ?? []), ...notes]);
    }

    const items: Note[] = [];
    for (const oppId of ids) {
      const desc = (byOpp.get(oppId) ?? []).slice().sort(newestFirst((n) => n.createdAt));
      if (desc.length > limit) truncatedOpportunityIds.add(oppId);
      items.push(...desc.slice(0, limit).reverse()); // back to ascending, newest-kept
    }
    return { items, truncatedOpportunityIds, apiCallsConsumed };
  }

  /**
   * Enhanced Notes for the given opportunities: ContentDocumentLink ->
   * ContentNote (TextPreview), in batches of childRecordBatchLimit ids.
   * A preview at ENHANCED_NOTE_PREVIEW_CAP may be cut off, so its full text
   * is fetched, one call per note, while this instance's
   * noteFullTextFetchLimit lasts; past it, the note keeps its preview and
   * is marked bodyTruncated. A note linked to several of the opportunities
   * is returned once per opportunity, like a legacy Note would be.
   */
  private async fetchEnhancedNotes(
    opportunityIds: readonly string[],
  ): Promise<{ notesByOpportunity: Map<string, Note[]>; apiCallsConsumed: number }> {
    const notesByOpportunity = new Map<string, Note[]>();
    let apiCallsConsumed = 0;
    const batch = this.capabilities().childRecordBatchLimit;
    const fetchLimit = this.config.noteFullTextFetchLimit ?? DEFAULT_NOTE_FULLTEXT_FETCH_LIMIT;
    // preflight() found ContentDocumentLink unreadable: Enhanced Notes can't be found (notesComplete is then false).
    if (this.unreadableNoteObjects.has('ContentDocumentLink')) return { notesByOpportunity, apiCallsConsumed };

    for (let i = 0; i < opportunityIds.length; i += batch) {
      const chunk = opportunityIds.slice(i, i + batch);
      const links: RawContentDocumentLink[] = [];
      let page = await this.soqlQuery<RawContentDocumentLink>(
        `SELECT ${CONTENT_DOCUMENT_LINK_FIELDS.join(', ')} FROM ContentDocumentLink ` +
          `WHERE LinkedEntityId IN (${soqlIdList(chunk)}) AND ContentDocument.FileType = 'SNOTE'`,
      );
      apiCallsConsumed += 1;
      for (;;) {
        links.push(...page.records);
        if (page.done || !page.nextRecordsUrl) break;
        page = await this.soqlQueryMore<RawContentDocumentLink>(page.nextRecordsUrl);
        apiCallsConsumed += 1;
      }
      if (links.length === 0) continue;
      if (this.contentNoteQueryable === false) {
        this.enhancedNotesUnread = true;
        continue;
      }

      const docIds = [...new Set(links.map((l) => l.ContentDocumentId))];
      const notesById = new Map<string, Note>();
      for (let j = 0; j < docIds.length; j += batch) {
        const docChunk = docIds.slice(j, j + batch);
        let notePage: SoqlResponse<RawContentNote>;
        try {
          notePage = await this.soqlQuery<RawContentNote>(
            `SELECT ${CONTENT_NOTE_FIELDS.join(', ')} FROM ContentNote WHERE Id IN (${soqlIdList(docChunk)})`,
          );
        } catch (err) {
          apiCallsConsumed += 1;
          // Not probed, or access changed since: the same outcome as a
          // failed probe, never a failed run. Other errors still throw.
          if (!(err instanceof AdapterError && err.message.includes('INVALID_TYPE'))) throw err;
          this.contentNoteQueryable = false;
          this.enhancedNotesUnread = true;
          break;
        }
        apiCallsConsumed += 1;
        for (;;) {
          for (const raw of notePage.records) {
            const preview = raw.TextPreview ?? '';
            let text = preview;
            let bodyTruncated = false;
            if (preview.length >= ENHANCED_NOTE_PREVIEW_CAP) {
              if (this.noteFullTextFetchesUsed < fetchLimit) {
                assertValidSalesforceId(raw.Id);
                this.noteFullTextFetchesUsed += 1;
                apiCallsConsumed += 1;
                text = htmlToText(await this.requestText(`/services/data/${this.config.apiVersion}/sobjects/ContentNote/${raw.Id}/Content`));
              } else {
                bodyTruncated = true;
              }
            }
            notesById.set(raw.Id, this.mapContentNote(raw, text, bodyTruncated));
          }
          if (notePage.done || !notePage.nextRecordsUrl) break;
          notePage = await this.soqlQueryMore<RawContentNote>(notePage.nextRecordsUrl);
          apiCallsConsumed += 1;
        }
      }

      for (const link of links) {
        const note = notesById.get(link.ContentDocumentId);
        if (!note) continue;
        const list = notesByOpportunity.get(link.LinkedEntityId) ?? [];
        list.push({ ...note, relatedTo: [this.ref('opportunity', link.LinkedEntityId)] });
        notesByOpportunity.set(link.LinkedEntityId, list);
      }
    }
    return { notesByOpportunity, apiCallsConsumed };
  }

  private mapContentNote(raw: RawContentNote, text: string, bodyTruncated: boolean): Note {
    return {
      ref: this.ref('note', raw.Id),
      relatedTo: [],
      authorId: raw.OwnerId ?? undefined,
      createdAt: raw.CreatedDate,
      body: tag(TrustTier.UserAuthored, text, { recordId: `note:${raw.Id}`, field: 'body', capturedAt: raw.CreatedDate }),
      ...(bodyTruncated ? { bodyTruncated: true } : {}),
    };
  }

  /**
   * Tasks and Events (meetings) per opportunity, each read newest-first with
   * LIMIT limit+1 per deal (the Tasks and Events subqueries, batched by id,
   * see childRowsByOpportunity), merged by occurredAt and cut to
   * activitiesPerOpportunityLimit, newest kept. Truncated if the merged
   * list had more than the limit.
   */
  async getActivitiesByOpportunity(oppRefs: readonly RecordRef[]): Promise<GetChildRecordsResult<Activity>> {
    if (oppRefs.length === 0) return { items: [], truncatedOpportunityIds: new Set(), apiCallsConsumed: 0 };
    const limit = this.capabilities().activitiesPerOpportunityLimit;
    const ids = dedupeIds(oppRefs);
    ids.forEach(assertValidSalesforceId);
    const tasks = await this.childRowsByOpportunity<RawTask>(
      ids,
      'Tasks',
      `SELECT ${TASK_FIELDS.join(', ')} FROM Tasks ORDER BY ActivityDate DESC NULLS LAST, CreatedDate DESC LIMIT ${limit + 1}`,
    );
    const events = await this.childRowsByOpportunity<RawEvent>(
      ids,
      'Events',
      `SELECT ${EVENT_FIELDS.join(', ')} FROM Events ORDER BY ActivityDateTime DESC NULLS LAST, CreatedDate DESC LIMIT ${limit + 1}`,
    );
    const items: Activity[] = [];
    const truncatedOpportunityIds = new Set<string>();
    for (const oppId of ids) {
      const desc = [
        ...(tasks.rowsByOpportunity.get(oppId) ?? []).map(this.mapTask),
        ...(events.rowsByOpportunity.get(oppId) ?? []).map(this.mapEvent),
      ].sort(newestFirst((a) => a.occurredAt));
      if (desc.length > limit) truncatedOpportunityIds.add(oppId);
      items.push(...desc.slice(0, limit).reverse());
    }
    return { items, truncatedOpportunityIds, apiCallsConsumed: tasks.apiCallsConsumed + events.apiCallsConsumed };
  }

  /**
   * Pure, per-opportunity fromStage derivation — deliberately NOT
   * mapStageHistory (which mutates this.lastKnownStage as a side effect,
   * correct only under listStageHistory's single global chronological
   * stream). A by-ref batch call fetches one opportunity's full history at
   * once; reusing the shared stateful map here would either corrupt or be
   * corrupted by whatever listStageHistory is concurrently doing, and its
   * ordering guarantee doesn't hold for an arbitrary WHERE-IN result set
   * anyway. rows must already be ascending by CreatedDate.
   */
  private mapStageHistoryForOpportunity(rows: readonly RawOpportunityHistory[]): StageHistoryEntry[] {
    let previous: CanonicalStage | undefined;
    const result: StageHistoryEntry[] = [];
    for (const raw of rows) {
      const { toStage, unmapped } = this.historyStage(raw.StageName);
      result.push({
        ref: this.ref('stage_history', raw.Id),
        opportunityRef: this.ref('opportunity', raw.OpportunityId),
        fromStage: previous,
        toStage,
        changedAt: raw.CreatedDate,
        changedBy: raw.CreatedById ?? undefined,
        closeDateAtChange: raw.CloseDate ?? undefined,
        ...(unmapped ? { toStageConfidence: 'unmapped' as const } : {}),
      });
      previous = toStage;
    }
    return result;
  }

  /**
   * Same batched subquery shape as getNotesByOpportunity (the
   * OpportunityHistories subquery, see childRowsByOpportunity), reusing
   * OpportunityHistory (the same always-on object listStageHistory already
   * reads — see capabilities().closeDateHistory's docblock) per deal
   * instead of a since-window. fromStage is derived locally per deal
   * (mapStageHistoryForOpportunity), not via the stateful mapStageHistory
   * used by the stream.
   */
  async getStageHistoryByOpportunity(oppRefs: readonly RecordRef[]): Promise<GetChildRecordsResult<StageHistoryEntry>> {
    if (oppRefs.length === 0) return { items: [], truncatedOpportunityIds: new Set(), apiCallsConsumed: 0 };
    const limit = this.capabilities().historyPerOpportunityLimit;
    const ids = dedupeIds(oppRefs);
    ids.forEach(assertValidSalesforceId);
    const history = await this.childRowsByOpportunity<RawOpportunityHistory>(
      ids,
      'OpportunityHistories',
      `SELECT ${OPPORTUNITY_HISTORY_FIELDS.join(', ')} FROM OpportunityHistories ORDER BY CreatedDate DESC LIMIT ${limit + 1}`,
    );
    const items: StageHistoryEntry[] = [];
    const truncatedOpportunityIds = new Set<string>();
    for (const oppId of ids) {
      const desc = history.rowsByOpportunity.get(oppId) ?? [];
      if (desc.length > limit) truncatedOpportunityIds.add(oppId);
      const ascending = desc.slice(0, limit).reverse(); // back to ascending, newest-kept
      items.push(...this.mapStageHistoryForOpportunity(ascending));
    }
    return { items, truncatedOpportunityIds, apiCallsConsumed: history.apiCallsConsumed };
  }

  async getNextStepHistoryByOpportunity(_oppRefs: readonly RecordRef[]): Promise<GetChildRecordsResult<NextStepChange>> {
    // capabilities().nextStepHistory is false — contract requires empty, not
    // a throw, same as listOwnerChanges above for the same reason (Next Step
    // has no always-on tracking path on this adapter, see capabilities()).
    return { items: [], truncatedOpportunityIds: new Set(), apiCallsConsumed: 0 };
  }

  async getOpportunity(ref: RecordRef): Promise<Opportunity | null> {
    assertValidSalesforceId(ref.id);
    const soql = `SELECT ${OPPORTUNITY_FIELDS.join(', ')} FROM Opportunity WHERE Id = '${ref.id}' LIMIT 1`;
    const page = await this.soqlQuery<RawOpportunity>(soql);
    const raw = page.records[0];
    if (!raw) return null;
    const { linksByOpportunity } = await this.fetchContactLinksFor([ref.id]);
    return this.mapOpportunity(raw, linksByOpportunity.get(ref.id) ?? []);
  }

  // -- CrmAdapter: writes (disabled) --------------------------------------

  async applyFieldWrite(_w: FieldWrite): Promise<WriteOutcome> {
    return { status: 'rejected', reason: 'read-only adapter: Salesforce writes are disabled' };
  }
}

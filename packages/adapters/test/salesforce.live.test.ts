/**
 * SalesforceAdapter against a real org. Opt-in and read-only:
 *
 *   npm run test:live -w @gtm-trust-kernel/adapters
 *
 * `npm test` never runs this file (vitest.config.ts excludes it). It loads
 * the repo-root .env if present, then skips, with a message, unless
 * SF_CLIENT_ID, SF_CLIENT_SECRET and SF_INSTANCE_URL are set. The adapter
 * never writes to Salesforce (applyFieldWrite always rejects), and nothing
 * here seeds data: the pagination check reads a deal seeded by hand.
 *
 * Three parts:
 *  - the shared CRM adapter contract (contract/adapter.contract.ts);
 *  - a readiness-shaped read pass: every response must have the shape the
 *    adapter reads (contract/salesforceShapes.ts), within an API call budget;
 *  - child pagination on a deal with more Tasks than the per-deal cap,
 *    found by CONTRACT-PAGINATION in their Subject (skipped if absent).
 */

import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { Activity, RecordRef } from '../src/model/canonical.js';
import { loadSalesforceConfigFromEnv, SalesforceAdapter } from '../src/salesforce.js';
import { runAdapterContract, type ContractHarness } from './contract/adapter.contract.js';
import { checkSalesforceShapes, recordSalesforceResponses, type RecordedResponse } from './contract/salesforceShapes.js';
import { unresolvableSalesforceIdFor } from './support/salesforceIds.js';

const ROOT_ENV = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../.env');
if (existsSync(ROOT_ENV)) process.loadEnvFile(ROOT_ENV);

const REQUIRED = ['SF_CLIENT_ID', 'SF_CLIENT_SECRET', 'SF_INSTANCE_URL'] as const;
const missing = REQUIRED.filter((k) => !process.env[k]);
if (missing.length > 0) {
  console.warn(`Salesforce live tests skipped: ${missing.join(', ')} not set (shell or repo-root .env).`);
}

/**
 * Provisional: at most this many API calls for one readiness-shaped read
 * pass. The 35-deal dev org measured 12 (2026-09-30). Not calibrated; revisit
 * when the org or the read pattern changes.
 */
const LIVE_RUN_API_CALL_BUDGET = 25;

/** Seeded by hand on one deal's Tasks; this package never writes it. */
const PAGINATION_MARKER = 'CONTRACT-PAGINATION';

const newAdapter = () => new SalesforceAdapter(loadSalesforceConfigFromEnv());

/** Known ids from the org itself, so the run needs no settings beyond credentials. */
async function discover(): Promise<ContractHarness> {
  const adapter = newAdapter();
  await adapter.probe();
  // The contract resolves notes and activities on the known opportunity,
  // so pick one that has both (and an account).
  const opps = (await adapter.listOpportunities({ limit: 200 })).items.filter((o) => o.accountRef.id);
  const refs = opps.map((o) => o.ref);
  const onDeal = (items: readonly { relatedTo: readonly RecordRef[] }[]) =>
    new Set(items.flatMap((i) => i.relatedTo.map((r) => r.id)));
  const withNotes = onDeal((await adapter.getNotesByOpportunity(refs)).items);
  const withActivities = onDeal((await adapter.getActivitiesByOpportunity(refs)).items);
  const opp = opps.find((o) => withNotes.has(o.ref.id) && withActivities.has(o.ref.id));
  const contact = (await adapter.listContacts({ limit: 200 })).items[0];
  if (!opp || !contact) {
    throw new Error(
      'The live org needs an opportunity with an account, a note and an activity, and a contact (packages/readiness/docs/salesforce-setup.md section 5).',
    );
  }
  return {
    adapter,
    knownOpportunityId: opp.ref.id,
    knownAccountId: opp.accountRef.id,
    knownContactId: contact.ref.id,
    // The adapter refuses ids not in Salesforce's format; see salesforceIds.ts.
    unresolvableId: unresolvableSalesforceIdFor,
  };
}

/**
 * Logging only: each page of one deal's `relationship` child rows, in
 * request order (the inline first page, then any nextRecordsUrl pages).
 */
function childPages(responses: readonly RecordedResponse[], relationship: string, dealId: string): { rows: number; next: boolean }[] {
  const pages: { rows: number; next: boolean }[] = [];
  const pageOf = (v: unknown) => {
    const p = v as { records?: unknown[]; nextRecordsUrl?: unknown } | null;
    return { rows: p?.records?.length ?? 0, next: typeof p?.nextRecordsUrl === 'string' };
  };
  for (const r of responses) {
    if (r.kind !== 'query' || !r.soql?.includes(` FROM ${relationship} `)) continue;
    if (r.role === 'child') {
      pages.push(pageOf(r.body));
      continue;
    }
    const records = (r.body as { records?: Record<string, unknown>[] }).records ?? [];
    const parent = records.find((p) => p.Id === dealId);
    if (parent) pages.push(pageOf(parent[relationship]));
  }
  return pages;
}

/**
 * Logging only, on the skip path: the Run As user's username, from a fresh
 * client-credentials token and the userinfo endpoint (2 calls, outside any
 * budget). Never throws; a failure is reported in the returned text.
 */
async function runAsUsername(): Promise<string> {
  try {
    const config = loadSalesforceConfigFromEnv();
    const tokenRes = await fetch(`${config.instanceUrl}/services/oauth2/token`, {
      method: 'POST',
      body: new URLSearchParams({ grant_type: 'client_credentials', client_id: config.clientId, client_secret: config.clientSecret }),
    });
    const token = (await tokenRes.json()) as { access_token?: string; instance_url?: string };
    if (!token.access_token) return `unknown (token request answered ${tokenRes.status})`;
    const infoRes = await fetch(`${token.instance_url ?? config.instanceUrl}/services/oauth2/userinfo`, {
      headers: { Authorization: `Bearer ${token.access_token}` },
    });
    const info = (await infoRes.json()) as { preferred_username?: string };
    return info.preferred_username ?? `unknown (userinfo answered ${infoRes.status})`;
  } catch (err) {
    return `unknown (${err instanceof Error ? err.message : String(err)})`;
  }
}

describe.skipIf(missing.length > 0)('SalesforceAdapter (live org)', () => {
  let harness: Promise<ContractHarness> | undefined;
  const make = () => (harness ??= discover());

  describe('CRM adapter contract', () => runAdapterContract(make));

  it(`reads like a readiness run in at most ${LIVE_RUN_API_CALL_BUDGET} API calls, every response in the shape the adapter reads`, async () => {
    const adapter = newAdapter();
    const rec = recordSalesforceResponses();
    try {
      await adapter.probe();
      const population = { asOf: new Date().toISOString(), closedWithinMonths: 12 };
      await adapter.countOpportunitiesForSample(population);
      await adapter.listStageHistory({ limit: 1 });
      const refs: RecordRef[] = [];
      const accountRefs = new Map<string, RecordRef>();
      let cursor: string | undefined;
      do {
        const page = await adapter.listOpportunitiesForSample({ ...population, limit: 200, cursor });
        for (const o of page.items) {
          refs.push(o.ref);
          if (o.accountRef.id) accountRefs.set(o.accountRef.id, o.accountRef);
        }
        cursor = page.nextCursor;
      } while (cursor);
      await adapter.getAccounts([...accountRefs.values()]);
      await adapter.getNotesByOpportunity(refs);
      await adapter.getActivitiesByOpportunity(refs);
      await adapter.getStageHistoryByOpportunity(refs);
    } finally {
      rec.restore();
    }
    console.info(`Live read pass: ${rec.requests.length} API calls (budget ${LIVE_RUN_API_CALL_BUDGET}).`);
    expect(checkSalesforceShapes(rec.responses).violations).toEqual([]);
    expect(rec.requests.length).toBeLessThanOrEqual(LIVE_RUN_API_CALL_BUDGET);
  });

  it('reads a deal with more Tasks than the per-deal cap: capped, flagged, in the documented shape', async (ctx) => {
    const adapter = newAdapter();
    const marked: Activity[] = [];
    let cursor: string | undefined;
    do {
      const page = await adapter.listActivities({ limit: 2000, cursor });
      marked.push(...page.items.filter((a) => a.subject?.value.includes(PAGINATION_MARKER)));
      cursor = page.nextCursor;
    } while (cursor);
    const deals = new Map(marked.flatMap((a) => a.relatedTo.filter((r) => r.id.startsWith('006'))).map((r) => [r.id, r]));
    if (deals.size === 0) {
      console.warn(`Child pagination check skipped: no Task has "${PAGINATION_MARKER}" in its Subject. Seed about 250 on one deal by hand to run it.`);
      // CI logs can be public: there, never name the org or the Run As user.
      console.warn(
        process.env.CI
          ? 'Seed not visible to the Run As user.'
          : `Looked in org ${adapter.orgId} as Run As user ${await runAsUsername()} (Tasks must be in this org and visible to this user).`,
      );
      ctx.skip();
    }
    expect(deals.size, `Tasks marked ${PAGINATION_MARKER} should all be on one deal`).toBe(1);
    const deal = [...deals.values()][0]!;
    const limit = adapter.capabilities().activitiesPerOpportunityLimit;
    expect(marked.length, `seed more than ${limit} marked Tasks`).toBeGreaterThan(limit);

    const rec = recordSalesforceResponses();
    let result;
    try {
      result = await adapter.getActivitiesByOpportunity([deal]);
    } finally {
      rec.restore();
    }
    const report = checkSalesforceShapes(rec.responses);
    console.info(
      `Child pagination ${report.seen.has('child-paged') ? 'observed' : 'not observed'} on ${marked.length} marked Tasks (${rec.requests.length} API calls).`,
    );
    for (const relationship of ['Tasks', 'Events']) {
      const pages = childPages(rec.responses, relationship, deal.id);
      console.info(
        `${relationship} child pages for ${deal.id}: ${pages.length} page(s), rows per page [${pages.map((p) => p.rows).join(', ')}], ` +
          `nextRecordsUrl on the child: ${pages.some((p) => p.next) ? 'yes' : 'no'}.`,
      );
    }
    console.info(`getActivitiesByOpportunity for the deal: ${rec.requests.length} API calls in total.`);
    expect(report.violations).toEqual([]);
    expect(result.items).toHaveLength(limit);
    expect(result.truncatedOpportunityIds.has(deal.id)).toBe(true);
  });
});

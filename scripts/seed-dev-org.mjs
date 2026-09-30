#!/usr/bin/env node
/**
 * One-off seed for the readiness smoke run: creates the records in
 * packages/readiness/docs/salesforce-setup.md sections 5-7 in the
 * maintainer's Developer Edition org, or deletes them again.
 *
 *   node scripts/seed-dev-org.mjs             # print what it would create; writes nothing
 *   node scripts/seed-dev-org.mjs --apply     # create the records
 *   node scripts/seed-dev-org.mjs --cleanup   # print what it would delete; writes nothing
 *   node scripts/seed-dev-org.mjs --cleanup --apply   # delete them
 *   node scripts/seed-dev-org.mjs --top-up    # print which SEED- records are missing; writes nothing
 *   node scripts/seed-dev-org.mjs --top-up --apply    # create only the missing ones
 *
 * --top-up matches each record by its Name, Subject, Title or LastName
 * (a contact role or note link by the two records it joins) and never
 * duplicates or modifies an existing one. The stage change is made only
 * when SEED-Qualification deal is created in the same run.
 *
 * Plan mode (no --apply) reads but never writes: it prints the Run As
 * user's license and profile, whether ContentNote is queryable, and
 * whether SEED_CUSTOM_STAGE is a Stage picklist value in the org.
 *
 * Enhanced Notes: --apply aborts if ContentNote isn't queryable (its
 * describe fails), unless --allow-no-enhanced is passed; then the Enhanced
 * Note and its link are skipped.
 *
 * Custom stage: set SEED_CUSTOM_STAGE (shell or .env) to a Stage picklist
 * value you added by hand (salesforce-setup.md section 5) to create
 * SEED-Custom stage deal at that stage. Unset, or not an active Stage
 * value in the org, and that record is skipped.
 *
 * Not part of any package and never imported: the packages keep no CRM
 * write path (CLAUDE.md rule 1). It writes only to the org in .env, and
 * aborts unless that org's hostname starts with <dev-org-host-prefix>.
 *
 * Every record it creates has a Name, Subject, Title or LastName starting
 * with "SEED-" (a contact role has no name: it belongs to a SEED-
 * opportunity). --cleanup deletes only records matching that, so the
 * org's own sample data is never touched.
 *
 * Stage history can't be seeded backwards: Salesforce dates every
 * OpportunityHistory row when the change happens, and the field can't be
 * set. The stage change below adds rows dated today, so
 * stage_history_months stays 0 and the stage-history gates (pipeline risk
 * alerts) stay Blocked on this org for months, whatever is seeded.
 *
 * Adding the custom Stage picklist value stays a manual step (it changes
 * the org's metadata); this script only uses one that already exists.
 *
 * Reads SF_CLIENT_ID, SF_CLIENT_SECRET, SF_INSTANCE_URL and SF_API_VERSION
 * from .env at the repo root; never prints them or the access token.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const REQUIRED_HOST_PREFIX = '<dev-org-host-prefix>';
const PREFIX = 'SEED-';

const args = new Set(process.argv.slice(2));
const apply = args.has('--apply');
const cleanup = args.has('--cleanup');
const allowNoEnhanced = args.has('--allow-no-enhanced');
const topUp = args.has('--top-up');
for (const a of args) {
  if (!['--apply', '--cleanup', '--allow-no-enhanced', '--top-up'].includes(a)) {
    fail(`Unknown argument ${a}. Use --apply, --cleanup, --top-up and/or --allow-no-enhanced.`);
  }
}
if (topUp && cleanup) fail('--top-up and --cleanup do not go together.');

function fail(message) {
  console.error(`seed-dev-org: ${message}`);
  process.exit(1);
}

// -- settings -----------------------------------------------------------

function loadEnv() {
  const envPath = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '.env');
  const env = {};
  for (const line of readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);
    if (m) env[m[1]] = m[2].replace(/^"(.*)"$/, '$1');
  }
  // A variable set in the shell wins, as for the report.
  for (const key of ['SF_CLIENT_ID', 'SF_CLIENT_SECRET', 'SF_INSTANCE_URL', 'SF_API_VERSION', 'SEED_CUSTOM_STAGE']) {
    if (process.env[key]) env[key] = process.env[key];
  }
  for (const key of ['SF_CLIENT_ID', 'SF_CLIENT_SECRET', 'SF_INSTANCE_URL']) {
    if (!env[key]) fail(`${key} is not set in .env.`);
  }
  return {
    clientId: env.SF_CLIENT_ID,
    clientSecret: env.SF_CLIENT_SECRET,
    instanceUrl: env.SF_INSTANCE_URL.replace(/\/$/, ''),
    apiVersion: env.SF_API_VERSION || 'v62.0',
    customStage: env.SEED_CUSTOM_STAGE?.trim() || null,
  };
}

const config = loadEnv();
const host = new URL(config.instanceUrl).host;
if (!host.startsWith(REQUIRED_HOST_PREFIX)) {
  fail(`Refusing to run: the org in .env is not the Developer Edition org this script is for (hostname must start with ${REQUIRED_HOST_PREFIX}).`);
}

// -- REST ---------------------------------------------------------------

let accessToken;

async function token() {
  if (accessToken) return accessToken;
  const res = await fetch(`${config.instanceUrl}/services/oauth2/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: config.clientId,
      client_secret: config.clientSecret,
    }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || !body.access_token) fail(`Token request failed (${res.status}): ${body.error ?? ''} ${body.error_description ?? ''}`);
  accessToken = body.access_token;
  return accessToken;
}

/** The Run As user's license and profile names (client credentials runs as that user). */
async function runAsUser() {
  apiCalls += 1;
  const res = await fetch(`${config.instanceUrl}/services/oauth2/userinfo`, { headers: { Authorization: `Bearer ${await token()}` } });
  if (!res.ok) return { license: `unknown (userinfo ${res.status})`, profile: 'unknown' };
  const { user_id: userId } = await res.json();
  const [user] = await query(`SELECT Profile.Name, Profile.UserLicense.Name FROM User WHERE Id = '${userId}'`);
  return { license: user?.Profile?.UserLicense?.Name ?? 'unknown', profile: user?.Profile?.Name ?? 'unknown' };
}

/** Same check as the adapter's probe: any failure means not queryable. */
async function contentNoteQueryable() {
  try {
    return (await api('GET', '/sobjects/ContentNote/describe')).queryable === true;
  } catch {
    return false;
  }
}

/** Whether SEED_CUSTOM_STAGE is an active Opportunity StageName value, with the reason when it isn't. */
async function customStageCheck() {
  if (!config.customStage) return { ok: false, reason: 'SEED_CUSTOM_STAGE is not set' };
  const describe = await api('GET', '/sobjects/Opportunity/describe');
  const stage = describe.fields.find((f) => f.name === 'StageName');
  const active = (stage?.picklistValues ?? []).filter((v) => v.active).map((v) => v.value);
  return active.includes(config.customStage)
    ? { ok: true }
    : { ok: false, reason: `SEED_CUSTOM_STAGE is not an active Stage picklist value in this org (active values: ${active.length})` };
}

let apiCalls = 0;

async function api(method, pathname, body) {
  apiCalls += 1;
  const res = await fetch(`${config.instanceUrl}/services/data/${config.apiVersion}${pathname}`, {
    method,
    headers: { Authorization: `Bearer ${await token()}`, 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const text = await res.text();
  if (!res.ok) {
    const err = new Error(`${method} ${pathname.split('?')[0]} failed (${res.status}): ${text.slice(0, 300)}`);
    err.status = res.status;
    throw err;
  }
  return text ? JSON.parse(text) : null;
}

async function query(soql) {
  const out = [];
  let page = await api('GET', `/query?q=${encodeURIComponent(soql)}`);
  out.push(...page.records);
  while (!page.done) {
    apiCalls += 1;
    const res = await fetch(`${config.instanceUrl}${page.nextRecordsUrl}`, { headers: { Authorization: `Bearer ${await token()}` } });
    page = await res.json();
    out.push(...page.records);
  }
  return out;
}

const create = async (sobject, fields) => (await api('POST', `/sobjects/${sobject}`, fields)).id;
const update = (sobject, id, fields) => api('PATCH', `/sobjects/${sobject}/${id}`, fields);
const remove = (sobject, id) => api('DELETE', `/sobjects/${sobject}/${id}`);

// -- records ------------------------------------------------------------

function isoDate(daysFromToday) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + daysFromToday);
  return d.toISOString().slice(0, 10);
}

function isoDateTime(daysFromToday, hourUtc) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + daysFromToday);
  d.setUTCHours(hourUtc, 0, 0, 0);
  return d.toISOString();
}

const LONG_NOTE =
  'Discovery recap. The buyer runs a twelve-person revenue team and wants to replace manual pipeline reviews. ' +
  'Their main concerns are data quality in the CRM, how deal risk is flagged, and whether forecast calls can use ' +
  'real evidence rather than rep sentiment. Next: send the security questionnaire and book a technical session ' +
  'with their operations lead before the end of the month.';

/** The records to create, in order. Each step may use ids from earlier steps. */
const PLAN = [
  { key: 'account', sobject: 'Account', label: `${PREFIX}Northwind Seed Co`, fields: () => ({ Name: `${PREFIX}Northwind Seed Co`, Website: 'https://northwind-seed.example' }) },
  { key: 'contact', sobject: 'Contact', label: `${PREFIX}Contact (Dana)`, fields: (ids) => ({ FirstName: 'Dana', LastName: `${PREFIX}Contact`, AccountId: ids.account, Email: 'dana@northwind-seed.example' }) },
  { key: 'oppProspecting', sobject: 'Opportunity', label: `${PREFIX}Prospecting deal (Prospecting)`, fields: (ids) => opp(ids, 'Prospecting deal', 'Prospecting', 12000, 60, 'Book the discovery call') },
  { key: 'oppStageChange', sobject: 'Opportunity', label: `${PREFIX}Qualification deal (created Prospecting, then moved to Qualification)`, fields: (ids) => opp(ids, 'Qualification deal', 'Prospecting', 25000, 45, 'Confirm budget owner') },
  { key: 'oppProposal', sobject: 'Opportunity', label: `${PREFIX}Proposal deal (Proposal/Price Quote)`, fields: (ids) => opp(ids, 'Proposal deal', 'Proposal/Price Quote', 40000, 30, 'Send the revised quote') },
  { key: 'oppCustomStage', sobject: 'Opportunity', label: `${PREFIX}Custom stage deal (StageName = SEED_CUSTOM_STAGE)`, customStage: true, fields: (ids) => opp(ids, 'Custom stage deal', config.customStage, 30000, 40, 'Run the security review') },
  { key: 'oppClosedLost', sobject: 'Opportunity', label: `${PREFIX}Closed Lost deal (closed 30 days ago)`, fields: (ids) => opp(ids, 'Closed Lost deal', 'Closed Lost', 18000, -30, 'Lost on price') },
  { key: 'contactRole', sobject: 'OpportunityContactRole', label: 'Contact role: SEED-Contact on SEED-Prospecting deal (primary, Decision Maker)', fields: (ids) => ({ OpportunityId: ids.oppProspecting, ContactId: ids.contact, Role: 'Decision Maker', IsPrimary: true }) },
  { key: 'legacyNote', sobject: 'Note', label: `${PREFIX}Legacy note on SEED-Prospecting deal`, optional: true, fields: (ids) => ({ ParentId: ids.oppProspecting, Title: `${PREFIX}Legacy note`, Body: 'Intro call went well; they asked for pricing tiers.' }) },
  { key: 'enhancedNote', sobject: 'ContentNote', label: `${PREFIX}Enhanced note (${LONG_NOTE.length} characters, over the 255 preview cap)`, optional: true, fields: () => ({ Title: `${PREFIX}Enhanced note`, Content: Buffer.from(`<p>${LONG_NOTE}</p>`).toString('base64') }) },
  { key: 'enhancedNoteLink', sobject: 'ContentDocumentLink', label: 'Link: SEED-Enhanced note to SEED-Prospecting deal', optional: true, needs: 'enhancedNote', fields: (ids) => ({ ContentDocumentId: ids.enhancedNote, LinkedEntityId: ids.oppProspecting, ShareType: 'V' }) },
  { key: 'task', sobject: 'Task', label: `${PREFIX}Call about pricing (Task, completed 3 days ago, on SEED-Prospecting deal)`, fields: (ids) => ({ Subject: `${PREFIX}Call about pricing`, WhatId: ids.oppProspecting, WhoId: ids.contact, Status: 'Completed', ActivityDate: isoDate(-3) }) },
  { key: 'event', sobject: 'Event', label: `${PREFIX}Discovery meeting (Event, 2 days ago, on SEED-Prospecting deal)`, fields: (ids) => ({ Subject: `${PREFIX}Discovery meeting`, WhatId: ids.oppProspecting, WhoId: ids.contact, StartDateTime: isoDateTime(-2, 15), EndDateTime: isoDateTime(-2, 16) }) },
];

/** After creating: the stage change, so OpportunityHistory gains a row. */
const STAGE_CHANGE = { key: 'oppStageChange', label: `${PREFIX}Qualification deal: Prospecting -> Qualification`, fields: { StageName: 'Qualification' } };

/**
 * SOQL finding the existing record a step would create, for --top-up; null
 * when a record it depends on doesn't exist yet (so neither can this one).
 */
function matchSoql(step, ids) {
  const byName = (sobject, field, value) => `SELECT Id FROM ${sobject} WHERE ${field} = '${value}' LIMIT 1`;
  const f = step.fields(ids);
  switch (step.sobject) {
    case 'Account':
    case 'Opportunity':
      return byName(step.sobject, 'Name', f.Name);
    case 'Contact':
      return byName('Contact', 'LastName', f.LastName);
    case 'Note':
      return byName('Note', 'Title', f.Title);
    case 'ContentNote':
      return `SELECT Id FROM ContentDocument WHERE Title = '${f.Title}' AND FileType = 'SNOTE' LIMIT 1`;
    case 'Task':
    case 'Event':
      return byName(step.sobject, 'Subject', f.Subject);
    case 'OpportunityContactRole':
      return f.OpportunityId && f.ContactId
        ? `SELECT Id FROM OpportunityContactRole WHERE OpportunityId = '${f.OpportunityId}' AND ContactId = '${f.ContactId}' LIMIT 1`
        : null;
    case 'ContentDocumentLink':
      return f.ContentDocumentId && f.LinkedEntityId
        ? `SELECT Id FROM ContentDocumentLink WHERE ContentDocumentId = '${f.ContentDocumentId}' AND LinkedEntityId = '${f.LinkedEntityId}' LIMIT 1`
        : null;
    default:
      throw new Error(`no --top-up match for ${step.sobject}`);
  }
}

async function findExisting(step, ids) {
  const soql = matchSoql(step, ids);
  if (!soql) return null;
  const [row] = await query(soql);
  return row?.Id ?? null;
}

function opp(ids, name, stage, amount, closeInDays, nextStep) {
  return { Name: `${PREFIX}${name}`, AccountId: ids.account, StageName: stage, Amount: amount, CloseDate: isoDate(closeInDays), NextStep: nextStep };
}

/** What --cleanup deletes: only SEED- records. Contact roles go with their SEED- opportunity. Order: children first. */
const CLEANUP = [
  { sobject: 'ContentDocument', soql: `SELECT Id FROM ContentDocument WHERE Title LIKE '${PREFIX}%' AND FileType = 'SNOTE'`, optional: true },
  { sobject: 'Note', soql: `SELECT Id FROM Note WHERE Title LIKE '${PREFIX}%'` },
  { sobject: 'Task', soql: `SELECT Id FROM Task WHERE Subject LIKE '${PREFIX}%'` },
  { sobject: 'Event', soql: `SELECT Id FROM Event WHERE Subject LIKE '${PREFIX}%'` },
  { sobject: 'OpportunityContactRole', soql: `SELECT Id FROM OpportunityContactRole WHERE Opportunity.Name LIKE '${PREFIX}%'` },
  { sobject: 'Opportunity', soql: `SELECT Id FROM Opportunity WHERE Name LIKE '${PREFIX}%'` },
  { sobject: 'Contact', soql: `SELECT Id FROM Contact WHERE LastName LIKE '${PREFIX}%'` },
  { sobject: 'Account', soql: `SELECT Id FROM Account WHERE Name LIKE '${PREFIX}%'` },
];

// -- run ----------------------------------------------------------------

async function seed() {
  const user = await runAsUser();
  const enhanced = await contentNoteQueryable();
  const stage = await customStageCheck();
  const skipEnhanced = !enhanced;
  const skip = (step) =>
    (step.customStage && !stage.ok) || (skipEnhanced && (step.sobject === 'ContentNote' || step.sobject === 'ContentDocumentLink'));

  console.log(`Org: ${host.slice(0, REQUIRED_HOST_PREFIX.length)}...`);
  console.log(`Run As user: license "${user.license}", profile "${user.profile}"`);
  console.log(`ContentNote queryable: ${enhanced ? 'yes' : 'no'}`);
  console.log(`Custom stage: ${stage.ok ? `"${config.customStage}" is an active Stage value` : `${stage.reason}; SEED-Custom stage deal will be skipped`}`);
  if (!enhanced) {
    console.log(
      allowNoEnhanced
        ? 'Enhanced Notes: skipped (--allow-no-enhanced).'
        : 'Enhanced Notes: ContentNote is not queryable, so --apply will abort. Fix Notes access, or pass --allow-no-enhanced to seed without them.',
    );
  }

  if (!apply && topUp) {
    console.log('Top-up (nothing written; add --apply):');
    const ids = {};
    let toCreate = 0;
    for (const step of PLAN) {
      if (skip(step)) {
        console.log(`  skipped        ${step.sobject}: ${step.label}`);
        continue;
      }
      const id = await findExisting(step, ids);
      if (id) {
        ids[step.key] = id;
        console.log(`  exists         ${step.sobject} ${id}: ${step.label}`);
      } else {
        toCreate += 1;
        console.log(`  would create   ${step.sobject}: ${step.label}`);
      }
    }
    console.log(ids[STAGE_CHANGE.key] ? '  no stage change (SEED-Qualification deal already exists)' : `  would update   Opportunity: ${STAGE_CHANGE.label}`);
    console.log(toCreate === 0 ? 'Nothing to create.' : `${toCreate} record(s) to create.`);
    console.log(`API calls for this plan: ${apiCalls}.`);
    return;
  }

  if (!apply) {
    console.log('Would create (nothing written; add --apply):');
    for (const step of PLAN) {
      const note = skip(step) ? '  [skipped]' : step.optional ? '  [skipped if the org refuses it]' : '';
      console.log(`  ${step.sobject.padEnd(22)} ${step.label}${note}`);
    }
    console.log(`  ${'Opportunity update'.padEnd(22)} ${STAGE_CHANGE.label}`);
    console.log(`API calls for this plan: ${apiCalls}.`);
    return;
  }
  if (!enhanced && !allowNoEnhanced) fail('ContentNote is not queryable. Fix Notes access, or pass --allow-no-enhanced.');

  if (!topUp) {
    const existing = await query(`SELECT Id FROM Opportunity WHERE Name LIKE '${PREFIX}%'`);
    if (existing.length > 0) fail(`${existing.length} SEED- opportunities already exist. Run with --cleanup --apply first, or use --top-up.`);
  }

  const ids = {};
  const created = new Set();
  for (const step of PLAN) {
    if (skip(step)) {
      console.log(`  skipped  ${step.sobject}: ${step.label}`);
      continue;
    }
    if (topUp) {
      const id = await findExisting(step, ids);
      if (id) {
        ids[step.key] = id;
        console.log(`  exists   ${step.sobject} ${id}: ${step.label}`);
        continue;
      }
    }
    if (step.needs && !ids[step.needs]) {
      console.log(`  skipped  ${step.sobject}: ${step.label} (needs ${step.needs})`);
      continue;
    }
    try {
      ids[step.key] = await create(step.sobject, step.fields(ids));
      created.add(step.key);
      console.log(`  created  ${step.sobject} ${ids[step.key]}: ${step.label}`);
    } catch (err) {
      if (!step.optional) throw err;
      console.log(`  skipped  ${step.sobject}: ${step.label}\n           ${err.message}`);
    }
  }
  // Never modify a record this run didn't create.
  if (created.has(STAGE_CHANGE.key)) {
    await update('Opportunity', ids[STAGE_CHANGE.key], STAGE_CHANGE.fields);
    console.log(`  updated  Opportunity: ${STAGE_CHANGE.label}`);
  }
}

async function clean() {
  let total = 0;
  for (const step of CLEANUP) {
    let rows;
    try {
      rows = await query(step.soql);
    } catch (err) {
      if (!step.optional) throw err;
      console.log(`  skipped  ${step.sobject}: ${err.message}`);
      continue;
    }
    total += rows.length;
    if (!apply) {
      console.log(`  would delete ${rows.length} ${step.sobject}`);
      continue;
    }
    for (const row of rows) {
      try {
        await remove(step.sobject, row.Id);
      } catch (err) {
        // A contact role or ContentDocumentLink may already be gone with its parent.
        if (err.status !== 404) throw err;
      }
    }
    console.log(`  deleted ${rows.length} ${step.sobject}`);
  }
  if (!apply) console.log(`${total} SEED- records found; nothing deleted (add --apply).`);
}

try {
  await (cleanup ? clean() : seed());
  if (apply) console.log(`Done. API calls: ${apiCalls}.`);
} catch (err) {
  fail(err.message);
}

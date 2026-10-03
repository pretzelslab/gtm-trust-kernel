/**
 * SalesforceAdapter.preflight() against the in-memory fake API: credentials,
 * API version, object and field access, one message per problem, warnings
 * for the note objects (whose metrics are then marked not measured), and
 * no record reads.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { NOTE_OBJECTS_ACCESS_HINT, NOTES_ACCESS_HINT } from '../src/salesforce.js';
import { installFakeSalesforce, sfId, sfRef } from './support/fakeSalesforce.js';
import { registerPreflightOrg, type PreflightOrgOptions } from './support/preflightOrg.js';

const OPP = sfRef('opportunity', sfId('006', 1));

afterEach(() => {
  vi.unstubAllGlobals();
});

function org(options: PreflightOrgOptions = {}) {
  const sf = installFakeSalesforce();
  registerPreflightOrg(sf, options);
  return sf;
}

const tokenCalls = (urls: readonly string[]) => urls.filter((u) => u === '/services/oauth2/token').length;
const apiCalls = (urls: readonly string[]) => urls.filter((u) => u !== '/services/oauth2/token');

describe('SalesforceAdapter.preflight', () => {
  it('passes on an org that grants every read, in 11 calls and no record reads', async () => {
    const sf = org();
    const adapter = sf.adapter();
    const result = await adapter.preflight();
    expect(result).toEqual({ failures: [], warnings: [], apiCallsConsumed: 11 });
    expect(apiCalls(sf.urls)).toHaveLength(11);
    expect(sf.queries).toEqual([]);
    expect(sf.urls.some((u) => u.includes('/Contact/describe'))).toBe(false);
    expect(adapter.capabilities().notesComplete).toBe(true);
  });

  it('checks Contact only when contacts will be read', async () => {
    const without = org({ unreadable: ['Contact'] });
    expect((await without.adapter().preflight()).failures).toEqual([]);

    const sf = org({ unreadable: ['Contact'] });
    const result = await sf.adapter().preflight({ contacts: true });
    expect(result.failures).toEqual([
      { check: 'object_access', message: "The Run As user can't read Contact records. Give it Read access to Contact in a permission set." },
    ]);
  });

  it.each([
    ['invalid_client_id', 'client identifier invalid', "Salesforce doesn't recognise SF_CLIENT_ID. Use the connected app's Consumer Key (salesforce-setup.md)."],
    ['invalid_client', 'invalid client credentials', "Salesforce rejected SF_CLIENT_SECRET. Use the connected app's Consumer Secret (salesforce-setup.md)."],
    ['invalid_grant', 'no client credentials user enabled', "The connected app can't use the client credentials flow: turn on Enable Client Credentials Flow and set a Run As user (salesforce-setup.md)."],
    ['invalid_grant', 'request not supported on this domain', "SF_INSTANCE_URL must be your org's My Domain URL, such as https://yourcompany.my.salesforce.com."],
    ['something_new', 'whatever', 'Salesforce refused the token request (something_new). Check SF_CLIENT_ID, SF_CLIENT_SECRET and SF_INSTANCE_URL (salesforce-setup.md).'],
  ])('reports a token error %s (%s) as one auth failure and stops', async (code, description, message) => {
    const sf = org();
    sf.tokenAnswers({ status: 400, body: JSON.stringify({ error: code, error_description: description }) });
    const result = await sf.adapter().preflight();
    expect(result.failures).toEqual([{ check: 'auth', message }]);
    expect(result.warnings).toEqual([]);
    expect(tokenCalls(sf.urls)).toBe(1);
    expect(apiCalls(sf.urls)).toEqual([]);
  });

  it('reports an unreachable instance as one auth failure', async () => {
    const sf = installFakeSalesforce();
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new Error('getaddrinfo ENOTFOUND');
    }));
    const result = await sf.adapter().preflight();
    expect(result.failures).toEqual([
      { check: 'auth', message: "Couldn't reach Salesforce at SF_INSTANCE_URL. Check the URL and your network connection." },
    ]);
  });

  it('stops at an API version the org does not offer, naming the newest it does', async () => {
    const sf = org();
    sf.apiVersions(['59.0', '61.0', '60.0']);
    const result = await sf.adapter().preflight();
    expect(result.failures).toEqual([
      { check: 'api_version', message: "This org doesn't offer API version v62.0; the newest it offers is v61.0. Set SF_API_VERSION=v61.0." },
    ]);
    expect(result.apiCallsConsumed).toBe(1);
    expect(apiCalls(sf.urls)).toEqual(['/services/data/']);
  });

  it('reports each required object the Run As user cannot read, in one line each, without describing it', async () => {
    const sf = org({ unreadable: ['OpportunityContactRole', 'Task'] });
    const result = await sf.adapter().preflight();
    expect(result.failures).toEqual([
      { check: 'object_access', message: "The Run As user can't read OpportunityContactRole records. Give it Read access to OpportunityContactRole in a permission set." },
      { check: 'object_access', message: "The Run As user can't read Task records. Give it Read access to Task in a permission set." },
    ]);
    expect(result.warnings).toEqual([]);
    expect(sf.urls.some((u) => u.includes('/OpportunityContactRole/describe') || u.includes('/Task/describe'))).toBe(false);
    expect(result.apiCallsConsumed).toBe(9);
  });

  it('keeps Event and OpportunityHistory required (D3)', async () => {
    const sf = org({ unreadable: ['Event', 'OpportunityHistory'] });
    const result = await sf.adapter().preflight();
    expect(result.failures.map((f) => f.check)).toEqual(['object_access', 'object_access']);
    expect(result.failures.map((f) => f.message)).toEqual([
      expect.stringContaining("can't read Event records"),
      expect.stringContaining("can't read OpportunityHistory records"),
    ]);
  });

  it('names every field hidden by field-level security, one line per object', async () => {
    const sf = org({ hiddenFields: { Opportunity: ['Amount', 'NextStep'], Account: ['Industry'] } });
    const result = await sf.adapter().preflight();
    expect(result.failures).toEqual([
      {
        check: 'field_access',
        message: "The Run As user can't read Opportunity.Amount, Opportunity.NextStep. Give it Read access to those fields (field-level security).",
      },
      { check: 'field_access', message: "The Run As user can't read Account.Industry. Give it Read access to that field (field-level security)." },
    ]);
  });

  it('warns about unreadable Notes, skips their query and marks notes incomplete', async () => {
    const sf = org({ unreadable: ['Note'] });
    sf.on(/FROM ContentDocumentLink/, []);
    const adapter = sf.adapter();
    const result = await adapter.preflight();
    expect(result.failures).toEqual([]);
    expect(result.warnings).toEqual([
      {
        check: 'object_access',
        message: "The Run As user can't read Note records. Give it Read access to Note in a permission set. Until then, note metrics are marked not measured.",
      },
    ]);
    expect(adapter.capabilities().notesComplete).toBe(false);
    expect(adapter.capabilities().settingHints?.notesComplete).toBe(NOTE_OBJECTS_ACCESS_HINT);
    const notes = await adapter.getNotesByOpportunity([OPP]);
    expect(notes.items).toEqual([]);
    expect(sf.queries.some((q) => q.includes('FROM Notes'))).toBe(false);
    expect(sf.queries.some((q) => q.includes('FROM ContentDocumentLink'))).toBe(true);
  });

  it('warns about an unreadable ContentDocumentLink field and skips Enhanced Notes', async () => {
    const sf = org({ hiddenFields: { ContentDocumentLink: ['LinkedEntityId'] } });
    sf.subqueryRows('Notes', 'ParentId', []);
    const adapter = sf.adapter();
    const result = await adapter.preflight();
    expect(result.failures).toEqual([]);
    expect(result.warnings.map((w) => w.check)).toEqual(['field_access']);
    expect(result.warnings[0]!.message).toContain('ContentDocumentLink.LinkedEntityId');
    await adapter.getNotesByOpportunity([OPP]);
    expect(sf.queries.some((q) => q.includes('FROM ContentDocumentLink'))).toBe(false);
    expect(adapter.capabilities().notesComplete).toBe(false);
  });

  it('warns about unreadable ContentNote; probe() then makes no call and linked Enhanced Notes mark notes incomplete', async () => {
    const sf = org({ unreadable: ['ContentNote'] });
    sf.subqueryRows('Notes', 'ParentId', []);
    sf.on(/FROM ContentDocumentLink/, [{ ContentDocumentId: sfId('069', 1), LinkedEntityId: OPP.id }]);
    const adapter = sf.adapter();
    const result = await adapter.preflight();
    expect(result.warnings).toEqual([
      {
        check: 'object_access',
        message:
          "The Run As user can't read ContentNote records. Give it Read access to ContentNote in a permission set. Until then, Enhanced Notes are not read, and if the scan finds any, note metrics are marked not measured.",
      },
    ]);
    expect(adapter.capabilities().notesComplete).toBe(true);
    const before = sf.urls.length;
    await adapter.probe();
    expect(sf.urls.length).toBe(before);
    await adapter.getNotesByOpportunity([OPP]);
    expect(sf.queries.some((q) => q.includes('FROM ContentNote'))).toBe(false);
    expect(adapter.capabilities().notesComplete).toBe(false);
    expect(adapter.capabilities().settingHints?.notesComplete).toBe(NOTES_ACCESS_HINT);
  });

  it('makes probe() free after a passing preflight', async () => {
    const sf = org();
    const adapter = sf.adapter();
    await adapter.preflight();
    const before = sf.urls.length;
    await adapter.probe();
    expect(sf.urls.length).toBe(before);
  });

  it('reports a refused global describe by its error code only', async () => {
    const sf = org();
    sf.globalDescribe({ status: 403, body: '[{"errorCode":"API_DISABLED_FOR_ORG","message":"API is not enabled for 006SECRET"}]' });
    const result = await sf.adapter().preflight();
    expect(result.failures).toEqual([
      {
        check: 'object_access',
        message: "The Run As user can't list Salesforce objects (API_DISABLED_FOR_ORG). Check that it has the API Enabled permission.",
      },
    ]);
  });

  it('reports a describe that fails by its error code only, and checks the rest', async () => {
    const sf = org();
    sf.sobjectDescribe('Account', { status: 500, body: '[{"errorCode":"UNKNOWN_EXCEPTION","message":"echoes 001SECRET"}]' });
    const result = await sf.adapter().preflight();
    expect(result.failures).toEqual([{ check: 'object_access', message: "Couldn't check access to Account (UNKNOWN_EXCEPTION)." }]);
    expect(result.apiCallsConsumed).toBe(11);
  });

  it('never puts response text in a message', async () => {
    const sf = org({ unreadable: ['Task'], hiddenFields: { Opportunity: ['Name'] } });
    sf.sobjectDescribe('Account', { status: 500, body: '[{"errorCode":"X","message":"006SECRET"}]' });
    const result = await sf.adapter().preflight();
    for (const issue of [...result.failures, ...result.warnings]) expect(issue.message).not.toContain('SECRET');
  });
});

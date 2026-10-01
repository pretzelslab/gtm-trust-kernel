/**
 * The Salesforce response contract (test/contract/salesforceShapes.ts)
 * checked against the in-memory fake, in every CI run: the fake must answer
 * every query the adapter sends in the shape the adapter reads. The same
 * checks run against a real org in salesforce.live.test.ts (opt-in).
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { checkSalesforceShapes, parseSelect, recordSalesforceResponses, type RecordedResponse } from './contract/salesforceShapes.js';
import { installFakeSalesforce, sfId, sfRef, type FakeSalesforce } from './support/fakeSalesforce.js';

const OPP_1 = sfId('006', 1);
const OPP_2 = sfId('006', 2);
const ACC_1 = sfId('001', 1);
const CON_1 = sfId('003', 1);
const T = '2026-09-01T00:00:00.000+0000';

const opp = (id: string) => ({
  Id: id, AccountId: ACC_1, Name: `Deal ${id}`, Amount: 50000, StageName: 'Prospecting', CloseDate: '2026-12-01',
  OwnerId: sfId('005', 1), IsClosed: false, IsWon: false, ForecastCategoryName: 'Pipeline', NextStep: null,
  CreatedDate: T, SystemModstamp: T,
});
const note = (n: number, parent: string) => ({
  Id: sfId('002', n), ParentId: parent, Title: 't', Body: 'b', OwnerId: null, CreatedDate: T, SystemModstamp: T,
});
const task = (n: number, what: string) => ({
  Id: sfId('00T', n), WhoId: null, WhatId: what, Subject: 's', Description: null, ActivityDate: '2026-09-01',
  TaskSubtype: 'Call', CreatedDate: T, SystemModstamp: T,
});
const event = (n: number, what: string) => ({
  Id: sfId('00U', n), WhoId: null, WhatId: what, Subject: 's', Description: null, ActivityDate: '2026-09-01',
  ActivityDateTime: T, CreatedDate: T, SystemModstamp: T,
});
const history = (n: number, oppId: string) => ({
  Id: sfId('008', n), OpportunityId: oppId, StageName: 'Prospecting', CloseDate: '2026-12-01', CreatedById: null, CreatedDate: T,
});

/** Answers every query a readiness-shaped read pass sends; child rows on OPP_1 only, so OPP_2's relationships are null. */
function registerOrg(sf: FakeSalesforce, childCount: number, options: { parentPageSize?: number; childPageSize?: number } = {}): void {
  const range = (count: number) => Array.from({ length: count }, (_, i) => i + 1);
  sf.sobjectDescribe('ContentNote', { name: 'ContentNote', queryable: true });
  sf.on(/^SELECT COUNT\(\) FROM Opportunity WHERE IsClosed = false$/, { count: 2 });
  sf.on(/^SELECT COUNT\(\) FROM Opportunity WHERE IsClosed = true/, { count: 0 });
  sf.on(/FROM Opportunity WHERE \(IsClosed/, options.parentPageSize ? { pages: [[opp(OPP_1)], [opp(OPP_2)]] } : [opp(OPP_1), opp(OPP_2)]);
  sf.on(/FROM Opportunity WHERE Id = /, [opp(OPP_1)]);
  sf.on(/FROM OpportunityContactRole/, [{ OpportunityId: OPP_1, ContactId: CON_1, Role: null, IsPrimary: true }]);
  sf.on(/FROM OpportunityHistory /, [history(900, OPP_1)]);
  sf.on(/FROM Account WHERE Id IN/, [
    { Id: ACC_1, Name: 'Acme', Website: null, Industry: null, NumberOfEmployees: null, OwnerId: sfId('005', 1), CreatedDate: T, SystemModstamp: T },
  ]);
  sf.on(/FROM Contact WHERE Id IN/, [
    { Id: CON_1, AccountId: ACC_1, Name: 'Pat', Title: null, Email: null, CreatedDate: T, SystemModstamp: T },
  ]);
  sf.on(/FROM ContentDocumentLink/, [{ ContentDocumentId: sfId('069', 1), LinkedEntityId: OPP_1 }]);
  sf.on(/FROM ContentNote WHERE Id IN/, [
    { Id: sfId('069', 1), Title: 't', TextPreview: 'short', OwnerId: sfId('005', 1), CreatedDate: T },
  ]);
  sf.subqueryRows('Notes', 'ParentId', range(childCount).map((n) => note(n, OPP_1)), options);
  sf.subqueryRows('Tasks', 'WhatId', range(childCount).map((n) => task(n, OPP_1)), options);
  sf.subqueryRows('Events', 'WhatId', range(childCount).map((n) => event(n, OPP_1)), options);
  sf.subqueryRows('OpportunityHistories', 'OpportunityId', range(childCount).map((n) => history(n, OPP_1)), options);
}

async function readPass(sf: FakeSalesforce): Promise<void> {
  const adapter = sf.adapter();
  await adapter.probe();
  const population = { asOf: '2026-09-30T00:00:00.000Z', closedWithinMonths: 12 };
  await adapter.countOpportunitiesForSample(population);
  await adapter.listStageHistory({ limit: 1 });
  let cursor: string | undefined;
  do {
    const page = await adapter.listOpportunitiesForSample({ ...population, limit: 200, cursor });
    cursor = page.nextCursor;
  } while (cursor);
  const refs = [sfRef('opportunity', OPP_1), sfRef('opportunity', OPP_2)];
  await adapter.getAccounts([sfRef('account', ACC_1)]);
  await adapter.getContactsByRef([sfRef('contact', CON_1)]);
  await adapter.getNotesByOpportunity(refs);
  await adapter.getActivitiesByOpportunity(refs);
  await adapter.getStageHistoryByOpportunity(refs);
  await adapter.getOpportunity(refs[0]!);
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('Salesforce response contract (fake API)', () => {
  it('answers every query of a read pass in the shape the adapter reads', async () => {
    const sf = installFakeSalesforce();
    registerOrg(sf, 2);
    const rec = recordSalesforceResponses();
    await readPass(sf);
    const report = checkSalesforceShapes(rec.responses);
    expect(report.violations).toEqual([]);
    expect([...report.seen].sort()).toEqual(['child-inline', 'child-null', 'count', 'describe', 'flat-query']);
  });

  // Doc-based, not seen on a real org: Salesforce documents that a query
  // with subqueries may return fewer parents per page and may split one
  // parent's child rows, each continued from its own nextRecordsUrl. The
  // dev org was too small to show either (35 parents, 67 child rows at
  // most), so these shapes follow the documentation. salesforce.live.test.ts
  // looks for child paging on a seeded deal and reports whether it saw it.
  it('pages outer and child results in the documented shape (doc-based, not seen on a real org)', async () => {
    const sf = installFakeSalesforce();
    registerOrg(sf, 5, { parentPageSize: 1, childPageSize: 2 });
    const rec = recordSalesforceResponses();
    await readPass(sf);
    const report = checkSalesforceShapes(rec.responses);
    expect(report.violations).toEqual([]);
    for (const shape of ['outer-paged', 'next-page', 'child-paged', 'child-null'] as const) {
      expect(report.seen.has(shape), shape).toBe(true);
    }
  });

  it('counts every request but the token request', async () => {
    const sf = installFakeSalesforce();
    registerOrg(sf, 2);
    const rec = recordSalesforceResponses();
    await sf.adapter().countOpportunitiesForSample({ asOf: '2026-09-30T00:00:00.000Z', closedWithinMonths: 12 });
    expect(rec.requests).toHaveLength(2);
    expect(rec.requests.every((r) => r.includes('/query?q='))).toBe(true);
  });
});

describe('Salesforce shape checks catch drift', () => {
  const SUB = 'SELECT Id, (SELECT Id, ParentId FROM Notes LIMIT 201) FROM Opportunity WHERE Id IN (\'x\')';
  const query = (soql: string, body: unknown): RecordedResponse => ({ path: 'p', kind: 'query', soql, role: 'outer', firstPage: true, body });
  const page = (records: unknown[], extra: Record<string, unknown> = {}) => ({ totalSize: records.length, done: true, records, ...extra });

  it('accepts a null or inline child relationship', () => {
    const body = page([{ Id: 'a', Notes: null }, { Id: 'b', Notes: page([{ Id: 'n', ParentId: 'b' }]) }]);
    expect(checkSalesforceShapes([query(SUB, body)]).violations).toEqual([]);
  });

  it('flags an empty object or a missing key where a child relationship should be', () => {
    const body = page([{ Id: 'a', Notes: {} }, { Id: 'b' }]);
    expect(checkSalesforceShapes([query(SUB, body)]).violations).toEqual([
      'p records[0].Notes: totalSize is not a number',
      'p records[0].Notes: done is not a boolean',
      'p records[0].Notes: records is not an array',
      'p records[1]: missing relationship Notes',
    ]);
  });

  it('flags a missing field on an outer or child row', () => {
    const body = page([{ Notes: page([{ Id: 'n' }]) }]);
    expect(checkSalesforceShapes([query(SUB, body)]).violations).toEqual([
      'p records[0]: missing field Id',
      'p records[0].Notes records[0]: missing field ParentId',
    ]);
  });

  it('flags done: false without a nextRecordsUrl, at either level', () => {
    const body = page([{ Id: 'a', Notes: page([], { done: false }) }], { done: false });
    expect(checkSalesforceShapes([query(SUB, body)]).violations).toEqual([
      'p: done is false but nextRecordsUrl is not a non-empty string',
      'p records[0].Notes: done is false but nextRecordsUrl is not a non-empty string',
    ]);
  });

  it('flags a COUNT() answer with records, and a describe without a boolean queryable', () => {
    const count = query('SELECT COUNT() FROM Opportunity WHERE IsClosed = false', page([{}]));
    const describe: RecordedResponse = { path: 'd', kind: 'describe', body: { queryable: 'true' } };
    expect(checkSalesforceShapes([count, describe]).violations).toEqual([
      'p: COUNT() records is not an empty array',
      'd: describe has no boolean queryable',
    ]);
  });

  it('reads field and relationship names from the SOQL sent', () => {
    expect(parseSelect(SUB)).toEqual({
      fields: ['Id'],
      subqueries: [{ relationship: 'Notes', fields: ['Id', 'ParentId'], soql: 'SELECT Id, ParentId FROM Notes LIMIT 201' }],
    });
  });
});

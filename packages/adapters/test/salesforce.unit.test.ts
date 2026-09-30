/**
 * SalesforceAdapter unit tests against the in-memory fake API
 * (test/support/fakeSalesforce.ts). No network, no credentials. These pin
 * down the adapter's own behaviour (queries sent, mapping, paging, errors);
 * the live contract run against a real org is separate.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  ACTIVITY_CAPTURE_HINT,
  ENHANCED_NOTE_PREVIEW_CAP,
  htmlToText,
  loadSalesforceConfigFromEnv,
  loadStageMapFile,
  NOTES_ACCESS_HINT,
  STAGE_MAP_HINT,
} from '../src/salesforce.js';
import { AdapterError } from '../src/types.js';
import { installFakeSalesforce, sfId, sfRef } from './support/fakeSalesforce.js';

const OPP_1 = sfId('006', 1);
const OPP_2 = sfId('006', 2);
const ACC_1 = sfId('001', 1);

function rawOpp(id: string, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    Id: id,
    AccountId: ACC_1,
    Name: `Deal ${id}`,
    Amount: 50000,
    StageName: 'Prospecting',
    CloseDate: '2026-12-01',
    OwnerId: sfId('005', 1),
    IsClosed: false,
    IsWon: false,
    ForecastCategoryName: 'Pipeline',
    NextStep: 'Send proposal',
    CreatedDate: '2026-01-01T00:00:00.000+0000',
    SystemModstamp: '2026-09-01T00:00:00.000+0000',
    ...overrides,
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('SalesforceAdapter (fake API)', () => {
  it('fetches a token once and reuses it across requests', async () => {
    const sf = installFakeSalesforce();
    sf.on(/FROM Opportunity /, [rawOpp(OPP_1)]);
    sf.on(/FROM OpportunityContactRole/, []);
    const adapter = sf.adapter();
    await adapter.listOpportunities({ limit: 200 });
    await adapter.listOpportunities({ limit: 200 });
    expect(sf.urls.filter((u) => u.startsWith('/services/oauth2/token'))).toHaveLength(1);
  });

  it('pages opportunities through nextRecordsUrl and maps known and custom stages', async () => {
    const sf = installFakeSalesforce();
    sf.on(/FROM Opportunity /, {
      pages: [[rawOpp(OPP_1, { StageName: 'Negotiation/Review' })], [rawOpp(OPP_2, { StageName: 'Technical Win' })]],
    });
    sf.on(/FROM OpportunityContactRole/, []);
    const adapter = sf.adapter();

    const first = await adapter.listOpportunities({ limit: 200 });
    expect(first.items.map((o) => [o.stage, o.stageConfidence])).toEqual([['negotiation', 'mapped']]);
    expect(first.nextCursor).toBeDefined();

    const second = await adapter.listOpportunities({ limit: 200, cursor: first.nextCursor });
    expect(second.items.map((o) => [o.vendorStageLabel, o.stageConfidence])).toEqual([['Technical Win', 'unmapped']]);
    expect(second.nextCursor).toBeUndefined();
    // The second page came from the locator, not a new Opportunity query.
    expect(sf.queries.filter((q) => q.includes('FROM Opportunity '))).toHaveLength(1);
  });

  it('attaches contact roles to listed opportunities, batched by id', async () => {
    const sf = installFakeSalesforce();
    const opps = Array.from({ length: 250 }, (_, i) => rawOpp(sfId('006', i + 1)));
    sf.on(/FROM Opportunity /, opps);
    sf.on(/FROM OpportunityContactRole/, (soql) => {
      const ids = [...soql.matchAll(/'(\w+)'/g)].map((m) => m[1]!);
      // Two roles on the first opportunity, none on the rest.
      return ids.includes(OPP_1)
        ? [
            { OpportunityId: OPP_1, ContactId: sfId('003', 1), Role: 'Decision Maker', IsPrimary: true },
            { OpportunityId: OPP_1, ContactId: sfId('003', 2), Role: null, IsPrimary: false },
          ]
        : [];
    });
    const page = await sf.adapter().listOpportunities({ limit: 2000 });

    const roleQueries = sf.queries.filter((q) => q.includes('FROM OpportunityContactRole'));
    expect(roleQueries).toHaveLength(2); // 250 ids at 200 per batch
    expect(roleQueries[0]).toMatch(/WHERE OpportunityId IN \(/);
    expect(page.apiCallsConsumed).toBe(3);

    const first = page.items.find((o) => o.ref.id === OPP_1)!;
    expect(first.contactLinks.map((l) => [l.contactRef.id, l.role, l.isPrimary])).toEqual([
      [sfId('003', 1), 'Decision Maker', true],
      [sfId('003', 2), undefined, false],
    ]);
    expect(page.items.find((o) => o.ref.id === OPP_2)!.contactLinks).toEqual([]);
  });

  it('follows nextRecordsUrl when one batch has more roles than one page', async () => {
    const sf = installFakeSalesforce();
    sf.on(/FROM Opportunity /, [rawOpp(OPP_1)]);
    sf.on(/FROM OpportunityContactRole/, {
      pages: [
        [{ OpportunityId: OPP_1, ContactId: sfId('003', 1), Role: null, IsPrimary: true }],
        [{ OpportunityId: OPP_1, ContactId: sfId('003', 2), Role: null, IsPrimary: false }],
      ],
    });
    const page = await sf.adapter().listOpportunities({ limit: 200 });
    expect(page.items[0]!.contactLinks).toHaveLength(2);
    expect(page.apiCallsConsumed).toBe(3);
  });

  it('getOpportunity uses the same contact-role lookup', async () => {
    const sf = installFakeSalesforce();
    sf.on(/FROM Opportunity WHERE Id/, [rawOpp(OPP_1)]);
    sf.on(/FROM OpportunityContactRole/, [{ OpportunityId: OPP_1, ContactId: sfId('003', 1), Role: 'Champion', IsPrimary: true }]);
    const opp = await sf.adapter().getOpportunity(sfRef('opportunity', OPP_1));
    expect(opp!.contactLinks.map((l) => l.role)).toEqual(['Champion']);
  });

  it('orders the opportunity listing oldest-modified first (current behaviour)', async () => {
    const sf = installFakeSalesforce();
    sf.on(/FROM Opportunity /, []);
    await sf.adapter().listOpportunities({ limit: 200 });
    expect(sf.queries[0]).toMatch(/ORDER BY SystemModstamp ASC$/);
  });

  it('maps legacy Note records per opportunity and flags truncation past the limit', async () => {
    const sf = installFakeSalesforce();
    sf.on(/FROM Note WHERE ParentId/, (soql) => {
      const parent = /ParentId = '(\w+)'/.exec(soql)![1]!;
      return [
        { Id: sfId('002', 1), ParentId: parent, Title: 't', Body: 'Discussed pricing with the buyer.', OwnerId: sfId('005', 1), CreatedDate: '2026-09-01T00:00:00.000+0000', SystemModstamp: '2026-09-01T00:00:00.000+0000' },
      ];
    });
    sf.on(/FROM ContentDocumentLink/, []);
    const adapter = sf.adapter();
    const result = await adapter.getNotesByOpportunity([sfRef('opportunity', OPP_1)]);
    expect(result.items).toHaveLength(1);
    expect(result.items[0]!.body.value).toBe('Discussed pricing with the buyer.');
    expect(result.truncatedOpportunityIds.size).toBe(0);
  });

  it('turns a 403 into a non-retryable permission AdapterError', async () => {
    const sf = installFakeSalesforce();
    sf.on(/FROM Opportunity /, { status: 403 });
    const err = await sf.adapter().listOpportunities({ limit: 200 }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AdapterError);
    expect((err as AdapterError).kind).toBe('permission');
    expect((err as AdapterError).retryable).toBe(false);
  });

  it('turns a 429 into a retryable rate_limit AdapterError carrying Retry-After', async () => {
    const sf = installFakeSalesforce();
    sf.on(/FROM Opportunity /, { status: 429, headers: { 'Retry-After': '7' } });
    const err = (await sf.adapter().listOpportunities({ limit: 200 }).catch((e: unknown) => e)) as AdapterError;
    expect(err.kind).toBe('rate_limit');
    expect(err.retryable).toBe(true);
    expect(err.retryAfterMs).toBe(7000);
  });

  it('fails loudly on a query the fake has no handler for', async () => {
    const sf = installFakeSalesforce();
    await expect(sf.adapter().listOpportunities({ limit: 200 })).rejects.toThrow(/no handler for SOQL/);
  });

  describe('ContentNote access (probe)', () => {
    const OPP = sfRef('opportunity', OPP_1);
    const link = { ContentDocumentId: sfId('069', 1), LinkedEntityId: OPP_1 };
    const legacy = {
      Id: sfId('002', 1), ParentId: OPP_1, Title: 't', Body: 'legacy', OwnerId: null,
      CreatedDate: '2026-09-01T00:00:00.000+0000', SystemModstamp: '2026-09-01T00:00:00.000+0000',
    };
    const NOT_FOUND = { status: 404, body: '[{"errorCode":"NOT_FOUND","message":"The requested resource does not exist"}]' };
    const INVALID_TYPE = { status: 400, body: `[{"message":"sObject type 'ContentNote' is not supported.","errorCode":"INVALID_TYPE"}]` };

    function withNotes(links: readonly Record<string, unknown>[]) {
      const sf = installFakeSalesforce();
      sf.on(/FROM Note WHERE ParentId/, [legacy]);
      sf.on(/FROM ContentDocumentLink/, links);
      return sf;
    }

    it('reads Enhanced Notes and reports notes complete when ContentNote is queryable', async () => {
      const sf = withNotes([link]);
      sf.sobjectDescribe('ContentNote', { name: 'ContentNote', queryable: true });
      sf.on(/FROM ContentNote WHERE Id IN/, [
        { Id: sfId('069', 1), Title: 't', TextPreview: 'enhanced', OwnerId: null, CreatedDate: '2026-09-02T00:00:00.000+0000' },
      ]);
      const adapter = sf.adapter();
      await adapter.probe();
      const result = await adapter.getNotesByOpportunity([OPP]);
      expect(result.items.map((n) => n.body.value)).toEqual(['legacy', 'enhanced']);
      expect(adapter.capabilities().notesComplete).toBe(true);
      expect(adapter.capabilities().settingHints?.notesComplete).toBeUndefined();
    });

    it.each([
      ['404 NOT_FOUND', NOT_FOUND],
      ['400 INVALID_TYPE', INVALID_TYPE],
      ['500', { status: 500 }],
      ['a network failure', new Error('socket hang up')],
      ['queryable: false', { name: 'ContentNote', queryable: false }],
    ])('treats a describe answering %s as not queryable, without throwing', async (_label, answer) => {
      const sf = withNotes([link]);
      sf.sobjectDescribe('ContentNote', answer);
      const adapter = sf.adapter();
      await expect(adapter.probe()).resolves.toBeUndefined();
      const result = await adapter.getNotesByOpportunity([OPP]);
      expect(result.items.map((n) => n.body.value)).toEqual(['legacy']);
      expect(sf.queries.some((q) => q.includes('FROM ContentNote'))).toBe(false);
      expect(adapter.capabilities().notesComplete).toBe(false);
      expect(adapter.capabilities().settingHints?.notesComplete).toBe(NOTES_ACCESS_HINT);
    });

    it('reports notes complete when ContentNote is not queryable but no Enhanced Note is linked', async () => {
      const sf = withNotes([]);
      sf.sobjectDescribe('ContentNote', NOT_FOUND);
      const adapter = sf.adapter();
      await adapter.probe();
      await adapter.getNotesByOpportunity([OPP]);
      expect(adapter.capabilities().notesComplete).toBe(true);
      expect(adapter.capabilities().settingHints?.notesComplete).toBeUndefined();
    });

    it('never throws on INVALID_TYPE from the ContentNote query itself, even without a probe', async () => {
      const sf = withNotes([link]);
      sf.on(/FROM ContentNote WHERE Id IN/, INVALID_TYPE);
      const adapter = sf.adapter();
      const result = await adapter.getNotesByOpportunity([OPP]);
      expect(result.items.map((n) => n.body.value)).toEqual(['legacy']);
      expect(adapter.capabilities().notesComplete).toBe(false);
    });

    it('still throws on other ContentNote query errors', async () => {
      const sf = withNotes([link]);
      sf.sobjectDescribe('ContentNote', { name: 'ContentNote', queryable: true });
      sf.on(/FROM ContentNote WHERE Id IN/, { status: 500 });
      const adapter = sf.adapter();
      await adapter.probe();
      await expect(adapter.getNotesByOpportunity([OPP])).rejects.toThrow(/Salesforce API error \(500\)/);
    });

    it('the hint names the Notes setting and the Run As user access', () => {
      expect(NOTES_ACCESS_HINT).toBe(
        'Enable Notes (Setup, Notes Settings) and give the Run As user read access to Notes (ContentNote), so Enhanced Notes can be read.',
      );
    });
  });

  describe('apiCallEstimate', () => {
    it('declares the calls a report run makes, with the note full-text fetch limit as the fetch cap', () => {
      const sf = installFakeSalesforce();
      expect(sf.adapter().capabilities().apiCallEstimate).toEqual({
        perRun: 4,
        perScanPage: 1,
        perSampledOpportunity: 4,
        perChildRecordBatch: 2,
        perRunFetchCap: 200,
      });
      expect(sf.adapter({ noteFullTextFetchLimit: 0 }).capabilities().apiCallEstimate?.perRunFetchCap).toBe(0);
    });
  });

  describe('SF_ACTIVITY_CAPTURE', () => {
    const base = { SF_CLIENT_ID: 'id', SF_CLIENT_SECRET: 'secret', SF_INSTANCE_URL: 'https://example.my.salesforce.com' };

    it('declares activitySync only for auto, with no hint', () => {
      const sf = installFakeSalesforce();
      const config = loadSalesforceConfigFromEnv({ ...base, SF_ACTIVITY_CAPTURE: 'Auto ' });
      expect(config.activityCapture).toBe('auto');
      const caps = sf.adapter({ activityCapture: config.activityCapture }).capabilities();
      expect(caps.activitySync).toBe(true);
      expect(caps.settingHints).toBeUndefined();
    });

    it.each([['manual'], [undefined]])('reports no activitySync, with the setting hint, for %s', (value) => {
      const sf = installFakeSalesforce();
      const config = loadSalesforceConfigFromEnv({ ...base, ...(value ? { SF_ACTIVITY_CAPTURE: value } : {}) });
      const caps = sf.adapter({ activityCapture: config.activityCapture }).capabilities();
      expect(caps.activitySync).toBe(false);
      expect(caps.settingHints?.activitySync).toBe(ACTIVITY_CAPTURE_HINT);
      expect(ACTIVITY_CAPTURE_HINT).toBe('Set SF_ACTIVITY_CAPTURE=auto if your team logs activity automatically.');
    });

    it('rejects an unknown value with a clear error', () => {
      expect(() => loadSalesforceConfigFromEnv({ ...base, SF_ACTIVITY_CAPTURE: 'yes' })).toThrow(
        /Invalid SF_ACTIVITY_CAPTURE value "yes"\. Use one of: auto, manual/,
      );
    });
  });

  describe('Enhanced Notes (ContentNote)', () => {
    const at = (day: number) => `2026-09-${String(day).padStart(2, '0')}T00:00:00.000+0000`;
    const legacyNote = (n: number, day: number) => ({
      Id: sfId('002', n), ParentId: OPP_1, Title: 't', Body: `legacy ${n}`, OwnerId: null, CreatedDate: at(day), SystemModstamp: at(day),
    });
    const contentNote = (n: number, day: number, preview: string) => ({
      Id: sfId('069', n), Title: 't', TextPreview: preview, OwnerId: sfId('005', 1), CreatedDate: at(day),
    });

    it('merges legacy and Enhanced Notes per opportunity, newest kept, as user-authored text', async () => {
      const sf = installFakeSalesforce();
      sf.on(/FROM Note WHERE ParentId/, [legacyNote(1, 3), legacyNote(2, 1)]);
      sf.on(/FROM ContentDocumentLink/, [{ ContentDocumentId: sfId('069', 1), LinkedEntityId: OPP_1 }]);
      sf.on(/FROM ContentNote WHERE Id IN/, [contentNote(1, 2, 'enhanced short note')]);
      const result = await sf.adapter().getNotesByOpportunity([sfRef('opportunity', OPP_1)]);

      expect(result.items.map((n) => n.body.value)).toEqual(['legacy 2', 'enhanced short note', 'legacy 1']);
      const enhanced = result.items[1]!;
      expect(enhanced.relatedTo.map((r) => r.id)).toEqual([OPP_1]);
      expect(enhanced.body.tier).toBe(result.items[0]!.body.tier);
      expect(enhanced.bodyTruncated).toBeUndefined();
      expect(sf.queries.find((q) => q.includes('FROM ContentDocumentLink'))).toMatch(
        /WHERE LinkedEntityId IN \(.*\) AND ContentDocument\.FileType = 'SNOTE'/,
      );
      expect(result.apiCallsConsumed).toBe(3); // legacy + link + ContentNote
    });

    it('applies the per-opportunity limit to legacy and Enhanced Notes combined', async () => {
      const sf = installFakeSalesforce();
      sf.on(/FROM Note WHERE ParentId/, Array.from({ length: 150 }, (_, i) => legacyNote(i + 1, 1)));
      sf.on(/FROM ContentDocumentLink/, Array.from({ length: 60 }, (_, i) => ({ ContentDocumentId: sfId('069', i + 1), LinkedEntityId: OPP_1 })));
      sf.on(/FROM ContentNote WHERE Id IN/, Array.from({ length: 60 }, (_, i) => contentNote(i + 1, 2, 'short')));
      const result = await sf.adapter().getNotesByOpportunity([sfRef('opportunity', OPP_1)]);
      expect(result.items).toHaveLength(200);
      expect(result.truncatedOpportunityIds.has(OPP_1)).toBe(true);
      // The 60 newer Enhanced Notes are all kept; 10 of the older legacy notes are cut.
      expect(result.items.filter((n) => n.body.value === 'short')).toHaveLength(60);
    });

    it('fetches the full text only for a preview at the cap, as plain text', async () => {
      const sf = installFakeSalesforce();
      const capped = 'x'.repeat(ENHANCED_NOTE_PREVIEW_CAP);
      sf.on(/FROM Note WHERE ParentId/, []);
      sf.on(/FROM ContentDocumentLink/, [
        { ContentDocumentId: sfId('069', 1), LinkedEntityId: OPP_1 },
        { ContentDocumentId: sfId('069', 2), LinkedEntityId: OPP_1 },
      ]);
      sf.on(/FROM ContentNote WHERE Id IN/, [contentNote(1, 1, capped), contentNote(2, 2, 'short')]);
      sf.noteContent(sfId('069', 1), '<p>Full &amp; complete</p><p>second line</p>');
      const result = await sf.adapter().getNotesByOpportunity([sfRef('opportunity', OPP_1)]);

      expect(result.items.map((n) => n.body.value)).toEqual(['Full & complete\nsecond line', 'short']);
      expect(sf.urls.filter((u) => u.includes('/sobjects/ContentNote/'))).toEqual([
        `/services/data/v62.0/sobjects/ContentNote/${sfId('069', 1)}/Content`,
      ]);
      expect(result.apiCallsConsumed).toBe(4);
    });

    it('stops fetching full text at the per-run budget and marks the rest bodyTruncated', async () => {
      const sf = installFakeSalesforce();
      const capped = 'y'.repeat(ENHANCED_NOTE_PREVIEW_CAP);
      sf.on(/FROM Note WHERE ParentId/, []);
      sf.on(/FROM ContentDocumentLink/, (soql) => {
        const opp = /IN \('(\w+)'\)/.exec(soql)![1]!;
        return [{ ContentDocumentId: opp === OPP_1 ? sfId('069', 1) : sfId('069', 2), LinkedEntityId: opp }];
      });
      sf.on(/FROM ContentNote WHERE Id IN/, (soql) => [contentNote(soql.includes(sfId('069', 1)) ? 1 : 2, 1, capped)]);
      sf.noteContent(sfId('069', 1), 'full one');
      sf.noteContent(sfId('069', 2), 'full two');
      const adapter = sf.adapter({ noteFullTextFetchLimit: 1 });

      const first = await adapter.getNotesByOpportunity([sfRef('opportunity', OPP_1)]);
      expect(first.items[0]!.body.value).toBe('full one');
      // The budget is per adapter instance (one run), so a later call has none left.
      const second = await adapter.getNotesByOpportunity([sfRef('opportunity', OPP_2)]);
      expect(second.items[0]!.body.value).toBe(capped);
      expect(second.items[0]!.bodyTruncated).toBe(true);
    });

    it('reads SF_NOTE_FULLTEXT_FETCH_LIMIT, and rejects a non-number', () => {
      const base = { SF_CLIENT_ID: 'id', SF_CLIENT_SECRET: 'secret', SF_INSTANCE_URL: 'https://example.my.salesforce.com' };
      expect(loadSalesforceConfigFromEnv(base).noteFullTextFetchLimit).toBeUndefined();
      expect(loadSalesforceConfigFromEnv({ ...base, SF_NOTE_FULLTEXT_FETCH_LIMIT: '0' }).noteFullTextFetchLimit).toBe(0);
      expect(() => loadSalesforceConfigFromEnv({ ...base, SF_NOTE_FULLTEXT_FETCH_LIMIT: 'lots' })).toThrow(
        /Invalid SF_NOTE_FULLTEXT_FETCH_LIMIT/,
      );
    });

    it('reduces note HTML to plain text', () => {
      expect(htmlToText('<p>A&nbsp;&lt;b&gt;</p><br/>B &quot;c&quot; &#39;d&#39;')).toBe('A <b>\nB "c" \'d\'');
    });
  });

  describe('Events (meetings)', () => {
    const task = (n: number, date: string) => ({
      Id: sfId('00T', n), WhoId: null, WhatId: OPP_1, Subject: `task ${n}`, Description: null, ActivityDate: date,
      CreatedDate: '2026-01-01T00:00:00.000+0000', SystemModstamp: '2026-01-01T00:00:00.000+0000',
    });
    const event = (n: number, dateTime: string | null, date: string | null = null) => ({
      Id: sfId('00U', n), WhoId: sfId('003', 1), WhatId: OPP_1, Subject: `meeting ${n}`, Description: 'agenda', ActivityDate: date,
      ActivityDateTime: dateTime, CreatedDate: '2026-01-02T00:00:00.000+0000', SystemModstamp: '2026-01-02T00:00:00.000+0000',
    });

    it('merges Events with Tasks by date, as meetings with the same trust tier', async () => {
      const sf = installFakeSalesforce();
      sf.on(/FROM Task WHERE WhatId/, [task(1, '2026-09-10'), task(2, '2026-09-01')]);
      sf.on(/FROM Event WHERE WhatId/, [event(1, '2026-09-05T15:00:00.000+0000'), event(2, null, '2026-08-20')]);
      const result = await sf.adapter().getActivitiesByOpportunity([sfRef('opportunity', OPP_1)]);

      expect(result.items.map((a) => [a.subject?.value, a.kind])).toEqual([
        ['meeting 2', 'meeting'],
        ['task 2', 'other'],
        ['meeting 1', 'meeting'],
        ['task 1', 'other'],
      ]);
      const meeting = result.items[2]!;
      expect(meeting.occurredAt).toBe('2026-09-05T15:00:00.000+0000');
      expect(meeting.relatedTo.map((r) => r.objectType)).toEqual(['opportunity', 'contact']);
      expect(meeting.body!.tier).toBe(result.items[1]!.subject!.tier);
      expect(result.apiCallsConsumed).toBe(2);
    });

    it('applies the per-opportunity limit to Tasks and Events combined', async () => {
      const sf = installFakeSalesforce();
      sf.on(/FROM Task WHERE WhatId/, Array.from({ length: 150 }, (_, i) => task(i + 1, '2026-08-01')));
      sf.on(/FROM Event WHERE WhatId/, Array.from({ length: 60 }, (_, i) => event(i + 1, '2026-09-01T00:00:00.000+0000')));
      const result = await sf.adapter().getActivitiesByOpportunity([sfRef('opportunity', OPP_1)]);
      expect(result.items).toHaveLength(200);
      expect(result.truncatedOpportunityIds.has(OPP_1)).toBe(true);
      expect(result.items.filter((a) => a.kind === 'meeting')).toHaveLength(60);
    });
  });

  describe('sample population', () => {
    const population = { asOf: '2026-09-30T12:00:00.000Z', closedWithinMonths: 12 };

    it('queries open deals and closed ones in the window, newest created first, with contact roles', async () => {
      const sf = installFakeSalesforce();
      sf.on(/FROM Opportunity WHERE \(IsClosed/, { pages: [[rawOpp(OPP_2)], [rawOpp(OPP_1)]] });
      sf.on(/FROM OpportunityContactRole/, [{ OpportunityId: OPP_1, ContactId: sfId('003', 1), Role: null, IsPrimary: true }]);
      const adapter = sf.adapter();
      const first = await adapter.listOpportunitiesForSample({ ...population, limit: 200 });
      expect(sf.queries[0]).toBe(
        `SELECT Id, AccountId, Name, Amount, StageName, CloseDate, OwnerId, IsClosed, IsWon, ForecastCategoryName, NextStep, CreatedDate, SystemModstamp ` +
          `FROM Opportunity WHERE (IsClosed = false OR (CloseDate >= 2025-09-30 AND CloseDate <= 2026-09-30)) ORDER BY CreatedDate DESC, Id DESC`,
      );
      expect(first.items.map((o) => o.ref.id)).toEqual([OPP_2]);
      expect(first.apiCallsConsumed).toBe(2);
      const second = await adapter.listOpportunitiesForSample({ ...population, limit: 200, cursor: first.nextCursor });
      expect(second.items[0]!.contactLinks).toHaveLength(1);
      expect(second.nextCursor).toBeUndefined();
    });

    it('counts open and in-window closed deals with two COUNT() queries', async () => {
      const sf = installFakeSalesforce();
      sf.on(/SELECT COUNT\(\) FROM Opportunity WHERE IsClosed = false$/, { pages: [[]] });
      sf.on(/SELECT COUNT\(\) FROM Opportunity WHERE IsClosed = true AND CloseDate >= 2025-09-30 AND CloseDate <= 2026-09-30$/, [{}, {}]);
      const count = await sf.adapter().countOpportunitiesForSample(population);
      expect([count.open, count.closedInWindow, count.apiCallsConsumed]).toEqual([0, 2, 2]);
    });
  });

  describe('custom stage mapping', () => {
    function mapFile(content: string): string {
      const file = path.join(mkdtempSync(path.join(tmpdir(), 'gtk-stage-map-')), 'stage-map.json');
      writeFileSync(file, content, 'utf8');
      return file;
    }

    it('loads a valid map file, including through SF_STAGE_MAP_PATH', () => {
      const file = mapFile(JSON.stringify({ 'Technical Win': 'evaluation', Signed: 'closed_won' }));
      expect(loadStageMapFile(file)).toEqual({ 'Technical Win': 'evaluation', Signed: 'closed_won' });
      const config = loadSalesforceConfigFromEnv({
        SF_CLIENT_ID: 'id', SF_CLIENT_SECRET: 'secret', SF_INSTANCE_URL: 'https://example.my.salesforce.com', SF_STAGE_MAP_PATH: file,
      });
      expect(config.stageMap).toEqual({ 'Technical Win': 'evaluation', Signed: 'closed_won' });
    });

    it('names the bad entry when a label maps to something that is not a stage', () => {
      const file = mapFile(JSON.stringify({ 'Technical Win': 'tech' }));
      expect(() => loadStageMapFile(file)).toThrow(
        `Stage map ${file}: "Technical Win" maps to "tech", which is not a canonical stage. ` +
          'Use one of: prospecting, discovery, evaluation, proposal, negotiation, closed_won, closed_lost.',
      );
    });

    it.each([
      ['not JSON', '{nope', /is not valid JSON/],
      ['an array', '["evaluation"]', /must be a JSON object/],
      ['an empty label', '{" ": "evaluation"}', /has an empty stage label/],
    ])('rejects a file that is %s', (_name, content, error) => {
      expect(() => loadStageMapFile(mapFile(content))).toThrow(error);
    });

    it('rejects a missing file with its path', () => {
      expect(() => loadStageMapFile(path.join(tmpdir(), 'gtk-no-such-map.json'))).toThrow(/Cannot read stage map .*gtk-no-such-map\.json/);
    });

    it('maps a custom stage label, and exposes the merged map in capabilities()', async () => {
      const sf = installFakeSalesforce();
      sf.on(/FROM Opportunity /, [rawOpp(OPP_1, { StageName: 'Technical Win' }), rawOpp(OPP_2, { StageName: 'Qualification' })]);
      sf.on(/FROM OpportunityContactRole/, []);
      const adapter = sf.adapter({ stageMap: { 'Technical Win': 'evaluation' } });
      const page = await adapter.listOpportunities({ limit: 200 });
      expect(page.items.map((o) => [o.stage, o.stageConfidence])).toEqual([
        ['evaluation', 'mapped'],
        ['discovery', 'mapped'],
      ]);
      expect(adapter.capabilities().stageMap['Technical Win']).toBe('evaluation');
      expect(adapter.capabilities().stageMap['Qualification']).toBe('discovery');
    });

    it('offers a fixed stage-map hint that names the setting and no stage label', () => {
      const sf = installFakeSalesforce();
      expect(sf.adapter({ stageMap: { 'Technical Win': 'evaluation' } }).capabilities().stageMapHint).toBe(STAGE_MAP_HINT);
      expect(STAGE_MAP_HINT).toBe('Map your custom stages to standard ones in a JSON file and set SF_STAGE_MAP_PATH to its path.');
    });

    it("counts a mapping that contradicts Salesforce's closed flags as unmapped, trusting the flags", async () => {
      const sf = installFakeSalesforce();
      sf.on(/FROM Opportunity /, [
        rawOpp(OPP_1, { StageName: 'Signed', IsClosed: false, IsWon: false }),
        rawOpp(OPP_2, { StageName: 'Technical Win', IsClosed: true, IsWon: false }),
      ]);
      sf.on(/FROM OpportunityContactRole/, []);
      const adapter = sf.adapter({ stageMap: { Signed: 'closed_won', 'Technical Win': 'evaluation' } });
      const page = await adapter.listOpportunities({ limit: 200 });
      expect(page.items.map((o) => [o.stage, o.stageConfidence])).toEqual([
        ['prospecting', 'unmapped'],
        ['closed_lost', 'unmapped'],
      ]);
    });

    it('marks a stage-history row with an unmapped stage instead of silently calling it prospecting', async () => {
      const sf = installFakeSalesforce();
      sf.on(/FROM OpportunityHistory WHERE OpportunityId/, [
        { Id: sfId('008', 1), OpportunityId: OPP_1, StageName: 'Custom Stage', CloseDate: null, CreatedById: null, CreatedDate: '2026-09-02T00:00:00.000+0000' },
        { Id: sfId('008', 2), OpportunityId: OPP_1, StageName: 'Technical Win', CloseDate: null, CreatedById: null, CreatedDate: '2026-09-01T00:00:00.000+0000' },
      ]);
      const adapter = sf.adapter({ stageMap: { 'Technical Win': 'evaluation' } });
      const result = await adapter.getStageHistoryByOpportunity([sfRef('opportunity', OPP_1)]);
      expect(result.items.map((e) => [e.toStage, e.toStageConfidence])).toEqual([
        ['evaluation', undefined],
        ['prospecting', 'unmapped'],
      ]);
    });
  });
});

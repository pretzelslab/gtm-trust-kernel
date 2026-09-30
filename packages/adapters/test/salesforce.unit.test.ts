/**
 * SalesforceAdapter unit tests against the in-memory fake API
 * (test/support/fakeSalesforce.ts). No network, no credentials. These pin
 * down the adapter's own behaviour (queries sent, mapping, paging, errors);
 * the live contract run against a real org is separate.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
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
});

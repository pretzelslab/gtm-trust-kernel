/**
 * MockAdapter's sample population listing against hand-built data with the
 * cases the shared contract suite can't guarantee a fixture has: a closed
 * deal outside the window, and equal created dates.
 */

import { describe, expect, it } from 'vitest';
import { MockAdapter, type MockOrgData } from '../src/mock.js';
import type { Opportunity, RecordRef } from '../src/model/canonical.js';

const ORG = 'org-sample-population';
const ref = (objectType: RecordRef['objectType'], id: string): RecordRef => ({ crm: 'mock', orgId: ORG, objectType, id });
const ASOF = '2026-09-30T00:00:00.000Z';

function opp(id: string, createdAt: string, closed?: { won: boolean; closeDate: string }): Opportunity {
  return {
    ref: ref('opportunity', id),
    accountRef: ref('account', 'acc-1'),
    name: id,
    stage: closed ? (closed.won ? 'closed_won' : 'closed_lost') : 'discovery',
    stageConfidence: 'mapped',
    vendorStageLabel: 'x',
    closeDate: closed?.closeDate ?? '2026-12-01',
    isClosed: Boolean(closed),
    isWon: closed?.won ?? false,
    contactLinks: [],
    createdAt,
    modifiedAt: createdAt,
    concurrencyToken: createdAt,
  };
}

function data(opportunities: Opportunity[]): MockOrgData {
  return { accounts: [], opportunities, contacts: [], activities: [], notes: [], stageHistory: [], ownerChanges: [], nextStepChanges: [] };
}

describe('MockAdapter sample population', () => {
  const opportunities = [
    opp('opp-a', '2026-01-01T00:00:00.000Z'),
    opp('opp-b', '2026-03-01T00:00:00.000Z'),
    opp('opp-c', '2026-03-01T00:00:00.000Z'),
    opp('opp-won-recent', '2026-02-01T00:00:00.000Z', { won: true, closeDate: '2026-06-01' }),
    opp('opp-lost-old', '2024-01-01T00:00:00.000Z', { won: false, closeDate: '2025-01-01' }),
  ];

  it('excludes closed deals outside the window and orders newest created first, ties by id descending', async () => {
    const adapter = new MockAdapter(ORG, data(opportunities));
    const page = await adapter.listOpportunitiesForSample({ asOf: ASOF, closedWithinMonths: 12, limit: 10 });
    expect(page.items.map((o) => o.ref.id)).toEqual(['opp-c', 'opp-b', 'opp-won-recent', 'opp-a']);
  });

  it('counts open and in-window closed deals', async () => {
    const adapter = new MockAdapter(ORG, data(opportunities));
    const count = await adapter.countOpportunitiesForSample({ asOf: ASOF, closedWithinMonths: 12 });
    expect([count.open, count.closedInWindow]).toEqual([3, 1]);
  });

  it('raises a smaller limit to minPageSize when one is set, and pages the rest', async () => {
    const adapter = new MockAdapter(ORG, data(opportunities), { minPageSize: 3 });
    const first = await adapter.listOpportunitiesForSample({ asOf: ASOF, closedWithinMonths: 12, limit: 1 });
    expect(first.items.map((o) => o.ref.id)).toEqual(['opp-c', 'opp-b', 'opp-won-recent']);
    const second = await adapter.listOpportunitiesForSample({ asOf: ASOF, closedWithinMonths: 12, limit: 1, cursor: first.nextCursor });
    expect(second.items.map((o) => o.ref.id)).toEqual(['opp-a']);
    expect(second.nextCursor).toBeUndefined();
    expect((await adapter.listOpportunities({ limit: 1 })).items).toHaveLength(3);
  });

  it('honours the limit exactly when minPageSize is unset', async () => {
    const adapter = new MockAdapter(ORG, data(opportunities));
    const page = await adapter.listOpportunitiesForSample({ asOf: ASOF, closedWithinMonths: 12, limit: 1 });
    expect(page.items.map((o) => o.ref.id)).toEqual(['opp-c']);
  });
});

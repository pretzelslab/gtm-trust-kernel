/**
 * Mock-specific tests for getNotesByOpportunity/getActivitiesByOpportunity's
 * per-opportunity truncation cap. Forcing an actual truncation scenario
 * needs an opportunity seeded with more related records than the limit —
 * not practical to require of every adapter in the shared contract suite
 * (adapter.contract.ts already checks the shape: truncatedOpportunityIds
 * is a Set, empty when under the limit). This file checks the mock's own
 * enforcement of that cap.
 */

import { describe, expect, it } from 'vitest';
import { MockAdapter, type MockOrgData } from '../src/mock.js';
import type { Activity, Note, Opportunity, RecordRef } from '../src/model/canonical.js';
import { TrustTier, tag } from '../src/model/trust.js';

const ORG = 'org-child-records-test';
const ref = (objectType: RecordRef['objectType'], id: string): RecordRef => ({ crm: 'mock', orgId: ORG, objectType, id });
const iso = (daysAgo: number) => new Date(Date.UTC(2026, 8, 20) - daysAgo * 86_400_000).toISOString();

function makeData(): MockOrgData {
  const opportunities: Opportunity[] = [
    {
      ref: ref('opportunity', 'opp-1'),
      accountRef: ref('account', 'acc-1'),
      name: 'Deal 1',
      stage: 'discovery',
      stageConfidence: 'mapped',
      vendorStageLabel: 'Discovery',
      isClosed: false,
      contactLinks: [],
      createdAt: iso(100),
      modifiedAt: iso(1),
      concurrencyToken: 'tok-opp-1',
    },
  ];

  const notes: Note[] = [
    {
      ref: ref('note', 'note-1'),
      relatedTo: [ref('opportunity', 'opp-1')],
      createdAt: iso(3),
      body: tag(TrustTier.UserAuthored, 'First note', { recordId: 'note:note-1', field: 'body', capturedAt: iso(3) }),
    },
    {
      ref: ref('note', 'note-2'),
      relatedTo: [ref('opportunity', 'opp-1')],
      createdAt: iso(1),
      body: tag(TrustTier.UserAuthored, 'Second, more recent note', { recordId: 'note:note-2', field: 'body', capturedAt: iso(1) }),
    },
  ];

  const activities: Activity[] = [
    {
      ref: ref('activity', 'act-1'),
      relatedTo: [ref('opportunity', 'opp-1')],
      kind: 'call',
      direction: 'outbound',
      occurredAt: iso(5),
      participantIds: [],
    },
    {
      ref: ref('activity', 'act-2'),
      relatedTo: [ref('opportunity', 'opp-1')],
      kind: 'email',
      direction: 'outbound',
      occurredAt: iso(2),
      participantIds: [],
    },
  ];

  return { accounts: [], opportunities, contacts: [], activities, notes, stageHistory: [], ownerChanges: [] };
}

describe('MockAdapter getNotesByOpportunity/getActivitiesByOpportunity truncation', () => {
  it('caps a single opportunity\'s notes at notesPerOpportunityLimit and reports it truncated', async () => {
    const adapter = new MockAdapter(ORG, makeData(), { notesPerOpportunityLimit: 1 });
    const result = await adapter.getNotesByOpportunity([ref('opportunity', 'opp-1')]);

    expect(result.items).toHaveLength(1);
    expect(result.truncatedOpportunityIds.has('opp-1')).toBe(true);
  });

  it('truncates oldest-first: keeps the newest note within the cap, not the oldest', async () => {
    const adapter = new MockAdapter(ORG, makeData(), { notesPerOpportunityLimit: 1 });
    const result = await adapter.getNotesByOpportunity([ref('opportunity', 'opp-1')]);
    expect(result.items[0]!.ref.id).toBe('note-2'); // iso(1), more recent than note-1's iso(3) — note-1 (older) is the one dropped
  });

  it('caps activities at activitiesPerOpportunityLimit and reports it truncated', async () => {
    const adapter = new MockAdapter(ORG, makeData(), { activitiesPerOpportunityLimit: 1 });
    const result = await adapter.getActivitiesByOpportunity([ref('opportunity', 'opp-1')]);

    expect(result.items).toHaveLength(1);
    expect(result.truncatedOpportunityIds.has('opp-1')).toBe(true);
  });

  it('truncates oldest-first: keeps the newest activity within the cap, not the oldest', async () => {
    const adapter = new MockAdapter(ORG, makeData(), { activitiesPerOpportunityLimit: 1 });
    const result = await adapter.getActivitiesByOpportunity([ref('opportunity', 'opp-1')]);
    expect(result.items[0]!.ref.id).toBe('act-2'); // iso(2), more recent than act-1's iso(5) — act-1 (older) is the one dropped
  });

  it('does not report truncation when the limit is not exceeded', async () => {
    const adapter = new MockAdapter(ORG, makeData(), { notesPerOpportunityLimit: 200 });
    const result = await adapter.getNotesByOpportunity([ref('opportunity', 'opp-1')]);

    expect(result.items).toHaveLength(2);
    expect(result.truncatedOpportunityIds.size).toBe(0);
  });
});

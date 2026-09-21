/**
 * Mock-specific tests for MockSecondSourceAdapter's getActivitiesByRef
 * per-ref truncation cap. Forcing an actual truncation scenario needs a
 * contact/account seeded with more related activities than the limit —
 * not practical to require of every adapter in the shared contract suite
 * (secondSource.contract.ts already checks the shape: truncatedRefIds is
 * a Set, empty when under the limit). Same split rationale as
 * mock.childRecords.test.ts for the CRM adapter's equivalent cap.
 */

import { describe, expect, it } from 'vitest';
import { MockSecondSourceAdapter, type MockSecondSourceOrgData } from '../src/mock.js';
import type { SecondSourceActivity, SecondSourceRef } from '../src/types.js';

const SOURCE = 'org-second-source-test';
const ORG = 'org-second-source-test';
const ref = (objectType: SecondSourceRef['objectType'], id: string): SecondSourceRef => ({ source: SOURCE, orgId: ORG, objectType, id });
const iso = (daysAgo: number) => new Date(Date.UTC(2026, 8, 20) - daysAgo * 86_400_000).toISOString();

function makeData(): MockSecondSourceOrgData {
  const activities: SecondSourceActivity[] = [
    {
      ref: ref('activity', 'ss-act-1'),
      contactRef: ref('contact', 'con-1'),
      accountRef: null,
      occurredAt: iso(5),
      kind: 'call',
      createdAt: iso(5),
      lastModifiedAt: iso(5),
    },
    {
      ref: ref('activity', 'ss-act-2'),
      contactRef: ref('contact', 'con-1'),
      accountRef: null,
      occurredAt: iso(2),
      kind: 'email',
      createdAt: iso(2),
      lastModifiedAt: iso(2),
    },
  ];

  return {
    contacts: [{ ref: ref('contact', 'con-1'), email: 'dana@example.com', modifiedAt: iso(10) }],
    accounts: [{ ref: ref('account', 'acc-1'), domain: 'example.com', modifiedAt: iso(10) }],
    activities,
  };
}

describe('MockSecondSourceAdapter getActivitiesByRef truncation', () => {
  it('caps a single ref\'s activities at activitiesPerRefLimit and reports it truncated', async () => {
    const adapter = new MockSecondSourceAdapter(makeData(), { activitiesPerRefLimit: 1 });
    const result = await adapter.getActivitiesByRef([ref('contact', 'con-1')]);

    expect(result.items).toHaveLength(1);
    expect(result.truncatedRefIds.has('con-1')).toBe(true);
  });

  it('truncates oldest-first: keeps the newest activity within the cap, not the oldest', async () => {
    const adapter = new MockSecondSourceAdapter(makeData(), { activitiesPerRefLimit: 1 });
    const result = await adapter.getActivitiesByRef([ref('contact', 'con-1')]);
    expect(result.items[0]!.ref.id).toBe('ss-act-2'); // iso(2), more recent than ss-act-1's iso(5) — ss-act-1 (older) is the one dropped
  });

  it('does not report truncation when the limit is not exceeded', async () => {
    const adapter = new MockSecondSourceAdapter(makeData(), { activitiesPerRefLimit: 200 });
    const result = await adapter.getActivitiesByRef([ref('contact', 'con-1')]);

    expect(result.items).toHaveLength(2);
    expect(result.truncatedRefIds.size).toBe(0);
  });

  it('matches by accountRef when the given ref\'s objectType is account', async () => {
    const data = makeData();
    data.activities.push({
      ref: ref('activity', 'ss-act-3'),
      contactRef: null,
      accountRef: ref('account', 'acc-1'),
      occurredAt: iso(1),
      kind: 'meeting',
      createdAt: iso(1),
      lastModifiedAt: iso(1),
    });
    const adapter = new MockSecondSourceAdapter(data);
    const result = await adapter.getActivitiesByRef([ref('account', 'acc-1')]);
    expect(result.items.map((a) => a.ref.id)).toEqual(['ss-act-3']);
  });
});

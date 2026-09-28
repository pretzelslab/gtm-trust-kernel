/**
 * volume: ordinary D1-D5 hygiene (deliberately unremarkable — this fixture
 * exists for exactly one purpose), but 30 closed_won + 30 closed_lost
 * opportunities — over buildReportData's default perStratumSampleSize (20,
 * report/buildReport.ts) for BOTH closed strata, so a real
 * `report --fixture volume --json` run exercises closed_deal_count_12m's
 * floor path (both closedWonUnderfilled/closedLostUnderfilled false) end to
 * end, not just a synthetic unit-test CoverageSample. See docs/STATUS.md's
 * D7 decisions for why none of healthy/fresh/legacy (12/4/6 per closed
 * stage) can demonstrate this.
 */

import {
  BASE_CAPABILITIES,
  CLOSED_STAGES,
  OPEN_STAGES,
  daysBefore,
  makeAccount,
  makeActivity,
  makeContact,
  makeNextStepChange,
  makeNote,
  makeOpportunity,
  makeStageHistoryEntry,
  ref,
  type Account,
  type Activity,
  type Contact,
  type MockOrgFixture,
  type NextStepChange,
  type Note,
  type Opportunity,
  type StageHistoryEntry,
} from './mockOrgShared.js';

function generateVolume(): MockOrgFixture {
  const orgId = 'org-volume';
  const asOf = '2026-09-20T00:00:00.000Z';

  const accounts: Account[] = [];
  const contacts: Contact[] = [];
  for (let i = 0; i < 15; i++) {
    const domain = `volumeco${i}.com`;
    accounts.push(makeAccount(orgId, `acc-${i}`, domain, daysBefore(asOf, 900)));
    contacts.push(makeContact(orgId, `con-${i}`, ref(orgId, 'account', `acc-${i}`), `lead${i}@${domain}`, daysBefore(asOf, 900)));
  }

  const opportunities: Opportunity[] = [];
  const activities: Activity[] = [];
  const notes: Note[] = [];
  const stageHistory: StageHistoryEntry[] = [];
  const nextStepChanges: NextStepChange[] = [];

  let n = 0;
  const perOpenStratum = 15;
  const perClosedStratum = 30;
  const allStages = [...OPEN_STAGES, ...CLOSED_STAGES];

  for (const stage of allStages) {
    const count = OPEN_STAGES.includes(stage) ? perOpenStratum : perClosedStratum;
    for (let i = 0; i < count; i++) {
      const id = `opp-${n}`;
      const accountRef = ref(orgId, 'account', `acc-${n % accounts.length}`);
      const isClosed = CLOSED_STAGES.includes(stage);
      const createdAt = daysBefore(asOf, 400 + (n % 60));
      const closeDate = isClosed ? daysBefore(asOf, 5 + (n % 300)) : daysBefore(asOf, -(10 + (n % 60)));

      opportunities.push(
        makeOpportunity({
          id,
          orgId,
          stage,
          stageConfidence: 'mapped',
          vendorStageLabel: stage,
          accountRef,
          amount: 1000 * (10 + (n % 90)),
          closeDate,
          ownerId: `rep-${n % 8}`,
          nextStep: isClosed ? undefined : `Follow up on ${id}`,
          contactRefs: [ref(orgId, 'contact', `con-${n % accounts.length}`)],
          createdAt,
          modifiedAt: daysBefore(asOf, n % 10),
        }),
      );

      if (!isClosed) {
        activities.push(makeActivity(orgId, `act-${n}`, ref(orgId, 'opportunity', id), daysBefore(asOf, n % 20)));
        // Every open opportunity has a Next Step (unconditional above) and a
        // matching change-history entry — a clean, fully-covered baseline,
        // contrasting with healthy's partial-exclusion and legacy's
        // capability-off cases.
        nextStepChanges.push(makeNextStepChange(orgId, `nsc-${n}`, ref(orgId, 'opportunity', id), daysBefore(asOf, n % 30)));
      }
      notes.push(makeNote(orgId, `note-${n}`, ref(orgId, 'opportunity', id), `Standard progress note for deal ${id}.`, daysBefore(asOf, n % 30)));
      stageHistory.push(makeStageHistoryEntry(orgId, `sh-${n}`, ref(orgId, 'opportunity', id), stage, createdAt));

      n++;
    }
  }

  stageHistory.push(makeStageHistoryEntry(orgId, 'sh-earliest', ref(orgId, 'opportunity', 'opp-0'), 'prospecting', daysBefore(asOf, 640)));

  return {
    name: 'volume',
    orgId,
    label: 'Volume',
    description: 'Ordinary field hygiene; exists solely to exceed the default per-stratum sample size on both closed strata (closed_deal_count_12m\'s floor path).',
    asOf,
    capabilities: BASE_CAPABILITIES,
    data: { accounts, opportunities, contacts, activities, notes, stageHistory, ownerChanges: [], nextStepChanges },
    // No second source: this fixture's only job is the D7 floor path, not D5.
  };
}

export const volumeFixture: MockOrgFixture = generateVolume();

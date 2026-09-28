/**
 * fresh: newly onboarded. Otherwise healthy-quality data, but stage-history
 * tracking was JUST turned on — capability true, zero entries retained yet.
 */

import {
  BASE_CAPABILITIES,
  CLOSED_STAGES,
  OPEN_STAGES,
  daysBefore,
  makeAccount,
  makeActivity,
  makeContact,
  makeNote,
  makeOpportunity,
  ref,
  type Account,
  type Activity,
  type Contact,
  type MockOrgFixture,
  type Note,
  type Opportunity,
  type OwnerChange,
} from './mockOrgShared.js';

function generateFresh(): MockOrgFixture {
  const orgId = 'org-fresh';
  const asOf = '2026-09-20T00:00:00.000Z';

  const accounts: Account[] = [];
  const contacts: Contact[] = [];
  for (let i = 0; i < 8; i++) {
    const domain = `freshstart${i}.com`;
    accounts.push(makeAccount(orgId, `acc-${i}`, domain, daysBefore(asOf, 60)));
    contacts.push(makeContact(orgId, `con-${i}a`, ref(orgId, 'account', `acc-${i}`), `lead${i}@${domain}`, daysBefore(asOf, 60)));
  }

  const opportunities: Opportunity[] = [];
  const activities: Activity[] = [];
  const notes: Note[] = [];
  const ownerChanges: OwnerChange[] = [];

  let n = 0;
  const perOpenStratum = 8;
  const perClosedStratum = 4;
  const allStages = [...OPEN_STAGES, ...CLOSED_STAGES];

  for (const stage of allStages) {
    const count = OPEN_STAGES.includes(stage) ? perOpenStratum : perClosedStratum;
    for (let i = 0; i < count; i++) {
      const id = `opp-${n}`;
      const accountRef = ref(orgId, 'account', `acc-${n % accounts.length}`);
      const createdAt = daysBefore(asOf, 30 + (n % 20));
      const isClosed = CLOSED_STAGES.includes(stage);
      const closeDate = isClosed ? daysBefore(asOf, 2 + (n % 20)) : daysBefore(asOf, -(5 + (n % 25)));

      opportunities.push(
        makeOpportunity({
          id,
          orgId,
          stage,
          stageConfidence: 'mapped',
          vendorStageLabel: stage,
          accountRef,
          amount: 1000 * (5 + (n % 40)),
          closeDate,
          ownerId: `rep-${n % 3}`,
          nextStep: n % 6 === 0 ? undefined : `Schedule discovery follow-up for ${id}`,
          contactRefs: [ref(orgId, 'contact', `con-${n % accounts.length}a`)],
          createdAt,
          modifiedAt: daysBefore(asOf, n % 5),
        }),
      );

      if (!isClosed && n % 4 !== 0) {
        activities.push(makeActivity(orgId, `act-${n}`, ref(orgId, 'opportunity', id), daysBefore(asOf, n % 15)));
        notes.push(
          makeNote(orgId, `note-${n}`, ref(orgId, 'opportunity', id), `Kickoff call went well for ${id}, evaluating fit.`, daysBefore(asOf, n % 15)),
        );
      }

      n++;
    }
  }

  return {
    name: 'fresh',
    orgId,
    label: 'Fresh',
    description: 'Newly onboarded org: healthy-quality data, but stage-history tracking was just turned on (zero entries retained yet).',
    asOf,
    capabilities: BASE_CAPABILITIES, // stageHistory: true, but data.stageHistory is empty below.
    data: { accounts, opportunities, contacts, activities, notes, stageHistory: [], ownerChanges, nextStepChanges: [] },
    // secondSource intentionally omitted: this is D5's "no second source
    // connected" fixture — layers onto "newly onboarded" (a fresh org
    // hasn't connected one yet either), rather than adding a 4th fixture
    // name. See second-source-adapter-design.md.
  };
}

export const freshFixture: MockOrgFixture = generateFresh();

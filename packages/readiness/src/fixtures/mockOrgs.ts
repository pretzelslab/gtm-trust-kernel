/**
 * Mock org fixtures for the visual report (src/report/*). Product code, not
 * test-only — the report CLI reads these at runtime, unlike test/fixtures/*
 * (golden fixtures for unit tests, with hand-verified expected numbers).
 *
 * These are generated, not hand-tuned to exact expected metric values —
 * nothing asserts on their precise numeric output (only buildReport's JSON
 * *shape* is tested, per this session's scope). Each fixture bakes in its
 * own fixed `asOf`, not real "now", so report numbers are stable run to run.
 */

import { TrustTier, tag } from '@gtm-trust-kernel/adapters/model/trust.js';
import { CANONICAL_STAGE_ORDER } from '@gtm-trust-kernel/adapters/model/canonical.js';
import type {
  Account,
  Activity,
  CanonicalStage,
  Contact,
  Note,
  Opportunity,
  OwnerChange,
  RecordRef,
  StageConfidence,
  StageHistoryEntry,
} from '@gtm-trust-kernel/adapters/model/canonical.js';
import type { AdapterCapabilities } from '@gtm-trust-kernel/adapters/types.js';
import type { MockOrgData } from '@gtm-trust-kernel/adapters/mock.js';

export type FixtureName = 'healthy' | 'fresh' | 'legacy';

export const FIXTURE_NAMES: readonly FixtureName[] = ['healthy', 'fresh', 'legacy'];

export interface MockOrgFixture {
  readonly name: FixtureName;
  readonly orgId: string;
  readonly label: string;
  readonly description: string;
  readonly asOf: string;
  readonly capabilities: AdapterCapabilities;
  readonly data: MockOrgData;
}

const DAY_MS = 86_400_000;

function daysBefore(asOf: string, days: number): string {
  return new Date(new Date(asOf).getTime() - days * DAY_MS).toISOString();
}

function ref(orgId: string, objectType: RecordRef['objectType'], id: string): RecordRef {
  return { crm: 'mock', orgId, objectType, id };
}

const OPEN_STAGES: readonly CanonicalStage[] = CANONICAL_STAGE_ORDER;
const CLOSED_STAGES: readonly CanonicalStage[] = ['closed_won', 'closed_lost'];

interface OppOptions {
  readonly id: string;
  readonly orgId: string;
  readonly stage: CanonicalStage;
  readonly stageConfidence: StageConfidence;
  readonly vendorStageLabel: string;
  readonly accountRef: RecordRef;
  readonly amount?: number;
  readonly closeDate?: string;
  readonly ownerId?: string;
  readonly nextStep?: string;
  readonly contactRefs?: readonly RecordRef[];
  readonly createdAt: string;
  readonly modifiedAt: string;
}

function makeOpportunity(o: OppOptions): Opportunity {
  const isClosed = o.stage === 'closed_won' || o.stage === 'closed_lost';
  return {
    ref: ref(o.orgId, 'opportunity', o.id),
    accountRef: o.accountRef,
    name: `Deal ${o.id}`,
    amount: o.amount,
    stage: o.stage,
    stageConfidence: o.stageConfidence,
    vendorStageLabel: o.vendorStageLabel,
    closeDate: o.closeDate,
    ownerId: o.ownerId,
    isClosed,
    isWon: o.stage === 'closed_won' ? true : o.stage === 'closed_lost' ? false : undefined,
    nextStep: o.nextStep
      ? tag(TrustTier.UserAuthored, o.nextStep, {
          recordId: `opportunity:${o.id}`,
          field: 'nextStep',
          capturedAt: o.modifiedAt,
        })
      : undefined,
    contactLinks: (o.contactRefs ?? []).map((contactRef, i) => ({ contactRef, isPrimary: i === 0 })),
    createdAt: o.createdAt,
    modifiedAt: o.modifiedAt,
    concurrencyToken: `tok-${o.id}`,
  };
}

function makeAccount(orgId: string, id: string, domain: string | undefined, createdAt: string): Account {
  return { ref: ref(orgId, 'account', id), name: `Account ${id}`, domain, createdAt, modifiedAt: createdAt };
}

function makeContact(orgId: string, id: string, accountRef: RecordRef, email: string | undefined, createdAt: string): Contact {
  return { ref: ref(orgId, 'contact', id), accountRef, name: `Contact ${id}`, email, createdAt, modifiedAt: createdAt };
}

function makeActivity(orgId: string, id: string, opportunityRef: RecordRef, occurredAt: string): Activity {
  return {
    ref: ref(orgId, 'activity', id),
    relatedTo: [opportunityRef],
    kind: 'call',
    direction: 'outbound',
    occurredAt,
    participantIds: [],
  };
}

function makeNote(orgId: string, id: string, opportunityRef: RecordRef, body: string, createdAt: string): Note {
  return {
    ref: ref(orgId, 'note', id),
    relatedTo: [opportunityRef],
    createdAt,
    body: tag(TrustTier.UserAuthored, body, { recordId: `note:${id}`, field: 'body', capturedAt: createdAt }),
  };
}

function makeStageHistoryEntry(
  orgId: string,
  id: string,
  opportunityRef: RecordRef,
  toStage: CanonicalStage,
  changedAt: string,
): StageHistoryEntry {
  return { ref: ref(orgId, 'stage_history', id), opportunityRef, toStage, changedAt };
}

function makeOwnerChange(orgId: string, id: string, subjectRef: RecordRef, toOwnerId: string, changedAt: string): OwnerChange {
  return { ref: ref(orgId, 'owner_change', id), subjectRef, toOwnerId, changedAt };
}

const BASE_CAPABILITIES: AdapterCapabilities = {
  stageHistory: true,
  ownerHistory: true,
  activitySync: true,
  incrementalSync: true,
  bulkRead: true,
  writeGranularity: 'field',
  nativeConcurrencyCheck: false,
  rateLimit: { kind: 'none', value: 0 },
  stageMap: {},
  accountBatchLimit: 200,
};

// ---------------------------------------------------------------------------
// healthy: good coverage and hygiene across the board.
// ---------------------------------------------------------------------------

function generateHealthy(): MockOrgFixture {
  const orgId = 'org-healthy';
  const asOf = '2026-09-20T00:00:00.000Z';

  const accounts: Account[] = [];
  const contacts: Contact[] = [];
  for (let i = 0; i < 15; i++) {
    const domain = `northco${i}.com`;
    accounts.push(makeAccount(orgId, `acc-${i}`, domain, daysBefore(asOf, 900)));
    contacts.push(makeContact(orgId, `con-${i}a`, ref(orgId, 'account', `acc-${i}`), `lead${i}@${domain}`, daysBefore(asOf, 900)));
    contacts.push(makeContact(orgId, `con-${i}b`, ref(orgId, 'account', `acc-${i}`), `buyer${i}@${domain}`, daysBefore(asOf, 900)));
  }

  const opportunities: Opportunity[] = [];
  const activities: Activity[] = [];
  const notes: Note[] = [];
  const stageHistory: StageHistoryEntry[] = [];
  const ownerChanges: OwnerChange[] = [];

  let n = 0;
  const perOpenStratum = 20;
  const perClosedStratum = 12;

  const allStages = [...OPEN_STAGES, ...CLOSED_STAGES];
  for (const stage of allStages) {
    const count = OPEN_STAGES.includes(stage) ? perOpenStratum : perClosedStratum;
    for (let i = 0; i < count; i++) {
      const id = `opp-${n}`;
      const accountRef = ref(orgId, 'account', `acc-${n % accounts.length}`);
      const createdAt = daysBefore(asOf, 400 + (n % 60));
      const isClosed = CLOSED_STAGES.includes(stage);
      const closeDate = isClosed
        ? daysBefore(asOf, 5 + (n % 300))
        : n % 20 === 0
          ? undefined
          : daysBefore(asOf, -(10 + (n % 60))); // future close date for most open deals
      const modifiedAt = daysBefore(asOf, n % 10);

      opportunities.push(
        makeOpportunity({
          id,
          orgId,
          stage,
          stageConfidence: n % 25 === 0 ? 'inferred' : 'mapped',
          vendorStageLabel: stage,
          accountRef,
          amount: n % 15 === 0 ? undefined : 1000 * (10 + (n % 90)) + (n % 7 === 0 ? 0 : 137),
          closeDate,
          ownerId: `rep-${n % 8}`,
          nextStep: n % 12 === 0 ? undefined : `Follow up with contact on deal ${id}, confirm budget and timeline`,
          contactRefs: n % 10 === 0 ? [] : [ref(orgId, 'contact', `con-${n % accounts.length}a`)],
          createdAt,
          modifiedAt,
        }),
      );

      if (!isClosed) {
        // Recent qualifying activity for most open deals.
        if (n % 8 !== 0) {
          activities.push(makeActivity(orgId, `act-${n}`, ref(orgId, 'opportunity', id), daysBefore(asOf, n % 20)));
        }
        if (n % 5 !== 0) {
          notes.push(
            makeNote(
              orgId,
              `note-${n}`,
              ref(orgId, 'opportunity', id),
              `Had a productive call with the buying committee about deal ${id}. They confirmed timeline and next steps for procurement.`,
              daysBefore(asOf, n % 30),
            ),
          );
        }
      }

      stageHistory.push(makeStageHistoryEntry(orgId, `sh-${n}`, ref(orgId, 'opportunity', id), stage, createdAt));
      if (n % 6 === 0) {
        ownerChanges.push(makeOwnerChange(orgId, `oc-${n}`, ref(orgId, 'opportunity', id), `rep-${n % 8}`, daysBefore(asOf, 200 + (n % 100))));
      }

      n++;
    }
  }

  // Oldest retained stage history: well over a year back, for a comfortably viable stage_history_months.
  stageHistory.push(makeStageHistoryEntry(orgId, 'sh-earliest', ref(orgId, 'opportunity', 'opp-0'), 'prospecting', daysBefore(asOf, 640)));

  return {
    name: 'healthy',
    orgId,
    label: 'Healthy',
    description: 'Good field hygiene, full capability matrix, clean unique account domains.',
    asOf,
    capabilities: BASE_CAPABILITIES,
    data: { accounts, opportunities, contacts, activities, notes, stageHistory, ownerChanges },
  };
}

// ---------------------------------------------------------------------------
// fresh: newly onboarded. Otherwise healthy-quality data, but stage-history
// tracking was JUST turned on — capability true, zero entries retained yet.
// ---------------------------------------------------------------------------

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
    data: { accounts, opportunities, contacts, activities, notes, stageHistory: [], ownerChanges },
  };
}

// ---------------------------------------------------------------------------
// legacy: sparse fields, most history/sync capabilities off, messy accounts.
// ---------------------------------------------------------------------------

function generateLegacy(): MockOrgFixture {
  const orgId = 'org-legacy';
  const asOf = '2026-09-20T00:00:00.000Z';

  // Accounts deliberately messy: two share the same custom domain (a real
  // duplicate group), two use a denylisted shared-provider domain, one has
  // no domain at all.
  const accountDomains: (string | undefined)[] = [
    'oldco.com',
    'oldco.com',
    'gmail.com',
    'gmail.com',
    'legacypartner.com',
    undefined,
  ];
  const accounts: Account[] = accountDomains.map((domain, i) => makeAccount(orgId, `acc-${i}`, domain, daysBefore(asOf, 2000)));
  const contacts: Contact[] = accounts.map((a, i) =>
    makeContact(orgId, `con-${i}`, a.ref, i % 3 === 0 ? undefined : `person${i}@${accountDomains[i] ?? 'unknown.example'}`, daysBefore(asOf, 2000)),
  );

  const opportunities: Opportunity[] = [];
  const stageHistory: StageHistoryEntry[] = []; // capability is off; content here is inert either way.
  const ownerChanges: OwnerChange[] = [];

  let n = 0;
  const perOpenStratum = 10;
  const perClosedStratum = 6;
  const allStages = [...OPEN_STAGES, ...CLOSED_STAGES];
  const stageConfidences: StageConfidence[] = ['mapped', 'inferred', 'unmapped'];

  for (const stage of allStages) {
    const count = OPEN_STAGES.includes(stage) ? perOpenStratum : perClosedStratum;
    for (let i = 0; i < count; i++) {
      const id = `opp-${n}`;
      const accountRef = ref(orgId, 'account', `acc-${n % accounts.length}`);
      const isClosed = CLOSED_STAGES.includes(stage);
      const createdAt = daysBefore(asOf, 1500 - (n % 400));
      // Past-due close dates common for open deals; many missing entirely.
      const closeDate = isClosed
        ? n % 4 === 0
          ? undefined
          : daysBefore(asOf, 20 + (n % 500))
        : n % 3 === 0
          ? undefined
          : daysBefore(asOf, 30 + (n % 200)); // in the past -> past-due

      // Round amounts common (fabrication tell); many missing.
      const amount = n % 4 === 0 ? undefined : n % 2 === 0 ? 1000 * (10 + (n % 50)) : 1000 * (10 + (n % 50)) + 373;

      opportunities.push(
        makeOpportunity({
          id,
          orgId,
          stage,
          stageConfidence: stageConfidences[n % 3]!,
          vendorStageLabel: `Legacy Stage ${n % 6}`,
          accountRef,
          amount,
          closeDate,
          ownerId: n % 5 === 0 ? undefined : `rep-${n % 4}`,
          nextStep: n % 3 === 0 ? undefined : n % 7 === 0 ? '-' : `Chase ${id}`,
          contactRefs: n % 3 === 0 ? [ref(orgId, 'contact', `con-${n % accounts.length}`)] : [],
          createdAt,
          modifiedAt: daysBefore(asOf, 60 + (n % 300)),
        }),
      );

      n++;
    }
  }

  return {
    name: 'legacy',
    orgId,
    label: 'Legacy',
    description: 'Sparse fields, activity sync and history tracking off, duplicate and shared-provider account domains.',
    asOf,
    capabilities: {
      ...BASE_CAPABILITIES,
      stageHistory: false,
      ownerHistory: false,
      activitySync: false,
      incrementalSync: false,
      bulkRead: false,
      accountBatchLimit: 50,
    },
    data: { accounts, opportunities, contacts, activities: [], notes: [], stageHistory, ownerChanges },
  };
}

export const MOCK_ORG_FIXTURES: Readonly<Record<FixtureName, MockOrgFixture>> = {
  healthy: generateHealthy(),
  fresh: generateFresh(),
  legacy: generateLegacy(),
};

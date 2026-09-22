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
import type {
  AdapterCapabilities,
  SecondSourceAccount,
  SecondSourceActivity,
  SecondSourceCapabilities,
  SecondSourceContact,
  SecondSourceRef,
} from '@gtm-trust-kernel/adapters/types.js';
import type { MockOrgData, MockSecondSourceOrgData } from '@gtm-trust-kernel/adapters/mock.js';

export type FixtureName = 'healthy' | 'fresh' | 'legacy' | 'volume';

export const FIXTURE_NAMES: readonly FixtureName[] = ['healthy', 'fresh', 'legacy', 'volume'];

export interface MockOrgFixture {
  readonly name: FixtureName;
  readonly orgId: string;
  readonly label: string;
  readonly description: string;
  readonly asOf: string;
  readonly capabilities: AdapterCapabilities;
  readonly data: MockOrgData;
  /**
   * D5 cross-system joinability. undefined means no second source
   * connected — the actual not_instrumented gate-off case (see
   * metric-definitions.md's D5 intro). Mirrors capabilities/data's shape
   * (raw config + data, not a pre-built adapter) so a caller constructs
   * MockSecondSourceAdapter the same way cli.ts constructs MockAdapter.
   */
  readonly secondSource?: {
    readonly capabilities: Partial<SecondSourceCapabilities>;
    readonly data: MockSecondSourceOrgData;
  };
}

const DAY_MS = 86_400_000;

function daysBefore(asOf: string, days: number): string {
  return new Date(new Date(asOf).getTime() - days * DAY_MS).toISOString();
}

function ref(orgId: string, objectType: RecordRef['objectType'], id: string): RecordRef {
  return { crm: 'mock', orgId, objectType, id };
}

const SECOND_SOURCE = 'mock-second-source';

function secondSourceRef(orgId: string, objectType: SecondSourceRef['objectType'], id: string): SecondSourceRef {
  return { source: SECOND_SOURCE, orgId, objectType, id };
}

function makeSecondSourceContact(orgId: string, id: string, email: string | null, modifiedAt: string): SecondSourceContact {
  return { ref: secondSourceRef(orgId, 'contact', id), email, modifiedAt };
}

function makeSecondSourceAccount(orgId: string, id: string, domain: string | null, modifiedAt: string): SecondSourceAccount {
  return { ref: secondSourceRef(orgId, 'account', id), domain, modifiedAt };
}

function makeSecondSourceActivity(
  orgId: string,
  id: string,
  contactRef: SecondSourceRef | null,
  accountRef: SecondSourceRef | null,
  occurredAt: string,
): SecondSourceActivity {
  return {
    ref: secondSourceRef(orgId, 'activity', id),
    contactRef,
    accountRef,
    occurredAt,
    kind: 'email',
    createdAt: occurredAt,
    lastModifiedAt: occurredAt,
  };
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

interface MakeActivityOptions {
  readonly kind?: Activity['kind'];
  readonly direction?: Activity['direction'];
  readonly subject?: string;
  readonly body?: string;
  /** Tier applied to both subject and body when either is provided. Defaults to UserAuthored. */
  readonly tier?: TrustTier;
}

/**
 * subject/body/tier are new, optional, and additive (D6 fixture support,
 * this session) — every pre-existing call site is unaffected. Fixtures
 * building content, this project's own — do not touch the mock's ingestion,
 * since MockAdapter never runs inferTier itself.
 */
function makeActivity(
  orgId: string,
  id: string,
  opportunityRef: RecordRef,
  occurredAt: string,
  options: MakeActivityOptions = {},
): Activity {
  const tier = options.tier ?? TrustTier.UserAuthored;
  return {
    ref: ref(orgId, 'activity', id),
    relatedTo: [opportunityRef],
    kind: options.kind ?? 'call',
    direction: options.direction ?? 'outbound',
    occurredAt,
    participantIds: [],
    subject: options.subject ? tag(tier, options.subject, { recordId: `activity:${id}`, field: 'subject', capturedAt: occurredAt }) : undefined,
    body: options.body ? tag(tier, options.body, { recordId: `activity:${id}`, field: 'body', capturedAt: occurredAt }) : undefined,
  };
}

/** tier is new, optional, and additive (D6 fixture support, this session) — every pre-existing call site keeps its UserAuthored default. */
function makeNote(orgId: string, id: string, opportunityRef: RecordRef, body: string, createdAt: string, tier: TrustTier = TrustTier.UserAuthored): Note {
  return {
    ref: ref(orgId, 'note', id),
    relatedTo: [opportunityRef],
    createdAt,
    body: tag(tier, body, { recordId: `note:${id}`, field: 'body', capturedAt: createdAt }),
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
  contactBatchLimit: 200,
  childRecordBatchLimit: 200,
  notesPerOpportunityLimit: 200,
  activitiesPerOpportunityLimit: 200,
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

  // One opportunity deliberately seeded well over notesPerOpportunityLimit/
  // activitiesPerOpportunityLimit (200 each), so the report's "floor" badge
  // has something real to demonstrate rather than only unit-test fixtures.
  const overflowOppRef = ref(orgId, 'opportunity', 'opp-0');
  for (let i = 0; i < 205; i++) {
    notes.push(makeNote(orgId, `note-overflow-${i}`, overflowOppRef, `Overflow note ${i}, seeded to exceed the per-opportunity cap.`, daysBefore(asOf, i % 30)));
    activities.push(makeActivity(orgId, `act-overflow-${i}`, overflowOppRef, daysBefore(asOf, i % 20)));
  }

  // D6 text substrate: real, non-trivial data for untrusted_text_ratio and
  // pii_density, so a real `report --fixture healthy` run demonstrates both
  // with actual matches rather than reading 0/not_applicable off empty
  // fixture text — same "make the report prove it, not just unit tests"
  // reasoning as opp-0's overflow seeding above.
  //
  // 3 inbound-email activities, ExternallySourced — untrusted_text_ratio's
  // only source of non-UserAuthored text in this fixture (every note body
  // and every other activity in this generator stays UserAuthored/
  // undefined, per the mock's existing convention).
  activities.push(
    makeActivity(orgId, 'act-inbound-1', ref(orgId, 'opportunity', 'opp-1'), daysBefore(asOf, 3), {
      kind: 'email',
      direction: 'inbound',
      subject: 'Re: proposal questions',
      body: 'Thanks for sending this over. Can we push the call to next week while legal reviews the redlines?',
      tier: TrustTier.ExternallySourced,
    }),
  );
  activities.push(
    makeActivity(orgId, 'act-inbound-2', ref(orgId, 'opportunity', 'opp-2'), daysBefore(asOf, 5), {
      kind: 'email',
      direction: 'inbound',
      subject: 'Budget approved',
      body: 'Good news — finance signed off. Let\'s get the paperwork moving.',
      tier: TrustTier.ExternallySourced,
    }),
  );
  activities.push(
    makeActivity(orgId, 'act-inbound-3', ref(orgId, 'opportunity', 'opp-3'), daysBefore(asOf, 8), {
      kind: 'email',
      direction: 'inbound',
      subject: 'Question on renewal terms',
      body: 'Our procurement team has a few questions before they can sign off on the renewal terms.',
      tier: TrustTier.ExternallySourced,
    }),
  );

  // pii_density: 3 positive matches (email, phone, card — all
  // well-known placeholder values, never real PII), plus 1 deliberate
  // negative case (a plain dollar amount) so the report doesn't imply every
  // digit run is treated as PII.
  notes.push(makeNote(orgId, 'note-pii-email', ref(orgId, 'opportunity', 'opp-5'), 'Follow up with buyer directly at jane.doe@example.com if the champion goes dark.', daysBefore(asOf, 10)));
  notes.push(makeNote(orgId, 'note-pii-phone', ref(orgId, 'opportunity', 'opp-6'), 'Reach the economic buyer at (415) 555-0100 for a final signature.', daysBefore(asOf, 12)));
  notes.push(makeNote(orgId, 'note-pii-card', ref(orgId, 'opportunity', 'opp-7'), 'Billing confirmed card on file ending 4111111111111111, renews automatically next cycle.', daysBefore(asOf, 14)));
  notes.push(makeNote(orgId, 'note-pii-negative-amount', ref(orgId, 'opportunity', 'opp-8'), 'Final negotiated deal size is $45,000 with net 30 payment terms.', daysBefore(asOf, 16)));

  // D5 second source: good overlap. Reuses 13 of the 15 CRM accounts'
  // domains/emails verbatim (acc-13/acc-14 deliberately left unmatched —
  // "good overlap" isn't "total"), so a future matching implementation
  // resolves them deterministically.
  const secondSourceAccounts: SecondSourceAccount[] = [];
  const secondSourceContacts: SecondSourceContact[] = [];
  const secondSourceActivities: SecondSourceActivity[] = [];
  for (let i = 0; i < 13; i++) {
    const domain = `northco${i}.com`;
    const contactRef = secondSourceRef(orgId, 'contact', `ss-con-${i}`);
    const accountRef = secondSourceRef(orgId, 'account', `ss-acc-${i}`);
    secondSourceAccounts.push(makeSecondSourceAccount(orgId, `ss-acc-${i}`, domain, daysBefore(asOf, 30)));
    secondSourceContacts.push(makeSecondSourceContact(orgId, `ss-con-${i}`, `lead${i}@${domain}`, daysBefore(asOf, 30)));
    secondSourceActivities.push(makeSecondSourceActivity(orgId, `ss-act-${i}`, contactRef, accountRef, daysBefore(asOf, i % 10)));
  }

  return {
    name: 'healthy',
    orgId,
    label: 'Healthy',
    description: 'Good field hygiene, full capability matrix, clean unique account domains.',
    asOf,
    capabilities: BASE_CAPABILITIES,
    data: { accounts, opportunities, contacts, activities, notes, stageHistory, ownerChanges },
    secondSource: {
      capabilities: { kind: 'engagement', hasContacts: true, hasAccounts: true, hasActivities: true },
      data: { contacts: secondSourceContacts, accounts: secondSourceAccounts, activities: secondSourceActivities },
    },
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
    // secondSource intentionally omitted: this is D5's "no second source
    // connected" fixture — layers onto "newly onboarded" (a fresh org
    // hasn't connected one yet either), rather than adding a 4th fixture
    // name. See second-source-adapter-design.md.
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
          // (n + 1) % accounts.length, not n % accounts.length: n % 3 === 0
          // always makes n % 6 land on con-0/con-3 — the two contacts
          // deliberately seeded with no email (i % 3 === 0, above) — which
          // structurally zeroed out contact_identity_resolution_rate's
          // denominator (D5 part 2b) regardless of sampling. Shifting by
          // one keeps the same 1-in-3 linkage frequency but spreads
          // references across contacts that do have an email.
          contactRefs: n % 3 === 0 ? [ref(orgId, 'contact', `con-${(n + 1) % accounts.length}`)] : [],
          createdAt,
          modifiedAt: daysBefore(asOf, 60 + (n % 300)),
        }),
      );

      n++;
    }
  }

  // D5 second source: poor overlap, no activities. Only acc-4/con-4 (the
  // one unique, non-denylisted domain — legacypartner.com) resolves; the
  // shared oldco.com pair, the denylisted gmail.com pair, and the
  // domain-less account all deliberately have no second-source match.
  // hasActivities: false mirrors this org's activitySync: false on the
  // CRM side — no engagement-tool activity log for a legacy org.
  const secondSourceAccounts: SecondSourceAccount[] = [makeSecondSourceAccount(orgId, 'ss-acc-4', 'legacypartner.com', daysBefore(asOf, 1000))];
  const secondSourceContacts: SecondSourceContact[] = [
    makeSecondSourceContact(orgId, 'ss-con-4', 'person4@legacypartner.com', daysBefore(asOf, 1000)),
  ];

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
    secondSource: {
      capabilities: { kind: 'billing', hasContacts: true, hasAccounts: true, hasActivities: false },
      data: { contacts: secondSourceContacts, accounts: secondSourceAccounts, activities: [] },
    },
  };
}

// ---------------------------------------------------------------------------
// volume: ordinary D1-D5 hygiene (deliberately unremarkable — this fixture
// exists for exactly one purpose), but 30 closed_won + 30 closed_lost
// opportunities — over buildReportData's default perStratumSampleSize (20,
// report/buildReport.ts) for BOTH closed strata, so a real
// `report --fixture volume --json` run exercises closed_deal_count_12m's
// floor path (both closedWonUnderfilled/closedLostUnderfilled false) end to
// end, not just a synthetic unit-test CoverageSample. See docs/STATUS.md's
// D7 decisions for why none of healthy/fresh/legacy (12/4/6 per closed
// stage) can demonstrate this.
// ---------------------------------------------------------------------------

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
    data: { accounts, opportunities, contacts, activities, notes, stageHistory, ownerChanges: [] },
    // No second source: this fixture's only job is the D7 floor path, not D5.
  };
}

export const MOCK_ORG_FIXTURES: Readonly<Record<FixtureName, MockOrgFixture>> = {
  healthy: generateHealthy(),
  fresh: generateFresh(),
  legacy: generateLegacy(),
  volume: generateVolume(),
};

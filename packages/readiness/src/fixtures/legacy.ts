/**
 * legacy: sparse fields, most history/sync capabilities off, messy accounts.
 */

import {
  BASE_CAPABILITIES,
  CLOSED_STAGES,
  OPEN_STAGES,
  daysBefore,
  makeAccount,
  makeContact,
  makeOpportunity,
  makeSecondSourceAccount,
  makeSecondSourceContact,
  ref,
  type Account,
  type Contact,
  type MockOrgFixture,
  type Opportunity,
  type OwnerChange,
  type SecondSourceAccount,
  type SecondSourceContact,
  type StageConfidence,
  type StageHistoryEntry,
} from './mockOrgShared.js';

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
    'legacypartner.example',
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
  // one unique, non-denylisted domain — legacypartner.example) resolves; the
  // shared oldco.com pair, the denylisted gmail.com pair, and the
  // domain-less account all deliberately have no second-source match.
  // hasActivities: false mirrors this org's activitySync: false on the
  // CRM side — no engagement-tool activity log for a legacy org.
  const secondSourceAccounts: SecondSourceAccount[] = [makeSecondSourceAccount(orgId, 'ss-acc-4', 'legacypartner.example', daysBefore(asOf, 1000))];
  const secondSourceContacts: SecondSourceContact[] = [
    makeSecondSourceContact(orgId, 'ss-con-4', 'person4@legacypartner.example', daysBefore(asOf, 1000)),
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
      nextStepHistory: false,
      activitySync: false,
      incrementalSync: false,
      bulkRead: false,
      accountBatchLimit: 50,
    },
    data: { accounts, opportunities, contacts, activities: [], notes: [], stageHistory, ownerChanges, nextStepChanges: [] },
    secondSource: {
      capabilities: { kind: 'billing', hasContacts: true, hasAccounts: true, hasActivities: false },
      data: { contacts: secondSourceContacts, accounts: secondSourceAccounts, activities: [] },
    },
  };
}

export const legacyFixture: MockOrgFixture = generateLegacy();

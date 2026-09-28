/**
 * healthy: good coverage and hygiene across the board.
 */

import {
  BASE_CAPABILITIES,
  CANONICAL_STAGE_ORDER,
  CLOSED_STAGES,
  OPEN_STAGES,
  TrustTier,
  daysBefore,
  makeAccount,
  makeActivity,
  makeContact,
  makeNextStepChange,
  makeNote,
  makeOpportunity,
  makeOwnerChange,
  makeSecondSourceAccount,
  makeSecondSourceActivity,
  makeSecondSourceContact,
  makeStageHistoryEntry,
  ref,
  secondSourceRef,
  type Account,
  type Activity,
  type Contact,
  type MockOrgFixture,
  type NextStepChange,
  type Note,
  type Opportunity,
  type OwnerChange,
  type SecondSourceAccount,
  type SecondSourceActivity,
  type SecondSourceContact,
  type StageHistoryEntry,
} from './mockOrgShared.js';

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
  const nextStepChanges: NextStepChange[] = [];

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
        // median_next_step_age_days: most open deals with a Next Step also
        // get a real change-history entry (n % 12 !== 0 is the same
        // condition nextStep itself uses above). n % 11 === 0 is a second,
        // independent exclusion — a Next Step that's set but whose change
        // history hasn't been captured yet (capability just enabled, or
        // retention doesn't reach back far enough) — so this metric reads a
        // real, non-trivial excluded count on a fixture that's supposed to
        // look healthy, not either 0% or 100% excluded.
        if (n % 12 !== 0 && n % 11 !== 0) {
          nextStepChanges.push(makeNextStepChange(orgId, `nsc-${n}`, ref(orgId, 'opportunity', id), daysBefore(asOf, n % 45)));
        }
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
      } else {
        // outcome_evidence_retention_rate: 11 of every 12 closed
        // opportunities (i % 12 !== 0) get a real closing note — landing at
        // 0.9167, clearly above rubric.ts's viableAt (0.8), not a boundary
        // value. The remaining 1/12 per stratum is deliberate: a fixture
        // meant to look "Healthy" should still read a real, imperfect rate,
        // not 100% (see docs/STATUS.md). Notes only, not activities — keeps
        // this seeding from touching temporal_anomaly_rate's pooled CRM
        // activity count (D5). 4 varied templates, won/lost-specific and
        // all >=40 chars, off FILLER_DENYLIST, no PII-like substrings, so
        // substantive_note_rate/median_note_length_chars move for a real
        // reason rather than being skewed by one repeated string.
        if (i % 12 !== 0) {
          const wonTemplates = [
            'Closed won: champion carried it through procurement without pushback, contract signed on schedule.',
            'Deal closed won after final legal redlines were resolved in a single call with the buyer\'s counsel.',
          ];
          const lostTemplates = [
            'Closed lost: budget was reallocated to a competing initiative before the final signature stage.',
            'Prospect chose an incumbent vendor after a late executive change on their side derailed the deal.',
          ];
          const templates = stage === 'closed_won' ? wonTemplates : lostTemplates;
          notes.push(
            // closeDate is always defined when isClosed (see its assignment above) — TS
            // can't narrow that from this branch alone, hence the assertion.
            makeNote(orgId, `note-${n}`, ref(orgId, 'opportunity', id), templates[i % templates.length]!, closeDate!),
          );
        }
      }

      if (!isClosed) {
        stageHistory.push(makeStageHistoryEntry(orgId, `sh-${n}`, ref(orgId, 'opportunity', id), stage, createdAt));
      } else if (stage === 'closed_won' && i === 0) {
        // win_rate_dispersion: deliberate degenerate case — one closed deal
        // with only its closing snapshot, no intermediate-stage history at
        // all (a real "history enabled, but this deal's journey wasn't
        // captured" scenario). The old single-entry-per-opportunity
        // behavior, kept for exactly this one opportunity rather than
        // silently disappearing once the rest of healthy's closed
        // opportunities below get real multi-hop histories.
        stageHistory.push(makeStageHistoryEntry(orgId, `sh-${n}`, ref(orgId, 'opportunity', id), stage, createdAt));
      } else {
        // win_rate_dispersion: a realistic multi-hop path through the
        // intermediate pipeline stages before closing, not one snapshot of
        // the final stage. Depth deliberately correlates with outcome (won
        // deals typically reach further into the pipeline — proposal/
        // negotiation — before closing; lost deals more often stall earlier
        // at evaluation/proposal) — a plausible sales pattern, not an
        // arbitrary one, and it's what gives this metric a real signal:
        // negotiation ends up won-only (6 deals, all won), proposal is
        // mixed (12 won + 6 lost), prospecting/discovery/evaluation are
        // reached by every deal regardless of outcome (~50/50). That
        // produces a real, non-zero dispersion that reads as rubric.ts's
        // "degraded" tier — a genuine imperfection, not a manufactured
        // "viable", matching this fixture's established practice elsewhere
        // (e.g. outcome_evidence_retention_rate's 11/12) of not making
        // "healthy" mean "perfect". Timestamps spaced between createdAt and
        // closeDate — all comfortably more recent than sh-earliest's
        // 640-days-back entry below, so stage_history_months' org-wide-
        // earliest reading is unaffected.
        const pathLength = stage === 'closed_won' ? 4 + (n % 2) : 3 + (n % 2); // won: 4-5 stages reached; lost: 3-4
        const path = CANONICAL_STAGE_ORDER.slice(0, pathLength);
        const createdMs = new Date(createdAt).getTime();
        const closeMs = new Date(closeDate!).getTime();
        const span = closeMs - createdMs;
        path.forEach((toStage, idx) => {
          stageHistory.push({
            ref: ref(orgId, 'stage_history', `sh-${n}-${idx}`),
            opportunityRef: ref(orgId, 'opportunity', id),
            fromStage: idx === 0 ? undefined : path[idx - 1],
            toStage,
            changedAt: new Date(createdMs + (span * (idx + 1)) / (path.length + 1)).toISOString(),
          });
        });
        // Final transition into the closing stage itself, at closeDate —
        // same shape a real adapter's stage-history object would show (e.g.
        // Salesforce OpportunityHistory records a row for this too).
        // win_rate_dispersion filters closed_won/closed_lost out (see
        // metrics/labels.ts), so this row is inert for that metric but
        // keeps the seeded sequence realistic.
        stageHistory.push({
          ref: ref(orgId, 'stage_history', `sh-${n}-close`),
          opportunityRef: ref(orgId, 'opportunity', id),
          fromStage: path[path.length - 1],
          toStage: stage,
          changedAt: closeDate!,
        });
      }
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
  //
  // Note bodies use 4 varied, realistic-length templates (83-102 chars),
  // not one fixed ~60-char filler string — the fixed string dragged D6's
  // org-wide median_note_length_chars down to ~60 (these 205 notes are 67%
  // of the whole healthy note pool once D6 started pooling every sampled
  // note), reading as a data-quality problem the fixture never intended.
  // See docs/STATUS.md. Count stays 205 (still over the 200 cap) so the
  // truncation-floor badge this block exists for is unaffected.
  const overflowOppRef = ref(orgId, 'opportunity', 'opp-0');
  const overflowNoteTemplates = [
    'Confirmed budget approval with the CFO; next step is legal review of the MSA terms.',
    'Spoke with the champion re: Q4 close timeline, need an exec sponsor intro before advancing.',
    'Walked the security team through our SOC 2 report; they flagged two questions for follow-up next week.',
    'Demo went well with the broader buying committee, but procurement wants a competitive bake-off first.',
  ];
  for (let i = 0; i < 205; i++) {
    notes.push(
      makeNote(
        orgId,
        `note-overflow-${i}`,
        overflowOppRef,
        overflowNoteTemplates[i % overflowNoteTemplates.length]!,
        daysBefore(asOf, i % 30),
      ),
    );
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
    data: { accounts, opportunities, contacts, activities, notes, stageHistory, ownerChanges, nextStepChanges },
    secondSource: {
      capabilities: { kind: 'engagement', hasContacts: true, hasAccounts: true, hasActivities: true },
      data: { contacts: secondSourceContacts, accounts: secondSourceAccounts, activities: secondSourceActivities },
    },
  };
}

export const healthyFixture: MockOrgFixture = generateHealthy();

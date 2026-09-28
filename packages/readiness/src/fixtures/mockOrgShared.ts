/**
 * Shared types and record builders for the mock org fixtures (src/fixtures/
 * healthy.ts, fresh.ts, legacy.ts, volume.ts). Product code, not test-only —
 * the report CLI reads these at runtime, unlike test/fixtures/* (golden
 * fixtures for unit tests, with hand-verified expected numbers).
 *
 * Each fixture lives in its own file (one org's `generate*()` per file) so a
 * bundler that only imports one org's file never pulls the other three's
 * generated data into its output — see gtm-trust-kernel's packaging plan.
 * This file holds everything all four generators share; it must stay free of
 * any per-org data itself.
 */

import { TrustTier, tag } from '@gtm-trust-kernel/adapters/model/trust.js';
import { CANONICAL_STAGE_ORDER } from '@gtm-trust-kernel/adapters/model/canonical.js';
import type {
  Account,
  Activity,
  CanonicalStage,
  Contact,
  NextStepChange,
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

export { TrustTier, tag, CANONICAL_STAGE_ORDER };
export type {
  Account,
  Activity,
  CanonicalStage,
  Contact,
  NextStepChange,
  Note,
  Opportunity,
  OwnerChange,
  RecordRef,
  StageConfidence,
  StageHistoryEntry,
  AdapterCapabilities,
  SecondSourceAccount,
  SecondSourceActivity,
  SecondSourceCapabilities,
  SecondSourceContact,
  SecondSourceRef,
  MockOrgData,
  MockSecondSourceOrgData,
};

export type FixtureName = 'healthy' | 'fresh' | 'legacy' | 'volume';

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

export function daysBefore(asOf: string, days: number): string {
  return new Date(new Date(asOf).getTime() - days * DAY_MS).toISOString();
}

export function ref(orgId: string, objectType: RecordRef['objectType'], id: string): RecordRef {
  return { crm: 'mock', orgId, objectType, id };
}

export const SECOND_SOURCE = 'mock-second-source';

export function secondSourceRef(orgId: string, objectType: SecondSourceRef['objectType'], id: string): SecondSourceRef {
  return { source: SECOND_SOURCE, orgId, objectType, id };
}

export function makeSecondSourceContact(orgId: string, id: string, email: string | null, modifiedAt: string): SecondSourceContact {
  return { ref: secondSourceRef(orgId, 'contact', id), email, modifiedAt };
}

export function makeSecondSourceAccount(orgId: string, id: string, domain: string | null, modifiedAt: string): SecondSourceAccount {
  return { ref: secondSourceRef(orgId, 'account', id), domain, modifiedAt };
}

export function makeSecondSourceActivity(
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

export const OPEN_STAGES: readonly CanonicalStage[] = CANONICAL_STAGE_ORDER;
export const CLOSED_STAGES: readonly CanonicalStage[] = ['closed_won', 'closed_lost'];

export interface OppOptions {
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

export function makeOpportunity(o: OppOptions): Opportunity {
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

export function makeAccount(orgId: string, id: string, domain: string | undefined, createdAt: string): Account {
  return { ref: ref(orgId, 'account', id), name: `Account ${id}`, domain, createdAt, modifiedAt: createdAt };
}

export function makeContact(orgId: string, id: string, accountRef: RecordRef, email: string | undefined, createdAt: string): Contact {
  return { ref: ref(orgId, 'contact', id), accountRef, name: `Contact ${id}`, email, createdAt, modifiedAt: createdAt };
}

export interface MakeActivityOptions {
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
export function makeActivity(
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
export function makeNote(orgId: string, id: string, opportunityRef: RecordRef, body: string, createdAt: string, tier: TrustTier = TrustTier.UserAuthored): Note {
  return {
    ref: ref(orgId, 'note', id),
    relatedTo: [opportunityRef],
    createdAt,
    body: tag(tier, body, { recordId: `note:${id}`, field: 'body', capturedAt: createdAt }),
  };
}

export function makeStageHistoryEntry(
  orgId: string,
  id: string,
  opportunityRef: RecordRef,
  toStage: CanonicalStage,
  changedAt: string,
): StageHistoryEntry {
  return { ref: ref(orgId, 'stage_history', id), opportunityRef, toStage, changedAt };
}

export function makeOwnerChange(orgId: string, id: string, subjectRef: RecordRef, toOwnerId: string, changedAt: string): OwnerChange {
  return { ref: ref(orgId, 'owner_change', id), subjectRef, toOwnerId, changedAt };
}

export function makeNextStepChange(orgId: string, id: string, opportunityRef: RecordRef, changedAt: string): NextStepChange {
  return { ref: ref(orgId, 'next_step_change', id), opportunityRef, changedAt };
}

export const BASE_CAPABILITIES: AdapterCapabilities = {
  stageHistory: true,
  ownerHistory: true,
  closeDateHistory: true,
  nextStepHistory: true,
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
  historyPerOpportunityLimit: 200,
};

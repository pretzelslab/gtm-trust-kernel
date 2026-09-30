/**
 * Canonical GTM object model.
 *
 * Every CRM adapter normalises into these types. The point is not to be a
 * lowest-common-denominator of Salesforce and HubSpot: it is to make the
 * differences *explicit and typed* rather than silently lossy.
 *
 * Two rules that make this different from a naive DTO layer:
 *
 * 1. Stage is a semantic mapping, never a string passthrough. Salesforce
 *    "Negotiation/Review" and HubSpot "Contract Sent" are not the same word
 *    and must not be compared as words.
 * 2. Every free-text field carries a TrustTier (see model/trust.ts). Text that
 *    a customer could have authored is structurally distinguishable from text
 *    an admin configured. This is what makes injection defence possible at all.
 */

import type { TrustedText } from './trust.js';

/** Opaque, adapter-qualified record id. Never collide ids across CRMs. */
export type RecordRef = {
  readonly crm: CrmVendor;
  readonly orgId: string;
  readonly objectType: CanonicalObjectType;
  readonly id: string;
};

export type CrmVendor = 'salesforce' | 'hubspot' | 'mock';

export type CanonicalObjectType =
  | 'account'
  | 'opportunity'
  | 'contact'
  | 'activity'
  | 'note'
  | 'task'
  | 'stage_history'
  | 'owner_change'
  | 'next_step_change';

/**
 * Canonical pipeline stage. Adapters map vendor stage names onto this ladder
 * via explicit per-org configuration, and MUST report unmapped stages rather
 * than guessing. An unmapped stage degrades the opportunity to
 * `stageConfidence: 'unmapped'` and suppresses stage-dependent signals.
 */
export type CanonicalStage =
  | 'prospecting'
  | 'discovery'
  | 'evaluation'
  | 'proposal'
  | 'negotiation'
  | 'closed_won'
  | 'closed_lost';

export const CANONICAL_STAGE_ORDER: readonly CanonicalStage[] = [
  'prospecting',
  'discovery',
  'evaluation',
  'proposal',
  'negotiation',
] as const;

export type StageConfidence = 'mapped' | 'inferred' | 'unmapped';

export interface Account {
  readonly ref: RecordRef;
  readonly name: string;
  readonly domain?: string;
  readonly industry?: string;
  readonly employeeCount?: number;
  readonly ownerId?: string;
  readonly createdAt: string;
  readonly modifiedAt: string;
  /** Adapter-computed duplicate cluster key, if the adapter supports it. */
  readonly dedupeKey?: string;
}

/**
 * A contact's association with an opportunity (Salesforce's
 * OpportunityContactRole junction object; HubSpot's deal-to-contact
 * associations). Distinct from Contact.accountRef, which is account-level
 * and says nothing about which deals a contact is actually involved in.
 */
export interface OpportunityContactLink {
  readonly contactRef: RecordRef;
  /**
   * Named buying-group role, when the vendor tracks one (Salesforce's
   * "Decision Maker", "Economic Buyer", etc). Optional because not every
   * CRM has named roles — HubSpot associations frequently don't.
   */
  readonly role?: string;
  readonly isPrimary?: boolean;
}

export interface Opportunity {
  readonly ref: RecordRef;
  readonly accountRef: RecordRef;
  readonly name: string;
  readonly amount?: number;
  readonly currency?: string;
  readonly stage: CanonicalStage;
  readonly stageConfidence: StageConfidence;
  /** Raw vendor stage label, retained for audit and for the approval UI. */
  readonly vendorStageLabel: string;
  readonly closeDate?: string;
  readonly ownerId?: string;
  readonly isClosed: boolean;
  readonly isWon?: boolean;
  readonly forecastCategory?: string;
  readonly nextStep?: TrustedText;
  readonly contactLinks: readonly OpportunityContactLink[];
  readonly createdAt: string;
  readonly modifiedAt: string;
  /**
   * Vendor concurrency token captured at read time. Salesforce SystemModstamp,
   * HubSpot hs_lastmodifieddate, etc. Required for safe write-back.
   */
  readonly concurrencyToken: string;
}

export interface Contact {
  readonly ref: RecordRef;
  readonly accountRef?: RecordRef;
  readonly name: string;
  readonly title?: string;
  readonly email?: string;
  readonly createdAt: string;
  readonly modifiedAt: string;
}

export type ActivityKind = 'call' | 'email' | 'meeting' | 'other';
export type ActivityDirection = 'inbound' | 'outbound' | 'internal' | 'unknown';

export interface Activity {
  readonly ref: RecordRef;
  readonly relatedTo: readonly RecordRef[];
  readonly kind: ActivityKind;
  readonly direction: ActivityDirection;
  readonly occurredAt: string;
  readonly subject?: TrustedText;
  readonly body?: TrustedText;
  readonly participantIds: readonly string[];
}

export interface Note {
  readonly ref: RecordRef;
  readonly relatedTo: readonly RecordRef[];
  readonly authorId?: string;
  readonly createdAt: string;
  readonly body: TrustedText;
  /**
   * True when `body` is only the start of the note: the adapter could read
   * a preview but not the full text (e.g. a per-run fetch budget ran out).
   * Length-based metrics treat their value as a floor. Absent means the
   * body is complete.
   */
  readonly bodyTruncated?: boolean;
}

export interface StageHistoryEntry {
  readonly ref: RecordRef;
  readonly opportunityRef: RecordRef;
  readonly fromStage?: CanonicalStage;
  readonly toStage: CanonicalStage;
  readonly changedAt: string;
  readonly changedBy?: string;
  /** Close date at the moment of the change, for push-count signals. */
  readonly closeDateAtChange?: string;
  /**
   * 'unmapped' when the vendor stage recorded here has no canonical
   * mapping; `toStage` is then only a placeholder and stage-based metrics
   * must skip the entry. Absent means mapped.
   */
  readonly toStageConfidence?: StageConfidence;
}

export interface OwnerChange {
  readonly ref: RecordRef;
  readonly subjectRef: RecordRef;
  readonly fromOwnerId?: string;
  readonly toOwnerId: string;
  readonly changedAt: string;
}

/**
 * One field-history change event on Opportunity.nextStep. Deliberately
 * carries no text value (only when it changed, not what it changed to or
 * from) — median_next_step_age_days only needs the latest changedAt per
 * opportunity, and this keeps the type structurally incapable of leaking
 * Next Step content, same reasoning StageHistoryEntry already has no free
 * text field. See docs/metric-definitions.md's median_next_step_age_days
 * entry.
 */
export interface NextStepChange {
  readonly ref: RecordRef;
  readonly opportunityRef: RecordRef;
  readonly changedAt: string;
}

/**
 * The bounded, deterministic set of records assembled for one reasoning run.
 * Retrieval MUST be deterministic: same input, same evidence set, same id.
 * Without this, evals are not reproducible and audit is not meaningful.
 */
export interface EvidenceSet {
  readonly id: string;
  readonly builtAt: string;
  readonly opportunity: Opportunity;
  readonly account: Account;
  readonly contacts: readonly Contact[];
  readonly activities: readonly Activity[];
  readonly notes: readonly Note[];
  readonly stageHistory: readonly StageHistoryEntry[];
  readonly ownerChanges: readonly OwnerChange[];
  /** Records dropped by the retrieval budget, recorded so abstention is honest. */
  readonly truncated: {
    readonly activities: number;
    readonly notes: number;
  };
}

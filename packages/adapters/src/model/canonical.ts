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
  | 'owner_change';

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
}

export interface OwnerChange {
  readonly ref: RecordRef;
  readonly subjectRef: RecordRef;
  readonly fromOwnerId?: string;
  readonly toOwnerId: string;
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

/**
 * D5 independent second-source sampling (metric-definitions.md, D5;
 * second-source-adapter-design.md decision 2).
 *
 * Hashing/normalizing happens HERE, as each page arrives — not in a later
 * step — so a raw email or domain from the second source is never held
 * past the single line that transforms it. SecondSourceSampleResult never
 * carries a raw SecondSourceContact.email or SecondSourceAccount.domain,
 * only refs, hashed email keys, normalized domains, and timestamps.
 *
 * Enforces capabilities().maxSampleSizePerType per record type by stopping
 * pagination once the cap is reached, even if nextCursor is still present
 * — the adapter itself does not enforce this (see SecondSourceCapabilities'
 * docblock, packages/adapters/src/types.ts). Does not pre-check has*
 * capability flags before calling list* — relies on SecondSourceAdapter's
 * own contract (returns empty, never throws, when a flag is false), same
 * precedent as hydrateStageHistory trusting CrmAdapter.listStageHistory's
 * contract rather than duplicating the check.
 */

import type {
  SecondSourceActivity,
  SecondSourceAdapter,
  SecondSourceRef,
} from '@gtm-trust-kernel/adapters/types.js';
import type { SyncWindow } from '@gtm-trust-kernel/adapters/types.js';
import { normalizeDomain } from '../metrics/shared.js';
import { hashEmail } from './hash.js';

const PAGE_SIZE = 200;

/** Sanitized second-source contact: hashed email, never the raw value. */
export interface HashedContact {
  readonly ref: SecondSourceRef;
  readonly emailHash: string | null;
  readonly modifiedAt: string;
}

/** Sanitized second-source account: normalized domain, never the raw value. */
export interface NormalizedAccount {
  readonly ref: SecondSourceRef;
  readonly normalizedDomain: string | null;
  readonly modifiedAt: string;
}

export interface SecondSourceSampleResult {
  readonly contacts: readonly HashedContact[];
  /** True when the second source had more contacts than maxSampleSizePerType — contacts is a floor, not the complete set. */
  readonly contactsTruncated: boolean;
  readonly accounts: readonly NormalizedAccount[];
  /** Same as contactsTruncated, for accounts. */
  readonly accountsTruncated: boolean;
  /** Unmodified — SecondSourceActivity carries no raw email/domain field, so there's nothing to sanitize. */
  readonly activities: readonly SecondSourceActivity[];
  /** Same as contactsTruncated, for activities. */
  readonly activitiesTruncated: boolean;
  readonly apiCallsConsumed: number;
}

async function paginate<TRaw, TOut>(
  list: (w: SyncWindow) => Promise<{ items: readonly TRaw[]; nextCursor?: string; apiCallsConsumed: number }>,
  cap: number,
  transform: (raw: TRaw) => TOut,
): Promise<{ items: TOut[]; apiCallsConsumed: number; truncated: boolean }> {
  const items: TOut[] = [];
  let apiCallsConsumed = 0;
  let cursor: string | undefined;
  let truncated = false;

  while (items.length < cap) {
    const page = await list({ limit: PAGE_SIZE, cursor });
    apiCallsConsumed += page.apiCallsConsumed;

    let consumedFromPage = 0;
    for (const raw of page.items) {
      if (items.length >= cap) break;
      items.push(transform(raw));
      consumedFromPage += 1;
    }

    if (items.length >= cap) {
      // Hit the cap: truncated iff there was more data beyond what we took
      // — items left unconsumed in this page, or another page still pending.
      truncated = consumedFromPage < page.items.length || Boolean(page.nextCursor);
      break;
    }

    if (!page.nextCursor) break;
    cursor = page.nextCursor;
  }

  return { items, apiCallsConsumed, truncated };
}

/**
 * Independently samples the second source's contacts, accounts, and
 * activities, each capped at capabilities().maxSampleSizePerType. salt
 * must be generated once per run by the caller (hash.ts's
 * generateRunSalt) and passed in here — sampleSecondSource never
 * generates its own, so every hash it produces is comparable against
 * hashes computed elsewhere in the same run with the same salt.
 */
export async function sampleSecondSource(adapter: SecondSourceAdapter, salt: string): Promise<SecondSourceSampleResult> {
  const cap = adapter.capabilities().maxSampleSizePerType;

  const contactsResult = await paginate(
    (w) => adapter.listContacts(w),
    cap,
    (c): HashedContact => ({
      ref: c.ref,
      emailHash: c.email ? hashEmail(c.email, salt) : null,
      modifiedAt: c.modifiedAt,
    }),
  );

  const accountsResult = await paginate(
    (w) => adapter.listAccounts(w),
    cap,
    (a): NormalizedAccount => ({
      ref: a.ref,
      normalizedDomain: normalizeDomain(a.domain ?? undefined),
      modifiedAt: a.modifiedAt,
    }),
  );

  const activitiesResult = await paginate(
    (w) => adapter.listActivities(w),
    cap,
    (a: SecondSourceActivity) => a,
  );

  return {
    contacts: contactsResult.items,
    contactsTruncated: contactsResult.truncated,
    accounts: accountsResult.items,
    accountsTruncated: accountsResult.truncated,
    activities: activitiesResult.items,
    activitiesTruncated: activitiesResult.truncated,
    apiCallsConsumed: contactsResult.apiCallsConsumed + accountsResult.apiCallsConsumed + activitiesResult.apiCallsConsumed,
  };
}

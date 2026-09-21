/**
 * D5 joinability resolution (metric-definitions.md, D5; second-source-
 * adapter-design.md decisions 1-5). Orchestration only — no D5 metric is
 * computed here, that's D5 part 2b.
 *
 * Computed once per run, held only in memory by whoever calls
 * resolveSecondSource, discarded when that call returns — there is no
 * persistence step to undo, "discarded at end of run" is simply "nothing
 * here is written anywhere durable."
 *
 * Never constructs a merged record: contactMatches/accountMatches map a
 * CRM ref.id to the SecondSourceRefs that matched it, never to a combined
 * CRM+second-source object. See metric-definitions.md's D5 intro and
 * gtm-readiness-scope.md:96/:260 ("Sources are sampled independently and
 * never merged").
 */

import type { SecondSourceAdapter, SecondSourceCapabilities, SecondSourceRef } from '@gtm-trust-kernel/adapters/types.js';
import { normalizeDomain } from '../metrics/shared.js';
import type { CoverageSample } from '../metrics/types.js';
import { generateRunSalt, hashEmail } from './hash.js';
import { sampleSecondSource, type SecondSourceSampleResult } from './sample.js';

export interface SecondSourceResolution {
  /**
   * CRM contact ref.id -> every SecondSourceRef that matched it by hashed
   * email. A CRM contact absent from this map has zero matches. Multiple
   * second-source records sharing a hash are NOT deduped — a CRM contact
   * counts as resolved if it matches at least one second-source record;
   * this map preserves all of them rather than picking one arbitrarily.
   * See metric-definitions.md's D5 "Matching count" note.
   */
  readonly contactMatches: ReadonlyMap<string, readonly SecondSourceRef[]>;
  /** Same shape as contactMatches, matched by normalized domain instead of hashed email. */
  readonly accountMatches: ReadonlyMap<string, readonly SecondSourceRef[]>;
  /** The second source's own independent sample, for D5 part 2b's activity_attribution_rate/temporal_anomaly_rate denominators. */
  readonly secondSourceSample: SecondSourceSampleResult;
  /**
   * Captured once via adapter.capabilities() at the start of this call —
   * D5 metrics gate per-type on hasContacts/hasAccounts/hasActivities
   * against this, not against secondSourceSample's presence/absence
   * (which reflects only whether any records existed, not whether the
   * type is readable at all — same has-flag-vs-empty-result distinction
   * established in second-source-adapter-design.md decision 5).
   */
  readonly capabilities: SecondSourceCapabilities;
}

function addMatch(bucket: Map<string, SecondSourceRef[]>, key: string, ref: SecondSourceRef): void {
  const existing = bucket.get(key);
  if (existing) {
    existing.push(ref);
  } else {
    bucket.set(key, [ref]);
  }
}

/**
 * Requires sample.contactsHydrated and sample.accountsHydrated — a
 * build-order precondition, same rule as accountsByRef/accountsHydrated
 * elsewhere in this package. Unlike a metric's not_instrumented, this
 * throws: an orchestration caller that hasn't hydrated first is a
 * programming error, not a runtime "gate off" case to degrade gracefully.
 */
export async function resolveSecondSource(sample: CoverageSample, adapter: SecondSourceAdapter): Promise<SecondSourceResolution> {
  if (!sample.contactsHydrated || !sample.accountsHydrated) {
    throw new Error('resolveSecondSource requires CoverageSample.contactsHydrated and accountsHydrated to both be true');
  }

  const salt = generateRunSalt();
  const secondSourceSample = await sampleSecondSource(adapter, salt);

  const secondSourceContactsByEmailHash = new Map<string, SecondSourceRef[]>();
  for (const c of secondSourceSample.contacts) {
    if (c.emailHash !== null) {
      addMatch(secondSourceContactsByEmailHash, c.emailHash, c.ref);
    }
  }

  const contactMatches = new Map<string, readonly SecondSourceRef[]>();
  for (const crmContact of sample.contactsByRef.values()) {
    if (!crmContact.email) continue;
    const hash = hashEmail(crmContact.email, salt);
    const matches = secondSourceContactsByEmailHash.get(hash);
    if (matches) {
      contactMatches.set(crmContact.ref.id, matches);
    }
  }

  const secondSourceAccountsByDomain = new Map<string, SecondSourceRef[]>();
  for (const a of secondSourceSample.accounts) {
    if (a.normalizedDomain !== null) {
      addMatch(secondSourceAccountsByDomain, a.normalizedDomain, a.ref);
    }
  }

  const accountMatches = new Map<string, readonly SecondSourceRef[]>();
  for (const crmAccount of sample.accountsByRef.values()) {
    const normalized = normalizeDomain(crmAccount.domain);
    if (normalized === null) continue;
    const matches = secondSourceAccountsByDomain.get(normalized);
    if (matches) {
      accountMatches.set(crmAccount.ref.id, matches);
    }
  }

  return { contactMatches, accountMatches, secondSourceSample, capabilities: adapter.capabilities() };
}

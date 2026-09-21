/**
 * Builds a CoverageSample (src/metrics/types.ts) from a stratified sample
 * (sample.ts), in two steps:
 *
 * 1. buildCoverageSample — pure, sync. Wires up openOpportunities/
 *    closedOpportunities from a SampleResult.
 * 2. hydrateAccounts — async, the only I/O in this file (mirrors runSample
 *    already being the impure orchestrator over in sample.ts). Fetches the
 *    Account for every sampled opportunity's accountRef via
 *    CrmAdapter.getAccounts.
 *
 * notesByOpportunity/activitiesByOpportunity hydration is unrelated to
 * this file and remains unimplemented (see CoverageSample's docblock).
 */

import type { CrmAdapter } from '@gtm-trust-kernel/adapters/types.js';
import type { Account, Opportunity, RecordRef } from '@gtm-trust-kernel/adapters/model/canonical.js';
import type { SampleResult, SampleStratum } from './sample.js';
import type { AdapterCapabilities } from '@gtm-trust-kernel/adapters/types.js';
import type { CoverageSample } from './metrics/types.js';

const CLOSED_STAGES: ReadonlySet<SampleStratum> = new Set(['closed_won', 'closed_lost']);

/**
 * "No accountRef" means absent or an empty/whitespace-only id — accountRef
 * is non-optional in the canonical model, but real adapter data isn't
 * guaranteed to respect that at runtime, so this guards the same way
 * owner_id_fill_rate guards ownerId (metrics/coverage.ts).
 */
function hasAccountRef(o: Opportunity): boolean {
  return (o.accountRef?.id?.trim().length ?? 0) > 0;
}

function chunk<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(items.slice(i, i + size));
  }
  return out;
}

export function buildCoverageSample(result: SampleResult, capabilities: AdapterCapabilities): CoverageSample {
  const openOpportunities: Opportunity[] = [];
  const closedOpportunities: Opportunity[] = [];

  for (const stratumResult of result.strata) {
    const bucket = CLOSED_STAGES.has(stratumResult.stratum) ? closedOpportunities : openOpportunities;
    bucket.push(...stratumResult.opportunities);
  }

  const oppsWithoutAccountRef = [...openOpportunities, ...closedOpportunities].filter((o) => !hasAccountRef(o)).length;

  return {
    openOpportunities,
    closedOpportunities,
    notesByOpportunity: new Map(),
    activitiesByOpportunity: new Map(),
    accountsByRef: new Map(),
    accountsHydrated: false,
    missingAccountCount: 0,
    oppsWithoutAccountRef,
    capabilities,
  };
}

export interface HydrateAccountsResult {
  readonly sample: CoverageSample;
  /** Summed apiCallsConsumed across every getAccounts chunk call, for budget reporting. */
  readonly accountApiCallsConsumed: number;
}

/**
 * Derives the distinct accountRef set from sample.openOpportunities +
 * closedOpportunities (opportunities failing hasAccountRef are skipped —
 * already counted in oppsWithoutAccountRef by buildCoverageSample), sorts
 * it by ref.id for determinism independent of opportunity order, and
 * chunks it at adapter.capabilities().accountBatchLimit.
 *
 * A chunk's getAccounts call rejecting propagates as-is: this function does
 * not catch, retry, or return a partial sample, and a rejected chunk's refs
 * are never counted as missing (missingAccountCount is only ever computed
 * from a fully successful hydration).
 */
export async function hydrateAccounts(sample: CoverageSample, adapter: CrmAdapter): Promise<HydrateAccountsResult> {
  const allOpportunities = [...sample.openOpportunities, ...sample.closedOpportunities];
  const refsById = new Map<string, RecordRef>();
  for (const o of allOpportunities) {
    if (hasAccountRef(o)) {
      refsById.set(o.accountRef.id, o.accountRef);
    }
  }
  const sortedRefs = [...refsById.values()].sort((a, b) => a.id.localeCompare(b.id));

  const limit = adapter.capabilities().accountBatchLimit;
  const chunks = chunk(sortedRefs, limit);

  const accountsByRef = new Map<string, Account>();
  let accountApiCallsConsumed = 0;

  for (const refChunk of chunks) {
    const result = await adapter.getAccounts(refChunk);
    accountApiCallsConsumed += result.apiCallsConsumed;
    for (const account of result.items) {
      accountsByRef.set(account.ref.id, account);
    }
  }

  return {
    sample: {
      ...sample,
      accountsByRef,
      accountsHydrated: true,
      missingAccountCount: sortedRefs.length - accountsByRef.size,
    },
    accountApiCallsConsumed,
  };
}

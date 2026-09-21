/**
 * Builds a CoverageSample (src/metrics/types.ts) from a stratified sample
 * (sample.ts): buildCoverageSample is pure/sync, wiring up
 * openOpportunities/closedOpportunities from a SampleResult. Every other
 * export here is an independent async hydration step, each the only I/O
 * for its own field (mirrors runSample already being the impure
 * orchestrator over in sample.ts): hydrateAccounts (accountRef ->
 * Account), hydrateStageHistory (org-wide earliest StageHistoryEntry),
 * hydrateNotes / hydrateActivities (opportunity -> related Notes/
 * Activities). A caller only needs to await the hydration step(s) whose
 * fields the metrics it's about to run actually read.
 */

import type { CrmAdapter } from '@gtm-trust-kernel/adapters/types.js';
import type { Account, Activity, Note, Opportunity, RecordRef } from '@gtm-trust-kernel/adapters/model/canonical.js';
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
    stageHistoryEarliestChangedAt: null,
    stageHistoryHydrated: false,
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

export interface HydrateStageHistoryResult {
  readonly sample: CoverageSample;
  /** apiCallsConsumed from the single listStageHistory call, for budget reporting. */
  readonly apiCallsConsumed: number;
}

/**
 * Minimal glue for stage_history_months (D4, docs/metric-definitions.md):
 * fetches only the org's single earliest retained StageHistoryEntry, via
 * one ascending listStageHistory page (no `since`, `limit: 1`) — this
 * metric is org-wide, not scoped to the sample's opportunities (that
 * scope question was resolved this session; see the doc), so no new
 * by-ref batched adapter method is needed, and no full-org scan happens:
 * the existing method's page is already sorted ascending by changedAt, so
 * the first item of the first page IS the earliest entry.
 *
 * Does not special-case AdapterCapabilities.stageHistory itself — relies
 * on CrmAdapter.listStageHistory's own contract ("must return empty, not
 * throw, when capabilities().stageHistory is false", types.ts) rather
 * than duplicating that check here. stage_history_months (metrics/history.ts)
 * still gates on the capability before trusting this field, same as any
 * other capability-gated metric.
 */
export async function hydrateStageHistory(
  sample: CoverageSample,
  adapter: CrmAdapter,
): Promise<HydrateStageHistoryResult> {
  const page = await adapter.listStageHistory({ limit: 1 });

  return {
    sample: {
      ...sample,
      stageHistoryEarliestChangedAt: page.items[0]?.changedAt ?? null,
      stageHistoryHydrated: true,
    },
    apiCallsConsumed: page.apiCallsConsumed,
  };
}

/** Distinct sampled opportunity refs (open + closed), sorted by ref.id — same determinism convention as hydrateAccounts' account-ref set. */
function sortedOpportunityRefs(sample: CoverageSample): RecordRef[] {
  const allOpportunities = [...sample.openOpportunities, ...sample.closedOpportunities];
  const refsById = new Map<string, RecordRef>();
  for (const o of allOpportunities) {
    refsById.set(o.ref.id, o.ref);
  }
  return [...refsById.values()].sort((a, b) => a.id.localeCompare(b.id));
}

/**
 * Groups a flat, adapter-returned child-record list back by owning
 * opportunity, via each record's relatedTo entries — a record can
 * legitimately appear in more than one opportunity's bucket if it's
 * related to more than one (the canonical model's relatedTo is
 * multi-valued). oppIds not present as a key in the returned map had zero
 * matching records, not an error.
 */
function groupByOpportunity<T extends { relatedTo: readonly RecordRef[] }>(
  items: readonly T[],
  oppIds: ReadonlySet<string>,
): Map<string, T[]> {
  const grouped = new Map<string, T[]>();
  for (const item of items) {
    for (const relRef of item.relatedTo) {
      if (relRef.objectType === 'opportunity' && oppIds.has(relRef.id)) {
        const bucket = grouped.get(relRef.id);
        if (bucket) {
          bucket.push(item);
        } else {
          grouped.set(relRef.id, [item]);
        }
      }
    }
  }
  return grouped;
}

export interface HydrateNotesResult {
  readonly sample: CoverageSample;
  readonly apiCallsConsumed: number;
}

/**
 * Minimal glue for note_coverage_rate (D1): fetches related Notes for
 * every sampled opportunity (open + closed) via
 * CrmAdapter.getNotesByOpportunity, chunked at
 * capabilities().childRecordBatchLimit (advisory; chunking is this
 * function's job, same as hydrateAccounts' accountBatchLimit chunking).
 * Not gated on any capability — notes are always readable regardless of
 * activitySync (see CrmAdapter.getNotesByOpportunity's docblock).
 */
export async function hydrateNotes(sample: CoverageSample, adapter: CrmAdapter): Promise<HydrateNotesResult> {
  const sortedRefs = sortedOpportunityRefs(sample);
  const limit = adapter.capabilities().childRecordBatchLimit;
  const chunks = chunk(sortedRefs, limit);

  const allNotes: Note[] = [];
  let apiCallsConsumed = 0;
  for (const refChunk of chunks) {
    const result = await adapter.getNotesByOpportunity(refChunk);
    apiCallsConsumed += result.apiCallsConsumed;
    allNotes.push(...result.items);
  }

  const oppIds = new Set(sortedRefs.map((r) => r.id));
  const notesByOpportunity: ReadonlyMap<string, readonly Note[]> = groupByOpportunity(allNotes, oppIds);

  return {
    sample: { ...sample, notesByOpportunity },
    apiCallsConsumed,
  };
}

export interface HydrateActivitiesResult {
  readonly sample: CoverageSample;
  readonly apiCallsConsumed: number;
}

/**
 * Same shape as hydrateNotes, for Activity records via
 * CrmAdapter.getActivitiesByOpportunity. Also not gated on activitySync
 * here — activity_capture_rate and stage_activity_contradiction_rate
 * (metrics/coverage.ts, metrics/consistency.ts) already gate on that
 * capability before ever reading activitiesByOpportunity, which is
 * sufficient; this function always fetches whatever actually exists.
 */
export async function hydrateActivities(sample: CoverageSample, adapter: CrmAdapter): Promise<HydrateActivitiesResult> {
  const sortedRefs = sortedOpportunityRefs(sample);
  const limit = adapter.capabilities().childRecordBatchLimit;
  const chunks = chunk(sortedRefs, limit);

  const allActivities: Activity[] = [];
  let apiCallsConsumed = 0;
  for (const refChunk of chunks) {
    const result = await adapter.getActivitiesByOpportunity(refChunk);
    apiCallsConsumed += result.apiCallsConsumed;
    allActivities.push(...result.items);
  }

  const oppIds = new Set(sortedRefs.map((r) => r.id));
  const activitiesByOpportunity: ReadonlyMap<string, readonly Activity[]> = groupByOpportunity(allActivities, oppIds);

  return {
    sample: { ...sample, activitiesByOpportunity },
    apiCallsConsumed,
  };
}

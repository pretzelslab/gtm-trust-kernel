import type { AdapterCapabilities } from '@gtm-trust-kernel/adapters/types.js';
import type { CoverageSample } from '../../src/metrics/types.js';

export const STAGE_HISTORY_MONTHS_ASOF = '2026-06-20T00:00:00.000Z';

/** 2 years + 5 months before STAGE_HISTORY_MONTHS_ASOF, day-of-month <= asOf's day-of-month (no partial-month decrement). */
const EARLIEST_CHANGED_AT = '2024-01-15T00:00:00.000Z';

function capabilities(stageHistory: boolean): AdapterCapabilities {
  return {
    stageHistory,
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
}

function coverageSample(
  stageHistoryCapability: boolean,
  stageHistoryHydrated: boolean,
  stageHistoryEarliestChangedAt: string | null,
): CoverageSample {
  return {
    openOpportunities: [],
    closedOpportunities: [],
    notesByOpportunity: new Map(),
    activitiesByOpportunity: new Map(),
    notesTruncatedOpportunityIds: new Set(),
    activitiesTruncatedOpportunityIds: new Set(),
    accountsByRef: new Map(),
    accountsHydrated: false,
    stageHistoryEarliestChangedAt,
    stageHistoryHydrated,
    missingAccountCount: 0,
    oppsWithoutAccountRef: 0,
    contactsByRef: new Map(),
    contactsHydrated: false,
    missingContactCount: 0,
    capabilities: capabilities(stageHistoryCapability),
  };
}

/** Golden fixture: hydrated, earliest entry 2024-01-15 vs. STAGE_HISTORY_MONTHS_ASOF (2026-06-20) -> 29 whole calendar months. */
export function stageHistoryMonthsFixture(): CoverageSample {
  return coverageSample(true, true, EARLIEST_CHANGED_AT);
}

export const STAGE_HISTORY_MONTHS_EXPECTED = { value: 29 };

/** Capability enabled, hydration ran, but the org has zero retained stage-history entries (e.g. freshly turned on). */
export function stageHistoryMonthsZeroEntriesFixture(): CoverageSample {
  return coverageSample(true, true, null);
}

/** Capability enabled but hydrateStageHistory (coverageSample.ts) hasn't run yet for this sample. */
export function stageHistoryMonthsNotHydratedFixture(): CoverageSample {
  return coverageSample(true, false, null);
}

/** No stageHistory capability at all — must gate before ever looking at hydration state. */
export function stageHistoryMonthsGateOffFixture(): CoverageSample {
  return coverageSample(false, false, null);
}

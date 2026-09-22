import type { CoverageSample } from '../../src/metrics/types.js';
import { makeCoverageSample, DEFAULT_TEST_CAPABILITIES } from '../support/coverageSample.js';

export const STAGE_HISTORY_MONTHS_ASOF = '2026-06-20T00:00:00.000Z';

/** 2 years + 5 months before STAGE_HISTORY_MONTHS_ASOF, day-of-month <= asOf's day-of-month (no partial-month decrement). */
const EARLIEST_CHANGED_AT = '2024-01-15T00:00:00.000Z';

function coverageSample(
  stageHistoryCapability: boolean,
  stageHistoryHydrated: boolean,
  stageHistoryEarliestChangedAt: string | null,
): CoverageSample {
  return makeCoverageSample({
    stageHistoryEarliestChangedAt,
    stageHistoryHydrated,
    capabilities: { ...DEFAULT_TEST_CAPABILITIES, stageHistory: stageHistoryCapability },
  });
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

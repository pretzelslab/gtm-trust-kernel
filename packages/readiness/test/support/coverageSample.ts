/**
 * Shared CoverageSample test builder. Every per-metric fixture file under
 * test/fixtures/*.ts used to hand-write its own full CoverageSample object
 * literal (or a small local wrapper around one) — ~16 near-identical copies.
 * That meant every new required CoverageSample field (accountsByRef,
 * contactsByRef, and now closedWonUnderfilled/closedLostUnderfilled) forced
 * a mechanical edit across all of them. makeCoverageSample centralizes the
 * defaults once; a fixture file overrides only the fields its metric
 * actually varies.
 */

import type { AdapterCapabilities } from '@gtm-trust-kernel/adapters/types.js';
import type { CoverageSample } from '../../src/metrics/types.js';

/**
 * The permissive capability matrix every fixture file used to duplicate by
 * hand. A file testing a capability gate overrides just the flag it needs:
 * { ...DEFAULT_TEST_CAPABILITIES, activitySync: false }.
 */
export const DEFAULT_TEST_CAPABILITIES: AdapterCapabilities = {
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

/**
 * Every field defaults to the same "empty/not hydrated/not underfilled"
 * shape buildCoverageSample itself produces before any hydration step runs
 * — a fixture overrides only what its metric reads. closedWonUnderfilled/
 * closedLostUnderfilled default to true (a reservoir that saw nothing is,
 * by definition, not full) since no existing fixture cares about the
 * floor path unless it explicitly opts in.
 */
export function makeCoverageSample(overrides: Partial<CoverageSample> = {}): CoverageSample {
  return {
    openOpportunities: [],
    closedOpportunities: [],
    notesByOpportunity: new Map(),
    activitiesByOpportunity: new Map(),
    notesTruncatedOpportunityIds: new Set(),
    activitiesTruncatedOpportunityIds: new Set(),
    nextStepChangesByOpportunity: new Map(),
    stageHistoryByOpportunity: new Map(),
    accountsByRef: new Map(),
    accountsHydrated: false,
    stageHistoryEarliestChangedAt: null,
    stageHistoryHydrated: false,
    missingAccountCount: 0,
    oppsWithoutAccountRef: 0,
    contactsByRef: new Map(),
    contactsHydrated: false,
    missingContactCount: 0,
    closedWonUnderfilled: true,
    closedLostUnderfilled: true,
    closedInWindowCount: null,
    capabilities: DEFAULT_TEST_CAPABILITIES,
    ...overrides,
  };
}

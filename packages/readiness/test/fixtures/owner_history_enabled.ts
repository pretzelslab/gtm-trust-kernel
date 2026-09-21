import type { AdapterCapabilities } from '@gtm-trust-kernel/adapters/types.js';
import type { CoverageSample } from '../../src/metrics/types.js';

function capabilities(ownerHistory: boolean): AdapterCapabilities {
  return {
    stageHistory: true,
    ownerHistory,
    activitySync: true,
    incrementalSync: true,
    bulkRead: true,
    writeGranularity: 'field',
    nativeConcurrencyCheck: false,
    rateLimit: { kind: 'none', value: 0 },
    stageMap: {},
    accountBatchLimit: 200,
    childRecordBatchLimit: 200,
    notesPerOpportunityLimit: 200,
    activitiesPerOpportunityLimit: 200,
  };
}

function coverageSample(ownerHistory: boolean): CoverageSample {
  return {
    openOpportunities: [],
    closedOpportunities: [],
    notesByOpportunity: new Map(),
    activitiesByOpportunity: new Map(),
    accountsByRef: new Map(),
    accountsHydrated: false,
    stageHistoryEarliestChangedAt: null,
    stageHistoryHydrated: false,
    missingAccountCount: 0,
    oppsWithoutAccountRef: 0,
    capabilities: capabilities(ownerHistory),
  };
}

export function ownerHistoryEnabledTrueFixture(): CoverageSample {
  return coverageSample(true);
}

export function ownerHistoryEnabledFalseFixture(): CoverageSample {
  return coverageSample(false);
}

import { describe, expect, it } from 'vitest';
import { ownerHistoryEnabled, stageHistoryMonths } from '../../src/metrics/history.js';
import { ownerHistoryEnabledFalseFixture, ownerHistoryEnabledTrueFixture } from '../fixtures/owner_history_enabled.js';
import {
  STAGE_HISTORY_MONTHS_ASOF,
  STAGE_HISTORY_MONTHS_EXPECTED,
  stageHistoryMonthsFixture,
  stageHistoryMonthsGateOffFixture,
  stageHistoryMonthsNotHydratedFixture,
  stageHistoryMonthsZeroEntriesFixture,
} from '../fixtures/stage_history_months.js';

describe('ownerHistoryEnabled', () => {
  it('reports value 1 when AdapterCapabilities.ownerHistory is true', () => {
    const result = ownerHistoryEnabled(ownerHistoryEnabledTrueFixture(), { asOf: STAGE_HISTORY_MONTHS_ASOF });
    expect(result).toEqual({
      metric: 'owner_history_enabled',
      status: 'ok',
      value: 1,
      sampleSize: 0,
      lowConfidence: false,
    });
  });

  it('reports value 0 when AdapterCapabilities.ownerHistory is false', () => {
    const result = ownerHistoryEnabled(ownerHistoryEnabledFalseFixture(), { asOf: STAGE_HISTORY_MONTHS_ASOF });
    expect(result).toEqual({
      metric: 'owner_history_enabled',
      status: 'ok',
      value: 0,
      sampleSize: 0,
      lowConfidence: false,
    });
  });
});

describe('stageHistoryMonths', () => {
  it('matches the golden fixture: 29 whole calendar months between the earliest entry and asOf', () => {
    const result = stageHistoryMonths(stageHistoryMonthsFixture(), { asOf: STAGE_HISTORY_MONTHS_ASOF });
    expect(result).toEqual({
      metric: 'stage_history_months',
      status: 'ok',
      value: STAGE_HISTORY_MONTHS_EXPECTED.value,
      sampleSize: 0,
      lowConfidence: false,
    });
  });

  it('returns ok with value 0 and a distinct note when the capability is on but zero entries are retained', () => {
    const result = stageHistoryMonths(stageHistoryMonthsZeroEntriesFixture(), { asOf: STAGE_HISTORY_MONTHS_ASOF });
    expect(result).toEqual({
      metric: 'stage_history_months',
      status: 'ok',
      value: 0,
      sampleSize: 0,
      lowConfidence: false,
      note: 'history enabled, no entries yet',
    });
  });

  it('returns not_instrumented when stageHistoryHydrated is false, without reading stageHistoryEarliestChangedAt', () => {
    const result = stageHistoryMonths(stageHistoryMonthsNotHydratedFixture(), { asOf: STAGE_HISTORY_MONTHS_ASOF });
    expect(result).toEqual({
      metric: 'stage_history_months',
      status: 'not_instrumented',
      value: null,
      sampleSize: 0,
      lowConfidence: false,
      note: 'stage history has not been hydrated for this sample (stageHistoryHydrated is false)',
    });
  });

  it('returns not_instrumented when the adapter reports no stageHistory capability, before the hydration gate', () => {
    const result = stageHistoryMonths(stageHistoryMonthsGateOffFixture(), { asOf: STAGE_HISTORY_MONTHS_ASOF });
    expect(result).toEqual({
      metric: 'stage_history_months',
      status: 'not_instrumented',
      value: null,
      sampleSize: 0,
      lowConfidence: false,
      note: 'adapter capability matrix reports no stage-history capability for this org',
    });
  });
});

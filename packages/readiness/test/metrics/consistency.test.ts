import { describe, expect, it } from 'vitest';
import { roundAmountRate, stageActivityContradictionRate } from '../../src/metrics/consistency.js';
import {
  ROUND_AMOUNT_RATE_EXPECTED,
  coverageSample as roundAmountCoverageSample,
  roundAmountRateAllExcludedFixture,
  roundAmountRateFixture,
} from '../fixtures/round_amount_rate.js';
import {
  STAGE_ACTIVITY_CONTRADICTION_RATE_ASOF,
  STAGE_ACTIVITY_CONTRADICTION_RATE_EXPECTED,
  stageActivityContradictionRateFixture,
  stageActivityContradictionRateGateOffFixture,
  stageActivityContradictionRateNoLateStageFixture,
} from '../fixtures/stage_activity_contradiction_rate.js';

describe('stageActivityContradictionRate', () => {
  it('matches the golden fixture: 3 of 5 open opportunities in proposal/negotiation have no qualifying activity in the trailing 21 days', () => {
    const result = stageActivityContradictionRate(stageActivityContradictionRateFixture(), {
      asOf: STAGE_ACTIVITY_CONTRADICTION_RATE_ASOF,
    });
    expect(result).toEqual({
      metric: 'stage_activity_contradiction_rate',
      status: 'ok',
      value: STAGE_ACTIVITY_CONTRADICTION_RATE_EXPECTED.value,
      sampleSize: STAGE_ACTIVITY_CONTRADICTION_RATE_EXPECTED.sampleSize,
      lowConfidence: true, // 5 < LOW_CONFIDENCE_SAMPLE_SIZE (30)
    });
  });

  it('returns not_applicable rather than dividing by zero when no open opportunities are in proposal or negotiation', () => {
    const result = stageActivityContradictionRate(stageActivityContradictionRateNoLateStageFixture(), {
      asOf: STAGE_ACTIVITY_CONTRADICTION_RATE_ASOF,
    });
    expect(result).toEqual({
      metric: 'stage_activity_contradiction_rate',
      status: 'not_applicable',
      value: null,
      sampleSize: 0,
      lowConfidence: false,
      note: 'no open opportunities in proposal or negotiation stage in sample',
    });
  });

  it('returns not_instrumented when the adapter reports no activitySync capability, without reading the sample', () => {
    const result = stageActivityContradictionRate(stageActivityContradictionRateGateOffFixture(), {
      asOf: STAGE_ACTIVITY_CONTRADICTION_RATE_ASOF,
    });
    expect(result).toEqual({
      metric: 'stage_activity_contradiction_rate',
      status: 'not_instrumented',
      value: null,
      sampleSize: 0,
      lowConfidence: false,
      note: 'adapter capability matrix reports no activity-sync capability for this org',
    });
  });
});

describe('roundAmountRate', () => {
  it('matches the golden fixture: 3 of 5 opportunities with a non-null, non-zero amount are evenly divisible by 1,000; 2 are excluded from the denominator', () => {
    const result = roundAmountRate(roundAmountRateFixture(), { asOf: '2026-06-15T00:00:00.000Z' });
    expect(result).toEqual({
      metric: 'round_amount_rate',
      status: 'ok',
      value: ROUND_AMOUNT_RATE_EXPECTED.value,
      sampleSize: ROUND_AMOUNT_RATE_EXPECTED.sampleSize,
      lowConfidence: true, // 5 < LOW_CONFIDENCE_SAMPLE_SIZE (30)
      note: `${ROUND_AMOUNT_RATE_EXPECTED.excludedCount} opportunities excluded from the denominator (null or zero amount)`,
    });
  });

  it('returns not_applicable rather than dividing by zero when every open opportunity has a null or zero amount', () => {
    const result = roundAmountRate(roundAmountRateAllExcludedFixture(), { asOf: '2026-06-15T00:00:00.000Z' });
    expect(result).toEqual({
      metric: 'round_amount_rate',
      status: 'not_applicable',
      value: null,
      sampleSize: 0,
      lowConfidence: false,
      note: 'no open opportunities with a non-null, non-zero amount in sample',
    });
  });

  it('returns not_applicable with a distinct note when the sample has no open opportunities at all', () => {
    const result = roundAmountRate(roundAmountCoverageSample([]), { asOf: '2026-06-15T00:00:00.000Z' });
    expect(result).toEqual({
      metric: 'round_amount_rate',
      status: 'not_applicable',
      value: null,
      sampleSize: 0,
      lowConfidence: false,
      note: 'no open opportunities in sample',
    });
  });
});

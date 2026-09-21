import { describe, expect, it } from 'vitest';
import { medianDaysSinceModified, pastDueCloseDateRate } from '../../src/metrics/freshness.js';
import {
  MEDIAN_DAYS_SINCE_MODIFIED_ASOF,
  MEDIAN_DAYS_SINCE_MODIFIED_EXPECTED,
  coverageSample as medianDaysCoverageSample,
  medianDaysSinceModifiedFixture,
} from '../fixtures/median_days_since_modified.js';
import {
  PAST_DUE_CLOSE_DATE_RATE_ASOF,
  PAST_DUE_CLOSE_DATE_RATE_EXPECTED,
  coverageSample as pastDueCoverageSample,
  pastDueCloseDateRateAllNullFixture,
  pastDueCloseDateRateFixture,
} from '../fixtures/past_due_close_date_rate.js';

describe('medianDaysSinceModified', () => {
  it('matches the golden fixture: median of 4 values lands on the average of the two middle ones', () => {
    const result = medianDaysSinceModified(medianDaysSinceModifiedFixture(), {
      asOf: MEDIAN_DAYS_SINCE_MODIFIED_ASOF,
    });
    expect(result).toEqual({
      metric: 'median_days_since_modified',
      status: 'ok',
      value: MEDIAN_DAYS_SINCE_MODIFIED_EXPECTED.value,
      sampleSize: MEDIAN_DAYS_SINCE_MODIFIED_EXPECTED.sampleSize,
      lowConfidence: true, // 4 < LOW_CONFIDENCE_SAMPLE_SIZE (30)
    });
  });

  it('returns not_applicable rather than computing a median of nothing when the sample has no open opportunities', () => {
    const result = medianDaysSinceModified(medianDaysCoverageSample([]), {
      asOf: MEDIAN_DAYS_SINCE_MODIFIED_ASOF,
    });
    expect(result).toEqual({
      metric: 'median_days_since_modified',
      status: 'not_applicable',
      value: null,
      sampleSize: 0,
      lowConfidence: false,
      note: 'no open opportunities in sample',
    });
  });
});

describe('pastDueCloseDateRate', () => {
  it('matches the golden fixture: 2 of 4 opportunities with a close date are past-due; null close dates are excluded from the denominator', () => {
    const result = pastDueCloseDateRate(pastDueCloseDateRateFixture(), { asOf: PAST_DUE_CLOSE_DATE_RATE_ASOF });
    expect(result).toEqual({
      metric: 'past_due_close_date_rate',
      status: 'ok',
      value: PAST_DUE_CLOSE_DATE_RATE_EXPECTED.value,
      sampleSize: PAST_DUE_CLOSE_DATE_RATE_EXPECTED.sampleSize,
      lowConfidence: true, // 4 < LOW_CONFIDENCE_SAMPLE_SIZE (30)
    });
  });

  it('returns not_applicable rather than dividing by zero when the sample has no open opportunities', () => {
    const result = pastDueCloseDateRate(pastDueCoverageSample([]), { asOf: PAST_DUE_CLOSE_DATE_RATE_ASOF });
    expect(result).toEqual({
      metric: 'past_due_close_date_rate',
      status: 'not_applicable',
      value: null,
      sampleSize: 0,
      lowConfidence: false,
      note: 'no open opportunities in sample',
    });
  });

  it('returns not_applicable with a distinct note when every open opportunity has a null close date', () => {
    const result = pastDueCloseDateRate(pastDueCloseDateRateAllNullFixture(), {
      asOf: PAST_DUE_CLOSE_DATE_RATE_ASOF,
    });
    expect(result).toEqual({
      metric: 'past_due_close_date_rate',
      status: 'not_applicable',
      value: null,
      sampleSize: 0,
      lowConfidence: false,
      note: 'no open opportunities with a non-null close date in sample',
    });
  });
});

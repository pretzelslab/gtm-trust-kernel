import { describe, expect, it } from 'vitest';
import { medianDaysSinceModified, medianNextStepAgeDays, pastDueCloseDateRate } from '../../src/metrics/freshness.js';
import {
  MEDIAN_NEXT_STEP_AGE_DAYS_ASOF,
  MEDIAN_NEXT_STEP_AGE_DAYS_EXPECTED,
  MEDIAN_NEXT_STEP_AGE_DAYS_MAJORITY_EXCLUDED_EXPECTED,
  medianNextStepAgeDaysAllExcludedFixture,
  medianNextStepAgeDaysFixture,
  medianNextStepAgeDaysGateOffFixture,
  medianNextStepAgeDaysLatestEntryFixture,
  medianNextStepAgeDaysMajorityExcludedFixture,
  medianNextStepAgeDaysNoEligibleFixture,
} from '../fixtures/median_next_step_age_days.js';
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

describe('medianNextStepAgeDays', () => {
  it('matches the golden fixture: median of 3 included ages (1 of 4 eligible opportunities excluded, no change history)', () => {
    const result = medianNextStepAgeDays(medianNextStepAgeDaysFixture(), { asOf: MEDIAN_NEXT_STEP_AGE_DAYS_ASOF });
    expect(result).toEqual({
      metric: 'median_next_step_age_days',
      status: 'ok',
      value: MEDIAN_NEXT_STEP_AGE_DAYS_EXPECTED.value,
      sampleSize: MEDIAN_NEXT_STEP_AGE_DAYS_EXPECTED.sampleSize,
      lowConfidence: true, // 3 < LOW_CONFIDENCE_SAMPLE_SIZE (30)
      note: '1 of 4 eligible opportunities excluded: no Next Step change history',
    });
  });

  it('uses the latest (last) NextStepChange entry when an opportunity has more than one, not the first or oldest', () => {
    const result = medianNextStepAgeDays(medianNextStepAgeDaysLatestEntryFixture(), { asOf: MEDIAN_NEXT_STEP_AGE_DAYS_ASOF });
    expect(result).toEqual({
      metric: 'median_next_step_age_days',
      status: 'ok',
      value: 3, // the newer entry (3 days ago), not the older one (40 days ago)
      sampleSize: 1,
      lowConfidence: true,
    });
  });

  it('returns not_instrumented when the adapter reports no nextStepHistory capability for this org', () => {
    const result = medianNextStepAgeDays(medianNextStepAgeDaysGateOffFixture(), { asOf: MEDIAN_NEXT_STEP_AGE_DAYS_ASOF });
    expect(result).toEqual({
      metric: 'median_next_step_age_days',
      status: 'not_instrumented',
      value: null,
      sampleSize: 0,
      lowConfidence: false,
      note: 'adapter capability matrix reports no Next Step change-history capability for this org',
    });
  });

  it('returns not_applicable when no open opportunity has a meaningfully-filled Next Step', () => {
    const result = medianNextStepAgeDays(medianNextStepAgeDaysNoEligibleFixture(), { asOf: MEDIAN_NEXT_STEP_AGE_DAYS_ASOF });
    expect(result).toEqual({
      metric: 'median_next_step_age_days',
      status: 'not_applicable',
      value: null,
      sampleSize: 0,
      lowConfidence: false,
      note: 'no open opportunities in sample with a meaningfully-filled Next Step',
    });
  });

  it('returns not_applicable with a distinct note when every eligible opportunity has zero NextStepChange entries', () => {
    const result = medianNextStepAgeDays(medianNextStepAgeDaysAllExcludedFixture(), { asOf: MEDIAN_NEXT_STEP_AGE_DAYS_ASOF });
    expect(result).toEqual({
      metric: 'median_next_step_age_days',
      status: 'not_applicable',
      value: null,
      sampleSize: 0,
      lowConfidence: false,
      note: 'all 2 eligible opportunities have no Next Step change history',
    });
  });

  it('sets lowConfidence when more than 50% of eligible opportunities are excluded, even with a sample size well over 30 (independent of the raw-sample-size trigger)', () => {
    const result = medianNextStepAgeDays(medianNextStepAgeDaysMajorityExcludedFixture(), { asOf: MEDIAN_NEXT_STEP_AGE_DAYS_ASOF });
    expect(result).toEqual({
      metric: 'median_next_step_age_days',
      status: 'ok',
      value: MEDIAN_NEXT_STEP_AGE_DAYS_MAJORITY_EXCLUDED_EXPECTED.value,
      sampleSize: MEDIAN_NEXT_STEP_AGE_DAYS_MAJORITY_EXCLUDED_EXPECTED.sampleSize,
      lowConfidence: true,
      note: '45 of 80 eligible opportunities excluded: no Next Step change history',
    });
  });
});

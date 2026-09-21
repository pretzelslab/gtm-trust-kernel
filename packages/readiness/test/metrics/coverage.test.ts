import { describe, expect, it } from 'vitest';
import {
  activityCaptureRate,
  amountFillRate,
  closeDateFillRate,
  contactLinkageRate,
  nextStepFillRate,
  noteCoverageRate,
  ownerIdFillRate,
} from '../../src/metrics/coverage.js';
import {
  CLOSE_DATE_FILL_RATE_ASOF,
  CLOSE_DATE_FILL_RATE_EXPECTED,
  closeDateFillRateFixture,
  coverageSample,
} from '../fixtures/close_date_fill_rate.js';
import {
  CONTACT_LINKAGE_RATE_EXPECTED,
  contactLinkageRateFixture,
  coverageSample as contactLinkageCoverageSample,
} from '../fixtures/contact_linkage_rate.js';
import {
  AMOUNT_FILL_RATE_EXPECTED,
  amountFillRateFixture,
  coverageSample as amountCoverageSample,
} from '../fixtures/amount_fill_rate.js';
import {
  NEXT_STEP_FILL_RATE_EXPECTED,
  nextStepFillRateFixture,
  coverageSample as nextStepCoverageSample,
} from '../fixtures/next_step_fill_rate.js';
import {
  NOTE_COVERAGE_RATE_EXPECTED,
  noteCoverageRateFixture,
  noteCoverageRateTruncatedFixture,
  coverageSample as noteCoverageSample,
} from '../fixtures/note_coverage_rate.js';
import {
  ACTIVITY_CAPTURE_RATE_ASOF,
  ACTIVITY_CAPTURE_RATE_EXPECTED,
  activityCaptureRateFixture,
  activityCaptureRateGateOffFixture,
  activityCaptureRateTruncatedFixture,
} from '../fixtures/activity_capture_rate.js';
import {
  OWNER_ID_FILL_RATE_EXPECTED,
  ownerIdFillRateFixture,
  coverageSample as ownerIdCoverageSample,
} from '../fixtures/owner_id_fill_rate.js';

describe('closeDateFillRate', () => {
  it('matches the golden fixture: 3 of 5 open opportunities filled, one exactly at asOf', () => {
    const result = closeDateFillRate(closeDateFillRateFixture(), { asOf: CLOSE_DATE_FILL_RATE_ASOF });
    expect(result).toEqual({
      metric: 'close_date_fill_rate',
      status: 'ok',
      value: CLOSE_DATE_FILL_RATE_EXPECTED.value,
      sampleSize: CLOSE_DATE_FILL_RATE_EXPECTED.sampleSize,
      lowConfidence: true, // 5 < LOW_CONFIDENCE_SAMPLE_SIZE (30)
    });
  });

  it('returns not_applicable rather than dividing by zero when the sample has no open opportunities', () => {
    const result = closeDateFillRate(coverageSample([]), { asOf: CLOSE_DATE_FILL_RATE_ASOF });
    expect(result).toEqual({
      metric: 'close_date_fill_rate',
      status: 'not_applicable',
      value: null,
      sampleSize: 0,
      lowConfidence: false,
      note: 'no open opportunities in sample',
    });
  });
});

describe('contactLinkageRate', () => {
  const asOf = '2026-06-15T00:00:00.000Z';

  it('matches the golden fixture: 3 of 5 open opportunities have at least one contact link', () => {
    const result = contactLinkageRate(contactLinkageRateFixture(), { asOf });
    expect(result).toEqual({
      metric: 'contact_linkage_rate',
      status: 'ok',
      value: CONTACT_LINKAGE_RATE_EXPECTED.value,
      sampleSize: CONTACT_LINKAGE_RATE_EXPECTED.sampleSize,
      lowConfidence: true, // 5 < LOW_CONFIDENCE_SAMPLE_SIZE (30)
    });
  });

  it('returns not_applicable rather than dividing by zero when the sample has no open opportunities', () => {
    const result = contactLinkageRate(contactLinkageCoverageSample([]), { asOf });
    expect(result).toEqual({
      metric: 'contact_linkage_rate',
      status: 'not_applicable',
      value: null,
      sampleSize: 0,
      lowConfidence: false,
      note: 'no open opportunities in sample',
    });
  });
});

describe('amountFillRate', () => {
  const asOf = '2026-06-15T00:00:00.000Z';

  it('matches the golden fixture: amount 0 counts as unfilled, not a filled zero value', () => {
    const result = amountFillRate(amountFillRateFixture(), { asOf });
    expect(result).toEqual({
      metric: 'amount_fill_rate',
      status: 'ok',
      value: AMOUNT_FILL_RATE_EXPECTED.value,
      sampleSize: AMOUNT_FILL_RATE_EXPECTED.sampleSize,
      lowConfidence: true, // 5 < LOW_CONFIDENCE_SAMPLE_SIZE (30)
    });
  });

  it('returns not_applicable rather than dividing by zero when the sample has no open opportunities', () => {
    const result = amountFillRate(amountCoverageSample([]), { asOf });
    expect(result).toEqual({
      metric: 'amount_fill_rate',
      status: 'not_applicable',
      value: null,
      sampleSize: 0,
      lowConfidence: false,
      note: 'no open opportunities in sample',
    });
  });
});

describe('nextStepFillRate', () => {
  const asOf = '2026-06-15T00:00:00.000Z';

  it('matches the golden fixture: a single-dash or whitespace-only next step counts as unfilled', () => {
    const result = nextStepFillRate(nextStepFillRateFixture(), { asOf });
    expect(result).toEqual({
      metric: 'next_step_fill_rate',
      status: 'ok',
      value: NEXT_STEP_FILL_RATE_EXPECTED.value,
      sampleSize: NEXT_STEP_FILL_RATE_EXPECTED.sampleSize,
      lowConfidence: true, // 5 < LOW_CONFIDENCE_SAMPLE_SIZE (30)
    });
  });

  it('returns not_applicable rather than dividing by zero when the sample has no open opportunities', () => {
    const result = nextStepFillRate(nextStepCoverageSample([]), { asOf });
    expect(result).toEqual({
      metric: 'next_step_fill_rate',
      status: 'not_applicable',
      value: null,
      sampleSize: 0,
      lowConfidence: false,
      note: 'no open opportunities in sample',
    });
  });
});

describe('noteCoverageRate', () => {
  const asOf = '2026-06-15T00:00:00.000Z';

  it('matches the golden fixture: a short note counts by presence alone, no length threshold', () => {
    const result = noteCoverageRate(noteCoverageRateFixture(), { asOf });
    expect(result).toEqual({
      metric: 'note_coverage_rate',
      status: 'ok',
      value: NOTE_COVERAGE_RATE_EXPECTED.value,
      sampleSize: NOTE_COVERAGE_RATE_EXPECTED.sampleSize,
      lowConfidence: true, // 5 < LOW_CONFIDENCE_SAMPLE_SIZE (30)
    });
  });

  it('returns not_applicable rather than dividing by zero when the sample has no open opportunities', () => {
    const result = noteCoverageRate(noteCoverageSample([]), { asOf });
    expect(result).toEqual({
      metric: 'note_coverage_rate',
      status: 'not_applicable',
      value: null,
      sampleSize: 0,
      lowConfidence: false,
      note: 'no open opportunities in sample',
    });
  });

  it('sets floor: true and a truncated-count note when a sampled opportunity had truncated notes, value unchanged', () => {
    const result = noteCoverageRate(noteCoverageRateTruncatedFixture(), { asOf });
    expect(result).toEqual({
      metric: 'note_coverage_rate',
      status: 'ok',
      value: NOTE_COVERAGE_RATE_EXPECTED.value,
      sampleSize: NOTE_COVERAGE_RATE_EXPECTED.sampleSize,
      lowConfidence: true,
      floor: true,
      note: '1 opportunity had truncated related records — value is a floor, not exact',
    });
  });

  it('does not set floor when no sampled opportunity was truncated (golden fixture)', () => {
    const result = noteCoverageRate(noteCoverageRateFixture(), { asOf });
    expect(result.floor).toBeUndefined();
  });
});

describe('ownerIdFillRate', () => {
  const asOf = '2026-06-15T00:00:00.000Z';

  it('matches the golden fixture: an empty-string or whitespace-only ownerId counts as unfilled, same as undefined', () => {
    const result = ownerIdFillRate(ownerIdFillRateFixture(), { asOf });
    expect(result).toEqual({
      metric: 'owner_id_fill_rate',
      status: 'ok',
      value: OWNER_ID_FILL_RATE_EXPECTED.value,
      sampleSize: OWNER_ID_FILL_RATE_EXPECTED.sampleSize,
      lowConfidence: true, // 5 < LOW_CONFIDENCE_SAMPLE_SIZE (30)
    });
  });

  it('returns not_applicable rather than dividing by zero when the sample has no open opportunities', () => {
    const result = ownerIdFillRate(ownerIdCoverageSample([]), { asOf });
    expect(result).toEqual({
      metric: 'owner_id_fill_rate',
      status: 'not_applicable',
      value: null,
      sampleSize: 0,
      lowConfidence: false,
      note: 'no open opportunities in sample',
    });
  });
});

describe('activityCaptureRate', () => {
  it('matches the golden fixture: 4 of 8 eligible opportunities have a qualifying activity', () => {
    const result = activityCaptureRate(activityCaptureRateFixture(), { asOf: ACTIVITY_CAPTURE_RATE_ASOF });
    expect(result).toEqual({
      metric: 'activity_capture_rate',
      status: 'ok',
      value: ACTIVITY_CAPTURE_RATE_EXPECTED.value,
      sampleSize: ACTIVITY_CAPTURE_RATE_EXPECTED.sampleSize,
      lowConfidence: true, // 8 < LOW_CONFIDENCE_SAMPLE_SIZE (30)
    });
  });

  it('returns not_instrumented when the adapter reports no activitySync capability, without reading the sample', () => {
    const result = activityCaptureRate(activityCaptureRateGateOffFixture(), { asOf: ACTIVITY_CAPTURE_RATE_ASOF });
    expect(result).toEqual({
      metric: 'activity_capture_rate',
      status: 'not_instrumented',
      value: null,
      sampleSize: 0,
      lowConfidence: false,
      note: 'adapter capability matrix reports no activity-sync capability for this org',
    });
  });

  it('sets floor: true and a truncated-count note when an eligible opportunity had truncated activities, value unchanged', () => {
    const result = activityCaptureRate(activityCaptureRateTruncatedFixture(), { asOf: ACTIVITY_CAPTURE_RATE_ASOF });
    expect(result).toEqual({
      metric: 'activity_capture_rate',
      status: 'ok',
      value: ACTIVITY_CAPTURE_RATE_EXPECTED.value,
      sampleSize: ACTIVITY_CAPTURE_RATE_EXPECTED.sampleSize,
      lowConfidence: true,
      floor: true,
      note: '1 opportunity had truncated related records — value is a floor, not exact',
    });
  });

  it('does not set floor when no eligible opportunity was truncated (golden fixture)', () => {
    const result = activityCaptureRate(activityCaptureRateFixture(), { asOf: ACTIVITY_CAPTURE_RATE_ASOF });
    expect(result.floor).toBeUndefined();
  });
});

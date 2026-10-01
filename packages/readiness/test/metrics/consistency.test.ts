import { describe, expect, it } from 'vitest';
import {
  duplicateAccountRate,
  roundAmountRate,
  stageActivityContradictionRate,
  stageMappingCoverage,
} from '../../src/metrics/consistency.js';
import {
  ROUND_AMOUNT_RATE_EXPECTED,
  coverageSample as roundAmountCoverageSample,
  roundAmountRateAllExcludedFixture,
  roundAmountRateFixture,
} from '../fixtures/round_amount_rate.js';
import {
  STAGE_ACTIVITY_CONTRADICTION_RATE_ASOF,
  STAGE_ACTIVITY_CONTRADICTION_RATE_EXPECTED,
  stageActivityContradictionRateAllNewFixture,
  stageActivityContradictionRateFixture,
  stageActivityContradictionRateGateOffFixture,
  stageActivityContradictionRateNewDealFixture,
  stageActivityContradictionRateNoLateStageFixture,
  stageActivityContradictionRateTruncatedFixture,
} from '../fixtures/stage_activity_contradiction_rate.js';
import {
  STAGE_MAPPING_COVERAGE_EXPECTED,
  stageMappingCoverageEmptyFixture,
  stageMappingCoverageFixture,
} from '../fixtures/stage_mapping_coverage.js';
import {
  DUPLICATE_ACCOUNT_RATE_EXPECTED,
  duplicateAccountRateAllExcludedFixture,
  duplicateAccountRateConfigDenylistFixture,
  duplicateAccountRateEmptyFixture,
  duplicateAccountRateFixture,
  duplicateAccountRateGateOffFixture,
} from '../fixtures/duplicate_account_rate.js';

const ASOF = '2026-06-15T00:00:00.000Z';

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

  it('sets floor: true and a truncated-count note when a denominator opportunity had truncated activities, value unchanged', () => {
    const result = stageActivityContradictionRate(stageActivityContradictionRateTruncatedFixture(), {
      asOf: STAGE_ACTIVITY_CONTRADICTION_RATE_ASOF,
    });
    expect(result).toEqual({
      metric: 'stage_activity_contradiction_rate',
      status: 'ok',
      value: STAGE_ACTIVITY_CONTRADICTION_RATE_EXPECTED.value,
      sampleSize: STAGE_ACTIVITY_CONTRADICTION_RATE_EXPECTED.sampleSize,
      lowConfidence: true,
      floor: true,
      note: '1 opportunity had truncated related records — value is a floor, not exact',
    });
  });

  it('excludes a deal created in the last 7 days, same as activity_capture_rate; an older one is still flagged', () => {
    const result = stageActivityContradictionRate(stageActivityContradictionRateNewDealFixture(), {
      asOf: STAGE_ACTIVITY_CONTRADICTION_RATE_ASOF,
    });
    expect(result).toEqual({
      metric: 'stage_activity_contradiction_rate',
      status: 'ok',
      value: 1,
      sampleSize: 1,
      lowConfidence: true,
    });
  });

  it('returns not_applicable, not 0 or 1, when every late-stage deal is newer than 7 days', () => {
    const result = stageActivityContradictionRate(stageActivityContradictionRateAllNewFixture(), {
      asOf: STAGE_ACTIVITY_CONTRADICTION_RATE_ASOF,
    });
    expect(result).toMatchObject({
      metric: 'stage_activity_contradiction_rate',
      status: 'not_applicable',
      value: null,
      sampleSize: 0,
    });
  });

  it('does not set floor when no denominator opportunity was truncated (golden fixture)', () => {
    const result = stageActivityContradictionRate(stageActivityContradictionRateFixture(), {
      asOf: STAGE_ACTIVITY_CONTRADICTION_RATE_ASOF,
    });
    expect(result.floor).toBeUndefined();
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

describe('stageMappingCoverage', () => {
  it('matches the golden fixture: 4 of 6 sampled opportunities (open + closed) are mapped or inferred, split reported via note', () => {
    const result = stageMappingCoverage(stageMappingCoverageFixture(), { asOf: ASOF });
    expect(result).toEqual({
      metric: 'stage_mapping_coverage',
      status: 'ok',
      value: STAGE_MAPPING_COVERAGE_EXPECTED.value,
      sampleSize: STAGE_MAPPING_COVERAGE_EXPECTED.sampleSize,
      lowConfidence: true, // 6 < LOW_CONFIDENCE_SAMPLE_SIZE (30)
      note: `${STAGE_MAPPING_COVERAGE_EXPECTED.mapped} mapped, ${STAGE_MAPPING_COVERAGE_EXPECTED.inferred} inferred, ${STAGE_MAPPING_COVERAGE_EXPECTED.unmapped} unmapped`,
    });
  });

  it('returns not_applicable rather than dividing by zero when there are no sampled opportunities at all', () => {
    const result = stageMappingCoverage(stageMappingCoverageEmptyFixture(), { asOf: ASOF });
    expect(result).toEqual({
      metric: 'stage_mapping_coverage',
      status: 'not_applicable',
      value: null,
      sampleSize: 0,
      lowConfidence: false,
      note: 'no sampled opportunities (open or closed) in sample',
    });
  });
});

describe('duplicateAccountRate', () => {
  it('matches the golden fixture: one duplicate group of 3 (all members counted) among 4 accounts considered after excluding null-domain and denylisted accounts', () => {
    const result = duplicateAccountRate(duplicateAccountRateFixture(), { asOf: ASOF });
    expect(result).toEqual({
      metric: 'duplicate_account_rate',
      status: 'ok',
      value: DUPLICATE_ACCOUNT_RATE_EXPECTED.value,
      sampleSize: DUPLICATE_ACCOUNT_RATE_EXPECTED.sampleSize,
      lowConfidence: true, // 4 < LOW_CONFIDENCE_SAMPLE_SIZE (30)
      note:
        `${DUPLICATE_ACCOUNT_RATE_EXPECTED.excludedNullDomain} accounts excluded (no resolvable domain), ` +
        `${DUPLICATE_ACCOUNT_RATE_EXPECTED.excludedDenylisted} excluded (shared-provider domain), ` +
        `${DUPLICATE_ACCOUNT_RATE_EXPECTED.duplicateGroupCount} duplicate group(s) among ${DUPLICATE_ACCOUNT_RATE_EXPECTED.sampleSize} accounts considered; ` +
        `${DUPLICATE_ACCOUNT_RATE_EXPECTED.missingAccountCount} accountRefs did not resolve, ` +
        `${DUPLICATE_ACCOUNT_RATE_EXPECTED.oppsWithoutAccountRef} opportunities had no usable accountRef`,
    });
  });

  it('returns not_applicable with a distinct note when every hydrated account is excluded (null or denylisted domain)', () => {
    const result = duplicateAccountRate(duplicateAccountRateAllExcludedFixture(), { asOf: ASOF });
    expect(result).toEqual({
      metric: 'duplicate_account_rate',
      status: 'not_applicable',
      value: null,
      sampleSize: 0,
      lowConfidence: false,
      note: 'no accounts with a resolvable, non-denylisted domain in sample',
    });
  });

  it('returns not_applicable with a distinct note when there are no hydrated accounts at all', () => {
    const result = duplicateAccountRate(duplicateAccountRateEmptyFixture(), { asOf: ASOF });
    expect(result).toEqual({
      metric: 'duplicate_account_rate',
      status: 'not_applicable',
      value: null,
      sampleSize: 0,
      lowConfidence: false,
      note: 'no hydrated accounts in sample',
    });
  });

  it('returns not_instrumented when accountsHydrated is false, without reading accountsByRef', () => {
    const result = duplicateAccountRate(duplicateAccountRateGateOffFixture(), { asOf: ASOF });
    expect(result).toEqual({
      metric: 'duplicate_account_rate',
      status: 'not_instrumented',
      value: null,
      sampleSize: 0,
      lowConfidence: false,
      note: 'account hydration has not run for this sample (accountsHydrated is false)',
    });
  });

  it('normalizes a config-supplied denylist entry before comparison, so " Gmail.COM " still excludes a gmail.com account', () => {
    const result = duplicateAccountRate(duplicateAccountRateConfigDenylistFixture(), {
      asOf: ASOF,
      sharedProviderDenylist: [' Gmail.COM '],
    });
    expect(result).toEqual({
      metric: 'duplicate_account_rate',
      status: 'ok',
      value: 0,
      sampleSize: 1,
      lowConfidence: true,
      note:
        '0 accounts excluded (no resolvable domain), 1 excluded (shared-provider domain), ' +
        '0 duplicate group(s) among 1 accounts considered; 0 accountRefs did not resolve, ' +
        '0 opportunities had no usable accountRef',
    });
  });
});

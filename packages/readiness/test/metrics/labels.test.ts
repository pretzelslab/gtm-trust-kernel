import { describe, expect, it } from 'vitest';
import { closedDealCountTwelveMonths, outcomeEvidenceRetentionRate, winRateDispersion } from '../../src/metrics/labels.js';
import {
  CLOSED_DEAL_COUNT_12M_ASOF,
  CLOSED_DEAL_COUNT_12M_EXPECTED,
  closedDealCount12mEmptyFixture,
  closedDealCount12mFixture,
  closedDealCount12mFloorFixture,
} from '../fixtures/closed_deal_count_12m.js';
import {
  OUTCOME_EVIDENCE_RETENTION_RATE_ASOF,
  OUTCOME_EVIDENCE_RETENTION_RATE_EXPECTED,
  outcomeEvidenceRetentionRateEmptyFixture,
  outcomeEvidenceRetentionRateFixture,
  outcomeEvidenceRetentionRateTruncatedFixture,
} from '../fixtures/outcome_evidence_retention_rate.js';
import {
  WIN_RATE_DISPERSION_ASOF,
  WIN_RATE_DISPERSION_EXCLUDED_STAGE_EXPECTED,
  WIN_RATE_DISPERSION_EXPECTED,
  WIN_RATE_DISPERSION_MULTI_HOP_HIGH_EXPECTED,
  WIN_RATE_DISPERSION_MULTI_HOP_LOW_EXPECTED,
  WIN_RATE_DISPERSION_REVISITED_STAGE_EXPECTED,
  winRateDispersionExcludedStageFixture,
  winRateDispersionFewerThanTwoStagesFixture,
  winRateDispersionFixture,
  winRateDispersionGateOffFixture,
  winRateDispersionMultiHopHighFixture,
  winRateDispersionMultiHopLowFixture,
  winRateDispersionNoEligibleFixture,
  winRateDispersionOnlyClosingTransitionFixture,
  winRateDispersionRevisitedStageFixture,
} from '../fixtures/win_rate_dispersion.js';

describe('closedDealCountTwelveMonths', () => {
  it('matches the golden fixture: 5 closed opportunities, no floor', () => {
    const result = closedDealCountTwelveMonths(closedDealCount12mFixture(), { asOf: CLOSED_DEAL_COUNT_12M_ASOF });
    expect(result).toEqual({
      metric: 'closed_deal_count_12m',
      status: 'ok',
      value: CLOSED_DEAL_COUNT_12M_EXPECTED.value,
      sampleSize: CLOSED_DEAL_COUNT_12M_EXPECTED.sampleSize,
      lowConfidence: true,
      floor: false,
    });
  });

  it('reports value 0, not not_applicable, when there are no closed opportunities in the sample', () => {
    const result = closedDealCountTwelveMonths(closedDealCount12mEmptyFixture(), { asOf: CLOSED_DEAL_COUNT_12M_ASOF });
    expect(result).toEqual({
      metric: 'closed_deal_count_12m',
      status: 'ok',
      value: 0,
      sampleSize: 0,
      lowConfidence: true,
      floor: false,
    });
  });

  it('sets floor: true with an explanatory note when the closed_won reservoir stratum filled to target', () => {
    const result = closedDealCountTwelveMonths(closedDealCount12mFloorFixture(), { asOf: CLOSED_DEAL_COUNT_12M_ASOF });
    expect(result.floor).toBe(true);
    expect(result.value).toBe(2);
    expect(result.note).toContain('sample-size ceiling');
  });
});

describe('outcomeEvidenceRetentionRate', () => {
  it('matches the golden fixture: 3 of 5 closed opportunities retain a note or activity', () => {
    const result = outcomeEvidenceRetentionRate(outcomeEvidenceRetentionRateFixture(), { asOf: OUTCOME_EVIDENCE_RETENTION_RATE_ASOF });
    expect(result).toEqual({
      metric: 'outcome_evidence_retention_rate',
      status: 'ok',
      value: OUTCOME_EVIDENCE_RETENTION_RATE_EXPECTED.value,
      sampleSize: OUTCOME_EVIDENCE_RETENTION_RATE_EXPECTED.sampleSize,
      lowConfidence: true,
    });
  });

  it('does NOT set floor when a retained opportunity had truncated activities — reversed from note_coverage_rate/activity_capture_rate by design (metric-definitions.md D7)', () => {
    const result = outcomeEvidenceRetentionRate(outcomeEvidenceRetentionRateTruncatedFixture(), {
      asOf: OUTCOME_EVIDENCE_RETENTION_RATE_ASOF,
    });
    expect(result.value).toBe(OUTCOME_EVIDENCE_RETENTION_RATE_EXPECTED.value);
    expect(result.floor).toBeUndefined();
  });

  it('returns not_applicable when there are no closed opportunities in the sample', () => {
    const result = outcomeEvidenceRetentionRate(outcomeEvidenceRetentionRateEmptyFixture(), {
      asOf: OUTCOME_EVIDENCE_RETENTION_RATE_ASOF,
    });
    expect(result).toEqual({
      metric: 'outcome_evidence_retention_rate',
      status: 'not_applicable',
      value: null,
      sampleSize: 0,
      lowConfidence: false,
      note: 'no closed opportunities (won or lost, trailing 12 months) in sample',
    });
  });
});

describe('winRateDispersion', () => {
  it('matches the golden fixture: 2 qualifying stages at exactly the 5-opportunity minimum, dispersion 0.3', () => {
    const result = winRateDispersion(winRateDispersionFixture(), { asOf: WIN_RATE_DISPERSION_ASOF });
    expect(result.value).toBeCloseTo(WIN_RATE_DISPERSION_EXPECTED.value, 10);
    expect({ ...result, value: undefined }).toEqual({
      metric: 'win_rate_dispersion',
      status: 'ok',
      value: undefined,
      sampleSize: WIN_RATE_DISPERSION_EXPECTED.sampleSize,
      lowConfidence: true,
    });
  });

  it('excludes a stage below the 5-opportunity minimum, reporting exactly 1 excluded in note, value/sampleSize otherwise unchanged', () => {
    const result = winRateDispersion(winRateDispersionExcludedStageFixture(), { asOf: WIN_RATE_DISPERSION_ASOF });
    expect(result.value).toBeCloseTo(WIN_RATE_DISPERSION_EXCLUDED_STAGE_EXPECTED.value, 10);
    expect({ ...result, value: undefined }).toEqual({
      metric: 'win_rate_dispersion',
      status: 'ok',
      value: undefined,
      sampleSize: WIN_RATE_DISPERSION_EXCLUDED_STAGE_EXPECTED.sampleSize,
      lowConfidence: true,
      note: '1 stage excluded: fewer than 5 closed opportunities',
    });
  });

  it('returns not_applicable when fewer than 2 canonical stages ever qualify', () => {
    const result = winRateDispersion(winRateDispersionFewerThanTwoStagesFixture(), { asOf: WIN_RATE_DISPERSION_ASOF });
    expect(result).toEqual({
      metric: 'win_rate_dispersion',
      status: 'not_applicable',
      value: null,
      sampleSize: 0,
      lowConfidence: false,
      note: 'fewer than 2 canonical stages have at least 5 closed opportunities (0 stages excluded)',
    });
  });

  it('filters out the closing transition itself (closed_won/closed_lost) — a fixture where every entry is the closing stage reads as no intermediate stages at all, not a trivial 1.0/0.0 dispersion', () => {
    const result = winRateDispersion(winRateDispersionOnlyClosingTransitionFixture(), { asOf: WIN_RATE_DISPERSION_ASOF });
    expect(result.status).toBe('not_applicable');
    expect(result.value).toBeNull();
  });

  it('returns not_instrumented when the adapter reports no stageHistory capability for this org', () => {
    const result = winRateDispersion(winRateDispersionGateOffFixture(), { asOf: WIN_RATE_DISPERSION_ASOF });
    expect(result).toEqual({
      metric: 'win_rate_dispersion',
      status: 'not_instrumented',
      value: null,
      sampleSize: 0,
      lowConfidence: false,
      note: 'adapter capability matrix reports no stage-history capability for this org',
    });
  });

  it('returns not_applicable when no closed opportunity has a resolvable stage-history entry', () => {
    const result = winRateDispersion(winRateDispersionNoEligibleFixture(), { asOf: WIN_RATE_DISPERSION_ASOF });
    expect(result).toEqual({
      metric: 'win_rate_dispersion',
      status: 'not_applicable',
      value: null,
      sampleSize: 0,
      lowConfidence: false,
      note: 'no closed opportunities in sample with a resolvable stage-history entry',
    });
  });

  it('multi-hop, high dispersion: opportunities passing through 2 stages each read winRates [1.0, 0.5, 0.0], standardDeviation sqrt(1/6)', () => {
    const result = winRateDispersion(winRateDispersionMultiHopHighFixture(), { asOf: WIN_RATE_DISPERSION_ASOF });
    expect(result.value).toBeCloseTo(WIN_RATE_DISPERSION_MULTI_HOP_HIGH_EXPECTED.value, 10);
    expect({ ...result, value: undefined }).toEqual({
      metric: 'win_rate_dispersion',
      status: 'ok',
      value: undefined,
      sampleSize: WIN_RATE_DISPERSION_MULTI_HOP_HIGH_EXPECTED.sampleSize,
      lowConfidence: true,
    });
  });

  it('multi-hop, low dispersion: an even 50/50 split at every stage reads standardDeviation exactly 0 despite multi-stage transitions', () => {
    const result = winRateDispersion(winRateDispersionMultiHopLowFixture(), { asOf: WIN_RATE_DISPERSION_ASOF });
    expect(result.value).toBeCloseTo(WIN_RATE_DISPERSION_MULTI_HOP_LOW_EXPECTED.value, 10);
    expect({ ...result, value: undefined }).toEqual({
      metric: 'win_rate_dispersion',
      status: 'ok',
      value: undefined,
      sampleSize: WIN_RATE_DISPERSION_MULTI_HOP_LOW_EXPECTED.sampleSize,
      lowConfidence: true,
    });
  });

  it('degenerate multi-hop shape: a stage revisited twice by the same closed opportunity is deduped, not double-counted, within that stage\'s tally', () => {
    const result = winRateDispersion(winRateDispersionRevisitedStageFixture(), { asOf: WIN_RATE_DISPERSION_ASOF });
    expect(result.value).toBeCloseTo(WIN_RATE_DISPERSION_REVISITED_STAGE_EXPECTED.value, 10);
    expect({ ...result, value: undefined }).toEqual({
      metric: 'win_rate_dispersion',
      status: 'ok',
      value: undefined,
      sampleSize: WIN_RATE_DISPERSION_REVISITED_STAGE_EXPECTED.sampleSize,
      lowConfidence: true,
    });
  });
});

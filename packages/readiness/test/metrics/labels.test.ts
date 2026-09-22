import { describe, expect, it } from 'vitest';
import { closedDealCountTwelveMonths, outcomeEvidenceRetentionRate } from '../../src/metrics/labels.js';
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

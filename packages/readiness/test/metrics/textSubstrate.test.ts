import { describe, expect, it } from 'vitest';
import { medianNoteLengthChars, piiDensity, substantiveNoteRate, untrustedTextRatio } from '../../src/metrics/textSubstrate.js';
import {
  SUBSTANTIVE_NOTE_RATE_ASOF,
  SUBSTANTIVE_NOTE_RATE_EXPECTED,
  substantiveNoteRateEmptyFixture,
  substantiveNoteRateFixture,
} from '../fixtures/substantive_note_rate.js';
import {
  MEDIAN_NOTE_LENGTH_CHARS_ASOF,
  MEDIAN_NOTE_LENGTH_CHARS_EXPECTED,
  medianNoteLengthCharsEmptyFixture,
  medianNoteLengthCharsFixture,
} from '../fixtures/median_note_length_chars.js';
import { PII_DENSITY_ASOF, PII_DENSITY_EXPECTED, piiDensityEmptyFixture, piiDensityFixture } from '../fixtures/pii_density.js';
import {
  UNTRUSTED_TEXT_RATIO_ASOF,
  UNTRUSTED_TEXT_RATIO_EXPECTED,
  untrustedTextRatioEmptyFixture,
  untrustedTextRatioFixture,
} from '../fixtures/untrusted_text_ratio.js';

describe('substantiveNoteRate', () => {
  it('matches the golden fixture: 2 of 5 sampled notes are substantive', () => {
    const result = substantiveNoteRate(substantiveNoteRateFixture(), { asOf: SUBSTANTIVE_NOTE_RATE_ASOF });
    expect(result).toEqual({
      metric: 'substantive_note_rate',
      status: 'ok',
      value: SUBSTANTIVE_NOTE_RATE_EXPECTED.value,
      sampleSize: SUBSTANTIVE_NOTE_RATE_EXPECTED.sampleSize,
      lowConfidence: true,
    });
  });

  it('returns not_applicable when there are no sampled notes at all', () => {
    const result = substantiveNoteRate(substantiveNoteRateEmptyFixture(), { asOf: SUBSTANTIVE_NOTE_RATE_ASOF });
    expect(result).toEqual({
      metric: 'substantive_note_rate',
      status: 'not_applicable',
      value: null,
      sampleSize: 0,
      lowConfidence: false,
      note: 'no sampled notes (open or closed) in sample',
    });
  });
});

describe('medianNoteLengthChars', () => {
  it('matches the golden fixture: median of [10, 20, 30, 40, 50] trimmed lengths is 30', () => {
    const result = medianNoteLengthChars(medianNoteLengthCharsFixture(), { asOf: MEDIAN_NOTE_LENGTH_CHARS_ASOF });
    expect(result).toEqual({
      metric: 'median_note_length_chars',
      status: 'ok',
      value: MEDIAN_NOTE_LENGTH_CHARS_EXPECTED.value,
      sampleSize: MEDIAN_NOTE_LENGTH_CHARS_EXPECTED.sampleSize,
      lowConfidence: true,
    });
  });

  it('returns not_applicable when there are no sampled notes at all', () => {
    const result = medianNoteLengthChars(medianNoteLengthCharsEmptyFixture(), { asOf: MEDIAN_NOTE_LENGTH_CHARS_ASOF });
    expect(result.status).toBe('not_applicable');
    expect(result.value).toBeNull();
  });
});

describe('piiDensity', () => {
  it('matches the golden fixture: 4 of 7 candidate records match a PII pattern', () => {
    const result = piiDensity(piiDensityFixture(), { asOf: PII_DENSITY_ASOF });
    expect(result).toEqual({
      metric: 'pii_density',
      status: 'ok',
      value: PII_DENSITY_EXPECTED.value,
      sampleSize: PII_DENSITY_EXPECTED.sampleSize,
      lowConfidence: true,
      note: '4 of 7 sampled records (notes, activities, opportunities) matched a PII pattern',
    });
  });

  it('never surfaces a matched value in its note or anywhere else in the result', () => {
    const result = piiDensity(piiDensityFixture(), { asOf: PII_DENSITY_ASOF });
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain('jane.doe@example.com');
    expect(serialized).not.toContain('415');
    expect(serialized).not.toContain('123-45-6789');
    expect(serialized).not.toContain('4111111111111111');
  });

  it('returns not_applicable when there are no sampled notes, activities, or opportunities with free text', () => {
    const result = piiDensity(piiDensityEmptyFixture(), { asOf: PII_DENSITY_ASOF });
    expect(result.status).toBe('not_applicable');
    expect(result.value).toBeNull();
  });
});

describe('untrustedTextRatio', () => {
  it('matches the golden fixture: 4 of 7 sampled fields are ExternallySourced', () => {
    const result = untrustedTextRatio(untrustedTextRatioFixture(), { asOf: UNTRUSTED_TEXT_RATIO_ASOF });
    expect(result).toEqual({
      metric: 'untrusted_text_ratio',
      status: 'ok',
      value: UNTRUSTED_TEXT_RATIO_EXPECTED.value,
      sampleSize: UNTRUSTED_TEXT_RATIO_EXPECTED.sampleSize,
      lowConfidence: true,
      note: "reflects the adapter's own ingestion-time trust-tier assignment, not independently verified ground truth",
    });
  });

  it('returns not_applicable when there are no sampled note bodies or activity subject/body fields at all', () => {
    const result = untrustedTextRatio(untrustedTextRatioEmptyFixture(), { asOf: UNTRUSTED_TEXT_RATIO_ASOF });
    expect(result.status).toBe('not_applicable');
    expect(result.value).toBeNull();
  });
});

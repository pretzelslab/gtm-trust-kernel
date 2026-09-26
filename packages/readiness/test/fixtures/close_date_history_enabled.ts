import type { CoverageSample } from '../../src/metrics/types.js';
import { makeCoverageSample, DEFAULT_TEST_CAPABILITIES } from '../support/coverageSample.js';

function coverageSample(closeDateHistory: boolean): CoverageSample {
  return makeCoverageSample({ capabilities: { ...DEFAULT_TEST_CAPABILITIES, closeDateHistory } });
}

export function closeDateHistoryEnabledTrueFixture(): CoverageSample {
  return coverageSample(true);
}

export function closeDateHistoryEnabledFalseFixture(): CoverageSample {
  return coverageSample(false);
}

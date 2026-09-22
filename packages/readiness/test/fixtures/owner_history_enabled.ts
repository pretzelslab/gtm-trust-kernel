import type { CoverageSample } from '../../src/metrics/types.js';
import { makeCoverageSample, DEFAULT_TEST_CAPABILITIES } from '../support/coverageSample.js';

function coverageSample(ownerHistory: boolean): CoverageSample {
  return makeCoverageSample({ capabilities: { ...DEFAULT_TEST_CAPABILITIES, ownerHistory } });
}

export function ownerHistoryEnabledTrueFixture(): CoverageSample {
  return coverageSample(true);
}

export function ownerHistoryEnabledFalseFixture(): CoverageSample {
  return coverageSample(false);
}

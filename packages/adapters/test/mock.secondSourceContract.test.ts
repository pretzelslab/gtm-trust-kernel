import { describe } from 'vitest';
import { runSecondSourceContract } from './contract/secondSource.contract.js';
import { makeMockSecondSourceAdapter, makeSecondSourceOrgData, ORG, SECOND_SOURCE } from './fixtures.js';
import { MockSecondSourceAdapter } from '../src/mock.js';
import type { SecondSourceCapabilities } from '../src/types.js';

describe('MockSecondSourceAdapter satisfies the second-source adapter contract', () => {
  runSecondSourceContract(() => ({
    adapter: makeMockSecondSourceAdapter(),
    source: SECOND_SOURCE,
    orgId: ORG,
    knownContactId: 'con-1',
    knownAccountId: 'acc-1',
    withCapabilities: (overrides: Partial<SecondSourceCapabilities>) =>
      new MockSecondSourceAdapter(makeSecondSourceOrgData(), overrides),
  }));
});

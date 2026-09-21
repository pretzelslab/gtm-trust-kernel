import { describe } from 'vitest';
import { runAdapterContract } from './contract/adapter.contract.js';
import { makeMockAdapter } from './fixtures.js';

describe('MockAdapter satisfies the CRM adapter contract', () => {
  runAdapterContract(() => ({
    adapter: makeMockAdapter(),
    knownOpportunityId: 'opp-1',
    knownAccountId: 'acc-1',
    knownContactId: 'con-1',
  }));
});

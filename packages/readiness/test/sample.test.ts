import { describe, expect, it } from 'vitest';
import { MockAdapter, type MockOrgData } from '@gtm-trust-kernel/adapters/mock.js';
import type { CanonicalStage, Opportunity, RecordRef } from '@gtm-trust-kernel/adapters/model/canonical.js';
import { CANONICAL_STAGE_ORDER } from '@gtm-trust-kernel/adapters/model/canonical.js';
import { CLOSED_WINDOW_MONTHS, classifyStratum, runSample, type SampleConfig } from '../src/sample.js';

const ORG = 'org-sample-test';
const ASOF = new Date('2026-06-15T00:00:00.000Z');

function ref(objectType: RecordRef['objectType'], id: string): RecordRef {
  return { crm: 'mock', orgId: ORG, objectType, id };
}

function isoDaysBeforeAsOf(days: number): string {
  return new Date(ASOF.getTime() - days * 86_400_000).toISOString();
}

function makeOpenOpportunity(stage: CanonicalStage, id: string, order: number): Opportunity {
  return {
    ref: ref('opportunity', id),
    accountRef: ref('account', 'acc-1'),
    name: `${stage} ${id}`,
    stage,
    stageConfidence: 'mapped',
    vendorStageLabel: stage,
    isClosed: false,
    contactLinks: [],
    createdAt: isoDaysBeforeAsOf(400),
    modifiedAt: isoDaysBeforeAsOf(400 - order),
    concurrencyToken: `tok-${id}`,
  };
}

function makeClosedOpportunity(
  stage: 'closed_won' | 'closed_lost',
  id: string,
  order: number,
  closeDateIso: string,
): Opportunity {
  return {
    ref: ref('opportunity', id),
    accountRef: ref('account', 'acc-1'),
    name: `${stage} ${id}`,
    stage,
    stageConfidence: 'mapped',
    vendorStageLabel: stage,
    isClosed: true,
    isWon: stage === 'closed_won',
    closeDate: closeDateIso,
    contactLinks: [],
    createdAt: closeDateIso,
    modifiedAt: isoDaysBeforeAsOf(400 - order),
    concurrencyToken: `tok-${id}`,
  };
}

/** perStratum opportunities in each of the 5 open stages plus closed_won and closed_lost, all closed deals well inside the 12-month window. */
function buildOrgData(perStratum: number): MockOrgData {
  const opportunities: Opportunity[] = [];
  let order = 0;

  for (const stage of CANONICAL_STAGE_ORDER) {
    for (let i = 0; i < perStratum; i++) {
      order += 1;
      opportunities.push(makeOpenOpportunity(stage, `${stage}-${i}`, order));
    }
  }

  for (const stage of ['closed_won', 'closed_lost'] as const) {
    for (let i = 0; i < perStratum; i++) {
      order += 1;
      opportunities.push(makeClosedOpportunity(stage, `${stage}-${i}`, order, isoDaysBeforeAsOf(60 + i)));
    }
  }

  return {
    accounts: [],
    opportunities,
    contacts: [],
    activities: [],
    notes: [],
    stageHistory: [],
    ownerChanges: [],
  };
}

const baseConfig = {
  perStratumSampleSize: 3,
  maxRecordsToScan: 1_000,
  pageSizeBulk: 2_000,
  pageSizeStandard: 200,
  asOf: ASOF.toISOString(),
} satisfies Omit<SampleConfig, 'seed'>;

const alwaysConfirm = () => true;

function idsByStratum(result: Awaited<ReturnType<typeof runSample>>): readonly (readonly string[])[] {
  if ('cancelled' in result) throw new Error('unexpected cancellation in test');
  return result.strata.map((s) => s.opportunities.map((o) => o.ref.id));
}

describe('runSample determinism', () => {
  it('keeps identical opportunity IDs in identical order per stratum for the same seed', async () => {
    const adapterA = new MockAdapter(ORG, buildOrgData(10));
    const adapterB = new MockAdapter(ORG, buildOrgData(10));
    const config: SampleConfig = { ...baseConfig, seed: 'determinism-seed' };

    const resultA = idsByStratum(await runSample(adapterA, config, alwaysConfirm));
    const resultB = idsByStratum(await runSample(adapterB, config, alwaysConfirm));

    expect(resultB).toEqual(resultA);
  });

  it('produces a different sample for a different seed', async () => {
    const adapterA = new MockAdapter(ORG, buildOrgData(10));
    const adapterB = new MockAdapter(ORG, buildOrgData(10));

    const resultA = idsByStratum(await runSample(adapterA, { ...baseConfig, seed: 'seed-alpha' }, alwaysConfirm));
    const resultB = idsByStratum(await runSample(adapterB, { ...baseConfig, seed: 'seed-beta' }, alwaysConfirm));

    expect(resultB).not.toEqual(resultA);
  });
});

describe('classifyStratum', () => {
  it('excludes a closed deal just outside the 12-month window and includes one just inside it', () => {
    const cutoff = new Date(ASOF);
    cutoff.setUTCMonth(cutoff.getUTCMonth() - CLOSED_WINDOW_MONTHS);
    const justOutside = new Date(cutoff.getTime() - 86_400_000);

    const insideDeal = makeClosedOpportunity('closed_won', 'inside', 0, cutoff.toISOString());
    const outsideDeal = makeClosedOpportunity('closed_won', 'outside', 0, justOutside.toISOString());

    expect(classifyStratum(insideDeal, ASOF)).toBe('closed_won');
    expect(classifyStratum(outsideDeal, ASOF)).toBeNull();
  });
});

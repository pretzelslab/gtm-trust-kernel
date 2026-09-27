import { describe, expect, it } from 'vitest';
import { MockAdapter, MockSecondSourceAdapter } from '@gtm-trust-kernel/adapters/mock.js';
import { MOCK_ORG_FIXTURES, type FixtureName } from '../../src/fixtures/mockOrgs.js';
import { buildReportData, type MetricRow, type ReportData } from '../../src/report/buildReport.js';
import { buildNarrative } from '../../src/report/narrative.js';
import { buildExecutiveSummary } from '../../src/report/plainSummary.js';
import { FakeNarrativeModelClient } from '../support/fakeNarrativeModelClient.js';

async function buildFixture(name: FixtureName): Promise<ReportData> {
  const fixture = MOCK_ORG_FIXTURES[name];
  const adapter = new MockAdapter(fixture.orgId, fixture.data, fixture.capabilities);
  const secondSourceAdapter = fixture.secondSource
    ? new MockSecondSourceAdapter(fixture.secondSource.data, fixture.secondSource.capabilities)
    : undefined;
  return buildReportData(adapter, secondSourceAdapter, {
    orgLabel: fixture.label,
    orgDescription: fixture.description,
    asOf: fixture.asOf,
  });
}

/** A metric row from a real fixture, so claim text is built against real values rather than hand-invented numbers. */
function findRow(data: ReportData, predicate: (row: MetricRow) => boolean): MetricRow {
  const row = data.metrics.find(predicate);
  if (!row) throw new Error('expected fixture to contain a matching metric row for this test');
  return row;
}

describe('buildNarrative', () => {
  it('falls back to the deterministic summary with the client-error notice when the client throws', async () => {
    const data = await buildFixture('healthy');
    const client = FakeNarrativeModelClient.throwing(new Error('some SDK internals that must never leak'));

    const result = await buildNarrative(data, client);

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.reasonKind).toBe('client_error');
    expect(result.notice).toBe('LLM narrative unavailable (network/API error); showing deterministic summary.');
    expect(result.notice).not.toContain('some SDK internals');
    expect(result.text).toBe(buildExecutiveSummary(data));
  });

  it('falls back to the deterministic summary, naming the failing check and claim, when grounding fails', async () => {
    const data = await buildFixture('healthy');
    const client = FakeNarrativeModelClient.returning({
      claims: [{ text: 'Unsupported claim with no citation.', groundedIn: [] }],
    });

    const result = await buildNarrative(data, client);

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.reasonKind).toBe('grounding');
    expect(result.notice).toBe('LLM narrative rejected: no cited id in claim 1; showing deterministic summary.');
    expect(result.text).toBe(buildExecutiveSummary(data));
  });

  it('never leaks the failing claim text or an invalid cited id into the notice (adjustment 1)', async () => {
    const data = await buildFixture('healthy');
    const claimText = 'SECRET_MODEL_WORDING that must never reach the report';
    const bogusId = 'SECRET_INVALID_ID_STRING';
    const client = FakeNarrativeModelClient.returning({
      claims: [{ text: claimText, groundedIn: [bogusId as never] }],
    });

    const result = await buildNarrative(data, client);

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.notice).not.toContain(claimText);
    expect(result.notice).not.toContain(bogusId);
    expect(result.notice).toBe('LLM narrative rejected: unknown id in claim 1; showing deterministic summary.');
  });

  it('appends "(+N more)" to the notice when more than one claim fails grounding (adjustment 2)', async () => {
    const data = await buildFixture('healthy');
    const client = FakeNarrativeModelClient.returning({
      claims: [
        { text: 'First unsupported claim.', groundedIn: [] },
        { text: 'Second unsupported claim.', groundedIn: [] },
      ],
    });

    const result = await buildNarrative(data, client);

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.notice).toBe('LLM narrative rejected: no cited id in claim 1 (+1 more); showing deterministic summary.');
  });

  it('renders one bullet per claim, in model order, when every claim passes grounding', async () => {
    const data = await buildFixture('healthy');
    const rowA = findRow(data, (r) => r.value !== null);
    const rowB = findRow(data, (r) => r.value !== null && r.metric !== rowA.metric);
    const claims = [
      { text: `${rowA.metric} was computed for this org.`, groundedIn: [rowA.metric] },
      { text: `${rowB.metric} was computed for this org.`, groundedIn: [rowB.metric] },
    ];
    const client = FakeNarrativeModelClient.returning({ claims });

    const result = await buildNarrative(data, client);

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('unreachable');
    expect(result.text).toBe(`- ${claims[0]!.text}\n- ${claims[1]!.text}`);
    expect(result.claims).toEqual(claims);
  });

  it("the fallback text equals plainSummary's buildExecutiveSummary output, on both fallback paths", async () => {
    const data = await buildFixture('legacy');

    const throwResult = await buildNarrative(data, FakeNarrativeModelClient.throwing(new Error('boom')));
    const groundingResult = await buildNarrative(
      data,
      FakeNarrativeModelClient.returning({ claims: [{ text: 'bad', groundedIn: [] }] }),
    );

    expect(throwResult.text).toBe(buildExecutiveSummary(data));
    expect(groundingResult.text).toBe(buildExecutiveSummary(data));
  });
});

/**
 * Pure-function tests only -- no network call, no ANTHROPIC_API_KEY. The
 * real generate() happy path is exercised by scripts/narrativeSmoke.ts
 * (manual, gated on the env var, excluded from npm run ci), not here, per
 * docs/narrative-design.md's Test strategy.
 */

import { describe, expect, it } from 'vitest';
import { MockAdapter, MockSecondSourceAdapter } from '@gtm-trust-kernel/adapters/mock.js';
import {
  AnthropicNarrativeModelClient,
  buildPrompt,
  isClaimsShape,
  listValidIds,
  resolveNarrativeModel,
} from '../../src/report/anthropicNarrativeModelClient.js';
import { MOCK_ORG_FIXTURES } from '../../src/fixtures/mockOrgs.js';
import { buildReportData } from '../../src/report/buildReport.js';
import { buildNarrativePromptInput } from '../../src/report/narrativePromptInput.js';

async function buildHealthyPromptInput() {
  const fixture = MOCK_ORG_FIXTURES.healthy;
  const adapter = new MockAdapter(fixture.orgId, fixture.data, fixture.capabilities);
  const secondSourceAdapter = fixture.secondSource
    ? new MockSecondSourceAdapter(fixture.secondSource.data, fixture.secondSource.capabilities)
    : undefined;
  const data = await buildReportData(adapter, secondSourceAdapter, {
    orgLabel: fixture.label,
    orgDescription: fixture.description,
    asOf: fixture.asOf,
  });
  return buildNarrativePromptInput(data);
}

describe('resolveNarrativeModel', () => {
  it('defaults to claude-haiku-4-5-20251001 when NARRATIVE_MODEL is unset', () => {
    expect(resolveNarrativeModel({})).toBe('claude-haiku-4-5-20251001');
  });

  it('uses NARRATIVE_MODEL when set', () => {
    expect(resolveNarrativeModel({ NARRATIVE_MODEL: 'claude-sonnet-5' })).toBe('claude-sonnet-5');
  });
});

describe('isClaimsShape', () => {
  it('accepts a well-formed claims object', () => {
    expect(isClaimsShape({ claims: [{ text: 'x', groundedIn: ['close_date_fill_rate'] }] })).toBe(true);
  });

  it('accepts zero claims', () => {
    expect(isClaimsShape({ claims: [] })).toBe(true);
  });

  it.each([
    ['null', null],
    ['a string', 'not an object'],
    ['missing claims', {}],
    ['claims not an array', { claims: 'nope' }],
    ['a claim missing groundedIn', { claims: [{ text: 'x' }] }],
    ['a claim missing text', { claims: [{ groundedIn: ['x'] }] }],
    ['a claim with non-string text', { claims: [{ text: 1, groundedIn: ['x'] }] }],
    ['a claim with a non-string id in groundedIn', { claims: [{ text: 'x', groundedIn: [1] }] }],
  ])('rejects %s', (_label, value) => {
    expect(isClaimsShape(value)).toBe(false);
  });
});

describe('AnthropicNarrativeModelClient construction', () => {
  it('throws immediately, naming the missing var, when ANTHROPIC_API_KEY is unset -- never constructs the SDK client', () => {
    expect(() => new AnthropicNarrativeModelClient({})).toThrow(/ANTHROPIC_API_KEY/);
  });
});

describe('listValidIds / buildPrompt (decisions 14/15, commit 2b)', () => {
  it('lists every metric id, every capability id, and the 3 summary ids as valid', async () => {
    const input = await buildHealthyPromptInput();

    const validIds = listValidIds(input);

    for (const metric of input.metrics) {
      expect(validIds).toContain(metric.metric);
    }
    for (const capability of input.capabilities) {
      expect(validIds).toContain(capability.id);
    }
    expect(validIds).toEqual(
      expect.arrayContaining(['summary.recordsScanned', 'summary.openSampleSize', 'summary.closedSampleSize']),
    );
  });

  it('never presents a structural field name (capabilityVerdictCounts, metricStatusCounts, gatesCapabilities) as a valid id', async () => {
    const input = await buildHealthyPromptInput();

    const validIds = listValidIds(input);

    expect(validIds).not.toContain('capabilityVerdictCounts');
    expect(validIds).not.toContain('metricStatusCounts');
    expect(validIds).not.toContain('gatesCapabilities');
  });

  it('prompt text still names and explicitly forbids those structural field names, even though they are never valid ids', async () => {
    const input = await buildHealthyPromptInput();

    const prompt = buildPrompt(input);

    expect(prompt).toContain('capabilityVerdictCounts');
    expect(prompt).toContain('metricStatusCounts');
    expect(prompt).toContain('gatesCapabilities');
  });

  it('prompt text forbids aggregate tier-count sentences while allowing per-capability tier claims', async () => {
    const input = await buildHealthyPromptInput();

    const prompt = buildPrompt(input);

    expect(prompt).toContain('2 capabilities are blocked, 5');
    expect(prompt).toContain('pipeline_risk_signals capability is blocked');
  });
});

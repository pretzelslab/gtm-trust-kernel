/**
 * narrativeRequest.ts builds the exact Messages API request the narrative
 * feature sends. These tests pin its shape and prove the real client sends
 * that same object, by swapping the client's SDK instance for a stub. No
 * network call; the key passed below is a placeholder, never a real one.
 */

import { describe, expect, it } from 'vitest';
import { MockAdapter, MockSecondSourceAdapter } from '@gtm-trust-kernel/adapters/mock.js';
import { MOCK_ORG_FIXTURES } from '../../src/fixtures/mockOrgs.js';
import { buildReportData } from '../../src/report/buildReport.js';
import { buildNarrativePromptInput } from '../../src/report/narrativePromptInput.js';
import {
  CLAIMS_SCHEMA,
  MAX_TOKENS,
  buildNarrativeRequest,
  buildPrompt,
} from '../../src/report/narrativeRequest.js';
import { AnthropicNarrativeModelClient } from '../../src/report/anthropicNarrativeModelClient.js';

async function buildHealthyReportData() {
  const fixture = MOCK_ORG_FIXTURES.healthy;
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

describe('buildNarrativeRequest', () => {
  it('is one user message carrying buildPrompt() of the prompt input, plus the model, token cap and schema', async () => {
    const data = await buildHealthyReportData();
    const request = buildNarrativeRequest(data, {});

    expect(request).toEqual({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: MAX_TOKENS,
      messages: [{ role: 'user', content: buildPrompt(buildNarrativePromptInput(data)) }],
      output_config: { format: { type: 'json_schema', schema: CLAIMS_SCHEMA } },
    });
  });

  it('uses NARRATIVE_MODEL when set', async () => {
    const data = await buildHealthyReportData();
    expect(buildNarrativeRequest(data, { NARRATIVE_MODEL: 'claude-sonnet-5' }).model).toBe('claude-sonnet-5');
  });
});

describe('AnthropicNarrativeModelClient.generate', () => {
  it('sends exactly the object buildNarrativeRequest() returns', async () => {
    const data = await buildHealthyReportData();
    const env = { ANTHROPIC_API_KEY: 'placeholder-not-a-real-key' };
    const client = new AnthropicNarrativeModelClient(env);

    const sent: unknown[] = [];
    (client as unknown as { client: { messages: { create: (params: unknown) => Promise<unknown> } } }).client = {
      messages: {
        create: async (params: unknown) => {
          sent.push(params);
          return {
            stop_reason: 'end_turn',
            usage: { input_tokens: 1, output_tokens: 1 },
            content: [{ type: 'text', text: '{"claims":[]}' }],
          };
        },
      },
    };

    await client.generate(buildNarrativePromptInput(data));

    expect(sent).toEqual([buildNarrativeRequest(data, env)]);
  });
});

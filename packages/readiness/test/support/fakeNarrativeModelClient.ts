/**
 * Test-only NarrativeModelClient: returns a fixed, injected response (or
 * throws a fixed error) instead of calling a real model. Mirrors
 * MockAdapter's role for CrmAdapter -- narrative.ts's orchestration tests
 * (commit 3) inject this instead of AnthropicNarrativeModelClient (commit
 * 2), so no test ever needs network access or ANTHROPIC_API_KEY.
 */

import type { NarrativeModelClient, NarrativeModelResponse, NarrativePromptInput } from '../../src/report/narrativeTypes.js';

export class FakeNarrativeModelClient implements NarrativeModelClient {
  private constructor(private readonly behavior: (input: NarrativePromptInput) => Promise<NarrativeModelResponse>) {}

  static returning(response: NarrativeModelResponse): FakeNarrativeModelClient {
    return new FakeNarrativeModelClient(async () => response);
  }

  static throwing(error: Error): FakeNarrativeModelClient {
    return new FakeNarrativeModelClient(async () => {
      throw error;
    });
  }

  generate(input: NarrativePromptInput): Promise<NarrativeModelResponse> {
    return this.behavior(input);
  }
}

import { describe, expect, it, vi } from 'vitest';
import {
  NARRATIVE_CONSENT_DECLINED,
  NARRATIVE_CONSENT_PROMPT,
  NARRATIVE_CONSENT_REQUIRED,
  resolveNarrativeConsent,
} from '../../src/report/narrativeConsent.js';

describe('resolveNarrativeConsent', () => {
  it('consents on --narrative-consent without prompting, terminal or not', async () => {
    for (const interactive of [true, false]) {
      const ask = vi.fn(async () => 'n');
      expect(await resolveNarrativeConsent({ flag: true, interactive, ask })).toBe('consented');
      expect(ask).not.toHaveBeenCalled();
    }
  });

  it('never prompts without a terminal, and asks for the flag instead', async () => {
    const ask = vi.fn(async () => 'y');
    expect(await resolveNarrativeConsent({ flag: false, interactive: false, ask })).toBe('needs-flag');
    expect(ask).not.toHaveBeenCalled();
  });

  it.each(['y', 'Y', 'yes', ' YES \n'])('consents on the answer %j', async (answer) => {
    expect(await resolveNarrativeConsent({ flag: false, interactive: true, ask: async () => answer })).toBe('consented');
  });

  it.each(['', 'n', 'no', 'N', 'maybe', 'yy'])('declines on the answer %j (the default is no)', async (answer) => {
    expect(await resolveNarrativeConsent({ flag: false, interactive: true, ask: async () => answer })).toBe('declined');
  });

  it('prompts with what is sent, where to, and how to preview it', async () => {
    const ask = vi.fn(async () => 'n');
    await resolveNarrativeConsent({ flag: false, interactive: true, ask });
    expect(ask).toHaveBeenCalledWith(NARRATIVE_CONSENT_PROMPT);
    expect(NARRATIVE_CONSENT_PROMPT).toContain("Anthropic's API");
    expect(NARRATIVE_CONSENT_PROMPT).toContain('no record text, no org hostname');
    expect(NARRATIVE_CONSENT_PROMPT).toContain('--narrative-preview');
    expect(NARRATIVE_CONSENT_PROMPT).toMatch(/\[y\/N\] $/);
  });
});

describe('consent messages', () => {
  it('names --narrative-consent and --narrative-preview when no one could be asked', () => {
    expect(NARRATIVE_CONSENT_REQUIRED).toContain('--narrative-consent');
    expect(NARRATIVE_CONSENT_REQUIRED).toContain('--narrative-preview');
  });

  it('says the AI summary was skipped and nothing was sent when the answer was no', () => {
    expect(NARRATIVE_CONSENT_DECLINED).toBe('AI summary skipped; nothing was sent.');
  });
});

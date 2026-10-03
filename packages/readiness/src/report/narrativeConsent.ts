/**
 * Consent for --narrative, the only path that sends data off the machine
 * (to Anthropic's API). Off by default; when asked for, it still needs one
 * of:
 *   - --narrative-consent, for unattended runs (CI, cron, scripts);
 *   - a "y" at an interactive prompt, when stdin and stderr are a terminal.
 * Without a terminal and without the flag, the run stops before anything is
 * sent. The prompt goes to stderr so --json's stdout stays clean.
 *
 * Callers check ANTHROPIC_API_KEY first (by constructing the client), so a
 * missing key is reported before anyone is asked to consent to a send that
 * couldn't happen.
 */

import { createInterface } from 'node:readline/promises';

export const NARRATIVE_CONSENT_PROMPT =
  "--narrative sends metric names, values, sample sizes and ratings (no record text, no org hostname) to Anthropic's API, " +
  'which is hosted in the US. To see the exact request first, re-run with --narrative-preview instead.\n' +
  'Send it? [y/N] ';

export const NARRATIVE_CONSENT_REQUIRED =
  "--narrative sends report metrics to Anthropic's API and needs your consent: run it in a terminal to answer the prompt, " +
  'or pass --narrative-consent. Use --narrative-preview to see exactly what would be sent. Nothing was sent and no report was written.';

export const NARRATIVE_CONSENT_DECLINED = 'Narrative not sent: consent declined. Nothing was sent and no report was written.';

export const NARRATIVE_CONSENT_WITHOUT_NARRATIVE = '--narrative-consent only applies together with --narrative.';

export type NarrativeConsentDecision = 'consented' | 'declined' | 'needs-flag';

export interface NarrativeConsentOptions {
  /** --narrative-consent was passed. */
  readonly flag: boolean;
  /** Whether a person can answer a prompt (see isInteractive()). */
  readonly interactive: boolean;
  /** Shows the prompt and resolves to the typed answer. */
  readonly ask: (prompt: string) => Promise<string>;
}

/** Pure apart from `ask`: the flag wins, a non-interactive run never prompts, and only "y"/"yes" consents. */
export async function resolveNarrativeConsent(options: NarrativeConsentOptions): Promise<NarrativeConsentDecision> {
  if (options.flag) return 'consented';
  if (!options.interactive) return 'needs-flag';
  const answer = (await options.ask(NARRATIVE_CONSENT_PROMPT)).trim().toLowerCase();
  return answer === 'y' || answer === 'yes' ? 'consented' : 'declined';
}

export function isInteractive(): boolean {
  return Boolean(process.stdin.isTTY && process.stderr.isTTY);
}

/** Asks on the terminal, writing the prompt to stderr. */
export async function askOnTerminal(prompt: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stderr });
  try {
    return await rl.question(prompt);
  } finally {
    rl.close();
  }
}

/** The stderr line for a run that stops without consent. */
export function narrativeConsentRefusal(decision: Exclude<NarrativeConsentDecision, 'consented'>): string {
  return decision === 'needs-flag' ? NARRATIVE_CONSENT_REQUIRED : NARRATIVE_CONSENT_DECLINED;
}

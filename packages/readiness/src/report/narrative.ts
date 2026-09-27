/**
 * Phase E commit 3: narrative.ts orchestration (docs/narrative-design.md
 * decisions 20-22). Builds the prompt input from ReportData, calls the
 * injected NarrativeModelClient, validates the response's grounding, and
 * falls back to the deterministic plainSummary (buildExecutiveSummary) on
 * any client throw or grounding failure (decision 8: any single failing
 * claim discards the whole narrative -- no partial assembly). This is the
 * same buildExecutiveSummary string render.ts's "Plain-English summary"
 * slot already shows today -- not buildFullNarrative, which is a separate,
 * structured multi-part shape used only by plainReport.ts's own renderer.
 *
 * The grounding-failure notice never quotes GroundingFailure.reason
 * directly, even though three of its four shapes interpolate only
 * ReportData-derived content (real metric/capability ids, fixed tier-word
 * vocabulary). The fourth ("cited id ... does not exist") echoes whatever
 * arbitrary string the model put in a claim's groundedIn array -- once that
 * string has failed the id-existence check, it is unvalidated
 * model-generated content with no format guarantee beyond "a string", and
 * could in principle carry the claim's own wording. Rather than trust that
 * shape apart from the other three, every notice is built from a fixed
 * category label (checkNameFor) plus the claim number only -- no failure
 * reason's dynamic content ever reaches the notice.
 */

import type { ReportData } from './buildReport.js';
import { validateGrounding, type GroundingFailure } from './narrativeGrounding.js';
import { buildNarrativePromptInput } from './narrativePromptInput.js';
import type { NarrativeClaim, NarrativeModelClient } from './narrativeTypes.js';
import { buildExecutiveSummary } from './plainSummary.js';

/**
 * Decision 20. `text` is present on both branches -- a caller (commit 4's
 * render layer) never has to branch on `ok` just to find prose to show; on
 * the `ok: false` branch it's the same buildExecutiveSummary output
 * plainSummary.ts already produces elsewhere in the report. `claims` is
 * only present on `ok: true` (decision 22), so a caller can walk each
 * claim's own `groundedIn` for traceability -- the fallback branch has no
 * model claims to expose.
 */
export type NarrativeResult =
  | { readonly ok: true; readonly text: string; readonly claims: readonly NarrativeClaim[] }
  | { readonly ok: false; readonly reasonKind: 'client_error' | 'grounding'; readonly notice: string; readonly text: string };

/** Decision 21: category only, never the caught error's own message. */
const CLIENT_ERROR_NOTICE = 'LLM narrative unavailable (network/API error); showing deterministic summary.';

/**
 * Maps a GroundingFailure's reason to a fixed, static category label -- see
 * this file's docblock for why the reason string itself is never quoted in
 * the notice. Prefix-matched against narrativeGrounding.ts's four known
 * failure shapes; an unrecognized shape (e.g. a future check added there
 * without a matching update here) falls back to a generic label rather than
 * the raw reason, so a new check can never accidentally leak content just by
 * not being listed here yet.
 */
const CHECK_NAME_BY_PREFIX: readonly { readonly prefix: string; readonly name: string }[] = [
  { prefix: 'claim cites no metric or capability id', name: 'no cited id' },
  { prefix: 'cited id "', name: 'unknown id' },
  { prefix: "claim's number doesn't match", name: 'ungrounded figure' },
  { prefix: 'claim uses tier word "', name: 'tier mismatch' },
];

function checkNameFor(reason: string): string {
  return CHECK_NAME_BY_PREFIX.find((c) => reason.startsWith(c.prefix))?.name ?? 'grounding check';
}

/**
 * Decision 21's grounding-notice shape, following decision 9's example
 * ("LLM narrative rejected: ungrounded figure in claim 3; showing
 * deterministic summary."). Names only the first failure -- decision 8
 * discards the whole narrative on any single failing claim, so a reader
 * doesn't need every failure enumerated to know why -- and appends "(+N
 * more)" when other claims also failed, so a reader isn't misled into
 * thinking only one claim had a problem.
 */
function formatGroundingNotice(failures: readonly GroundingFailure[]): string {
  const first = failures[0]!;
  const more = failures.length > 1 ? ` (+${failures.length - 1} more)` : '';
  return `LLM narrative rejected: ${checkNameFor(first.reason)} in claim ${first.claimIndex + 1}${more}; showing deterministic summary.`;
}

/** Decision 22: one bullet per claim, in model order -- claims are already order-preserved by validateGrounding/capClaims. */
function renderClaims(claims: readonly NarrativeClaim[]): string {
  return claims.map((claim) => `- ${claim.text}`).join('\n');
}

export async function buildNarrative(data: ReportData, client: NarrativeModelClient): Promise<NarrativeResult> {
  const fallbackText = buildExecutiveSummary(data);

  let response;
  try {
    response = await client.generate(buildNarrativePromptInput(data));
  } catch {
    return { ok: false, reasonKind: 'client_error', notice: CLIENT_ERROR_NOTICE, text: fallbackText };
  }

  const grounding = validateGrounding(response.claims, data);
  if (!grounding.ok) {
    return { ok: false, reasonKind: 'grounding', notice: formatGroundingNotice(grounding.failures), text: fallbackText };
  }

  return { ok: true, text: renderClaims(response.claims), claims: response.claims };
}

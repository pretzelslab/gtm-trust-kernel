/**
 * Deterministic, template-based plain-English translation of ReportData for
 * a non-technical (sales-leader) reader. Every string here is either a fixed
 * template literal or a fixed string selected by a pure function of already-
 * computed data (verdicts, dimensions) — no model call anywhere in this
 * file, per root CLAUDE.md rule 5 ("no model call may influence a computed
 * number") and consistent with docs/STATUS.md's Known Gaps, which notes the
 * separate, still-deferred LLM narrative pass (`narrative.ts`) does not
 * exist. This module never reads raw record text (notes/activities), only
 * capability verdicts and metric dimensions, so it carries no PII-leak risk
 * either.
 *
 * Reason derivation (`notReadyReason`) is a heuristic, not a re-derivation
 * of rubric.ts's grading rules: it looks at which of a capability's gating
 * MetricRows aren't tier 'viable' and, if they all share one dimension,
 * names that dimension's plain-English cause. If they span more than one
 * dimension (or none can be identified), it falls back to neutral wording
 * rather than guessing — see NEUTRAL_REASON.
 */

import type { MetricDimension, ReportCapabilityRow, ReportData } from './buildReport.js';
import type { CapabilityId, Verdict } from '../rubric.js';

/** Lowercase, mid-sentence phrasing — sentence-case with capitalize() for a standalone label (e.g. a list heading). */
export const PLAIN_CAPABILITY: Readonly<Record<CapabilityId, string>> = {
  grounded_account_brief: 'AI-generated account briefs',
  pipeline_risk_signals: 'pipeline risk alerts',
  close_date_realism: 'close-date reality checks',
  next_action_recommendation: 'next-step suggestions on deals',
  enablement_answer_engine: 'answers drawn from past deals',
  forecast_assistance: 'forecast support',
  bulk_hygiene_automation: 'bulk data clean-up suggestions',
  autonomous_writeback: 'fully automatic CRM updates with no human check',
};

const DIMENSION_REASON: Readonly<Record<MetricDimension, string>> = {
  D1: 'not enough data has been captured',
  D2: 'the data on hand is out of date',
  D3: 'the data is inconsistent or messy',
  D4: 'not enough history has been recorded',
  D5: "records don't line up cleanly across systems",
  D6: "notes and activity text aren't detailed enough",
  D7: 'not enough closed-deal outcomes have been recorded',
};

const NEUTRAL_REASON = "the data doesn't meet the quality bar";

const PLAIN_OUTCOME: Readonly<Record<CapabilityId, Readonly<Record<Verdict, string>>>> = {
  grounded_account_brief: {
    viable: 'Account summaries can safely cite real notes and deal history.',
    degraded:
      'Account summaries can be generated, but with thinner supporting evidence than ideal — treat them as a starting point, not a finished brief.',
    blocked: 'There is not yet enough reliable note history to safely generate an account summary.',
  },
  pipeline_risk_signals: {
    viable: 'Stalled, silent or slipping deals can be flagged automatically.',
    degraded: 'Deal-risk flags can run, but over a smaller or less certain slice of the pipeline than ideal.',
    blocked: 'There is not yet enough reliable activity data to flag at-risk deals.',
  },
  close_date_realism: {
    viable: 'Deals with unrealistic or already-passed close dates can be flagged automatically.',
    degraded: 'Close-date flags can run, but some will rest on incomplete history.',
    blocked: 'Close dates are not filled in or tracked reliably enough to flag unrealistic ones.',
  },
  next_action_recommendation: {
    viable: 'A grounded "what to do next" suggestion can be generated for open deals.',
    degraded: 'Next-step suggestions can run, but with less supporting detail than ideal.',
    blocked: 'There is not yet enough activity and note detail to safely suggest a next step.',
  },
  enablement_answer_engine: {
    viable: '"How have we handled this before" questions can be answered from real closed-deal history.',
    degraded: 'Past-deal answers can be generated, but from a thinner set of closed history than ideal.',
    blocked: 'There is not yet enough closed-deal history to answer "how have we handled this before."',
  },
  forecast_assistance: {
    viable: 'A human forecast call can be supported with evidence and outlier flags from real pipeline data.',
    degraded: 'Forecast support can run, but on a less complete picture of the pipeline than ideal.',
    blocked: 'The pipeline data is not yet complete enough to support a forecast call.',
  },
  bulk_hygiene_automation: {
    viable: 'Batch fixes for stale or missing data can be proposed for a person to approve.',
    degraded: 'Batch fixes can be proposed, but over a smaller or less certain slice of records than ideal.',
    blocked: 'The data is not yet clean enough to safely propose batch fixes.',
  },
  autonomous_writeback: {
    viable:
      'The data is clean and trustworthy enough that AI writing to the CRM without a per-change human check could be considered — still worth extra caution before turning this on.',
    degraded: 'AI should not yet write to the CRM without a person checking every change.',
    blocked: 'AI should not write to the CRM without a person checking every change.',
  },
};

function capitalize(s: string): string {
  return s.length === 0 ? s : s.charAt(0).toUpperCase() + s.slice(1);
}

function joinPlain(phrases: readonly string[]): string {
  if (phrases.length === 0) return '';
  if (phrases.length === 1) return phrases[0]!;
  if (phrases.length === 2) return `${phrases[0]} and ${phrases[1]}`;
  return `${phrases.slice(0, -1).join(', ')}, and ${phrases[phrases.length - 1]}`;
}

/**
 * Which plain-English cause best explains why a capability isn't viable —
 * see the module docblock. Only called for a non-viable capability.
 */
function notReadyReason(data: ReportData, capabilityId: CapabilityId): string {
  const gatingRows = data.metrics.filter((m) => m.gatesCapabilities.some((g) => g.id === capabilityId));
  const failingDimensions = new Set(gatingRows.filter((m) => m.tier !== 'viable').map((m) => m.dimension));
  if (failingDimensions.size === 1) {
    const [dimension] = failingDimensions;
    return DIMENSION_REASON[dimension!];
  }
  return NEUTRAL_REASON;
}

/**
 * The blocked-bucket's aggregate reason: named only when at least half of
 * the not-ready capabilities share the same per-capability reason (see
 * notReadyReason); otherwise neutral wording, since naming one cause for a
 * genuinely mixed set of blockers would overstate what's actually known.
 */
function aggregateReason(data: ReportData, notReady: readonly ReportCapabilityRow[]): string {
  const reasons = notReady.map((c) => notReadyReason(data, c.id));
  const counts = new Map<string, number>();
  for (const reason of reasons) counts.set(reason, (counts.get(reason) ?? 0) + 1);
  let best = NEUTRAL_REASON;
  let bestCount = 0;
  for (const [reason, count] of counts) {
    if (count > bestCount) {
      best = reason;
      bestCount = count;
    }
  }
  return bestCount / reasons.length >= 0.5 ? best : NEUTRAL_REASON;
}

/**
 * 3-5 plain-English sentences for a sales-leader reader: no metric names,
 * no tier labels ("viable"/"degraded"/"blocked" never appear). Three
 * buckets — ready (viable), usable with caution (degraded), not ready
 * (blocked) — each get at most one self-contained sentence, omitted when
 * that bucket is empty (1-3 sentences total there); a degraded capability
 * is never described as "not ready" (that word only appears in the
 * blocked-bucket sentence, which never lists a degraded capability). The
 * fixed closing line is itself two sentences, so the overall range is
 * 3 (one populated bucket + closing) to 5 (all three buckets + closing).
 */
export function buildExecutiveSummary(data: ReportData): string {
  const ready = data.capabilities.filter((c) => c.verdict === 'viable');
  const caution = data.capabilities.filter((c) => c.verdict === 'degraded');
  const notReady = data.capabilities.filter((c) => c.verdict === 'blocked');

  const sentences: string[] = [];

  if (ready.length > 0) {
    sentences.push(`There is enough good-quality data to support ${joinPlain(ready.map((c) => PLAIN_CAPABILITY[c.id]))}.`);
  }

  if (caution.length > 0) {
    sentences.push(
      `The data can also support ${joinPlain(caution.map((c) => PLAIN_CAPABILITY[c.id]))}, but treat the output with caution — it's thinner or less certain than ideal for now.`,
    );
  }

  if (notReady.length > 0) {
    const reason = aggregateReason(data, notReady);
    const verb = notReady.length === 1 ? 'is' : 'are';
    sentences.push(
      `${capitalize(reason)} right now, so ${joinPlain(notReady.map((c) => PLAIN_CAPABILITY[c.id]))} ${verb} not ready yet.`,
    );
  }

  sentences.push("This report only reads your CRM data. It doesn't change anything.");

  return sentences.join(' ');
}

export interface CapabilityOutcome {
  readonly label: string;
  readonly outcome: string;
}

export interface FullNarrative {
  readonly summary: string;
  readonly ready: readonly CapabilityOutcome[];
  readonly caution: readonly CapabilityOutcome[];
  readonly notReady: readonly CapabilityOutcome[];
}

function outcomeFor(data: ReportData, c: ReportCapabilityRow): CapabilityOutcome {
  const base = PLAIN_OUTCOME[c.id][c.verdict];
  const outcome = c.verdict === 'viable' ? base : `${base} Right now, ${notReadyReason(data, c.id)}.`;
  return { label: capitalize(PLAIN_CAPABILITY[c.id]), outcome };
}

/** Full narrative for the plain HTML report: the executive summary, plus each capability's outcome grouped by bucket. */
export function buildFullNarrative(data: ReportData): FullNarrative {
  const ready = data.capabilities.filter((c) => c.verdict === 'viable').map((c) => outcomeFor(data, c));
  const caution = data.capabilities.filter((c) => c.verdict === 'degraded').map((c) => outcomeFor(data, c));
  const notReady = data.capabilities.filter((c) => c.verdict === 'blocked').map((c) => outcomeFor(data, c));
  return { summary: buildExecutiveSummary(data), ready, caution, notReady };
}

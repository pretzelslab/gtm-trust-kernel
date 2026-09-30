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

import { gateVerdictOf, type MetricDimension, type ReportCapabilityRow, type ReportData } from './buildReport.js';
import type { CapabilityId, CapabilityVerdict } from '../rubric.js';

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

const PLAIN_OUTCOME: Readonly<Record<CapabilityId, Readonly<Record<CapabilityVerdict, string>>>> = {
  grounded_account_brief: {
    viable: 'Account summaries can safely cite real notes and deal history.',
    degraded:
      'Account summaries can be generated, but with thinner supporting evidence than ideal — treat them as a starting point, not a finished brief.',
    blocked: 'There is not yet enough reliable note history to safely generate an account summary.',
    not_measured: "This scan can't see all the notes or account records an account summary would draw on, so it can't say yet whether one would be safe.",
  },
  pipeline_risk_signals: {
    viable: 'Stalled, silent or slipping deals can be flagged automatically.',
    degraded: 'Deal-risk flags can run, but over a smaller or less certain slice of the pipeline than ideal.',
    blocked: 'There is not yet enough reliable activity data to flag at-risk deals.',
    not_measured: "This scan can't see how activity is captured in your CRM, so it can't say yet whether a quiet deal really means a stalled one.",
  },
  close_date_realism: {
    viable: 'Deals with unrealistic or already-passed close dates can be flagged automatically.',
    degraded: 'Close-date flags can run, but some will rest on incomplete history.',
    blocked: 'Close dates are not filled in or tracked reliably enough to flag unrealistic ones.',
    not_measured: "This scan can't see how close dates are tracked over time, so it can't say yet whether slipping dates could be flagged.",
  },
  next_action_recommendation: {
    viable: 'A grounded "what to do next" suggestion can be generated for open deals.',
    degraded: 'Next-step suggestions can run, but with less supporting detail than ideal.',
    blocked: 'There is not yet enough activity and note detail to safely suggest a next step.',
    not_measured: "This scan can't see all the activity and note detail a next-step suggestion would rely on, so it can't say yet whether one would be safe.",
  },
  enablement_answer_engine: {
    viable: '"How have we handled this before" questions can be answered from real closed-deal history.',
    degraded: 'Past-deal answers can be generated, but from a thinner set of closed history than ideal.',
    blocked: 'There is not yet enough closed-deal history to answer "how have we handled this before."',
    not_measured: "This scan can't see all the closed-deal history these answers would draw on, so it can't say yet whether they would be reliable.",
  },
  forecast_assistance: {
    viable: 'A human forecast call can be supported with evidence and outlier flags from real pipeline data.',
    degraded: 'Forecast support can run, but on a less complete picture of the pipeline than ideal.',
    blocked: 'The pipeline data is not yet complete enough to support a forecast call.',
    not_measured: "This scan can't see all the pipeline data forecast support would need, so it can't say yet whether it would help.",
  },
  bulk_hygiene_automation: {
    viable: 'Batch fixes for stale or missing data can be proposed for a person to approve.',
    degraded: 'Batch fixes can be proposed, but over a smaller or less certain slice of records than ideal.',
    blocked: 'The data is not yet clean enough to safely propose batch fixes.',
    not_measured: "This scan can't see all the records batch fixes would touch, so it can't say yet whether proposing them would be safe.",
  },
  autonomous_writeback: {
    viable:
      'The data is clean and trustworthy enough that AI writing to the CRM without a per-change human check could be considered — still worth extra caution before turning this on.',
    // Fail-safe wording (see effectiveBucket): a degraded verdict here is still bucketed as
    // Not ready, so this line must read as a not-ready line, not a caution line.
    degraded: 'AI should not write to the CRM without a person checking every change yet.',
    blocked: 'AI should not write to the CRM without a person checking every change.',
    // Fail-safe wording, same as degraded above: not measured is also bucketed as Not ready.
    not_measured: "AI should not write to the CRM without a person checking every change, and this scan can't see everything needed to judge otherwise.",
  },
};

function capitalize(s: string): string {
  return s.length === 0 ? s : s.charAt(0).toUpperCase() + s.slice(1);
}

type Bucket = 'ready' | 'caution' | 'notMeasured' | 'notReady';

/** Degraded or not measured: either way, AI writing to the CRM is not ready (see effectiveBucket). */
function isWritebackFailSafe(c: ReportCapabilityRow): boolean {
  return c.id === 'autonomous_writeback' && (c.verdict === 'degraded' || c.verdict === 'not_measured');
}

/**
 * Fail-safe override, this plain layer only — does not touch rubric.ts or
 * the tabular verdict, which both still show autonomous_writeback as
 * "degraded" when that's what it graded as. Here, a degraded
 * autonomous_writeback is bucketed as Not ready, never Usable with
 * caution: "usable with caution" implies a human spot-checks some of the
 * output, but for AI writing to the CRM, a human must check every change
 * regardless of how close to viable the underlying data is.
 */
function effectiveBucket(c: ReportCapabilityRow): Bucket {
  if (isWritebackFailSafe(c)) return 'notReady';
  if (c.verdict === 'viable') return 'ready';
  if (c.verdict === 'degraded') return 'caution';
  if (c.verdict === 'not_measured') return 'notMeasured';
  return 'notReady';
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
 * The not-ready bucket's aggregate reason: named only when strictly more
 * than half of its capabilities share the same per-capability reason (see
 * notReadyReason); otherwise neutral wording. A tie (e.g. 1-of-2 each for
 * two different reasons) does not qualify — "more than half" rules it out
 * deliberately, rather than picking one arbitrarily.
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
  return bestCount / reasons.length > 0.5 ? best : NEUTRAL_REASON;
}

/** The writeback fail-safe's own not-ready clause — deliberately not a data-quality claim (see below). */
const WRITEBACK_NOT_READY_CLAUSE = 'fully automatic CRM updates stay off until a person checks every change';

/**
 * 3-7 plain-English sentences for a sales-leader reader: no metric names,
 * no tier labels ("viable"/"degraded"/"blocked" never appear). Four
 * buckets (see effectiveBucket) — ready, usable with caution, can't tell
 * yet (not measured: the scan can't see the data), not ready —
 * each get at most one sentence, omitted when empty (the caution sentence
 * is two sentences on its own once populated); a degraded capability is
 * never described as "not ready" EXCEPT autonomous_writeback, which the
 * fail-safe always buckets as not ready when degraded — but it gets its
 * own fixed clause there (WRITEBACK_NOT_READY_CLAUSE), never the aggregate
 * data-quality reason: it isn't blocked because of a data problem, so
 * `aggregateReason` only ever sees the genuinely-blocked capabilities,
 * both for naming a reason and for the >50% majority count. When a bucket
 * contains every capability, its sentence collapses to a fixed "all
 * N"/"none of the N" line instead of enumerating. The fixed closing line
 * is itself two sentences, so the overall range is 3 (one populated
 * single-sentence bucket + closing) to 7 (all four buckets, caution's two
 * sentences included, + closing). A not-measured autonomous_writeback is
 * bucketed as not ready by the same fail-safe as a degraded one.
 */
export function buildExecutiveSummary(data: ReportData): string {
  const total = data.capabilities.length;
  const ready = data.capabilities.filter((c) => effectiveBucket(c) === 'ready');
  const caution = data.capabilities.filter((c) => effectiveBucket(c) === 'caution');
  const notMeasured = data.capabilities.filter((c) => effectiveBucket(c) === 'notMeasured');
  const notReady = data.capabilities.filter((c) => effectiveBucket(c) === 'notReady');

  const sentences: string[] = [];

  if (ready.length > 0) {
    sentences.push(
      ready.length === total
        ? `The data can support all ${total} AI-assisted sales tools.`
        : `There is enough good-quality data to support ${joinPlain(ready.map((c) => PLAIN_CAPABILITY[c.id]))}.`,
    );
  }

  if (caution.length > 0) {
    sentences.push(
      `The data can also support ${joinPlain(caution.map((c) => PLAIN_CAPABILITY[c.id]))}, but treat the output with caution. It's thinner or less certain than ideal for now.`,
    );
  }

  if (notMeasured.length > 0) {
    sentences.push(
      notMeasured.length === total
        ? `This scan can't see enough of the data to judge any of the ${total} AI-assisted sales tools yet.`
        : `This scan can't see some of the data behind ${joinPlain(notMeasured.map((c) => PLAIN_CAPABILITY[c.id]))}, so it can't say yet whether ${notMeasured.length === 1 ? 'that is' : 'those are'} ready.`,
    );
  }

  if (notReady.length > 0) {
    if (notReady.length === total) {
      sentences.push(`None of the ${total} AI-assisted sales tools are ready yet.`);
    } else {
      const writebackFailSafe = notReady.find(isWritebackFailSafe);
      const genuine = notReady.filter((c) => !isWritebackFailSafe(c));

      if (genuine.length > 0) {
        const reason = aggregateReason(data, genuine);
        const verb = genuine.length === 1 ? 'is' : 'are';
        const base = `${capitalize(reason)} right now, so ${joinPlain(genuine.map((c) => PLAIN_CAPABILITY[c.id]))} ${verb} not ready yet`;
        sentences.push(writebackFailSafe ? `${base}, and ${WRITEBACK_NOT_READY_CLAUSE}.` : `${base}.`);
      } else if (writebackFailSafe) {
        sentences.push(`${capitalize(WRITEBACK_NOT_READY_CLAUSE)}.`);
      }
    }
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
  readonly notMeasured: readonly CapabilityOutcome[];
  readonly notReady: readonly CapabilityOutcome[];
}

/** Added for a not-measured capability when some of the gates the scan could see are thinner than ideal. */
const NOT_MEASURED_THIN_CLAUSE = 'Of the data it could see, some is thinner than ideal.';

function hasDegradedGate(data: ReportData, capabilityId: CapabilityId): boolean {
  return data.metrics.some(
    (m) => m.gatesCapabilities.some((g) => g.id === capabilityId) && gateVerdictOf(m) === 'degraded',
  );
}

function outcomeFor(data: ReportData, c: ReportCapabilityRow, bucket: Bucket): CapabilityOutcome {
  const base = PLAIN_OUTCOME[c.id][c.verdict];
  let outcome: string;
  if (bucket === 'ready') outcome = base;
  else if (bucket === 'notMeasured') outcome = hasDegradedGate(data, c.id) ? `${base} ${NOT_MEASURED_THIN_CLAUSE}` : base;
  else outcome = `${base} Right now, ${notReadyReason(data, c.id)}.`;
  return { label: capitalize(PLAIN_CAPABILITY[c.id]), outcome };
}

/** Full narrative for the plain HTML report: the executive summary, plus each capability's outcome grouped by bucket. */
export function buildFullNarrative(data: ReportData): FullNarrative {
  const ready: CapabilityOutcome[] = [];
  const caution: CapabilityOutcome[] = [];
  const notMeasured: CapabilityOutcome[] = [];
  const notReady: CapabilityOutcome[] = [];
  for (const c of data.capabilities) {
    const bucket = effectiveBucket(c);
    const outcome = outcomeFor(data, c, bucket);
    if (bucket === 'ready') ready.push(outcome);
    else if (bucket === 'caution') caution.push(outcome);
    else if (bucket === 'notMeasured') notMeasured.push(outcome);
    else notReady.push(outcome);
  }
  return { summary: buildExecutiveSummary(data), ready, caution, notMeasured, notReady };
}

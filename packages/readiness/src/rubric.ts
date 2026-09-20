/**
 * PROTECTED FILE. Claude must not edit this file or invent values in it.
 *
 * This is the rubric: every threshold that turns a measured number into a
 * verdict about someone's data. It is the intellectual property of this tool.
 * A model guessing these produces plausible nonsense that survives review,
 * so every value is set by hand, with a written rationale.
 *
 * HOW TO FILL THIS IN
 * -------------------
 * Each threshold ships as PENDING with a `question` and 2-3 `candidates`.
 * You are choosing between framed options, not inventing from a blank page.
 * Replace PENDING with a number and write one sentence in `rationale`.
 *
 * `rubric.test.ts` FAILS while any PENDING remains. That is deliberate: the
 * build stays red until the judgment has actually been made.
 */

export const PENDING = Symbol('PENDING_THRESHOLD');
export type ThresholdValue = number | typeof PENDING;

// ---------------------------------------------------------------------------
// Metrics
// ---------------------------------------------------------------------------

export type MetricId =
  // D1 coverage
  | 'close_date_fill_rate'
  | 'amount_fill_rate'
  | 'next_step_fill_rate'
  | 'activity_capture_rate'
  | 'contact_linkage_rate'
  | 'note_coverage_rate'
  // D2 freshness
  | 'median_days_since_modified'
  | 'past_due_close_date_rate'
  | 'median_next_step_age_days'
  // D3 consistency
  | 'stage_mapping_coverage'
  | 'duplicate_account_rate'
  | 'stage_activity_contradiction_rate'
  | 'round_amount_rate'
  // D4 history
  | 'close_date_history_enabled'
  | 'stage_history_months'
  | 'owner_history_enabled'
  // D5 joinability
  | 'contact_identity_resolution_rate'
  | 'account_resolution_rate'
  | 'activity_attribution_rate'
  | 'temporal_alignment_ok'
  // D6 text substrate
  | 'substantive_note_rate'
  | 'median_note_length_chars'
  | 'pii_density'
  | 'untrusted_text_ratio'
  // D7 labels
  | 'closed_deal_count_12m'
  | 'win_rate_dispersion'
  | 'outcome_evidence_retention_rate';

export type Unit = 'rate' | 'days' | 'months' | 'count' | 'chars' | 'bool';

export interface Threshold {
  readonly metric: MetricId;
  readonly unit: Unit;
  /** Which side of the number is good. Drives comparison direction. */
  readonly direction: 'higher_is_better' | 'lower_is_better';
  /** At or better than this: the gate is Viable. */
  readonly viableAt: ThresholdValue;
  /** At or better than this but worse than viableAt: Degraded. Worse: Blocked. */
  readonly degradedAt: ThresholdValue;
  /** The judgment call you are making. */
  readonly question: string;
  /** Framed options. Pick one or pick your own; write why in rationale. */
  readonly candidates: readonly { readonly value: number; readonly implication: string }[];
  /** YOU write this. One sentence. Empty string fails the test. */
  readonly rationale: string;
  /** Shown to the user when this gate is not Viable. */
  readonly remediation: string;
}

// ---------------------------------------------------------------------------
// Threshold table
// ---------------------------------------------------------------------------

export const THRESHOLDS: Readonly<Record<MetricId, Threshold>> = {
  close_date_fill_rate: {
    metric: 'close_date_fill_rate',
    unit: 'rate',
    direction: 'higher_is_better',
    viableAt: PENDING,
    degradedAt: PENDING,
    question:
      'What share of open opportunities must have a close date before date-aware capabilities are trustworthy?',
    candidates: [
      { value: 0.95, implication: 'Strict. Most orgs fail. Verdicts read as harsh but defensible.' },
      { value: 0.9, implication: 'Common real-world bar. Leaves a 10% blind spot you must disclose.' },
      { value: 0.8, implication: 'Permissive. One deal in five is invisible to forecast logic.' },
    ],
    rationale: '',
    remediation: 'Make Close Date required on the opportunity page layout and backfill open records.',
  },

  amount_fill_rate: {
    metric: 'amount_fill_rate',
    unit: 'rate',
    direction: 'higher_is_better',
    viableAt: PENDING,
    degradedAt: PENDING,
    question: 'What share of open opportunities must carry an amount for value-weighted analysis?',
    candidates: [
      { value: 0.9, implication: 'Value-weighted risk is meaningful.' },
      { value: 0.75, implication: 'Counts work, dollar-weighted views carry a stated caveat.' },
    ],
    rationale: '',
    remediation: 'Require Amount at stage entry, or accept count-weighted analysis only.',
  },

  next_step_fill_rate: {
    metric: 'next_step_fill_rate',
    unit: 'rate',
    direction: 'higher_is_better',
    viableAt: PENDING,
    degradedAt: PENDING,
    question: 'How widely must Next Step be used before recommending next actions is worth doing?',
    candidates: [
      { value: 0.6, implication: 'There is enough rep intent to reason against.' },
      { value: 0.4, implication: 'Sparse. Recommendations will often have no prior to contradict.' },
      { value: 0.2, implication: 'Effectively unused. The tool is guessing rather than reviewing.' },
    ],
    rationale: '',
    remediation: 'Adopt Next Step in the deal review ritual before expecting AI to improve it.',
  },

  activity_capture_rate: {
    metric: 'activity_capture_rate',
    unit: 'rate',
    direction: 'higher_is_better',
    viableAt: PENDING,
    degradedAt: PENDING,
    question:
      'What share of open opportunities need a logged activity in the last 30 days for engagement signals to mean anything?',
    candidates: [
      { value: 0.8, implication: 'Auto-capture is almost certainly in place. Signals are reliable.' },
      { value: 0.6, implication: 'Partial capture. Silence may mean "unlogged", not "stalled".' },
      { value: 0.4, implication: 'Manual logging. Every silence signal is suspect.' },
    ],
    rationale: '',
    remediation: 'Turn on Einstein Activity Capture or an equivalent before trusting silence as a signal.',
  },

  contact_linkage_rate: {
    metric: 'contact_linkage_rate',
    unit: 'rate',
    direction: 'higher_is_better',
    viableAt: PENDING,
    degradedAt: PENDING,
    question: 'What share of opportunities need at least one linked contact for multithreading analysis?',
    candidates: [
      { value: 0.9, implication: 'Buying-group analysis is viable.' },
      { value: 0.7, implication: 'Single-threading detection produces false positives.' },
    ],
    rationale: '',
    remediation: 'Enforce contact roles on opportunities at stage gate.',
  },

  note_coverage_rate: {
    metric: 'note_coverage_rate',
    unit: 'rate',
    direction: 'higher_is_better',
    viableAt: PENDING,
    degradedAt: PENDING,
    question: 'What share of open opportunities need any note for qualitative reasoning to be possible?',
    candidates: [
      { value: 0.7, implication: 'Most deals have narrative. Briefs will be substantive.' },
      { value: 0.4, implication: 'Briefs will abstain on the majority of the pipeline.' },
    ],
    rationale: '',
    remediation: 'Capture call notes into CRM, or connect the conversation intelligence tool.',
  },

  median_days_since_modified: {
    metric: 'median_days_since_modified',
    unit: 'days',
    direction: 'lower_is_better',
    viableAt: PENDING,
    degradedAt: PENDING,
    question: 'How stale can the median open opportunity be before the CRM stops describing reality?',
    candidates: [
      { value: 7, implication: 'Weekly hygiene discipline. Rare.' },
      { value: 14, implication: 'Typical for a well-run team on a two-week cadence.' },
      { value: 30, implication: 'Monthly-only updates. Anything time-sensitive is guesswork.' },
    ],
    rationale: '',
    remediation: 'Establish a weekly pipeline hygiene ritual before layering AI on top.',
  },

  past_due_close_date_rate: {
    metric: 'past_due_close_date_rate',
    unit: 'rate',
    direction: 'lower_is_better',
    viableAt: PENDING,
    degradedAt: PENDING,
    question:
      'What share of open opportunities can have a close date already in the past before forecast logic is meaningless?',
    candidates: [
      { value: 0.02, implication: 'Strict. Signals active date discipline.' },
      { value: 0.05, implication: 'Tolerant of normal slippage between reviews.' },
      { value: 0.15, implication: 'Dates are decorative. Any date-based verdict is noise.' },
    ],
    rationale: '',
    remediation: 'Sweep past-due close dates before enabling forecast assistance.',
  },

  median_next_step_age_days: {
    metric: 'median_next_step_age_days',
    unit: 'days',
    direction: 'lower_is_better',
    viableAt: PENDING,
    degradedAt: PENDING,
    question: 'How old can the median Next Step be before it describes a deal that no longer exists?',
    candidates: [
      { value: 14, implication: 'Aligned to a two-week review cadence.' },
      { value: 30, implication: 'Monthly. Next Step is a record of intent, not of state.' },
    ],
    rationale: '',
    remediation: 'Refresh Next Step at each pipeline review.',
  },

  stage_mapping_coverage: {
    metric: 'stage_mapping_coverage',
    unit: 'rate',
    direction: 'higher_is_better',
    viableAt: PENDING,
    degradedAt: PENDING,
    question:
      'What share of opportunities must sit in a stage mapped to the canonical ladder before stage logic is safe?',
    candidates: [
      { value: 1.0, implication: 'No unmapped stages at all. Clean but requires config work up front.' },
      { value: 0.95, implication: 'Tolerates a long tail of legacy stages.' },
      { value: 0.85, implication: 'One deal in seven has stage logic suppressed.' },
    ],
    rationale: '',
    remediation: 'Map remaining vendor stages, or retire unused ones.',
  },

  duplicate_account_rate: {
    metric: 'duplicate_account_rate',
    unit: 'rate',
    direction: 'lower_is_better',
    viableAt: PENDING,
    degradedAt: PENDING,
    question: 'How much account duplication can exist before account-level briefs are wrong rather than incomplete?',
    candidates: [
      { value: 0.02, implication: 'Dedupe process is working.' },
      { value: 0.05, implication: 'Typical. Briefs occasionally miss history on the sibling record.' },
      { value: 0.1, implication: 'Account context is unreliable. Fix before anything account-level.' },
    ],
    rationale: '',
    remediation: 'Run domain-based dedupe on accounts and merge before enabling account briefs.',
  },

  stage_activity_contradiction_rate: {
    metric: 'stage_activity_contradiction_rate',
    unit: 'rate',
    direction: 'lower_is_better',
    viableAt: PENDING,
    degradedAt: PENDING,
    question:
      'What share of late-stage deals can have no meetings logged before stage data is fiction?',
    candidates: [
      { value: 0.05, implication: 'Stage means what it says.' },
      { value: 0.2, implication: 'Stage is partly aspirational. Risk scoring will disagree with reps often.' },
    ],
    rationale: '',
    remediation: 'Audit late-stage deals with no meetings; usually a stage-gate discipline problem.',
  },

  round_amount_rate: {
    metric: 'round_amount_rate',
    unit: 'rate',
    direction: 'lower_is_better',
    viableAt: PENDING,
    degradedAt: PENDING,
    question:
      'What share of amounts can be suspiciously round (a fabrication tell) before value data is untrustworthy?',
    candidates: [
      { value: 0.3, implication: 'Some round numbers are legitimate list pricing.' },
      { value: 0.6, implication: 'Most amounts are placeholders, not quotes.' },
    ],
    rationale: '',
    remediation: 'Source amounts from CPQ or quotes rather than manual entry.',
  },

  close_date_history_enabled: {
    metric: 'close_date_history_enabled',
    unit: 'bool',
    direction: 'higher_is_better',
    viableAt: PENDING,
    degradedAt: PENDING,
    question:
      'Is field history tracking on Close Date required (1) or optional (0) for slip detection? It is off by default in most orgs.',
    candidates: [
      { value: 1, implication: 'Required. Without it, slip detection is impossible, not merely degraded.' },
      { value: 0, implication: 'Optional. Accept a weaker proxy from stage history timestamps.' },
    ],
    rationale: '',
    remediation: 'Enable field history tracking on Close Date. History accrues only from the day you turn it on.',
  },

  stage_history_months: {
    metric: 'stage_history_months',
    unit: 'months',
    direction: 'higher_is_better',
    viableAt: PENDING,
    degradedAt: PENDING,
    question: 'How many months of stage history are needed to compute a cohort median stage age?',
    candidates: [
      { value: 12, implication: 'A full cycle including seasonality.' },
      { value: 6, implication: 'Enough for a median, not enough for seasonal comparison.' },
      { value: 3, implication: 'Thin. Cohort medians will be unstable.' },
    ],
    rationale: '',
    remediation: 'Wait for history to accrue, or import from a warehouse if one exists.',
  },

  owner_history_enabled: {
    metric: 'owner_history_enabled',
    unit: 'bool',
    direction: 'higher_is_better',
    viableAt: PENDING,
    degradedAt: PENDING,
    question: 'Is owner change history required (1) or optional (0) for continuity risk signals?',
    candidates: [
      { value: 1, implication: 'Required. Owner churn is a strong predictor and cannot be inferred.' },
      { value: 0, implication: 'Optional. Suppress the continuity signal and say so.' },
    ],
    rationale: '',
    remediation: 'Enable field history tracking on Opportunity Owner.',
  },

  contact_identity_resolution_rate: {
    metric: 'contact_identity_resolution_rate',
    unit: 'rate',
    direction: 'higher_is_better',
    viableAt: PENDING,
    degradedAt: PENDING,
    question:
      'What share of contacts must resolve across CRM and the engagement tool before cross-system reasoning is honest?',
    candidates: [
      { value: 0.9, implication: 'Cross-system signals are trustworthy.' },
      { value: 0.75, implication: 'One contact in four is invisible. Disclose the blind spot prominently.' },
      { value: 0.5, implication: 'Cross-system capability should be reported as Blocked.' },
    ],
    rationale: '',
    remediation: 'Normalise email casing and aliases; reconcile the contact sync mapping.',
  },

  account_resolution_rate: {
    metric: 'account_resolution_rate',
    unit: 'rate',
    direction: 'higher_is_better',
    viableAt: PENDING,
    degradedAt: PENDING,
    question: 'What share of accounts must resolve by domain across systems?',
    candidates: [
      { value: 0.9, implication: 'Account-level joins are safe.' },
      { value: 0.7, implication: 'Subsidiaries and shared domains create real gaps.' },
    ],
    rationale: '',
    remediation: 'Populate account domain consistently; handle multi-domain parents explicitly.',
  },

  activity_attribution_rate: {
    metric: 'activity_attribution_rate',
    unit: 'rate',
    direction: 'higher_is_better',
    viableAt: PENDING,
    degradedAt: PENDING,
    question:
      'What share of engagement-tool activities must land on a CRM opportunity for deal-level engagement analysis?',
    candidates: [
      { value: 0.7, implication: 'Deal-level engagement is measurable.' },
      { value: 0.5, implication: 'Account-level only. Deal-level engagement claims are unsupported.' },
    ],
    rationale: '',
    remediation: 'Fix activity-to-opportunity association rules in the sync configuration.',
  },

  temporal_alignment_ok: {
    metric: 'temporal_alignment_ok',
    unit: 'bool',
    direction: 'higher_is_better',
    viableAt: PENDING,
    degradedAt: PENDING,
    question: 'Must timestamps be timezone-consistent across sources (1) or is a tolerance acceptable (0)?',
    candidates: [
      { value: 1, implication: 'Required. Ordering errors silently corrupt sequence-based signals.' },
      { value: 0, implication: 'Tolerate, and widen every time window to absorb the error.' },
    ],
    rationale: '',
    remediation: 'Normalise all timestamps to UTC at ingestion in both systems.',
  },

  substantive_note_rate: {
    metric: 'substantive_note_rate',
    unit: 'rate',
    direction: 'higher_is_better',
    viableAt: PENDING,
    degradedAt: PENDING,
    question:
      'What share of notes must be substantive rather than filler before an LLM has something worth reading?',
    candidates: [
      { value: 0.7, implication: 'Rich narrative. Grounded briefs will be strong.' },
      { value: 0.5, implication: 'Half the corpus is noise. Briefs will be thin but honest.' },
      { value: 0.3, implication: 'Report the text-dependent capabilities as Blocked.' },
    ],
    rationale: '',
    remediation: 'Note quality is a coaching problem, not a tooling one. Address it before expecting AI value.',
  },

  median_note_length_chars: {
    metric: 'median_note_length_chars',
    unit: 'chars',
    direction: 'higher_is_better',
    viableAt: PENDING,
    degradedAt: PENDING,
    question: 'What median note length indicates real content rather than a logged stub?',
    candidates: [
      { value: 200, implication: 'A few real sentences.' },
      { value: 80, implication: 'One line. Enough to cite, not enough to reason over.' },
    ],
    rationale: '',
    remediation: 'Capture structured call summaries rather than one-line stubs.',
  },

  pii_density: {
    metric: 'pii_density',
    unit: 'rate',
    direction: 'lower_is_better',
    viableAt: PENDING,
    degradedAt: PENDING,
    question:
      'Above what share of records containing detectable PII does a deployment require mandatory redaction rather than optional?',
    candidates: [
      { value: 0.05, implication: 'Cautious. Redaction becomes mandatory early.' },
      { value: 0.2, implication: 'Typical B2B CRM. Redaction still recommended.' },
    ],
    rationale: '',
    remediation: 'Enable field-level redaction before any text leaves the tenant boundary.',
  },

  untrusted_text_ratio: {
    metric: 'untrusted_text_ratio',
    unit: 'rate',
    direction: 'lower_is_better',
    viableAt: PENDING,
    degradedAt: PENDING,
    question:
      'Above what share of externally-sourced text does injection defence stop being optional hardening and become a prerequisite?',
    candidates: [
      { value: 0.2, implication: 'Conservative. Defence is required in most orgs, which is arguably correct.' },
      { value: 0.5, implication: 'Only flags orgs where inbound email dominates the corpus.' },
    ],
    rationale: '',
    remediation: 'Deploy trust-tier tagging and structural injection defence before enabling write-back.',
  },

  closed_deal_count_12m: {
    metric: 'closed_deal_count_12m',
    unit: 'count',
    direction: 'higher_is_better',
    viableAt: PENDING,
    degradedAt: PENDING,
    question: 'How many closed deals in 12 months are needed to calibrate or evaluate anything?',
    candidates: [
      { value: 200, implication: 'Enough to slice by stage and segment.' },
      { value: 100, implication: 'Enough for aggregate calibration, not for slicing.' },
      { value: 50, implication: 'Directional only. Say so explicitly in the report.' },
    ],
    rationale: '',
    remediation: 'Too few outcomes to evaluate against. Revisit after another quarter or two.',
  },

  win_rate_dispersion: {
    metric: 'win_rate_dispersion',
    unit: 'rate',
    direction: 'higher_is_better',
    viableAt: PENDING,
    degradedAt: PENDING,
    question:
      'How much must win rate vary across stages before stage carries predictive signal? Flat win rates mean stage is theatre.',
    candidates: [
      { value: 0.3, implication: 'Stage is strongly predictive.' },
      { value: 0.15, implication: 'Weak but present signal.' },
    ],
    rationale: '',
    remediation: 'Flat win rates across stages usually mean stage definitions are not being applied consistently.',
  },

  outcome_evidence_retention_rate: {
    metric: 'outcome_evidence_retention_rate',
    unit: 'rate',
    direction: 'higher_is_better',
    viableAt: PENDING,
    degradedAt: PENDING,
    question:
      'What share of closed deals must still have their activity and note history for an enablement corpus to exist?',
    candidates: [
      { value: 0.8, implication: 'A real corpus of what worked and what did not.' },
      { value: 0.5, implication: 'Half the institutional memory is gone. Answers will skew recent.' },
    ],
    rationale: '',
    remediation: 'Check archival and data retention policies before relying on historical deals.',
  },
};

// ---------------------------------------------------------------------------
// Capabilities
// ---------------------------------------------------------------------------

export type CapabilityId =
  | 'grounded_account_brief'
  | 'pipeline_risk_signals'
  | 'close_date_realism'
  | 'next_action_recommendation'
  | 'enablement_answer_engine'
  | 'forecast_assistance'
  | 'bulk_hygiene_automation'
  | 'autonomous_writeback';

export interface CapabilitySpec {
  readonly id: CapabilityId;
  readonly label: string;
  /** Written for a RevOps reader, not an engineer. */
  readonly description: string;
  /** Every gate must be Viable for the capability to be Viable. */
  readonly gates: readonly MetricId[];
  /**
   * The metric whose value sets the coverage ceiling: the share of pipeline
   * the capability can actually operate on. Null means coverage is not bounded
   * by a single metric.
   */
  readonly coverageDrivenBy: MetricId | null;
}

export const CAPABILITIES: readonly CapabilitySpec[] = [
  {
    id: 'grounded_account_brief',
    label: 'Grounded account brief',
    description: 'A cited summary of an account and its open deals, drawn only from records in the CRM.',
    gates: ['note_coverage_rate', 'substantive_note_rate', 'median_note_length_chars', 'duplicate_account_rate'],
    coverageDrivenBy: 'note_coverage_rate',
  },
  {
    id: 'pipeline_risk_signals',
    label: 'Pipeline risk signals',
    description: 'Deterministic flags for stalled, silent, single-threaded or slipping deals.',
    gates: ['activity_capture_rate', 'stage_mapping_coverage', 'stage_history_months', 'median_days_since_modified'],
    coverageDrivenBy: 'activity_capture_rate',
  },
  {
    id: 'close_date_realism',
    label: 'Close date realism check',
    description: 'Flags deals whose close date has slipped repeatedly or has already passed.',
    gates: ['close_date_fill_rate', 'close_date_history_enabled', 'past_due_close_date_rate'],
    coverageDrivenBy: 'close_date_fill_rate',
  },
  {
    id: 'next_action_recommendation',
    label: 'Next action recommendation',
    description: 'Suggests the next step on a deal, grounded in what has and has not happened.',
    gates: ['activity_capture_rate', 'next_step_fill_rate', 'substantive_note_rate', 'contact_linkage_rate'],
    coverageDrivenBy: 'activity_capture_rate',
  },
  {
    id: 'enablement_answer_engine',
    label: 'Enablement answer engine',
    description: 'Answers "how have we handled this before" from closed-won and closed-lost history.',
    gates: ['closed_deal_count_12m', 'outcome_evidence_retention_rate', 'substantive_note_rate'],
    coverageDrivenBy: 'outcome_evidence_retention_rate',
  },
  {
    id: 'forecast_assistance',
    label: 'Forecast assistance',
    description: 'Supports, never replaces, a human forecast call with evidence and outliers.',
    gates: ['stage_mapping_coverage', 'win_rate_dispersion', 'closed_deal_count_12m', 'amount_fill_rate', 'past_due_close_date_rate'],
    coverageDrivenBy: 'amount_fill_rate',
  },
  {
    id: 'bulk_hygiene_automation',
    label: 'Bulk hygiene automation',
    description: 'Proposes batch corrections to stale, missing or contradictory CRM data, under human approval.',
    gates: ['stage_mapping_coverage', 'duplicate_account_rate', 'close_date_fill_rate'],
    coverageDrivenBy: null,
  },
  {
    id: 'autonomous_writeback',
    label: 'Autonomous write-back',
    description:
      'AI writes to CRM without per-change human approval. Almost always Blocked, and correctly so.',
    gates: [
      'stage_mapping_coverage',
      'duplicate_account_rate',
      'untrusted_text_ratio',
      'pii_density',
      'temporal_alignment_ok',
      'activity_capture_rate',
      'closed_deal_count_12m',
    ],
    coverageDrivenBy: null,
  },
];

// ---------------------------------------------------------------------------
// Verdict engine. Pure. No thresholds live here.
// ---------------------------------------------------------------------------

export type Verdict = 'viable' | 'degraded' | 'blocked';

export interface MetricReading {
  readonly metric: MetricId;
  readonly value: number;
  readonly sampleSize: number;
}

export interface GateResult {
  readonly metric: MetricId;
  readonly verdict: Verdict;
  readonly value: number;
  readonly sampleSize: number;
  readonly viableAt: number;
  readonly degradedAt: number;
  readonly remediation: string;
}

export interface CapabilityResult {
  readonly capability: CapabilityId;
  readonly verdict: Verdict;
  readonly gates: readonly GateResult[];
  /** Share of pipeline this capability can operate on, if bounded. */
  readonly coverageCeiling: number | null;
  /** Gates that are not Viable, worst first. */
  readonly blockers: readonly GateResult[];
}

export class RubricIncompleteError extends Error {
  constructor(readonly metric: MetricId, readonly field: string) {
    super(`rubric threshold '${metric}.${field}' is still PENDING`);
    this.name = 'RubricIncompleteError';
  }
}

function resolve(t: Threshold): { viableAt: number; degradedAt: number } {
  if (t.viableAt === PENDING) throw new RubricIncompleteError(t.metric, 'viableAt');
  if (t.degradedAt === PENDING) throw new RubricIncompleteError(t.metric, 'degradedAt');
  return { viableAt: t.viableAt, degradedAt: t.degradedAt };
}

export function gradeGate(reading: MetricReading): GateResult {
  const t = THRESHOLDS[reading.metric];
  const { viableAt, degradedAt } = resolve(t);
  const better = (a: number, b: number) =>
    t.direction === 'higher_is_better' ? a >= b : a <= b;

  const verdict: Verdict = better(reading.value, viableAt)
    ? 'viable'
    : better(reading.value, degradedAt)
      ? 'degraded'
      : 'blocked';

  return {
    metric: reading.metric,
    verdict,
    value: reading.value,
    sampleSize: reading.sampleSize,
    viableAt,
    degradedAt,
    remediation: t.remediation,
  };
}

const RANK: Record<Verdict, number> = { viable: 0, degraded: 1, blocked: 2 };

export function gradeCapability(
  spec: CapabilitySpec,
  readings: ReadonlyMap<MetricId, MetricReading>,
): CapabilityResult {
  const gates: GateResult[] = [];
  for (const m of spec.gates) {
    const r = readings.get(m);
    // A metric that could not be measured is a blocker, never an assumed pass.
    if (!r) {
      const t = THRESHOLDS[m];
      const { viableAt, degradedAt } = resolve(t);
      gates.push({
        metric: m,
        verdict: 'blocked',
        value: Number.NaN,
        sampleSize: 0,
        viableAt,
        degradedAt,
        remediation: `Could not measure ${m}. ${t.remediation}`,
      });
      continue;
    }
    gates.push(gradeGate(r));
  }

  const verdict = gates.reduce<Verdict>(
    (worst, g) => (RANK[g.verdict] > RANK[worst] ? g.verdict : worst),
    'viable',
  );

  const ceilingReading = spec.coverageDrivenBy ? readings.get(spec.coverageDrivenBy) : undefined;

  return {
    capability: spec.id,
    verdict,
    gates,
    coverageCeiling: ceilingReading ? ceilingReading.value : null,
    blockers: gates
      .filter((g) => g.verdict !== 'viable')
      .sort((a, b) => RANK[b.verdict] - RANK[a.verdict]),
  };
}

export function gradeAll(
  readings: ReadonlyMap<MetricId, MetricReading>,
): readonly CapabilityResult[] {
  return CAPABILITIES.map((c) => gradeCapability(c, readings));
}

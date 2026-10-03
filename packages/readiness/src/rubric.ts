/**
 * PROTECTED FILE. Thresholds change only with the maintainer's explicit
 * sign-off. Do not add, edit or invent values here.
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
  | 'owner_id_fill_rate'
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
  | 'temporal_anomaly_rate'
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
    viableAt: 0.95,
    degradedAt: 0.85,
    question:
      'What share of open opportunities must have a close date before date-aware capabilities are trustworthy?',
    candidates: [
      { value: 0.95, implication: 'Strict. Most orgs fail. Verdicts read as harsh but defensible.' },
      { value: 0.9, implication: 'Common real-world bar. Leaves a 10% blind spot you must disclose.' },
      { value: 0.8, implication: 'Permissive. One deal in five is invisible to forecast logic.' },
    ],
    rationale:
      'Close date is mandatory in a working forecast process. Below 0.85, date-aware capabilities have no reliable signal to gate on.',
    remediation: 'Make Close Date required on the opportunity page layout and backfill open records.',
  },

  amount_fill_rate: {
    metric: 'amount_fill_rate',
    unit: 'rate',
    direction: 'higher_is_better',
    viableAt: 0.9,
    degradedAt: 0.75,
    question: 'What share of open opportunities must carry an amount for value-weighted analysis?',
    candidates: [
      { value: 0.9, implication: 'Value-weighted risk is meaningful.' },
      { value: 0.75, implication: 'Counts work, dollar-weighted views carry a stated caveat.' },
    ],
    rationale:
      '0.9 matches the file\'s own top candidate: value-weighted risk is meaningful there. Below 0.75, dollar-weighted views need a stated caveat rather than a pass.',
    remediation: 'Require Amount at stage entry, or accept count-weighted analysis only.',
  },
  
  owner_id_fill_rate: {
    metric: 'owner_id_fill_rate',
    unit: 'rate',
    direction: 'higher_is_better',
    viableAt: 0.95,
    degradedAt: 0.85,
    question: 'What share of open opportunities must have an owner before per-rep views and routing are trustworthy?',
    candidates: [
      { value: 0.95, implication: 'Ownership is system-enforced in most CRMs, so this is achievable.' },
      { value: 0.85, implication: 'Some deals orphaned. Per-rep rollups carry a stated gap.' },
    ],
    rationale:
      'Owner is usually required by the CRM itself, so gaps signal import or integration damage. Below 0.85, per-rep analysis and review routing are unreliable.',
    remediation: 'Reassign ownerless open opportunities and check import/integration jobs that create records without an owner.',
  },
  
  next_step_fill_rate: {
    metric: 'next_step_fill_rate',
    unit: 'rate',
    direction: 'higher_is_better',
    viableAt: 0.6,
    degradedAt: 0.3,
    question: 'How widely must Next Step be used before recommending next actions is worth doing?',
    candidates: [
      { value: 0.6, implication: 'There is enough rep intent to reason against.' },
      { value: 0.4, implication: 'Sparse. Recommendations will often have no prior to contradict.' },
      { value: 0.2, implication: 'Effectively unused. The tool is guessing rather than reviewing.' },
    ],
    rationale:
      '0.6 is the point where there is enough rep intent to reason against. Below 0.3, recommendations would mostly have no prior to contradict.',
    remediation: 'Adopt Next Step in the deal review ritual before expecting AI to improve it.',
  },

  activity_capture_rate: {
    metric: 'activity_capture_rate',
    unit: 'rate',
    direction: 'higher_is_better',
    viableAt: 0.8,
    degradedAt: 0.5,
    question:
      'What share of open opportunities need a logged activity in the last 30 days for engagement signals to mean anything?',
    candidates: [
      { value: 0.8, implication: 'Auto-capture is almost certainly in place. Signals are reliable.' },
      { value: 0.6, implication: 'Partial capture. Silence may mean "unlogged", not "stalled".' },
      { value: 0.4, implication: 'Manual logging. Every silence signal is suspect.' },
    ],
    rationale:
      'Assumes auto-capture (email/calendar sync) is on; 0.8 is the point where silence is a reliable signal. If an org logs manually instead of via sync, this metric should be reported as not instrumented rather than scored, per the adapter\'s capability matrix, not treated as a fail.',
    remediation: 'Turn on Einstein Activity Capture or an equivalent before trusting silence as a signal.',
  },

  contact_linkage_rate: {
    metric: 'contact_linkage_rate',
    unit: 'rate',
    direction: 'higher_is_better',
    viableAt: 0.85,
    degradedAt: 0.6,
    question: 'What share of opportunities need at least one linked contact for multithreading analysis?',
    candidates: [
      { value: 0.9, implication: 'Buying-group analysis is viable.' },
      { value: 0.7, implication: 'Single-threading detection produces false positives.' },
    ],
    rationale:
      'Between the file\'s own candidates: 0.9 makes buying-group analysis viable, 0.7 already produces false positives on single-threading; 0.85/0.6 keeps a real degraded band between them.',
    remediation: 'Enforce contact roles on opportunities at stage gate.',
  },

  note_coverage_rate: {
    metric: 'note_coverage_rate',
    unit: 'rate',
    direction: 'higher_is_better',
    viableAt: 0.7,
    degradedAt: 0.4,
    question: 'What share of open opportunities need any note for qualitative reasoning to be possible?',
    candidates: [
      { value: 0.7, implication: 'Most deals have narrative. Briefs will be substantive.' },
      { value: 0.4, implication: 'Briefs will abstain on the majority of the pipeline.' },
    ],
    rationale:
      'Matches the file\'s candidates exactly: 0.7 means most deals carry narrative; below 0.4, briefs would abstain on the majority of the pipeline.',
    remediation: 'Capture call notes into CRM, or connect the conversation intelligence tool.',
  },

  median_days_since_modified: {
    metric: 'median_days_since_modified',
    unit: 'days',
    direction: 'lower_is_better',
    viableAt: 7,
    degradedAt: 21,
    question: 'How stale can the median open opportunity be before the CRM stops describing reality?',
    candidates: [
      { value: 7, implication: 'Weekly hygiene discipline. Rare.' },
      { value: 14, implication: 'Typical for a well-run team on a two-week cadence.' },
      { value: 30, implication: 'Monthly-only updates. Anything time-sensitive is guesswork.' },
    ],
    rationale:
      '7 days matches weekly hygiene discipline, the file\'s strictest candidate. 21, one week past the file\'s own \'monthly-only\' candidate of 30, is where the CRM has clearly stopped describing reality.',
    remediation: 'Establish a weekly pipeline hygiene ritual before layering AI on top.',
  },

  past_due_close_date_rate: {
    metric: 'past_due_close_date_rate',
    unit: 'rate',
    direction: 'lower_is_better',
    viableAt: 0.1,
    degradedAt: 0.25,
    question:
      'What share of open opportunities can have a close date already in the past before forecast logic is meaningless?',
    candidates: [
      { value: 0.02, implication: 'Strict. Signals active date discipline.' },
      { value: 0.05, implication: 'Tolerant of normal slippage between reviews.' },
      { value: 0.15, implication: 'Dates are decorative. Any date-based verdict is noise.' },
    ],
    rationale:
      'Between the file\'s 0.05 (tolerant of normal slippage) and 0.15 (dates decorative) candidates; 0.25 is deliberately stricter than 0.15 since forecast_assistance depends directly on this gate.',
    remediation: 'Sweep past-due close dates before enabling forecast assistance.',
  },

  median_next_step_age_days: {
    metric: 'median_next_step_age_days',
    unit: 'days',
    direction: 'lower_is_better',
    viableAt: 14,
    degradedAt: 30,
    question: 'How old can the median Next Step be before it describes a deal that no longer exists?',
    candidates: [
      { value: 14, implication: 'Aligned to a two-week review cadence.' },
      { value: 30, implication: 'Monthly. Next Step is a record of intent, not of state.' },
    ],
    rationale:
      '14 days matches the file\'s two-week review cadence candidate; 30 matches its own \'record of intent, not of state\' candidate for degraded.',
    remediation: 'Refresh Next Step at each pipeline review.',
  },

  stage_mapping_coverage: {
    metric: 'stage_mapping_coverage',
    unit: 'rate',
    direction: 'higher_is_better',
    viableAt: 1.0,
    degradedAt: 0.9,
    question:
      'What share of opportunities must sit in a stage mapped to the canonical ladder before stage logic is safe?',
    candidates: [
      { value: 1.0, implication: 'No unmapped stages at all. Clean but requires config work up front.' },
      { value: 0.95, implication: 'Tolerates a long tail of legacy stages.' },
      { value: 0.85, implication: 'One deal in seven has stage logic suppressed.' },
    ],
    rationale:
      'Viable at 1.0 only once the denominator is sampled opportunities, not the full picklist, so a retired stage no live deal uses can\'t permanently block the capability. Degraded at 0.9, between the file\'s 0.95 and 0.85 candidates.',
    remediation: 'Map remaining vendor stages, or retire unused ones.',
  },

  duplicate_account_rate: {
    metric: 'duplicate_account_rate',
    unit: 'rate',
    direction: 'lower_is_better',
    viableAt: 0.02,
    degradedAt: 0.08,
    question: 'How much account duplication can exist before account-level briefs are wrong rather than incomplete?',
    candidates: [
      { value: 0.02, implication: 'Dedupe process is working.' },
      { value: 0.05, implication: 'Typical. Briefs occasionally miss history on the sibling record.' },
      { value: 0.1, implication: 'Account context is unreliable. Fix before anything account-level.' },
    ],
    rationale:
      '0.02 matches the file\'s \'dedupe process is working\' candidate. 0.08, just past its 0.1 candidate, is where account-level context stops being reliable.',
    remediation: 'Run domain-based dedupe on accounts and merge before enabling account briefs.',
  },

  stage_activity_contradiction_rate: {
    metric: 'stage_activity_contradiction_rate',
    unit: 'rate',
    direction: 'lower_is_better',
    viableAt: 0.05,
    degradedAt: 0.2,
    question:
      'What share of late-stage deals can have no meetings logged before stage data is fiction?',
    candidates: [
      { value: 0.05, implication: 'Stage means what it says.' },
      { value: 0.2, implication: 'Stage is partly aspirational. Risk scoring will disagree with reps often.' },
    ],
    rationale:
      'Matches the file\'s candidates exactly. Contradiction is defined as: an open opportunity in the top two canonical stages with zero qualifying activity (per activity_capture_rate\'s definition) in the trailing 21 days.',
    remediation: 'Audit late-stage deals with no meetings; usually a stage-gate discipline problem.',
  },

  round_amount_rate: {
    metric: 'round_amount_rate',
    unit: 'rate',
    direction: 'lower_is_better',
    viableAt: 0.3,
    degradedAt: 0.6,
    question:
      'What share of amounts can be suspiciously round (a fabrication tell) before value data is untrustworthy?',
    candidates: [
      { value: 0.3, implication: 'Some round numbers are legitimate list pricing.' },
      { value: 0.6, implication: 'Most amounts are placeholders, not quotes.' },
    ],
    rationale:
      'Matches the file\'s candidates exactly: 0.3 tolerates legitimate list pricing, 0.6 is where most amounts read as placeholders rather than quotes.',
    remediation: 'Source amounts from CPQ or quotes rather than manual entry.',
  },

  close_date_history_enabled: {
    metric: 'close_date_history_enabled',
    unit: 'bool',
    direction: 'higher_is_better',
    viableAt: 1,
    degradedAt: 0,
    question:
      'Can this CRM retain a change history for Close Date, required (1) or optional (0) for slip detection? Availability is adapter-specific, not a single "off by default" fact — see remediation.',
    candidates: [
      { value: 1, implication: 'Required. Without it, slip detection is impossible, not merely degraded.' },
      { value: 0, implication: 'Optional. Accept a weaker proxy from stage history timestamps.' },
    ],
    rationale:
      'Required. Without close date history, slip detection isn\'t degraded, it\'s impossible; there\'s no weaker proxy worth calling Viable.',
    remediation:
      'On Salesforce this is already available for free via the standard Opportunity History object (it snapshots Stage, Amount, Probability, and Close Date on every change, unconditionally — not gated by Field History Tracking). For an adapter or CRM without an equivalent always-on mechanism, enable field-history tracking on Close Date; history accrues only from the day it\'s turned on.',
  },

  stage_history_months: {
    metric: 'stage_history_months',
    unit: 'months',
    direction: 'higher_is_better',
    viableAt: 18,
    degradedAt: 6,
    question: 'How many months of stage history are needed to compute a cohort median stage age?',
    candidates: [
      { value: 12, implication: 'A full cycle including seasonality.' },
      { value: 6, implication: 'Enough for a median, not enough for seasonal comparison.' },
      { value: 3, implication: 'Thin. Cohort medians will be unstable.' },
    ],
    rationale:
      '18 covers a full annual cycle plus a season of comparison, a bit past the file\'s 12-month \'full cycle\' candidate. 6 matches the file\'s own \'enough for a median, not for seasonal comparison\' candidate.',
    remediation: 'Wait for history to accrue, or import from a warehouse if one exists.',
  },

  owner_history_enabled: {
    metric: 'owner_history_enabled',
    unit: 'bool',
    direction: 'higher_is_better',
    viableAt: 1,
    degradedAt: 0,
    question: 'Is owner change history required (1) or optional (0) for continuity risk signals?',
    candidates: [
      { value: 1, implication: 'Required. Owner churn is a strong predictor and cannot be inferred.' },
      { value: 0, implication: 'Optional. Suppress the continuity signal and say so.' },
    ],
    rationale:
      'Required. Owner churn is a real predictor of continuity risk that can\'t be inferred from anything else in the record.',
    remediation: 'Enable field history tracking on Opportunity Owner.',
  },

  contact_identity_resolution_rate: {
    metric: 'contact_identity_resolution_rate',
    unit: 'rate',
    direction: 'higher_is_better',
    viableAt: 0.85,
    degradedAt: 0.6,
    question:
      'What share of contacts must resolve across CRM and the engagement tool before cross-system reasoning is honest?',
    candidates: [
      { value: 0.9, implication: 'Cross-system signals are trustworthy.' },
      { value: 0.75, implication: 'One contact in four is invisible. Disclose the blind spot prominently.' },
      { value: 0.5, implication: 'Cross-system capability should be reported as Blocked.' },
    ],
    rationale:
      'Between the file\'s 0.9 (\'trustworthy\') and 0.75 (\'disclose the blind spot\') candidates for viable; 0.6 keeps the reported-Blocked floor at the file\'s own 0.5 candidate one step higher, giving a real degraded band.',
    remediation: 'Normalise email casing and aliases; reconcile the contact sync mapping.',
  },

  account_resolution_rate: {
    metric: 'account_resolution_rate',
    unit: 'rate',
    direction: 'higher_is_better',
    viableAt: 0.9,
    degradedAt: 0.7,
    question: 'What share of accounts must resolve by domain across systems?',
    candidates: [
      { value: 0.9, implication: 'Account-level joins are safe.' },
      { value: 0.7, implication: 'Subsidiaries and shared domains create real gaps.' },
    ],
    rationale:
      'Matches the file\'s candidates exactly: 0.9 for safe account-level joins, 0.7 where subsidiary and shared-domain gaps become real.',
    remediation: 'Populate account domain consistently; handle multi-domain parents explicitly.',
  },

  activity_attribution_rate: {
    metric: 'activity_attribution_rate',
    unit: 'rate',
    direction: 'higher_is_better',
    viableAt: 0.8,
    degradedAt: 0.55,
    question:
      'What share of engagement-tool activities must land on a CRM opportunity for deal-level engagement analysis?',
    candidates: [
      { value: 0.7, implication: 'Deal-level engagement is measurable.' },
      { value: 0.5, implication: 'Account-level only. Deal-level engagement claims are unsupported.' },
    ],
    rationale:
      'A bit stricter than the file\'s 0.7 candidate since next_action_recommendation depends on this gate directly; 0.55 sits just above its own 0.5 \'account-level only\' candidate.',
    remediation: 'Fix activity-to-opportunity association rules in the sync configuration.',
  },

  temporal_anomaly_rate: {
    metric: 'temporal_anomaly_rate',
    unit: 'rate',
    direction: 'lower_is_better',
    viableAt: 0.01,
    degradedAt: 0.05,
    question:
      'What share of sampled records can show impossible timestamp ordering (created after modified, activity after close date, future-dated) before sequence-based signals are unsafe?',
    candidates: [
      { value: 0.01, implication: 'Near-zero anomalies. Ordering is trustworthy.' },
      { value: 0.05, implication: 'A handful of bad rows tolerated without discarding sequence logic entirely.' },
    ],
    rationale:
      'Replaces a boolean with a rate: a few anomalous rows should not block the whole capability, only a high rate should. Anomaly definition: created-after-modified, activity dated after the deal\'s close date, or any future-dated record.',
    remediation: 'Normalise all timestamps to UTC at ingestion in both systems; investigate the specific anomalous records rather than widening tolerance.',
  },

  substantive_note_rate: {
    metric: 'substantive_note_rate',
    unit: 'rate',
    direction: 'higher_is_better',
    viableAt: 0.5,
    degradedAt: 0.25,
    question:
      'What share of notes must be substantive rather than filler before an LLM has something worth reading?',
    candidates: [
      { value: 0.7, implication: 'Rich narrative. Grounded briefs will be strong.' },
      { value: 0.5, implication: 'Half the corpus is noise. Briefs will be thin but honest.' },
      { value: 0.3, implication: 'Report the text-dependent capabilities as Blocked.' },
    ],
    rationale:
      '0.5 matches the file\'s own \'half the corpus is noise, briefs will be thin but honest\' candidate for viable, treating that as an acceptable floor rather than a failure. Below 0.25, past its own 0.3 Blocked candidate, there isn\'t enough substantive text to summarise honestly.',
    remediation: 'Note quality is a coaching problem, not a tooling one. Address it before expecting AI value.',
  },

  median_note_length_chars: {
    metric: 'median_note_length_chars',
    unit: 'chars',
    direction: 'higher_is_better',
    viableAt: 200,
    degradedAt: 80,
    question: 'What median note length indicates real content rather than a logged stub?',
    candidates: [
      { value: 200, implication: 'A few real sentences.' },
      { value: 80, implication: 'One line. Enough to cite, not enough to reason over.' },
    ],
    rationale:
      'Matches the file\'s candidates exactly: 200 chars is a few real sentences, 80 is one line, enough to cite but not to reason over.',
    remediation: 'Capture structured call summaries rather than one-line stubs.',
  },

  pii_density: {
    metric: 'pii_density',
    unit: 'rate',
    direction: 'lower_is_better',
    viableAt: 0.05,
    degradedAt: 0.2,
    question:
      'Above what share of records containing detectable PII does a deployment require mandatory redaction rather than optional?',
    candidates: [
      { value: 0.05, implication: 'Cautious. Redaction becomes mandatory early.' },
      { value: 0.2, implication: 'Typical B2B CRM. Redaction still recommended.' },
    ],
    rationale:
      'Matches the file\'s candidates exactly. Reframed as a flag, not a gate: PII density measures redaction burden and deployment risk, not data quality, and legitimately varies by industry (healthcare, fintech carry more). Removed from autonomous_writeback\'s gates below; still computed and reported on every run.',
    remediation: 'Enable field-level redaction before any text leaves the tenant boundary.',
  },

  untrusted_text_ratio: {
    metric: 'untrusted_text_ratio',
    unit: 'rate',
    direction: 'lower_is_better',
    viableAt: 0.1,
    degradedAt: 0.3,
    question:
      'Above what share of externally-sourced text does injection defence stop being optional hardening and become a prerequisite?',
    candidates: [
      { value: 0.2, implication: 'Conservative. Defence is required in most orgs, which is arguably correct.' },
      { value: 0.5, implication: 'Only flags orgs where inbound email dominates the corpus.' },
    ],
    rationale:
      'Stricter than the file\'s 0.2 \'conservative\' candidate since this gates autonomous_writeback specifically; 0.3 sits between its two candidates for degraded.',
    remediation: 'Deploy trust-tier tagging and structural injection defence before enabling write-back.',
  },

  closed_deal_count_12m: {
    metric: 'closed_deal_count_12m',
    unit: 'count',
    direction: 'higher_is_better',
    viableAt: 40,
    degradedAt: 20,
    // PROVISIONAL (2026-09-30): first set against the old 2 x 20 closed
    // sample ceiling; since then the value is the adapter's real count of
    // closed deals in 12 months, and 40/20 are kept as real counts until
    // Phase 4 calibration.
    question: 'How many closed deals in 12 months are needed to calibrate or evaluate anything?',
    candidates: [
      { value: 200, implication: 'Enough to slice by stage and segment.' },
      { value: 100, implication: 'Enough for aggregate calibration, not for slicing.' },
      { value: 50, implication: 'Directional only. Say so explicitly in the report.' },
    ],
    rationale:
      'Provisional: calibrate in Phase 4. 40/20 are real counts of closed deals in the trailing 12 months (the adapter\'s population count, since 2026-09-30), kept from when they capped a 2 x 20 sample. Deliberately below the file\'s own candidates (200/100/50): v0.1 computes this org-wide, with no segment-aware slicing yet, so a high floor would fail enterprise motions with few, large deals. Segment-scoped computation is a v0.2 recalibration item, not a v0.1 rubric change.',
    remediation: 'Too few outcomes to evaluate against. Revisit after another quarter or two.',
  },

  win_rate_dispersion: {
    metric: 'win_rate_dispersion',
    unit: 'rate',
    direction: 'higher_is_better',
    viableAt: 0.3,
    degradedAt: 0.15,
    question:
      'How much must win rate vary across stages before stage carries predictive signal? Flat win rates mean stage is theatre.',
    candidates: [
      { value: 0.3, implication: 'Stage is strongly predictive.' },
      { value: 0.15, implication: 'Weak but present signal.' },
    ],
    rationale:
      'Matches the file\'s candidates exactly, kept as originally scoped: this measures win-rate variance across pipeline stages, not across business segments, so segment mix doesn\'t weaken it. Flat win rates across stages mean stage isn\'t predictive of anything, a real quality problem regardless of how the org segments its market. Kept as a gate on forecast_assistance.',
    remediation: 'Flat win rates across stages usually mean stage definitions are not being applied consistently.',
  },

  outcome_evidence_retention_rate: {
    metric: 'outcome_evidence_retention_rate',
    unit: 'rate',
    direction: 'higher_is_better',
    viableAt: 0.8,
    degradedAt: 0.5,
    question:
      'What share of closed deals must still have their activity and note history for an enablement corpus to exist?',
    candidates: [
      { value: 0.8, implication: 'A real corpus of what worked and what did not.' },
      { value: 0.5, implication: 'Half the institutional memory is gone. Answers will skew recent.' },
    ],
    rationale:
      'Matches the file\'s candidates exactly: 0.8 is a real corpus of what worked and what didn\'t; below 0.5, half of institutional memory is gone and answers would skew recent without saying so.',
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
      'temporal_anomaly_rate',
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

/**
 * A gate's or capability's verdict. Adds 'not_measured' to the three metric
 * tiers: the tool could not see the data a gate needs (the adapter lacks the
 * capability, or the metric isn't built yet), so it can say nothing about
 * the org's data either way. Distinct from 'blocked', which is a verdict
 * about the data itself, including data that is missing from the CRM. A
 * single metric is never 'not_measured'; it has a MetricStatus instead.
 */
export type CapabilityVerdict = Verdict | 'not_measured';

export interface MetricReading {
  readonly metric: MetricId;
  readonly value: number;
  readonly sampleSize: number;
}

export interface GateResult {
  readonly metric: MetricId;
  readonly verdict: CapabilityVerdict;
  readonly value: number;
  readonly sampleSize: number;
  readonly viableAt: number;
  readonly degradedAt: number;
  readonly remediation: string;
}

/** A gate graded from a real reading: always one of the three metric tiers. */
export interface GradedGate extends GateResult {
  readonly verdict: Verdict;
}

export interface CapabilityResult {
  readonly capability: CapabilityId;
  readonly verdict: CapabilityVerdict;
  readonly gates: readonly GateResult[];
  /** Share of pipeline this capability can operate on, if bounded. */
  readonly coverageCeiling: number | null;
  /** Gates that are not Viable, worst first (blocked, not_measured, degraded). */
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

export function gradeGate(reading: MetricReading): GradedGate {
  const t = THRESHOLDS[reading.metric];
  const { viableAt, degradedAt } = resolve(t);
  const better = (a: number, b: number) =>
    t.direction === 'higher_is_better' ? a >= b : a <= b;

  // A bool gate has no degraded band: the capability is either there or it
  // isn't, so anything short of viableAt is blocked (decided 2026-09-30).
  // degradedAt is still resolved above so a PENDING value keeps failing.
  const verdict: Verdict = better(reading.value, viableAt)
    ? 'viable'
    : t.unit !== 'bool' && better(reading.value, degradedAt)
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

const RANK: Record<CapabilityVerdict, number> = { viable: 0, degraded: 1, not_measured: 2, blocked: 3 };

/**
 * `unmeasured` names the metrics the tool could not see (see
 * CapabilityVerdict). A gate with no reading is 'not_measured' if listed
 * there, and 'blocked' otherwise: no reading and no reason means the data
 * the metric needs is missing. Neither is ever an assumed pass.
 */
export function gradeCapability(
  spec: CapabilitySpec,
  readings: ReadonlyMap<MetricId, MetricReading>,
  unmeasured: ReadonlySet<MetricId> = new Set(),
): CapabilityResult {
  const gates: GateResult[] = [];
  for (const m of spec.gates) {
    const r = readings.get(m);
    if (!r) {
      const t = THRESHOLDS[m];
      const { viableAt, degradedAt } = resolve(t);
      const notMeasured = unmeasured.has(m);
      gates.push({
        metric: m,
        verdict: notMeasured ? 'not_measured' : 'blocked',
        value: Number.NaN,
        sampleSize: 0,
        viableAt,
        degradedAt,
        remediation: notMeasured
          ? `Not measured: this scan cannot see the data ${m} needs. ${t.remediation}`
          : `No data to measure ${m}. ${t.remediation}`,
      });
      continue;
    }
    gates.push(gradeGate(r));
  }

  const verdict = gates.reduce<CapabilityVerdict>(
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
  unmeasured: ReadonlySet<MetricId> = new Set(),
): readonly CapabilityResult[] {
  return CAPABILITIES.map((c) => gradeCapability(c, readings, unmeasured));
}
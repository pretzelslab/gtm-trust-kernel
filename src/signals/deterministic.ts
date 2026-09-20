/**
 * Deterministic pipeline risk signals.
 *
 * Hard rule of this project: arithmetic happens in code, interpretation happens
 * in the model. The numbers must be reproducible, unit-testable, and identical
 * across model versions, or the eval harness measures noise.
 *
 * Every signal declares the capability it needs. When the adapter cannot supply
 * it, the signal is SUPPRESSED with a stated reason rather than computed wrong.
 */

import type { AdapterCapabilities } from '../adapters/types.js';
import type { EvidenceSet } from '../model/canonical.js';

export type SignalId =
  | 'stage_age_vs_cohort'
  | 'activity_silence'
  | 'close_date_pushed'
  | 'single_threaded'
  | 'owner_changed_mid_cycle'
  | 'amount_changed_without_stage'
  | 'next_step_missing_or_stale'
  | 'stage_activity_mismatch';

export type SignalSeverity = 'none' | 'low' | 'medium' | 'high';

export interface SignalResult {
  readonly id: SignalId;
  readonly severity: SignalSeverity;
  /** Raw measured value, so the UI and the eval can show the arithmetic. */
  readonly value: number | null;
  readonly citedRecordIds: readonly string[];
  readonly explanation: string;
}

export interface SuppressedSignal {
  readonly id: SignalId;
  readonly reason: string;
}

export interface SignalOutput {
  readonly results: readonly SignalResult[];
  readonly suppressed: readonly SuppressedSignal[];
}

export interface SignalConfig {
  readonly activitySilenceDays: { low: number; medium: number; high: number };
  readonly nextStepStaleDays: number;
  readonly closeDatePushThreshold: { medium: number; high: number };
  readonly singleThreadedMinContacts: number;
  /** Cohort medians by stage, precomputed from closed-won history. */
  readonly cohortStageAgeDays: Readonly<Record<string, number>>;
}

export const DEFAULT_SIGNAL_CONFIG: SignalConfig = {
  activitySilenceDays: { low: 7, medium: 14, high: 30 },
  nextStepStaleDays: 14,
  closeDatePushThreshold: { medium: 2, high: 3 },
  singleThreadedMinContacts: 2,
  cohortStageAgeDays: {
    prospecting: 14,
    discovery: 21,
    evaluation: 30,
    proposal: 21,
    negotiation: 14,
  },
};

const DAY_MS = 86_400_000;

function daysBetween(a: string, b: string): number {
  return Math.floor((new Date(a).getTime() - new Date(b).getTime()) / DAY_MS);
}

export function computeSignals(
  ev: EvidenceSet,
  caps: AdapterCapabilities,
  cfg: SignalConfig = DEFAULT_SIGNAL_CONFIG,
  now: string = new Date().toISOString(),
): SignalOutput {
  const results: SignalResult[] = [];
  const suppressed: SuppressedSignal[] = [];
  const opp = ev.opportunity;

  // Unmapped stage poisons every stage-dependent signal. Say so rather than guess.
  const stageUsable = opp.stageConfidence === 'mapped';

  // 1. Activity silence.
  const lastActivity = [...ev.activities]
    .sort((a, b) => b.occurredAt.localeCompare(a.occurredAt))[0];
  if (lastActivity) {
    const d = daysBetween(now, lastActivity.occurredAt);
    const t = cfg.activitySilenceDays;
    const sev: SignalSeverity =
      d >= t.high ? 'high' : d >= t.medium ? 'medium' : d >= t.low ? 'low' : 'none';
    results.push({
      id: 'activity_silence',
      severity: sev,
      value: d,
      citedRecordIds: [lastActivity.ref.id],
      explanation: `${d} days since last logged activity`,
    });
  } else if (ev.truncated.activities > 0) {
    suppressed.push({
      id: 'activity_silence',
      reason: 'activity evidence was truncated by the retrieval budget',
    });
  } else {
    results.push({
      id: 'activity_silence',
      severity: 'high',
      value: null,
      citedRecordIds: [opp.ref.id],
      explanation: 'no activity has ever been logged on this opportunity',
    });
  }

  // 2. Stage age vs cohort median.
  if (!stageUsable) {
    suppressed.push({
      id: 'stage_age_vs_cohort',
      reason: `vendor stage '${opp.vendorStageLabel}' is not mapped to the canonical ladder`,
    });
  } else if (!caps.stageHistory) {
    suppressed.push({
      id: 'stage_age_vs_cohort',
      reason: 'adapter does not expose stage history',
    });
  } else {
    const entered = [...ev.stageHistory]
      .filter((h) => h.toStage === opp.stage)
      .sort((a, b) => b.changedAt.localeCompare(a.changedAt))[0];
    if (entered) {
      const age = daysBetween(now, entered.changedAt);
      const median = cfg.cohortStageAgeDays[opp.stage] ?? 21;
      const ratio = age / median;
      const sev: SignalSeverity =
        ratio >= 3 ? 'high' : ratio >= 2 ? 'medium' : ratio >= 1.5 ? 'low' : 'none';
      results.push({
        id: 'stage_age_vs_cohort',
        severity: sev,
        value: age,
        citedRecordIds: [entered.ref.id],
        explanation: `${age} days in ${opp.stage} against a cohort median of ${median}`,
      });
    } else {
      suppressed.push({
        id: 'stage_age_vs_cohort',
        reason: 'no stage history entry for the current stage',
      });
    }
  }

  // 3. Close date pushed.
  if (!caps.stageHistory) {
    suppressed.push({ id: 'close_date_pushed', reason: 'adapter does not expose field history' });
  } else {
    // Order by when the change happened, never by array order.
    const dates = [...ev.stageHistory]
      .sort((a, b) => a.changedAt.localeCompare(b.changedAt))
      .map((h) => h.closeDateAtChange)
      .filter((d): d is string => Boolean(d));
    let pushes = 0;
    for (let i = 1; i < dates.length; i += 1) {
      if (dates[i]! > dates[i - 1]!) pushes += 1;
    }
    const t = cfg.closeDatePushThreshold;
    const sev: SignalSeverity =
      pushes >= t.high ? 'high' : pushes >= t.medium ? 'medium' : pushes > 0 ? 'low' : 'none';
    results.push({
      id: 'close_date_pushed',
      severity: sev,
      value: pushes,
      citedRecordIds: ev.stageHistory.map((h) => h.ref.id),
      explanation: `close date pushed out ${pushes} time(s)`,
    });
  }

  // 4. Single threaded.
  const engaged = new Set(
    ev.activities.flatMap((a) => a.participantIds).filter((p) => p.startsWith('contact:')),
  );
  const sev4: SignalSeverity =
    engaged.size === 0 ? 'high' : engaged.size < cfg.singleThreadedMinContacts ? 'medium' : 'none';
  results.push({
    id: 'single_threaded',
    severity: sev4,
    value: engaged.size,
    citedRecordIds: ev.contacts.map((c) => c.ref.id),
    explanation: `${engaged.size} distinct contact(s) engaged in logged activity`,
  });

  // 5. Owner changed mid cycle.
  if (!caps.ownerHistory) {
    suppressed.push({ id: 'owner_changed_mid_cycle', reason: 'adapter does not expose owner history' });
  } else {
    const changes = ev.ownerChanges.filter((c) => c.subjectRef.id === opp.ref.id);
    const sev: SignalSeverity = changes.length >= 2 ? 'high' : changes.length === 1 ? 'medium' : 'none';
    results.push({
      id: 'owner_changed_mid_cycle',
      severity: sev,
      value: changes.length,
      citedRecordIds: changes.map((c) => c.ref.id),
      explanation: `owner changed ${changes.length} time(s) during the cycle`,
    });
  }

  // 6. Next step missing or stale.
  const ns = opp.nextStep;
  if (!ns || ns.value.trim() === '') {
    results.push({
      id: 'next_step_missing_or_stale',
      severity: 'high',
      value: null,
      citedRecordIds: [opp.ref.id],
      explanation: 'next step is empty',
    });
  } else {
    const age = daysBetween(now, ns.source.capturedAt);
    results.push({
      id: 'next_step_missing_or_stale',
      severity: age >= cfg.nextStepStaleDays ? 'medium' : 'none',
      value: age,
      citedRecordIds: [opp.ref.id],
      explanation: `next step last updated ${age} days ago`,
    });
  }

  // 7. Stage and activity mismatch: late stage, no meetings.
  if (stageUsable) {
    const lateStage = opp.stage === 'proposal' || opp.stage === 'negotiation';
    const meetings = ev.activities.filter((a) => a.kind === 'meeting').length;
    if (lateStage && meetings === 0) {
      results.push({
        id: 'stage_activity_mismatch',
        severity: 'high',
        value: meetings,
        citedRecordIds: [opp.ref.id],
        explanation: `opportunity is in ${opp.stage} with no meetings logged`,
      });
    }
  }

  return { results, suppressed };
}

/** Weighted roll-up. Deliberately simple and inspectable, not a learned model. */
export function riskScore(out: SignalOutput): { score: number; basis: number } {
  const weight: Record<SignalSeverity, number> = { none: 0, low: 1, medium: 3, high: 5 };
  const score = out.results.reduce((s, r) => s + weight[r.severity], 0);
  const basis = out.results.length * weight.high;
  return { score, basis };
}

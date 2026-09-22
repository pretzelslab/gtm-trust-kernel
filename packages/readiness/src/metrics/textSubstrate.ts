/**
 * D6 text substrate metrics. See docs/metric-definitions.md, section D6.
 */

import type { Activity, Note } from '@gtm-trust-kernel/adapters/model/canonical.js';
import { TrustTier, type TrustedText } from '@gtm-trust-kernel/adapters/model/trust.js';
import type { CoverageSample, MetricConfig, MetricResult } from './types.js';
import { LOW_CONFIDENCE_SAMPLE_SIZE } from './types.js';
import { detectPii, median } from './shared.js';

/**
 * Every sampled Note, open + closed opportunities pooled together —
 * notesByOpportunity is already hydrated for both (hydrateNotes fetches for
 * every sampled opportunity regardless of stage), and this session's
 * scoping decision widened substantive_note_rate/median_note_length_chars
 * beyond note_coverage_rate's open-only denominator on purpose: the former
 * gates enablement_answer_engine, which reasons over closed-won/lost
 * history (metric-definitions.md D6).
 */
function allSampledNotes(sample: CoverageSample): readonly Note[] {
  return [...sample.notesByOpportunity.values()].flat();
}

function allSampledActivities(sample: CoverageSample): readonly Activity[] {
  return [...sample.activitiesByOpportunity.values()].flat();
}

/** Case-insensitive, exact match after trim. metric-definitions.md D6. */
const FILLER_DENYLIST: ReadonlySet<string> = new Set([
  'n/a',
  'na',
  '-',
  'none',
  'called',
  'left vm',
  'left voicemail',
  'no answer',
  'followed up',
  'touch base',
  'checking in',
]);

function isSubstantive(body: string): boolean {
  const trimmed = body.trim();
  return trimmed.length >= 40 && !FILLER_DENYLIST.has(trimmed.toLowerCase());
}

export function substantiveNoteRate(sample: CoverageSample, _config: MetricConfig): MetricResult {
  const notes = allSampledNotes(sample);
  if (notes.length === 0) {
    return {
      metric: 'substantive_note_rate',
      status: 'not_applicable',
      value: null,
      sampleSize: 0,
      lowConfidence: false,
      note: 'no sampled notes (open or closed) in sample',
    };
  }

  const substantive = notes.filter((n) => isSubstantive(n.body.value)).length;

  return {
    metric: 'substantive_note_rate',
    status: 'ok',
    value: substantive / notes.length,
    sampleSize: notes.length,
    lowConfidence: notes.length < LOW_CONFIDENCE_SAMPLE_SIZE,
  };
}

/** Same denominator as substantiveNoteRate — every sampled note, not just the substantive ones. */
export function medianNoteLengthChars(sample: CoverageSample, _config: MetricConfig): MetricResult {
  const notes = allSampledNotes(sample);
  if (notes.length === 0) {
    return {
      metric: 'median_note_length_chars',
      status: 'not_applicable',
      value: null,
      sampleSize: 0,
      lowConfidence: false,
      note: 'no sampled notes (open or closed) in sample',
    };
  }

  const lengths = notes.map((n) => n.body.value.trim().length);

  return {
    metric: 'median_note_length_chars',
    status: 'ok',
    value: median(lengths),
    sampleSize: notes.length,
    lowConfidence: notes.length < LOW_CONFIDENCE_SAMPLE_SIZE,
  };
}

function activityPiiCandidates(activity: Activity): readonly string[] {
  const candidates: string[] = [];
  if (activity.subject) {
    candidates.push(activity.subject.value);
  }
  if (activity.body) {
    candidates.push(activity.body.value);
  }
  return candidates;
}

/**
 * Pooled per-record denominator across three structurally different record
 * types — Notes (body), Activities (subject and/or body), Opportunities
 * (nextStep) — deliberately not three separate rates (metric-definitions.md
 * D6). A record counts once toward the numerator if ANY of its candidate
 * fields matches detectPii (shared.ts); a record with zero candidate fields
 * set (an Activity with neither subject nor body, an Opportunity with no
 * nextStep) is excluded from the denominator entirely, not counted as a
 * non-match. Flag only — see rubric.ts, no CAPABILITIES gate references it.
 */
export function piiDensity(sample: CoverageSample, _config: MetricConfig): MetricResult {
  const notes = allSampledNotes(sample);
  const activities = allSampledActivities(sample);
  const opportunities = [...sample.openOpportunities, ...sample.closedOpportunities];

  const candidateGroups: (readonly string[])[] = [
    ...notes.map((n) => [n.body.value]),
    ...activities.map(activityPiiCandidates).filter((c) => c.length > 0),
    ...opportunities
      .map((o) => (o.nextStep ? [o.nextStep.value] : []))
      .filter((c) => c.length > 0),
  ];

  if (candidateGroups.length === 0) {
    return {
      metric: 'pii_density',
      status: 'not_applicable',
      value: null,
      sampleSize: 0,
      lowConfidence: false,
      note: 'no sampled notes, activities, or opportunities with free text to check',
    };
  }

  const matching = candidateGroups.filter((texts) => texts.some((t) => detectPii(t))).length;

  return {
    metric: 'pii_density',
    status: 'ok',
    value: matching / candidateGroups.length,
    sampleSize: candidateGroups.length,
    lowConfidence: candidateGroups.length < LOW_CONFIDENCE_SAMPLE_SIZE,
    note: `${matching} of ${candidateGroups.length} sampled records (notes, activities, opportunities) matched a PII pattern`,
  };
}

/**
 * Per-FIELD denominator (not per-record, unlike piiDensity above) — every
 * sampled Note body counts as one field, every sampled Activity contributes
 * one entry per subject/body it actually has set. Does not include
 * Opportunity.nextStep (a rep-typed field; contrast with pii_density, which
 * does include it) — there is no meaningful "externally sourced next step".
 *
 * Always computable: no capability gate, no not_instrumented path. Every
 * TrustedText carries a tier, assigned once at ingestion — there is no
 * canonical state where a hydrated free-text field lacks one (see
 * model/trust.ts and metric-definitions.md D6's resolved ambiguity, which
 * removed an earlier "adapter can't distinguish origin" gate that described
 * a state this model can't actually be in).
 */
export function untrustedTextRatio(sample: CoverageSample, _config: MetricConfig): MetricResult {
  const notes = allSampledNotes(sample);
  const activities = allSampledActivities(sample);

  const fields: TrustedText[] = notes.map((n) => n.body);
  for (const activity of activities) {
    if (activity.subject) {
      fields.push(activity.subject);
    }
    if (activity.body) {
      fields.push(activity.body);
    }
  }

  if (fields.length === 0) {
    return {
      metric: 'untrusted_text_ratio',
      status: 'not_applicable',
      value: null,
      sampleSize: 0,
      lowConfidence: false,
      note: 'no sampled note bodies or activity subject/body fields in sample',
    };
  }

  const externallySourced = fields.filter((f) => f.tier === TrustTier.ExternallySourced).length;

  return {
    metric: 'untrusted_text_ratio',
    status: 'ok',
    value: externallySourced / fields.length,
    sampleSize: fields.length,
    lowConfidence: fields.length < LOW_CONFIDENCE_SAMPLE_SIZE,
    note: 'reflects the adapter\'s own ingestion-time trust-tier assignment, not independently verified ground truth',
  };
}

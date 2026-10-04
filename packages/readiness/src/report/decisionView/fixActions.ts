/**
 * The plain action shown for each gating check that isn't passing. Static
 * text, not the rubric's `remediation` strings. Null for checks that gate
 * no use case (they show in object health only). A not-measured check shows
 * the adapter's own setting hint (MetricRow.fixHint) instead of this text.
 */

import type { MetricId } from '../../rubric.js';

export const FIX_ACTIONS: Readonly<Record<MetricId, string | null>> = {
  stage_mapping_coverage: 'Map every sales stage in use to a standard stage, or retire unused stages.',
  close_date_fill_rate: 'Fill in close dates on open deals, and make the field required.',
  past_due_close_date_rate: 'Move or close deals whose close date has already passed.',
  closed_deal_count_12m: 'Record every finished deal as won or lost; recheck after another quarter.',
  amount_fill_rate: 'Fill in amounts on open deals before they leave the early stages.',
  next_step_fill_rate: 'Write a next step on every open deal and review it in pipeline meetings.',
  median_days_since_modified: 'Update stale open deals and review them in pipeline meetings.',
  median_next_step_age_days: null,
  owner_id_fill_rate: null,
  round_amount_rate: null,
  duplicate_account_rate: 'Merge duplicate accounts.',
  account_resolution_rate: null,
  activity_capture_rate: 'Turn on automatic activity capture, or log calls and meetings against deals.',
  temporal_anomaly_rate: 'Fix timestamps that are in the future or out of order; store both systems in UTC.',
  stage_activity_contradiction_rate: null,
  activity_attribution_rate: null,
  substantive_note_rate: "Write notes that say what happened and what's next, not just \"follow up\".",
  note_coverage_rate: 'Log call notes on open deals.',
  median_note_length_chars: 'Write a short call summary instead of a one-line note.',
  untrusted_text_ratio: 'Expected. Keep a person approving every AI change.',
  outcome_evidence_retention_rate: 'Check that retention rules keep notes and activities on closed deals.',
  pii_density: null,
  close_date_history_enabled: 'Turn on history tracking for close date.',
  stage_history_months: 'Keep stage history on; it builds up over time, or import it from a warehouse.',
  win_rate_dispersion: 'Agree what each stage means and apply it the same way on every deal.',
  owner_history_enabled: null,
  contact_linkage_rate: 'Add contact roles to open deals.',
  contact_identity_resolution_rate: null,
};

/**
 * Plain labels for the checks, used in the decision view's object rows, fix
 * list, cards and heatmap. Wording follows README.md's use-case table and
 * outcome map; the few checks the README doesn't name get short labels in
 * the same style. Typed as Record<MetricId, string>, so a new metric
 * without a label fails the typecheck. Display only: nothing here is read
 * by a verdict.
 */

import type { MetricId } from '../../rubric.js';

export const PLAIN_CHECK_LABEL: Readonly<Record<MetricId, string>> = {
  stage_mapping_coverage: 'Stages mapped',
  close_date_fill_rate: 'Close dates filled in',
  past_due_close_date_rate: 'Past-due close dates',
  closed_deal_count_12m: 'Closed deals in the last 12 months',
  amount_fill_rate: 'Amounts filled in',
  next_step_fill_rate: 'Next steps filled in',
  median_days_since_modified: 'Deals touched recently',
  median_next_step_age_days: 'Age of next steps',
  owner_id_fill_rate: 'Deal owner filled in',
  round_amount_rate: 'Round-number amounts',
  duplicate_account_rate: 'Duplicate accounts',
  account_resolution_rate: 'Accounts matched across systems',
  activity_capture_rate: 'Activities captured',
  temporal_anomaly_rate: 'Date anomalies',
  stage_activity_contradiction_rate: 'Stages that contradict activity',
  activity_attribution_rate: 'Activities matched to deals across systems',
  substantive_note_rate: 'Notes with real content',
  note_coverage_rate: 'Notes on open deals',
  median_note_length_chars: 'Notes long enough to use',
  untrusted_text_ratio: 'Text written by people outside your company',
  outcome_evidence_retention_rate: 'Evidence kept on closed deals',
  pii_density: 'Personal data in notes and activities',
  close_date_history_enabled: 'Close-date history on',
  stage_history_months: 'Months of stage history',
  win_rate_dispersion: 'Win rates that differ by stage',
  owner_history_enabled: 'Owner history on',
  contact_linkage_rate: 'Contacts linked to deals',
  contact_identity_resolution_rate: 'Contacts matched across systems',
};

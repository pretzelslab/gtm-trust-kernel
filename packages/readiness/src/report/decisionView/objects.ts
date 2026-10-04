/**
 * Static maps for the decision view: which CRM object each metric reads,
 * who most likely owns the fix, which checks need a second system, and the
 * objects the scan doesn't read yet. Typed as Record<MetricId, ...>, so
 * adding a metric to rubric.ts without a mapping here fails the typecheck.
 * No numbers live here; thresholds stay in rubric.ts.
 */

import type { MetricId } from '../../rubric.js';

export type ObjectId =
  | 'opportunity'
  | 'account'
  | 'activities'
  | 'notes'
  | 'opportunity_history'
  | 'contact_roles'
  | 'contact';

/** Fixed display order, also the tie-break when two objects rank equal. */
export const OBJECT_ORDER: readonly ObjectId[] = [
  'opportunity',
  'account',
  'activities',
  'notes',
  'opportunity_history',
  'contact_roles',
  'contact',
];

export const OBJECT_LABEL: Readonly<Record<ObjectId, string>> = {
  opportunity: 'Opportunity',
  account: 'Account',
  activities: 'Activities (Task/Event)',
  notes: 'Notes',
  opportunity_history: 'Opportunity history',
  contact_roles: 'Contact roles',
  contact: 'Contact',
};

export const METRIC_OBJECT: Readonly<Record<MetricId, ObjectId>> = {
  stage_mapping_coverage: 'opportunity',
  close_date_fill_rate: 'opportunity',
  past_due_close_date_rate: 'opportunity',
  closed_deal_count_12m: 'opportunity',
  amount_fill_rate: 'opportunity',
  next_step_fill_rate: 'opportunity',
  median_days_since_modified: 'opportunity',
  median_next_step_age_days: 'opportunity',
  owner_id_fill_rate: 'opportunity',
  round_amount_rate: 'opportunity',
  duplicate_account_rate: 'account',
  account_resolution_rate: 'account',
  activity_capture_rate: 'activities',
  temporal_anomaly_rate: 'activities',
  stage_activity_contradiction_rate: 'activities',
  activity_attribution_rate: 'activities',
  substantive_note_rate: 'notes',
  note_coverage_rate: 'notes',
  median_note_length_chars: 'notes',
  untrusted_text_ratio: 'notes',
  outcome_evidence_retention_rate: 'notes',
  pii_density: 'notes',
  close_date_history_enabled: 'opportunity_history',
  stage_history_months: 'opportunity_history',
  win_rate_dispersion: 'opportunity_history',
  owner_history_enabled: 'opportunity_history',
  contact_linkage_rate: 'contact_roles',
  contact_identity_resolution_rate: 'contact',
};

export type Owner = 'Admin' | 'Reps' | 'Reps + Admin' | 'RevOps';

export const METRIC_OWNER: Readonly<Record<MetricId, Owner>> = {
  stage_mapping_coverage: 'Admin',
  close_date_fill_rate: 'Reps + Admin',
  past_due_close_date_rate: 'Reps',
  closed_deal_count_12m: 'RevOps',
  amount_fill_rate: 'Reps',
  next_step_fill_rate: 'Reps',
  median_days_since_modified: 'Reps',
  median_next_step_age_days: 'Reps',
  owner_id_fill_rate: 'RevOps',
  round_amount_rate: 'RevOps',
  duplicate_account_rate: 'RevOps',
  account_resolution_rate: 'RevOps',
  activity_capture_rate: 'Admin',
  temporal_anomaly_rate: 'Admin',
  stage_activity_contradiction_rate: 'RevOps',
  activity_attribution_rate: 'Admin',
  substantive_note_rate: 'Reps',
  note_coverage_rate: 'Reps',
  median_note_length_chars: 'Reps',
  untrusted_text_ratio: 'Admin',
  outcome_evidence_retention_rate: 'Admin',
  pii_density: 'Admin',
  close_date_history_enabled: 'Admin',
  stage_history_months: 'Admin',
  win_rate_dispersion: 'RevOps',
  owner_history_enabled: 'Admin',
  contact_linkage_rate: 'Reps',
  contact_identity_resolution_rate: 'RevOps',
};

/**
 * Cross-system checks (rubric D5). With no second system connected they
 * have nothing to compare against, so the model leaves them out of the
 * object counts and shows "N check(s) need a second system" instead.
 */
export const SECOND_SOURCE_METRICS: ReadonlySet<MetricId> = new Set<MetricId>([
  'contact_identity_resolution_rate',
  'account_resolution_rate',
  'activity_attribution_rate',
  'temporal_anomaly_rate',
]);

/** Checks whose row also reads activity text, so the view says so. */
export const ALSO_READS_ACTIVITY_TEXT: ReadonlySet<MetricId> = new Set<MetricId>(['pii_density', 'untrusted_text_ratio']);

/** Objects the scan doesn't read yet: always shown, greyed, in this order, after the scanned objects. */
export const UNSCANNED_OBJECTS: readonly string[] = [
  'Leads',
  'Quotes',
  'Products / line items',
  'Campaigns',
  'Territories / targets',
];

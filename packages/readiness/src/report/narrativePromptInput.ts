/**
 * Builds the model-facing prompt input from ReportData. Decision 11
 * (docs/narrative-design.md): org.orgDescription is dropped entirely, not
 * just genericized -- in --live mode it's SalesforceAdapter.orgId, the
 * connected instance's hostname (salesforce.ts derives it as
 * `new URL(instanceUrl).host`), a customer-identifying value, and sending
 * it to a third-party model API is data egress this package's local-first
 * design doesn't otherwise permit. org.orgLabel is kept unchanged -- it is
 * already a generic, static string in both fixture mode (fixture.label)
 * and live mode (the hardcoded literal 'Live Salesforce org'), never
 * org-specific identifying data.
 *
 * Every field is copied explicitly (no spread of `data.org`) so a future
 * field added to ReportOrgSummary does not silently reach the model --
 * same "a new field must be a deliberate decision" property decision 12's
 * structural guard test enforces for ReportData as a whole.
 */

import type { ReportData } from './buildReport.js';
import type { NarrativePromptInput } from './narrativeTypes.js';

export function buildNarrativePromptInput(data: ReportData): NarrativePromptInput {
  return {
    generatedAt: data.generatedAt,
    org: {
      orgLabel: data.org.orgLabel,
      asOf: data.org.asOf,
      openSampleSize: data.org.openSampleSize,
      closedSampleSize: data.org.closedSampleSize,
      recordsScanned: data.org.recordsScanned,
      stopReason: data.org.stopReason,
      capabilityVerdictCounts: data.org.capabilityVerdictCounts,
      metricStatusCounts: data.org.metricStatusCounts,
    },
    metrics: data.metrics,
    capabilities: data.capabilities,
  };
}

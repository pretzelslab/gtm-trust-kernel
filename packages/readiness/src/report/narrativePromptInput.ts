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
 *
 * Metrics are likewise copied field-for-field, not spread (decision 18,
 * commit 2e) -- viableAt/degradedAt are renamed to target/limit, since the
 * literal field names ("viable"/"degraded") were leaking into the model's
 * prose about threshold values, not just about a metric's own tier. See
 * NarrativePromptMetricRow's docblock (narrativeTypes.ts) for why.
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
    metrics: data.metrics.map((m) => ({
      metric: m.metric,
      dimension: m.dimension,
      dimensionLabel: m.dimensionLabel,
      status: m.status,
      value: m.value,
      sampleSize: m.sampleSize,
      lowConfidence: m.lowConfidence,
      note: m.note,
      tier: m.tier,
      floor: m.floor,
      unit: m.unit,
      target: m.viableAt,
      limit: m.degradedAt,
      gatesCapabilities: m.gatesCapabilities,
    })),
    capabilities: data.capabilities,
  };
}

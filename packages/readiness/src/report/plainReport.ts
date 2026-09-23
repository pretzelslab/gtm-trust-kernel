/**
 * Standalone plain-English report: same ReportData as render.ts's tabular
 * report, rendered as prose for a non-technical reader — no metric table,
 * no verdict pills, no tier labels. See plainSummary.ts for how the prose
 * is derived (deterministic, no model call).
 */

import type { ReportData } from './buildReport.js';
import { escapeHtml, pageShell, renderBanner } from './shell.js';
import { buildFullNarrative } from './plainSummary.js';

export function renderPlainReportHtml(data: ReportData, options?: { readonly mode?: 'fixture' | 'live' }): string {
  const { org } = data;
  const banner = renderBanner(options?.mode ?? 'fixture', org.orgLabel);
  const narrative = buildFullNarrative(data);

  const capabilityParas = narrative.capabilityOutcomes
    .map(
      (c) => `<div class="capability-outcome"><strong>${escapeHtml(c.label)}:</strong> ${escapeHtml(c.outcome)}</div>`,
    )
    .join('\n  ');

  const body = `
  ${banner}
  <h1>Readiness report: ${escapeHtml(org.orgLabel)}</h1>
  <div class="meta">${escapeHtml(org.orgDescription)}</div>
  <div class="meta">asOf ${escapeHtml(org.asOf)} · generated ${escapeHtml(data.generatedAt)}</div>
  <p>${escapeHtml(narrative.summary)}</p>
  <h2>What this means for each capability</h2>
  ${capabilityParas}
  `;
  return pageShell(`Readiness report (plain English) — ${org.orgLabel}`, body);
}

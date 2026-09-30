/**
 * Standalone plain-English report: same ReportData as render.ts's tabular
 * report, rendered as prose + short bucketed lists for a non-technical
 * reader — no metric table, no verdict pills, no tier labels. See
 * plainSummary.ts for how the content is derived (deterministic, no model
 * call).
 */

import type { ReportData } from './buildReport.js';
import { escapeHtml, pageShell, renderBanner } from './shell.js';
import { buildFullNarrative, type CapabilityOutcome } from './plainSummary.js';
import { coverageNoticeText } from './render.js';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** UTC-based, not locale-dependent — a fixed "D MMM YYYY" so this page never varies by machine timezone or ICU version. */
function formatPlainDate(iso: string): string {
  const d = new Date(iso);
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

function renderBucket(heading: string, outcomes: readonly CapabilityOutcome[]): string {
  if (outcomes.length === 0) return '';
  const items = outcomes
    .map((c) => `<li><strong>${escapeHtml(c.label)}</strong> — ${escapeHtml(c.outcome)}</li>`)
    .join('\n    ');
  return `
  <h2>${escapeHtml(heading)}</h2>
  <ul>
    ${items}
  </ul>`;
}

export function renderPlainReportHtml(data: ReportData, options?: { readonly mode?: 'fixture' | 'live' }): string {
  const { org } = data;
  const banner = renderBanner(options?.mode ?? 'fixture', org.orgLabel);
  const narrative = buildFullNarrative(data);

  const body = `
  ${banner}
  <h1>Readiness report: ${escapeHtml(org.orgLabel)}</h1>
  <div class="meta">${escapeHtml(org.orgDescription)}</div>
  <div class="meta">Data as of ${formatPlainDate(org.asOf)} · Report generated ${formatPlainDate(data.generatedAt)}</div>
  ${coverageNoticeText(data) ? `<p class="note">${escapeHtml(coverageNoticeText(data)!)}</p>` : ''}
  <p>${escapeHtml(narrative.summary)}</p>
  ${renderBucket('Ready to use', narrative.ready)}
  ${renderBucket('Usable with caution', narrative.caution)}
  ${renderBucket("Can't tell yet", narrative.notMeasured)}
  ${renderBucket('Not ready yet', narrative.notReady)}
  `;
  return pageShell(`Readiness report (plain English) — ${org.orgLabel}`, body);
}

/**
 * Pure HTML rendering for the readiness report. Self-contained: inline
 * <style>, no external fonts/scripts/network requests, works offline.
 * Not covered by tests (buildReport.ts's ReportData shape is; this isn't).
 */

import type { MetricRow, MetricRowStatus, ReportCapabilityRow, ReportData } from './buildReport.js';
import type { Unit, Verdict } from '../rubric.js';
import { escapeHtml, pageShell, renderBanner } from './shell.js';
import { buildExecutiveSummary } from './plainSummary.js';

type StatusKey = Verdict | MetricRowStatus;

const STATUS_META: Readonly<Record<StatusKey, { label: string; cssClass: string }>> = {
  viable: { label: 'Viable', cssClass: 'status-viable' },
  degraded: { label: 'Degraded', cssClass: 'status-degraded' },
  blocked: { label: 'Blocked', cssClass: 'status-blocked' },
  ok: { label: 'OK', cssClass: 'status-viable' }, // only reached when a row somehow has no tier; shouldn't happen for graded metrics.
  not_applicable: { label: 'N/A', cssClass: 'status-not_applicable' },
  not_instrumented: { label: 'Not instrumented', cssClass: 'status-not_instrumented' },
  deferred: { label: 'Deferred', cssClass: 'status-deferred' },
  not_implemented: { label: 'Not yet implemented', cssClass: 'status-not_implemented' },
};

function rowStatusMeta(row: MetricRow): { label: string; cssClass: string } {
  if (row.status === 'ok' && row.tier) return STATUS_META[row.tier];
  return STATUS_META[row.status];
}

function formatValue(row: MetricRow): string {
  if (row.value === null) return '—';
  const prefix = row.floor ? '≥ ' : ''; // "at least" — value is a lower bound when some related notes/activities were truncated.
  const unit: Unit = row.unit;
  switch (unit) {
    case 'rate':
      return `${prefix}${(row.value * 100).toFixed(1)}%`;
    case 'bool':
      return row.value === 1 ? 'Yes' : 'No';
    case 'months':
      return `${prefix}${row.value} mo`;
    case 'days':
      return `${prefix}${row.value} d`;
    case 'chars':
      return `${prefix}${row.value} chars`;
    case 'count':
    default:
      return `${prefix}${row.value}`;
  }
}

function renderSummaryCards(data: ReportData): string {
  const { org } = data;
  const cv = org.capabilityVerdictCounts;
  const ms = org.metricStatusCounts;
  return `
  <div class="summary-grid">
    <div class="card"><div class="n">${org.openSampleSize}</div><div class="l">Open sampled</div></div>
    <div class="card"><div class="n">${org.closedSampleSize}</div><div class="l">Closed sampled</div></div>
    <div class="card"><div class="n">${org.recordsScanned}</div><div class="l">Records scanned</div></div>
    <div class="card"><div class="n">${cv.viable} / ${cv.degraded} / ${cv.blocked}</div><div class="l">Capabilities: viable / degraded / blocked</div></div>
    <div class="card"><div class="n">${ms.ok}</div><div class="l">Metrics computed</div></div>
    <div class="card"><div class="n">${ms.not_applicable + ms.not_instrumented}</div><div class="l">Not applicable / not instrumented</div></div>
    <div class="card"><div class="n">${ms.deferred + ms.not_implemented}</div><div class="l">Deferred / not yet implemented</div></div>
  </div>`;
}

function renderCapabilitiesTable(caps: readonly ReportCapabilityRow[]): string {
  const rows = caps
    .map((c) => {
      const meta = STATUS_META[c.verdict];
      return `<tr>
        <td>${escapeHtml(c.label)}<div class="note">${escapeHtml(c.description)}</div></td>
        <td><span class="pill ${meta.cssClass}">${meta.label}</span></td>
        <td>${c.coverageCeiling !== null ? `${(c.coverageCeiling * 100).toFixed(1)}%` : '—'}</td>
        <td>${c.blockerCount}</td>
      </tr>`;
    })
    .join('');
  return `
  <h2>Capabilities</h2>
  <table>
    <thead><tr><th>Capability</th><th>Verdict</th><th>Coverage ceiling</th><th>Blockers</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>`;
}

function renderMetricsTable(rows: readonly MetricRow[]): string {
  let lastDimension = '';
  const body = rows
    .map((row) => {
      const meta = rowStatusMeta(row);
      const header =
        row.dimension !== lastDimension
          ? ((lastDimension = row.dimension),
            `<tr class="dim-header"><td colspan="5">${row.dimension} — ${escapeHtml(row.dimensionLabel)}</td></tr>`)
          : '';
      const gates = row.gatesCapabilities.length
        ? row.gatesCapabilities.map((g) => escapeHtml(g.label)).join(', ')
        : '—';
      const thresh =
        row.viableAt !== null && row.degradedAt !== null
          ? `viable ≥ ${row.viableAt}, degraded ≥ ${row.degradedAt}`
          : '';
      const lowConf = row.lowConfidence ? `<div class="lowconf">low confidence (n=${row.sampleSize})</div>` : '';
      const floorBadge = row.floor
        ? `<span class="floor-badge" title="Value is a lower bound: at least one opportunity's related notes/activities were truncated at the adapter's per-opportunity limit.">FLOOR</span>`
        : '';
      return `${header}<tr>
        <td>${escapeHtml(row.metric)}</td>
        <td>${formatValue(row)}${floorBadge}</td>
        <td><span class="pill ${meta.cssClass}">${meta.label}</span>${lowConf}</td>
        <td class="note">${row.note ? escapeHtml(row.note) : ''}</td>
        <td class="gates">${gates}${thresh ? `<div class="thresh">${escapeHtml(thresh)}</div>` : ''}</td>
      </tr>`;
    })
    .join('');
  return `
  <h2>Metrics</h2>
  <table>
    <thead><tr><th>Metric</th><th>Value</th><th>Tier</th><th>Note</th><th>Gates / threshold</th></tr></thead>
    <tbody>${body}</tbody>
  </table>`;
}

export function renderReportHtml(data: ReportData, options?: { readonly mode?: 'fixture' | 'live' }): string {
  const { org } = data;
  const banner = renderBanner(options?.mode ?? 'fixture', org.orgLabel);
  const body = `
  ${banner}
  <h1>Readiness report: ${escapeHtml(org.orgLabel)}</h1>
  <div class="meta">${escapeHtml(org.orgDescription)}</div>
  <div class="meta">asOf ${escapeHtml(org.asOf)} · generated ${escapeHtml(data.generatedAt)}</div>
  <details class="plain-summary"><summary>Plain-English summary</summary><p>${escapeHtml(buildExecutiveSummary(data))}</p></details>
  ${renderSummaryCards(data)}
  ${renderCapabilitiesTable(data.capabilities)}
  ${renderMetricsTable(data.metrics)}
  `;
  return pageShell(`Readiness report — ${org.orgLabel}`, body);
}

export function renderComparisonHtml(datas: readonly ReportData[]): string {
  const fixtureLabels = datas.map((d) => d.org.orgLabel).join(' / ');

  const summaries = datas
    .map(
      (d) => `
    <div class="card">
      <div class="n">${escapeHtml(d.org.orgLabel)}</div>
      <div class="l">${escapeHtml(d.org.orgDescription)}</div>
      <div class="note">Capabilities viable/degraded/blocked: ${d.org.capabilityVerdictCounts.viable} / ${d.org.capabilityVerdictCounts.degraded} / ${d.org.capabilityVerdictCounts.blocked}</div>
    </div>`,
    )
    .join('');

  const metricIds = datas[0]?.metrics.map((m) => m.metric) ?? [];
  let lastDimension = '';
  const matrixRows = metricIds
    .map((metric, i) => {
      const first = datas[0]!.metrics[i]!;
      const header =
        first.dimension !== lastDimension
          ? ((lastDimension = first.dimension),
            `<tr class="dim-header"><td colspan="${1 + datas.length}">${first.dimension} — ${escapeHtml(first.dimensionLabel)}</td></tr>`)
          : '';
      const cells = datas
        .map((d) => {
          const row = d.metrics.find((m) => m.metric === metric)!;
          const meta = rowStatusMeta(row);
          const floorBadge = row.floor
            ? `<span class="floor-badge" title="Value is a lower bound: at least one opportunity's related notes/activities were truncated.">FLOOR</span>`
            : '';
          return `<td><span class="pill ${meta.cssClass}">${meta.label}</span>${floorBadge}<div class="note">${formatValue(row)}</div></td>`;
        })
        .join('');
      return `${header}<tr><td>${escapeHtml(metric)}</td>${cells}</tr>`;
    })
    .join('');

  const colHeaders = datas.map((d) => `<th>${escapeHtml(d.org.orgLabel)}</th>`).join('');

  const body = `
  <div class="banner">MOCK DATA — comparison: ${escapeHtml(fixtureLabels)}. No real CRM was contacted; nothing leaves this machine.</div>
  <h1>Readiness comparison</h1>
  <div class="meta">generated ${escapeHtml(datas[0]?.generatedAt ?? '')}</div>
  <div class="summary-grid">${summaries}</div>
  <h2>Metrics</h2>
  <table>
    <thead><tr><th>Metric</th>${colHeaders}</tr></thead>
    <tbody>${matrixRows}</tbody>
  </table>`;

  return pageShell('Readiness comparison', body);
}

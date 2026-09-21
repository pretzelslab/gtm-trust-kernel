/**
 * Pure HTML rendering for the readiness report. Self-contained: inline
 * <style>, no external fonts/scripts/network requests, works offline.
 * Not covered by tests (buildReport.ts's ReportData shape is; this isn't).
 */

import type { MetricRow, MetricRowStatus, ReportCapabilityRow, ReportData } from './buildReport.js';
import type { Unit, Verdict } from '../rubric.js';

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

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
  const unit: Unit = row.unit;
  switch (unit) {
    case 'rate':
      return `${(row.value * 100).toFixed(1)}%`;
    case 'bool':
      return row.value === 1 ? 'Yes' : 'No';
    case 'months':
      return `${row.value} mo`;
    case 'days':
      return `${row.value} d`;
    case 'chars':
      return `${row.value} chars`;
    case 'count':
    default:
      return `${row.value}`;
  }
}

const STYLE = `
  :root {
    color-scheme: light dark;
    --bg: #ffffff; --fg: #1a1a1a; --muted: #6b7280; --border: #e2e2e2; --card-bg: #f9f9fb;
    --viable-bg: #d9f2e3; --viable-fg: #1a7f37;
    --degraded-bg: #fdecc8; --degraded-fg: #8a5a00;
    --blocked-bg: #fbeae9; --blocked-fg: #b42318;
    --na-bg: #f0f0f2; --na-fg: #6b7280;
    --ninstr-bg: #eaf1fb; --ninstr-fg: #3b5b82;
    --deferred-bg: #f1edf9; --deferred-fg: #5b4b8a;
    --nimpl-bg: #ececec; --nimpl-fg: #767676;
  }
  @media (prefers-color-scheme: dark) {
    :root { --bg: #14161a; --fg: #e7e7ea; --muted: #9aa0a6; --border: #2b2e33; --card-bg: #1c1f24; }
  }
  * { box-sizing: border-box; }
  body { margin: 0; padding: 24px; background: var(--bg); color: var(--fg); font: 14px/1.5 -apple-system, Segoe UI, Helvetica, Arial, sans-serif; }
  h1 { font-size: 20px; margin: 0 0 4px; }
  h2 { font-size: 16px; margin: 28px 0 10px; }
  .banner { background: #b42318; color: #fff; font-weight: 700; padding: 10px 14px; border-radius: 6px; margin-bottom: 18px; letter-spacing: 0.02em; }
  .meta { color: var(--muted); font-size: 12px; margin-bottom: 4px; }
  .summary-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 10px; margin: 12px 0 20px; }
  .card { background: var(--card-bg); border: 1px solid var(--border); border-radius: 8px; padding: 10px 12px; }
  .card .n { font-size: 20px; font-weight: 700; }
  .card .l { color: var(--muted); font-size: 11px; text-transform: uppercase; letter-spacing: 0.04em; }
  table { width: 100%; border-collapse: collapse; margin-bottom: 18px; }
  th, td { text-align: left; padding: 6px 8px; border-bottom: 1px solid var(--border); vertical-align: top; font-size: 13px; }
  th { color: var(--muted); font-weight: 600; font-size: 11px; text-transform: uppercase; letter-spacing: 0.03em; }
  tr.dim-header td { background: var(--card-bg); font-weight: 700; padding-top: 14px; }
  .pill { display: inline-block; padding: 2px 8px; border-radius: 999px; font-size: 12px; font-weight: 600; white-space: nowrap; }
  .status-viable { background: var(--viable-bg); color: var(--viable-fg); }
  .status-degraded { background: var(--degraded-bg); color: var(--degraded-fg); }
  .status-blocked { background: var(--blocked-bg); color: var(--blocked-fg); }
  .status-not_applicable { background: var(--na-bg); color: var(--na-fg); }
  .status-not_instrumented { background: var(--ninstr-bg); color: var(--ninstr-fg); }
  .status-deferred { background: var(--deferred-bg); color: var(--deferred-fg); border: 1px dashed var(--deferred-fg); }
  .status-not_implemented { background: var(--nimpl-bg); color: var(--nimpl-fg); border: 1px dashed var(--nimpl-fg); }
  .note { color: var(--muted); font-size: 12px; }
  .gates { font-size: 12px; color: var(--muted); }
  .thresh { font-size: 11px; color: var(--muted); white-space: nowrap; }
  .lowconf { font-size: 11px; color: var(--degraded-fg); }
`;

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
      return `${header}<tr>
        <td>${escapeHtml(row.metric)}</td>
        <td>${formatValue(row)}</td>
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

function pageShell(title: string, body: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>${STYLE}</style>
</head>
<body>
${body}
</body>
</html>`;
}

export function renderReportHtml(data: ReportData): string {
  const { org } = data;
  const body = `
  <div class="banner">MOCK DATA — fixture: ${escapeHtml(org.orgLabel)}. No real CRM was contacted; nothing leaves this machine.</div>
  <h1>Readiness report: ${escapeHtml(org.orgLabel)}</h1>
  <div class="meta">${escapeHtml(org.orgDescription)}</div>
  <div class="meta">asOf ${escapeHtml(org.asOf)} · generated ${escapeHtml(data.generatedAt)}</div>
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
          return `<td><span class="pill ${meta.cssClass}">${meta.label}</span><div class="note">${formatValue(row)}</div></td>`;
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

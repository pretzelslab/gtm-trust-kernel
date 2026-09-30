/**
 * Pure HTML rendering for the readiness report. Self-contained: inline
 * <style>, no external fonts/scripts/network requests, works offline.
 * Not covered by tests (buildReport.ts's ReportData shape is; this isn't).
 */

import { gateVerdictOf, type MetricRow, type MetricRowStatus, type ReportCapabilityRow, type ReportData } from './buildReport.js';
import { THRESHOLDS, type CapabilityVerdict, type Unit } from '../rubric.js';
import { escapeHtml, pageShell, renderBanner } from './shell.js';
import { buildExecutiveSummary } from './plainSummary.js';
import type { NarrativeResult } from './narrative.js';

type StatusKey = CapabilityVerdict | MetricRowStatus;

const STATUS_META: Readonly<Record<StatusKey, { label: string; cssClass: string }>> = {
  viable: { label: 'Viable', cssClass: 'status-viable' },
  degraded: { label: 'Degraded', cssClass: 'status-degraded' },
  blocked: { label: 'Blocked', cssClass: 'status-blocked' },
  not_measured: { label: 'Not measured', cssClass: 'status-not_instrumented' },
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
    <div class="card"><div class="n">${org.eligibleOpportunities}</div><div class="l">Eligible deals</div></div>
    <div class="card"><div class="n">${cv.viable} / ${cv.degraded} / ${cv.not_measured} / ${cv.blocked}</div><div class="l">Capabilities: viable / degraded / not measured / blocked</div></div>
    <div class="card"><div class="n">${ms.ok}</div><div class="l">Metrics computed</div></div>
    <div class="card"><div class="n">${ms.not_applicable + ms.not_instrumented}</div><div class="l">Not applicable / not instrumented</div></div>
    <div class="card"><div class="n">${ms.deferred + ms.not_implemented}</div><div class="l">Deferred / not yet implemented</div></div>
  </div>`;
}

const GATE_RANK: Readonly<Record<CapabilityVerdict, number>> = { viable: 0, degraded: 1, not_measured: 2, blocked: 3 };

/**
 * Every gate holding a capability back, worst first, each with its own
 * verdict. A not-measured capability still lists its degraded gates, so the
 * reader sees what the scan could measure as well as what it couldn't.
 */
function renderGatesHoldingBack(c: ReportCapabilityRow, metrics: readonly MetricRow[]): string {
  const held = metrics
    .filter((m) => m.gatesCapabilities.some((g) => g.id === c.id))
    .map((m) => ({ metric: m.metric, verdict: gateVerdictOf(m) }))
    .filter((g) => g.verdict !== 'viable')
    .sort((a, b) => GATE_RANK[b.verdict] - GATE_RANK[a.verdict]);
  if (held.length === 0) return '';
  const items = held.map((g) => `${escapeHtml(g.metric)} (${STATUS_META[g.verdict].label.toLowerCase()})`).join(', ');
  return `<div class="gates">${items}</div>`;
}

/**
 * Shown whenever the scan left eligible deals unread (budget hit, or a
 * --quick early stop): it reads the newest created first, so the ones it
 * missed are the oldest.
 */
export function coverageNoticeText(data: ReportData): string | null {
  const { org } = data;
  if (org.eligibleDealsUnread <= 0) return null;
  const scanned = `Scanned the ${org.recordsScanned} most recently created of ${org.eligibleOpportunities} eligible deals. `;
  if (org.olderOpenDealsExcluded <= 0) {
    return `${scanned}The ${org.eligibleDealsUnread} oldest were not read, so this report describes newer deals.`;
  }
  const deals = org.olderOpenDealsExcluded === 1 ? 'older open deal was' : 'older open deals were';
  return `${scanned}${org.olderOpenDealsExcluded} ${deals} excluded, so this report describes newer deals.`;
}

/** Always shown: both tiers' sizes and the seed that drew the detailed-check sample. */
export function sampleSizeText(data: ReportData): string {
  const { org } = data;
  return (
    `Scanned ${org.recordsScanned} of ${org.eligibleOpportunities} eligible deals; ` +
    `detailed checks on ${org.openSampleSize + org.closedSampleSize} sampled deals ` +
    `(up to ${org.hydratePerStratum} per stage, seed "${org.sampleSeed}").`
  );
}

function renderCoverageNotice(data: ReportData): string {
  const text = coverageNoticeText(data);
  return text ? `<div class="narrative-fallback-notice">${escapeHtml(text)}</div>` : '';
}

const STAGE_MAP_METRICS: ReadonlySet<string> = new Set(['stage_mapping_coverage', 'win_rate_dispersion']);

/**
 * Shown once when the sample held a stage with no standard mapping and the
 * adapter says how to map it. Never names a stage: the hint is the
 * adapter's static text (MetricRow.fixHint).
 */
export function stageMapNoticeText(data: ReportData): string | null {
  const hint = data.metrics.find((m) => STAGE_MAP_METRICS.has(m.metric) && !m.notMeasured && m.fixHint !== null)?.fixHint;
  return hint ? `Some deals have a stage this tool doesn't recognise, so stage-based checks skip them. ${hint}` : null;
}

function renderStageMapNotice(data: ReportData): string {
  const text = stageMapNoticeText(data);
  return text ? `<div class="narrative-fallback-notice">${escapeHtml(text)}</div>` : '';
}

function renderCapabilitiesTable(caps: readonly ReportCapabilityRow[], metrics: readonly MetricRow[]): string {
  const rows = caps
    .map((c) => {
      const meta = STATUS_META[c.verdict];
      return `<tr>
        <td>${escapeHtml(c.label)}<div class="note">${escapeHtml(c.description)}</div></td>
        <td><span class="pill ${meta.cssClass}">${meta.label}</span></td>
        <td>${c.coverageCeiling !== null ? `${(c.coverageCeiling * 100).toFixed(1)}%` : '—'}</td>
        <td>${c.blockerCount}${renderGatesHoldingBack(c, metrics)}</td>
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
      const cmp = THRESHOLDS[row.metric].direction === 'lower_is_better' ? '≤' : '≥';
      const thresh =
        row.viableAt !== null && row.degradedAt !== null
          ? `viable ${cmp} ${row.viableAt}, degraded ${cmp} ${row.degradedAt}`
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

/**
 * The "Plain-English summary" slot's body. `narrative` undefined (the
 * default -- commit 4's --narrative CLI flag is opt-in) reproduces the
 * exact prior markup, unchanged. `ok: true` renders one <li> per claim
 * (decision 22's model order, preserved by buildNarrative), each with a
 * `title` tooltip listing its groundedIn ids for traceability -- ids are
 * already grounding-validated by the time a caller builds a NarrativeResult,
 * but escaped anyway, same defense-in-depth as everything else here.
 * `ok: false` shows the visible fallback notice (decision 9) directly above
 * the same deterministic paragraph the undefined case already shows --
 * `result.text` on the fallback branch is exactly buildExecutiveSummary's
 * output (decision 20), so this never duplicates or diverges from it.
 */
function renderNarrativeBody(data: ReportData, narrative: NarrativeResult | undefined): string {
  if (!narrative) {
    return `<p>${escapeHtml(buildExecutiveSummary(data))}</p>`;
  }
  if (narrative.ok) {
    const items = narrative.claims
      .map((c) => `<li title="${escapeHtml(c.groundedIn.join(', '))}">${escapeHtml(c.text)}</li>`)
      .join('');
    return `<ul>${items}</ul>`;
  }
  return `<div class="narrative-fallback-notice">${escapeHtml(narrative.notice)}</div><p>${escapeHtml(narrative.text)}</p>`;
}

export function renderReportHtml(
  data: ReportData,
  options?: { readonly mode?: 'fixture' | 'live'; readonly narrative?: NarrativeResult },
): string {
  const { org } = data;
  const banner = renderBanner(options?.mode ?? 'fixture', org.orgLabel);
  const body = `
  ${banner}
  <h1>Readiness report: ${escapeHtml(org.orgLabel)}</h1>
  <div class="meta">${escapeHtml(org.orgDescription)}</div>
  <div class="meta">asOf ${escapeHtml(org.asOf)} · generated ${escapeHtml(data.generatedAt)}</div>
  <div class="meta">${escapeHtml(sampleSizeText(data))}</div>
  ${renderCoverageNotice(data)}
  ${renderStageMapNotice(data)}
  <details class="plain-summary"><summary>Plain-English summary</summary>${renderNarrativeBody(data, options?.narrative)}</details>
  ${renderSummaryCards(data)}
  ${renderCapabilitiesTable(data.capabilities, data.metrics)}
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
      <div class="note">Capabilities viable/degraded/not measured/blocked: ${d.org.capabilityVerdictCounts.viable} / ${d.org.capabilityVerdictCounts.degraded} / ${d.org.capabilityVerdictCounts.not_measured} / ${d.org.capabilityVerdictCounts.blocked}</div>
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

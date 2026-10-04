/**
 * Renders the decision view model (model.ts) as HTML plus inline SVG, for
 * the top of both single-org reports. Inline markup only: no script, no
 * external font or stylesheet, no `xmlns` (an HTML5 inline <svg> doesn't
 * need it, and the reports forbid "http://"), and the only `url(` is the
 * in-page hatch pattern. No <li>, <ul>, <table> or "pill" class, which the
 * existing report tests count or forbid. Every coloured mark also carries a
 * symbol or a word. Every string goes through escapeHtml. Styles live in
 * shell.ts (the `dv-` classes).
 */

import type { ReportData } from '../buildReport.js';
import { escapeHtml } from '../shell.js';
import {
  buildDecisionView,
  BUCKET_WORD,
  STATUS_WORD,
  type CardBucket,
  type CardCheck,
  type CellStatus,
  type DecisionViewModel,
  type FixGroup,
  type ObjectHealthRow,
  type PlainStatus,
  type UseCaseCard,
} from './model.js';
import { PLAIN_CHECK_LABEL } from './labels.js';
import type { MetricId, Unit } from '../../rubric.js';

/** Shown for a can't-tell check when the adapter gave no setting hint. */
export const NO_HINT_FALLBACK = "The scan can't see this data. Check field access or the integration.";

const STATUS_SYMBOL: Readonly<Record<CellStatus, string>> = {
  pass: '✓',
  weak: '!',
  failing: '✕',
  cant_tell: '?',
  none: '–',
};

const BUCKET_SYMBOL: Readonly<Record<CardBucket, string>> = { ready: '✓', caution: '!', notReady: '✕', cantTell: '?' };

/** The status each bucket's colour borrows. */
const BUCKET_STATUS: Readonly<Record<CardBucket, PlainStatus>> = {
  ready: 'pass',
  caution: 'weak',
  notReady: 'failing',
  cantTell: 'cant_tell',
};

const SUMMARY_ORDER: readonly CardBucket[] = ['ready', 'caution', 'notReady', 'cantTell'];

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** The plain label for a check (labels.ts). */
export function checkName(metric: MetricId): string {
  return PLAIN_CHECK_LABEL[metric];
}

function statusTag(status: CellStatus): string {
  const word = status === 'none' ? 'none' : STATUS_WORD[status];
  return `<span class="dv-tag dv-s-${status}"><span aria-hidden="true">${STATUS_SYMBOL[status]}</span> ${escapeHtml(word)}</span>`;
}

function bucketTag(bucket: CardBucket): string {
  return `<span class="dv-tag dv-s-${BUCKET_STATUS[bucket]}"><span aria-hidden="true">${BUCKET_SYMBOL[bucket]}</span> ${escapeHtml(BUCKET_WORD[bucket])}</span>`;
}

/** Percent of the bar, clamped to the track, two decimals. */
export function barPercent(value: number, axisMax: number): string {
  if (axisMax <= 0) return '0.00';
  return Math.min(100, Math.max(0, (value / axisMax) * 100)).toFixed(2);
}

function formatNumber(value: number, unit: Unit): string {
  switch (unit) {
    case 'rate':
      return `${Math.round(value * 1000) / 10}%`;
    case 'days':
      return plural(value, 'day', 'days');
    case 'months':
      return plural(value, 'month', 'months');
    case 'chars':
      return plural(value, 'char', 'chars');
    case 'bool':
      return value === 1 ? 'Yes' : 'No';
    case 'count':
    default:
      return String(value);
  }
}

// ---------------------------------------------------------------------------
// The five numbered parts and the jump bar
// ---------------------------------------------------------------------------

export type PartId = 'data-health' | 'verdict-counts' | 'fix-first' | 'use-cases' | 'heatmap';

/**
 * The five parts in page order: anchor id, numbered heading and one-line
 * lede. A lede never repeats a heading (a polish test slices the view from
 * "Fix this first" to "Use cases and the checks behind them").
 */
export const DV_PARTS: readonly { readonly id: PartId; readonly title: string; readonly lede: string }[] = [
  { id: 'data-health', title: 'Data health by CRM object', lede: 'Which CRM objects have weak or failing checks, worst first.' },
  {
    id: 'verdict-counts',
    title: 'AI use cases',
    lede: "How many AI use cases your data supports today, and how many it can't judge yet.",
  },
  { id: 'fix-first', title: 'Fix this first', lede: 'The changes that free up the most use cases, and who usually owns them.' },
  {
    id: 'use-cases',
    title: 'Use cases and the checks behind them',
    lede: 'For each use case, the checks behind its verdict and how far each is from passing.',
  },
  { id: 'heatmap', title: 'Use cases by CRM object', lede: 'Where each use case breaks down, by CRM object.' },
];

/** The id of the band that wraps each report's existing content after the decision view. */
export const DETAILS_ID = 'details';

/** Jump bar labels, in page order; the last one goes to the details band. */
export const JUMP_LINKS: readonly { readonly id: string; readonly label: string }[] = [
  { id: 'data-health', label: 'Data health' },
  { id: 'verdict-counts', label: 'Counts' },
  { id: 'fix-first', label: 'Fixes' },
  { id: 'use-cases', label: 'Use cases' },
  { id: 'heatmap', label: 'Grid' },
  { id: DETAILS_ID, label: 'Details' },
];

/** Plain links only, no list markup (the report tests count "<li"). */
export function renderJumpBar(): string {
  const links = JUMP_LINKS.map((l) => `<a href="#${escapeHtml(l.id)}">${escapeHtml(l.label)}</a>`).join('');
  return `<div class="jump" role="navigation" aria-label="Jump to section">${links}</div>`;
}

function part(id: PartId, content: string): string {
  const n = DV_PARTS.findIndex((p) => p.id === id);
  const p = DV_PARTS[n]!;
  return `<div class="dv-part" id="${id}">
    <div class="dv-part-head"><h3>${n + 1} · ${escapeHtml(p.title)}</h3><p class="dv-lede">${escapeHtml(p.lede)}</p></div>
    ${content}
  </div>`;
}

// ---------------------------------------------------------------------------
// 1. Data health by CRM object
// ---------------------------------------------------------------------------

const HATCH_DEFS =
  '<svg class="dv-defs" width="0" height="0" aria-hidden="true" focusable="false"><defs>' +
  '<pattern id="dv-hatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">' +
  '<rect class="dv-hatch-bg" width="6" height="6"></rect><rect class="dv-hatch-line" x="0" y="0" width="2.5" height="6"></rect>' +
  '</pattern></defs></svg>';

function objectCountsText(o: ObjectHealthRow): string {
  const parts = [`${o.pass} of ${plural(o.total, 'check', 'checks')} pass`, `${o.weak} weak`, `${o.failing} failing`];
  if (o.cantTell > 0) parts.push(`${o.cantTell} can't tell`);
  return parts.join(', ');
}

function objectBar(o: ObjectHealthRow): string {
  const segments: { status: PlainStatus; n: number }[] = [
    { status: 'pass', n: o.pass },
    { status: 'weak', n: o.weak },
    { status: 'failing', n: o.failing },
    { status: 'cant_tell', n: o.cantTell },
  ];
  let x = 0;
  const rects = segments
    .filter((s) => s.n > 0)
    .map((s) => {
      const width = (s.n / o.total) * 100;
      const fill = s.status === 'cant_tell' ? ' fill="url(#dv-hatch)"' : '';
      const rect = `<rect class="dv-f-${s.status}" x="${x.toFixed(2)}%" y="0" width="${width.toFixed(2)}%" height="100%"${fill}><title>${s.n} ${escapeHtml(STATUS_WORD[s.status])}</title></rect>`;
      x += width;
      return rect;
    })
    .join('');
  return `<svg class="dv-bar dv-objbar" role="img" aria-label="${escapeHtml(objectCountsText(o))}">${rects}</svg>`;
}

function renderObjectRow(o: ObjectHealthRow): string {
  const extra =
    o.needSecondSystem > 0
      ? `<div class="dv-sub">${escapeHtml(o.needSecondSystem === 1 ? '1 check needs a second system' : `${o.needSecondSystem} checks need a second system`)}</div>`
      : '';
  const activityNote = o.metrics.some((m) => m.alsoReadsActivityText)
    ? `<div class="dv-sub">${escapeHtml(
        `Also reads activity text: ${o.metrics
          .filter((m) => m.alsoReadsActivityText)
          .map((m) => checkName(m.metric))
          .join('; ')}`,
      )}</div>`
    : '';
  return `<div class="dv-obj" data-object="${escapeHtml(o.object)}">
      <div class="dv-obj-name">${escapeHtml(o.label)}${extra}${activityNote}</div>
      ${objectBar(o)}
      <div class="dv-obj-counts">${escapeHtml(objectCountsText(o))}</div>
    </div>`;
}

function renderGreyRow(label: string, text: string): string {
  return `<div class="dv-obj dv-obj-off">
      <div class="dv-obj-name">${escapeHtml(label)}</div>
      <div class="dv-bar dv-objbar dv-bar-off"></div>
      <div class="dv-obj-counts">${escapeHtml(text)}</div>
    </div>`;
}

function renderObjects(view: DecisionViewModel): string {
  const rows = [
    ...view.objects.map(renderObjectRow),
    ...view.secondSystemOnly.map((o) => renderGreyRow(o.label, 'needs a second system')),
    ...view.unscanned.map((o) => renderGreyRow(o.label, 'not scanned yet')),
  ].join('');
  return part('data-health', `<div class="dv-panel dv-objects">${rows}</div>`);
}

// ---------------------------------------------------------------------------
// 2. Summary strip
// ---------------------------------------------------------------------------

function renderSummary(view: DecisionViewModel): string {
  const counts: Readonly<Record<CardBucket, number>> = {
    ready: view.summary.ready,
    caution: view.summary.caution,
    notReady: view.summary.notReady,
    cantTell: view.summary.cantTell,
  };
  const stats = SUMMARY_ORDER.map(
    (b) => `<div class="dv-stat dv-s-${BUCKET_STATUS[b]}" data-bucket="${b}">
        <div class="dv-stat-n">${counts[b]}</div>
        <div class="dv-stat-l"><span aria-hidden="true">${BUCKET_SYMBOL[b]}</span> ${escapeHtml(BUCKET_WORD[b])}</div>
      </div>`,
  ).join('');
  return part('verdict-counts', `<div class="dv-strip">${stats}</div>`);
}

// ---------------------------------------------------------------------------
// 3. Fix this first
// ---------------------------------------------------------------------------

function unique(values: readonly string[]): string[] {
  return [...new Set(values)];
}

function renderFix(group: FixGroup, rank: number): string {
  const action = group.action ?? NO_HINT_FALLBACK;
  const many = group.items.length > 1;
  const holds = `Holds back ${plural(group.holdsBackCount, 'use case', 'use cases')}: ${group.holdsBack.map((h) => h.label).join(', ')}`;
  const objects = unique(group.items.map((f) => f.objectLabel)).join(', ');
  const owners = unique(group.items.map((f) => f.owner)).join(', ');
  const checks = group.items.map((f) => checkName(f.metric)).join(', ');
  const headline = many ? `<div class="dv-fix-group">One setting unlocks ${group.items.length} checks</div>` : '';
  return `<div class="dv-fix dv-s-${group.status}-edge" data-metric="${escapeHtml(group.items.map((f) => f.metric).join(' '))}">
      <div class="dv-fix-rank">${rank}</div>
      <div class="dv-fix-body">
        ${headline}<div class="dv-fix-action">${escapeHtml(action)}</div>
        <div class="dv-fix-meta">${statusTag(group.status)} <span>${escapeHtml(objects)}</span> <span class="dv-dot" aria-hidden="true">·</span> <span>Owner: ${escapeHtml(owners)}</span> <span class="dv-dot" aria-hidden="true">·</span> <span class="dv-muted">${escapeHtml(checks)}</span></div>
        <div class="dv-fix-holds">${escapeHtml(holds)}</div>
      </div>
    </div>`;
}

function renderFixes(view: DecisionViewModel): string {
  const body =
    view.fixGroups.length === 0
      ? `<div class="dv-empty">${statusTag('pass')} Nothing to fix: every check behind a use case passes.</div>`
      : view.fixGroups.map((g, i) => renderFix(g, i + 1)).join('');
  return part('fix-first', `<div class="dv-fixes">${body}</div>`);
}

// ---------------------------------------------------------------------------
// 4. Use-case cards
// ---------------------------------------------------------------------------

function thresholdText(check: CardCheck): string {
  if (check.viableAt === null || check.degradedAt === null) return '';
  if (check.kind === 'yes_no') return `pass = ${formatNumber(check.viableAt, 'bool')}`;
  const cmp = check.direction === 'lower_is_better' ? '≤' : '≥';
  const base = `pass ${cmp} ${formatNumber(check.viableAt, check.unit)}, weak ${cmp} ${formatNumber(check.degradedAt, check.unit)}`;
  return check.direction === 'lower_is_better' ? `${base} · lower is better` : base;
}

function checkBar(check: CardCheck): string {
  if (check.status === 'cant_tell') {
    return `<svg class="dv-bar dv-checkbar" role="img" aria-label="can't tell"><rect class="dv-track" x="0" y="3" width="100%" height="8" fill="url(#dv-hatch)"></rect></svg>`;
  }
  const axisMax = check.axisMax ?? 1;
  const fill =
    check.value === null
      ? ''
      : `<rect class="dv-fill dv-f-${check.status}" x="0" y="3" width="${barPercent(check.value, axisMax)}%" height="8" data-value="${check.value}"></rect>`;
  // Markers are rects, never <line>: the report tests count "<li" matches.
  // Pass line: one solid tick. Weak line: a broken tick (top and bottom).
  const marks: string[] = [];
  if (check.viableAt !== null) {
    const p = barPercent(check.viableAt, axisMax);
    marks.push(`<g class="dv-mark dv-mark-pass" data-at="${p}" transform="translate(-1 0)"><title>pass line</title><rect x="${p}%" y="0" width="2" height="14"></rect></g>`);
  }
  if (check.degradedAt !== null) {
    const p = barPercent(check.degradedAt, axisMax);
    marks.push(
      `<g class="dv-mark dv-mark-weak" data-at="${p}" transform="translate(-1 0)"><title>weak line</title><rect x="${p}%" y="0" width="2" height="4"></rect><rect x="${p}%" y="10" width="2" height="4"></rect></g>`,
    );
  }
  const label = check.value === null ? 'no data' : formatNumber(check.value, check.unit);
  return `<svg class="dv-bar dv-checkbar" role="img" aria-label="${escapeHtml(`${label}, ${thresholdText(check)}`)}"><rect class="dv-track" x="0" y="3" width="100%" height="8"></rect>${fill}${marks.join('')}</svg>`;
}

function renderCheck(check: CardCheck): string {
  const noSecond = check.noSecondSystem ? ' <span class="dv-flag">no second system</span>' : '';
  let visual: string;
  let foot: string;
  if (check.status === 'cant_tell') {
    visual = checkBar(check);
    foot = `<div class="dv-check-foot dv-hint">${escapeHtml(check.hint ?? NO_HINT_FALLBACK)}</div>`;
  } else if (check.kind === 'yes_no') {
    const yes = check.value === null ? 'No data' : formatNumber(check.value, 'bool');
    visual = `<div class="dv-yn"><span class="dv-yn-v dv-s-${check.status}">${escapeHtml(yes)}</span></div>`;
    foot = `<div class="dv-check-foot">${escapeHtml(thresholdText(check))}</div>`;
  } else {
    visual = checkBar(check);
    const value = check.value === null ? 'No data' : `${check.floor ? 'at least ' : ''}${formatNumber(check.value, check.unit)}`;
    const thresh = thresholdText(check);
    foot = `<div class="dv-check-foot"><strong>${escapeHtml(value)}</strong>${thresh ? ` <span class="dv-muted">· ${escapeHtml(thresh)}</span>` : ''}</div>`;
  }
  return `<div class="dv-check" data-metric="${escapeHtml(check.metric)}" data-status="${check.status}">
          <div class="dv-check-head"><span class="dv-check-name">${escapeHtml(checkName(check.metric))}</span>${noSecond} ${statusTag(check.status)}</div>
          ${visual}
          ${foot}
        </div>`;
}

function renderChecks(checks: readonly CardCheck[]): string {
  return `<div class="dv-checks">${checks.map(renderCheck).join('')}</div>`;
}

/**
 * A ready card folds every check under one "All N checks pass" line; any
 * other card shows its weak, failing and can't-tell checks and folds the
 * passing ones under "N checks pass". Native <details>, no script. Every
 * check stays in the markup either way.
 */
function renderCardBody(card: UseCaseCard): string {
  const passing = card.checks.filter((c) => c.status === 'pass');
  if (card.bucket === 'ready') {
    if (card.checks.length === 0) return '';
    return `<details class="dv-fold"><summary>${card.checks.length === 1 ? 'The 1 check passes' : `All ${card.checks.length} checks pass`}</summary>${renderChecks(card.checks)}</details>`;
  }
  const open = card.checks.filter((c) => c.status !== 'pass');
  const fold =
    passing.length === 0
      ? ''
      : `<details class="dv-fold"><summary>${passing.length === 1 ? '1 check passes' : `${passing.length} checks pass`}</summary>${renderChecks(passing)}</details>`;
  return `${open.length === 0 ? '' : renderChecks(open)}${fold}`;
}

/** The anchor id of a use-case card, stable for links into the report. */
export function cardId(id: string): string {
  return `uc-${id}`;
}

function renderCard(card: UseCaseCard): string {
  return `<div class="dv-card dv-s-${BUCKET_STATUS[card.bucket]}-edge" id="${escapeHtml(cardId(card.id))}" data-capability="${escapeHtml(card.id)}">
      <div class="dv-card-head"><div class="dv-card-title">${escapeHtml(card.label)}</div>${bucketTag(card.bucket)}</div>
      <p class="dv-why">${escapeHtml(card.why)}</p>
      ${renderCardBody(card)}
    </div>`;
}

/** Cards grouped under "Ready to use (N)" and so on, in the summary strip's order; empty groups are left out. */
function renderCards(view: DecisionViewModel): string {
  const groups = SUMMARY_ORDER.map((bucket) => ({ bucket, cards: view.cards.filter((c) => c.bucket === bucket) }))
    .filter((g) => g.cards.length > 0)
    .map(
      (g) => `<div class="dv-group" data-bucket="${g.bucket}">
      <h4 class="dv-group-head">${escapeHtml(BUCKET_WORD[g.bucket])} (${g.cards.length})</h4>
      <div class="dv-cards">${g.cards.map(renderCard).join('')}</div>
    </div>`,
    )
    .join('');
  return part('use-cases', groups);
}

// ---------------------------------------------------------------------------
// 5. Heatmap: use cases x objects
// ---------------------------------------------------------------------------

function renderHeatmap(view: DecisionViewModel): string {
  const { columns, rows } = view.heatmap;
  const head = `<div class="dv-heat-row" role="row"><div class="dv-heat-corner" role="columnheader">Use case</div>${columns
    .map((c) => `<div class="dv-heat-col" role="columnheader">${escapeHtml(c.label)}</div>`)
    .join('')}</div>`;
  const body = rows
    .map(
      (r) =>
        `<div class="dv-heat-row" role="row"><div class="dv-heat-rowhead" role="rowheader">${escapeHtml(r.label)}</div>${r.cells
          .map((cell) => {
            const title = cell.metric ? ` title="${escapeHtml(checkName(cell.metric))}"` : '';
            const word = cell.status === 'none' ? 'none' : STATUS_WORD[cell.status];
            return `<div class="dv-cell dv-s-${cell.status}" role="cell"${title}><span aria-hidden="true">${STATUS_SYMBOL[cell.status]}</span> ${escapeHtml(word)}</div>`;
          })
          .join('')}</div>`,
    )
    .join('');
  return part(
    'heatmap',
    `<div class="dv-note">Each cell shows the worst check for that pair.</div>
    <div class="dv-heat-wrap"><div class="dv-heat" role="table" style="--dv-cols: ${columns.length}">${head}${body}</div></div>`,
  );
}

/** The whole decision view, for the top of both single-org reports. */
export function renderDecisionView(data: ReportData): string {
  const view = buildDecisionView(data);
  return `<section class="dv" aria-label="At a glance">
    ${HATCH_DEFS}
    <h2 class="dv-title">At a glance</h2>
    ${renderObjects(view)}
    ${renderSummary(view)}
    ${renderFixes(view)}
    ${renderCards(view)}
    ${renderHeatmap(view)}
  </section>`;
}

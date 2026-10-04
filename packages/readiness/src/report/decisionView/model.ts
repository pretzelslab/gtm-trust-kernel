/**
 * Pure model for the decision view: turns ReportData into object health, a
 * summary strip, a fix list, use-case cards and a heatmap. No new metric,
 * weight, threshold or composite score; every status is the existing
 * gateVerdictOf, every use-case sentence is buildFullNarrative's. Output
 * order never depends on input order, and nothing here reads a clock or
 * calls a model.
 */

import { gateVerdictOf, type MetricRow, type ReportData } from '../buildReport.js';
import { buildFullNarrative, PLAIN_CAPABILITY, showsAsNotReady } from '../plainSummary.js';
import { CAPABILITIES, THRESHOLDS, type CapabilityId, type MetricId, type Unit } from '../../rubric.js';
import { FIX_ACTIONS } from './fixActions.js';
import {
  ALSO_READS_ACTIVITY_TEXT,
  METRIC_OBJECT,
  METRIC_OWNER,
  OBJECT_LABEL,
  OBJECT_ORDER,
  SECOND_SOURCE_METRICS,
  UNSCANNED_OBJECTS,
  type ObjectId,
  type Owner,
} from './objects.js';

/** Plain words for the verdicts: viable pass, degraded weak, blocked failing, not measured can't tell. */
export type PlainStatus = 'pass' | 'weak' | 'failing' | 'cant_tell';
export type CellStatus = PlainStatus | 'none';

export const STATUS_WORD: Readonly<Record<PlainStatus, string>> = {
  pass: 'pass',
  weak: 'weak',
  failing: 'failing',
  cant_tell: "can't tell",
};

const METRIC_ORDER: readonly MetricId[] = Object.keys(THRESHOLDS) as MetricId[];
const METRIC_INDEX: ReadonlyMap<MetricId, number> = new Map(METRIC_ORDER.map((m, i) => [m, i]));
const CAPABILITY_ORDER: readonly CapabilityId[] = CAPABILITIES.map((c) => c.id);

/** Display order for use cases within a bucket and for heatmap rows: the README's lead order. */
const DISPLAY_ORDER: readonly CapabilityId[] = [
  'grounded_account_brief',
  'forecast_assistance',
  'pipeline_risk_signals',
  'close_date_realism',
  'next_action_recommendation',
  'enablement_answer_engine',
  'bulk_hygiene_automation',
  'autonomous_writeback',
];
const BUCKET_ORDER: readonly CardBucket[] = ['ready', 'caution', 'notReady', 'cantTell'];

export function plainStatusOf(row: MetricRow): PlainStatus {
  switch (gateVerdictOf(row)) {
    case 'viable':
      return 'pass';
    case 'degraded':
      return 'weak';
    case 'blocked':
      return 'failing';
    case 'not_measured':
      return 'cant_tell';
  }
}

/** Heatmap order, matching GATE_RANK in render.ts: failing > can't tell > weak > pass. */
const WORST_RANK: Readonly<Record<PlainStatus, number>> = { pass: 0, weak: 1, cant_tell: 2, failing: 3 };

export interface ObjectMetric {
  readonly metric: MetricId;
  readonly status: PlainStatus;
  /** Set when the check also reads activity text. */
  readonly alsoReadsActivityText: boolean;
}

export interface ObjectHealthRow {
  readonly object: ObjectId;
  readonly label: string;
  /** Checks counted for this object (excludes cross-system checks with no second system). */
  readonly total: number;
  readonly pass: number;
  readonly weak: number;
  readonly failing: number;
  readonly cantTell: number;
  /** Cross-system checks left out of the counts because no second system is connected. */
  readonly needSecondSystem: number;
  readonly metrics: readonly ObjectMetric[];
}

export interface UnscannedObjectRow {
  readonly label: string;
}

export interface SummaryStrip {
  readonly ready: number;
  readonly caution: number;
  readonly notReady: number;
  readonly cantTell: number;
}

export interface FixItem {
  readonly metric: MetricId;
  readonly object: ObjectId;
  readonly objectLabel: string;
  readonly owner: Owner;
  readonly status: Exclude<PlainStatus, 'pass'>;
  /** The static plain action, or for can't-tell the adapter's setting hint (null when the adapter gave none). */
  readonly action: string | null;
  readonly holdsBackCount: number;
  readonly holdsBack: readonly { readonly id: CapabilityId; readonly label: string }[];
}

/**
 * One row of "Fix this first". Checks that are can't-tell and share the
 * same adapter setting hint form one group ("One setting unlocks N
 * checks"); every other check is a group of one.
 */
export interface FixGroup {
  readonly items: readonly FixItem[];
  /** The worst status among the items (failing, then can't tell, then weak). */
  readonly status: Exclude<PlainStatus, 'pass'>;
  /** The shared action or hint; null when the adapter gave none. */
  readonly action: string | null;
  /** Distinct use cases held back by any item, in the fixed use-case order. */
  readonly holdsBack: readonly { readonly id: CapabilityId; readonly label: string }[];
  readonly holdsBackCount: number;
}

export type CheckKind = 'rate' | 'yes_no' | 'scale';

export interface CardCheck {
  readonly metric: MetricId;
  readonly status: PlainStatus;
  readonly unit: Unit;
  readonly kind: CheckKind;
  readonly value: number | null;
  readonly floor: boolean;
  readonly viableAt: number | null;
  readonly degradedAt: number | null;
  readonly direction: 'higher_is_better' | 'lower_is_better';
  /** Display-only bar end: 1 for rates, 1.25 x max(value, viableAt, degradedAt) for count/days/months/chars, null for yes/no. */
  readonly axisMax: number | null;
  /** True for a cross-system check with no second system; it keeps its real status. */
  readonly noSecondSystem: boolean;
  /** The adapter's setting hint, only on a can't-tell check. */
  readonly hint: string | null;
}

export type CardBucket = 'ready' | 'caution' | 'notReady' | 'cantTell';

export const BUCKET_WORD: Readonly<Record<CardBucket, string>> = {
  ready: 'Ready to use',
  caution: 'Usable with caution',
  notReady: 'Not ready yet',
  cantTell: "Can't tell yet",
};

export interface UseCaseCard {
  readonly id: CapabilityId;
  readonly label: string;
  readonly bucket: CardBucket;
  readonly verdictWord: string;
  /** buildFullNarrative's outcome sentence for this use case. */
  readonly why: string;
  readonly checks: readonly CardCheck[];
}

export interface HeatmapCell {
  readonly status: CellStatus;
  /** The worst gating check for this pair; null when there is none. */
  readonly metric: MetricId | null;
}

export interface Heatmap {
  readonly columns: readonly { readonly object: ObjectId; readonly label: string }[];
  readonly rows: readonly {
    readonly id: CapabilityId;
    readonly label: string;
    readonly cells: readonly HeatmapCell[];
  }[];
}

export interface DecisionViewModel {
  readonly secondSourceConnected: boolean;
  readonly objects: readonly ObjectHealthRow[];
  /** Objects read only by cross-system checks (Contact) when no second system is connected: shown greyed, never counted. */
  readonly secondSystemOnly: readonly UnscannedObjectRow[];
  readonly unscanned: readonly UnscannedObjectRow[];
  readonly summary: SummaryStrip;
  /** Empty means every gating check passes: the "nothing to fix" state. */
  readonly fixes: readonly FixItem[];
  /** `fixes` grouped by shared setting hint, ranked by distinct use cases held back. */
  readonly fixGroups: readonly FixGroup[];
  readonly cards: readonly UseCaseCard[];
  readonly heatmap: Heatmap;
}

function capitalize(s: string): string {
  return s.length === 0 ? s : s.charAt(0).toUpperCase() + s.slice(1);
}

const plainCapabilityLabel = (id: CapabilityId): string => capitalize(PLAIN_CAPABILITY[id]);

/**
 * No second system when every cross-system row is "not instrumented" yet
 * not "not measured": buildReport marks exactly that for a D5 metric with
 * no second source connected. A connected source gives them values, or
 * (when it lacks the capability) not-measured rows.
 */
function hasSecondSource(data: ReportData): boolean {
  const cross = data.metrics.filter((m) => SECOND_SOURCE_METRICS.has(m.metric));
  return cross.some((m) => !(m.status === 'not_instrumented' && !m.notMeasured));
}

function numericThreshold(v: unknown): number | null {
  return typeof v === 'number' ? v : null;
}

function buildObjects(
  rows: readonly MetricRow[],
  secondSource: boolean,
): { objects: ObjectHealthRow[]; secondSystemOnly: UnscannedObjectRow[] } {
  const result: ObjectHealthRow[] = [];
  const secondSystemOnly: UnscannedObjectRow[] = [];
  for (const object of OBJECT_ORDER) {
    const own = rows.filter((r) => METRIC_OBJECT[r.metric] === object);
    const counted = own.filter((r) => secondSource || !SECOND_SOURCE_METRICS.has(r.metric));
    if (counted.length === 0) {
      if (own.length > 0) secondSystemOnly.push({ label: OBJECT_LABEL[object] });
      continue;
    }
    const metrics: ObjectMetric[] = counted
      .map((r) => ({
        metric: r.metric,
        status: plainStatusOf(r),
        alsoReadsActivityText: ALSO_READS_ACTIVITY_TEXT.has(r.metric),
      }))
      .sort((a, b) => METRIC_INDEX.get(a.metric)! - METRIC_INDEX.get(b.metric)!);
    const count = (s: PlainStatus): number => metrics.filter((m) => m.status === s).length;
    result.push({
      object,
      label: OBJECT_LABEL[object],
      total: metrics.length,
      pass: count('pass'),
      weak: count('weak'),
      failing: count('failing'),
      cantTell: count('cant_tell'),
      needSecondSystem: own.length - counted.length,
      metrics,
    });
  }
  // Worst first: failing, then weak, then can't tell, all descending; ties keep the fixed object order.
  result.sort(
    (a, b) =>
      b.failing - a.failing ||
      b.weak - a.weak ||
      b.cantTell - a.cantTell ||
      OBJECT_ORDER.indexOf(a.object) - OBJECT_ORDER.indexOf(b.object),
  );
  return { objects: result, secondSystemOnly };
}

const FIX_STATUS_RANK: Readonly<Record<Exclude<PlainStatus, 'pass'>, number>> = { failing: 0, cant_tell: 1, weak: 2 };

function buildFixes(rows: readonly MetricRow[]): FixItem[] {
  const items: FixItem[] = [];
  for (const r of rows) {
    if (r.gatesCapabilities.length === 0) continue;
    const status = plainStatusOf(r);
    if (status === 'pass') continue;
    const object = METRIC_OBJECT[r.metric];
    items.push({
      metric: r.metric,
      object,
      objectLabel: OBJECT_LABEL[object],
      owner: METRIC_OWNER[r.metric],
      status,
      action: status === 'cant_tell' ? r.fixHint : FIX_ACTIONS[r.metric],
      holdsBackCount: r.gatesCapabilities.length,
      holdsBack: [...r.gatesCapabilities]
        .sort((a, b) => CAPABILITY_ORDER.indexOf(a.id) - CAPABILITY_ORDER.indexOf(b.id))
        .map((g) => ({ id: g.id, label: plainCapabilityLabel(g.id) })),
    });
  }
  return items.sort(
    (a, b) =>
      b.holdsBackCount - a.holdsBackCount ||
      FIX_STATUS_RANK[a.status] - FIX_STATUS_RANK[b.status] ||
      METRIC_INDEX.get(a.metric)! - METRIC_INDEX.get(b.metric)!,
  );
}

/** Groups can't-tell fixes that share one setting hint; ranks groups by distinct use cases held back. */
function buildFixGroups(fixes: readonly FixItem[]): FixGroup[] {
  const buckets = new Map<string, FixItem[]>();
  fixes.forEach((f, i) => {
    const key = f.status === 'cant_tell' && f.action !== null ? `hint:${f.action}` : `own:${i}`;
    const list = buckets.get(key);
    if (list) list.push(f);
    else buckets.set(key, [f]);
  });
  const groups: FixGroup[] = [...buckets.values()].map((items) => {
    const ids = new Set(items.flatMap((f) => f.holdsBack.map((h) => h.id)));
    const holdsBack = CAPABILITY_ORDER.filter((id) => ids.has(id)).map((id) => ({ id, label: plainCapabilityLabel(id) }));
    const status = items.reduce<FixGroup['status']>(
      (w, f) => (FIX_STATUS_RANK[f.status] < FIX_STATUS_RANK[w] ? f.status : w),
      items[0]!.status,
    );
    return { items, status, action: items[0]!.action, holdsBack, holdsBackCount: holdsBack.length };
  });
  const first = (g: FixGroup): number => Math.min(...g.items.map((f) => METRIC_INDEX.get(f.metric)!));
  return groups.sort(
    (a, b) =>
      b.holdsBackCount - a.holdsBackCount || FIX_STATUS_RANK[a.status] - FIX_STATUS_RANK[b.status] || first(a) - first(b),
  );
}

function buildCheck(row: MetricRow, secondSource: boolean): CardCheck {
  const t = THRESHOLDS[row.metric];
  const viableAt = numericThreshold(t.viableAt);
  const degradedAt = numericThreshold(t.degradedAt);
  const kind: CheckKind = t.unit === 'rate' ? 'rate' : t.unit === 'bool' ? 'yes_no' : 'scale';
  let axisMax: number | null = null;
  if (kind === 'rate') axisMax = 1;
  else if (kind === 'scale') axisMax = 1.25 * Math.max(row.value ?? 0, viableAt ?? 0, degradedAt ?? 0);
  const status = plainStatusOf(row);
  return {
    metric: row.metric,
    status,
    unit: t.unit,
    kind,
    value: row.value,
    floor: row.floor,
    viableAt,
    degradedAt,
    direction: t.direction,
    axisMax,
    noSecondSystem: !secondSource && SECOND_SOURCE_METRICS.has(row.metric),
    hint: status === 'cant_tell' ? row.fixHint : null,
  };
}

function bucketOf(data: ReportData, id: CapabilityId): CardBucket {
  const c = data.capabilities.find((x) => x.id === id)!;
  if (showsAsNotReady(c)) return 'notReady';
  if (c.verdict === 'viable') return 'ready';
  if (c.verdict === 'degraded') return 'caution';
  return 'cantTell';
}

export function buildDecisionView(data: ReportData): DecisionViewModel {
  const secondSource = hasSecondSource(data);
  const rows = [...data.metrics].sort((a, b) => METRIC_INDEX.get(a.metric)! - METRIC_INDEX.get(b.metric)!);
  const narrative = buildFullNarrative(data);

  const capabilityIds = CAPABILITY_ORDER.filter((id) => data.capabilities.some((c) => c.id === id));
  const outcomeByLabel = new Map<string, string>(
    [...narrative.ready, ...narrative.caution, ...narrative.notMeasured, ...narrative.notReady].map((o) => [o.label, o.outcome]),
  );

  const cards: UseCaseCard[] = [...capabilityIds].map((id) => {
    const bucket = bucketOf(data, id);
    const label = plainCapabilityLabel(id);
    return {
      id,
      label,
      bucket,
      verdictWord: BUCKET_WORD[bucket],
      why: outcomeByLabel.get(label) ?? '',
      checks: rows.filter((r) => r.gatesCapabilities.some((g) => g.id === id)).map((r) => buildCheck(r, secondSource)),
    };
  });

  cards.sort(
    (a, b) =>
      BUCKET_ORDER.indexOf(a.bucket) - BUCKET_ORDER.indexOf(b.bucket) ||
      DISPLAY_ORDER.indexOf(a.id) - DISPLAY_ORDER.indexOf(b.id),
  );

  // Heatmap columns: scanned objects with at least one gating check.
  const gatingObjects = new Set(rows.filter((r) => r.gatesCapabilities.length > 0).map((r) => METRIC_OBJECT[r.metric]));
  const columns = OBJECT_ORDER.filter((o) => gatingObjects.has(o)).map((o) => ({ object: o, label: OBJECT_LABEL[o] }));
  const heatmap: Heatmap = {
    columns,
    rows: cards.map((card) => ({
      id: card.id,
      label: card.label,
      cells: columns.map((col): HeatmapCell => {
        let worst: CardCheck | null = null;
        for (const check of card.checks) {
          if (METRIC_OBJECT[check.metric] !== col.object) continue;
          if (worst === null || WORST_RANK[check.status] > WORST_RANK[worst.status]) worst = check;
        }
        return worst ? { status: worst.status, metric: worst.metric } : { status: 'none', metric: null };
      }),
    })),
  };

  const { objects, secondSystemOnly } = buildObjects(rows, secondSource);
  const fixes = buildFixes(rows);
  return {
    secondSourceConnected: secondSource,
    objects,
    secondSystemOnly,
    unscanned: UNSCANNED_OBJECTS.map((label) => ({ label })),
    summary: {
      ready: narrative.ready.length,
      caution: narrative.caution.length,
      notReady: narrative.notReady.length,
      cantTell: narrative.notMeasured.length,
    },
    fixes,
    fixGroups: buildFixGroups(fixes),
    cards,
    heatmap,
  };
}

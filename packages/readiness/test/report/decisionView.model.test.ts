/**
 * The decision view's model: object health, summary strip, fix list, use-case
 * cards and heatmap, built from ReportData over all four mock fixtures plus
 * the notes-not-measured case. The model adds no metric, threshold or score;
 * these tests pin that every count and order comes from gateVerdictOf, the
 * rubric's gate lists and buildFullNarrative.
 */

import { describe, expect, it } from 'vitest';
import { MockAdapter, MockSecondSourceAdapter } from '@gtm-trust-kernel/adapters/mock.js';
import { FIXTURE_NAMES, MOCK_ORG_FIXTURES, type FixtureName } from '../../src/fixtures/mockOrgs.js';
import { buildReportData, gateVerdictOf, type MetricRow, type ReportData } from '../../src/report/buildReport.js';
import { buildFullNarrative } from '../../src/report/plainSummary.js';
import { buildDecisionView, plainStatusOf } from '../../src/report/decisionView/model.js';
import { FIX_ACTIONS } from '../../src/report/decisionView/fixActions.js';
import {
  METRIC_OBJECT,
  OBJECT_ORDER,
  SECOND_SOURCE_METRICS,
  UNSCANNED_OBJECTS,
} from '../../src/report/decisionView/objects.js';
import { CAPABILITIES, THRESHOLDS, type MetricId } from '../../src/rubric.js';

async function build(
  name: FixtureName,
  opts: { withSecondSource?: boolean; activitySync?: boolean } = {},
): Promise<ReportData> {
  const fixture = MOCK_ORG_FIXTURES[name];
  const adapter = new MockAdapter(fixture.orgId, fixture.data, {
    ...fixture.capabilities,
    ...(opts.activitySync === false ? { activitySync: false } : {}),
  });
  const secondSource =
    (opts.withSecondSource ?? true) && fixture.secondSource
      ? new MockSecondSourceAdapter(fixture.secondSource.data, fixture.secondSource.capabilities)
      : undefined;
  return buildReportData(adapter, secondSource, {
    orgLabel: fixture.label,
    orgDescription: fixture.description,
    asOf: fixture.asOf,
  });
}

/** Every named case: the four fixtures, each without a second source, and a notes-not-measured one. */
async function allCases(): Promise<{ name: string; data: ReportData }[]> {
  const cases: { name: string; data: ReportData }[] = [];
  for (const name of FIXTURE_NAMES) {
    cases.push({ name, data: await build(name) });
    cases.push({ name: `${name} (no second source)`, data: await build(name, { withSecondSource: false }) });
  }
  cases.push({ name: 'healthy (activity sync off)', data: await build('healthy', { activitySync: false }) });
  return cases;
}

function patchRows(data: ReportData, patches: Partial<Record<MetricId, Partial<MetricRow>>>): ReportData {
  return { ...data, metrics: data.metrics.map((m) => (patches[m.metric] ? { ...m, ...patches[m.metric] } : m)) };
}

const PASS: Partial<MetricRow> = { status: 'ok', tier: 'viable', notMeasured: false, fixHint: null };
const WEAK: Partial<MetricRow> = { status: 'ok', tier: 'degraded', notMeasured: false, fixHint: null };
const FAILING: Partial<MetricRow> = { status: 'ok', tier: 'blocked', notMeasured: false, fixHint: null };
const CANT_TELL: Partial<MetricRow> = { status: 'not_instrumented', tier: null, notMeasured: true };

/** Every metric passing: a flat baseline for constructed cases. */
function allPassing(data: ReportData): ReportData {
  return { ...data, metrics: data.metrics.map((m) => ({ ...m, ...PASS })) };
}

const gateIdsOf = (metric: MetricId): string[] => CAPABILITIES.filter((c) => c.gates.includes(metric)).map((c) => c.id);

describe('decision view model', () => {
  it('counts each object from gateVerdictOf over that object\'s mapped metrics', async () => {
    for (const { name, data } of await allCases()) {
      const view = buildDecisionView(data);
      for (const obj of view.objects) {
        const rows = data.metrics.filter(
          (m) => METRIC_OBJECT[m.metric] === obj.object && (view.secondSourceConnected || !SECOND_SOURCE_METRICS.has(m.metric)),
        );
        const n = (v: string) => rows.filter((r) => gateVerdictOf(r) === v).length;
        expect(obj.total, name).toBe(rows.length);
        expect(obj.pass, name).toBe(n('viable'));
        expect(obj.weak, name).toBe(n('degraded'));
        expect(obj.failing, name).toBe(n('blocked'));
        expect(obj.cantTell, name).toBe(n('not_measured'));
        expect(obj.pass + obj.weak + obj.failing + obj.cantTell, name).toBe(obj.total);
      }
    }
  });

  it('lists every metric exactly once, except cross-system checks with no second source', async () => {
    for (const { name, data } of await allCases()) {
      const view = buildDecisionView(data);
      const listed = view.objects.flatMap((o) => o.metrics.map((m) => m.metric));
      expect(new Set(listed).size, name).toBe(listed.length);
      const expected = data.metrics
        .map((m) => m.metric)
        .filter((m) => view.secondSourceConnected || !SECOND_SOURCE_METRICS.has(m));
      expect([...listed].sort(), name).toEqual([...expected].sort());

      // The left-out ones are counted under their object instead (Contact has no row without a second source).
      const counted = view.objects.reduce((sum, o) => sum + o.needSecondSystem, 0);
      expect(counted, name).toBe(view.secondSourceConnected ? 0 : SECOND_SOURCE_METRICS.size - 1);
    }
  });

  it('shows the Contact row only when a second source is connected', async () => {
    const connected = buildDecisionView(await build('healthy'));
    const alone = buildDecisionView(await build('healthy', { withSecondSource: false }));
    if (MOCK_ORG_FIXTURES.healthy.secondSource) expect(connected.secondSourceConnected).toBe(true);
    expect(alone.secondSourceConnected).toBe(false);
    expect(alone.objects.some((o) => o.object === 'contact')).toBe(false);
    expect(alone.objects.find((o) => o.object === 'account')!.needSecondSystem).toBe(1);
    expect(alone.objects.find((o) => o.object === 'activities')!.needSecondSystem).toBe(2);
    if (connected.secondSourceConnected) {
      expect(connected.objects.some((o) => o.object === 'contact')).toBe(true);
      expect(connected.objects.every((o) => o.needSecondSystem === 0)).toBe(true);
    }
  });

  it('always lists the unscanned objects, in fixed order', async () => {
    for (const { name, data } of await allCases()) {
      expect(buildDecisionView(data).unscanned.map((u) => u.label), name).toEqual([...UNSCANNED_OBJECTS]);
    }
    expect(UNSCANNED_OBJECTS).toEqual(['Leads', 'Quotes', 'Products / line items', 'Campaigns', 'Territories / targets']);
  });

  it('gives identical output however the input metric order is shuffled', async () => {
    for (const { name, data } of await allCases()) {
      const reversed: ReportData = { ...data, metrics: [...data.metrics].reverse(), capabilities: [...data.capabilities].reverse() };
      const rotated: ReportData = { ...data, metrics: [...data.metrics.slice(7), ...data.metrics.slice(0, 7)] };
      const base = buildDecisionView(data);
      expect(buildDecisionView(reversed), name).toEqual(base);
      expect(buildDecisionView(rotated), name).toEqual(base);
    }
  });

  it('breaks object ties by the fixed object order, and ranks failing before weak before can\'t tell', async () => {
    const flat = allPassing(await build('healthy', { withSecondSource: false }));
    const tied = buildDecisionView(flat);
    expect(tied.objects.map((o) => o.object)).toEqual(OBJECT_ORDER.filter((o) => tied.objects.some((x) => x.object === o)));

    // Notes: 1 can't tell. Account: 1 weak. Activities: 1 failing. History: 1 weak + 1 can't tell.
    const data = patchRows(flat, {
      note_coverage_rate: CANT_TELL,
      duplicate_account_rate: WEAK,
      activity_capture_rate: FAILING,
      close_date_history_enabled: WEAK,
      stage_history_months: CANT_TELL,
    });
    expect(buildDecisionView(data).objects.slice(0, 4).map((o) => o.object)).toEqual([
      'activities', // 1 failing
      'opportunity_history', // 0 failing, 1 weak, 1 can't tell: beats account on the can't-tell count
      'account', // 0 failing, 1 weak
      'notes', // 0 failing, 0 weak, 1 can't tell
    ]);
  });

  it('ranks the fix list by use cases held back, then failing, can\'t tell, weak, then metric order', async () => {
    const flat = allPassing(await build('healthy', { withSecondSource: false }));
    // Three checks that each hold back exactly one use case.
    const oneEach = ['note_coverage_rate', 'contact_linkage_rate', 'stage_history_months'] as const;
    for (const m of oneEach) expect(gateIdsOf(m)).toHaveLength(1);

    const data = patchRows(flat, {
      note_coverage_rate: WEAK,
      contact_linkage_rate: CANT_TELL,
      stage_history_months: FAILING,
      stage_mapping_coverage: WEAK, // holds back 2+ use cases: leads the list despite being only weak
    });
    const order = buildDecisionView(data).fixes.map((f) => f.metric);
    expect(order[0]).toBe('stage_mapping_coverage');
    const rest = order.filter((m) => (oneEach as readonly string[]).includes(m) && gateIdsOf(m).length === 1);
    expect(rest).toEqual(['stage_history_months', 'contact_linkage_rate', 'note_coverage_rate']);

    // Equal holds-back and equal status: metric order in THRESHOLDS decides.
    const twins = patchRows(flat, { note_coverage_rate: WEAK, contact_linkage_rate: WEAK });
    const keys = Object.keys(THRESHOLDS);
    expect(buildDecisionView(twins).fixes.map((f) => f.metric)).toEqual(
      ['note_coverage_rate', 'contact_linkage_rate'].sort((a, b) => keys.indexOf(a) - keys.indexOf(b)),
    );
  });

  it('holds back exactly the use cases whose gate lists contain a non-passing check', async () => {
    for (const { name, data } of await allCases()) {
      const view = buildDecisionView(data);
      const failingGates = data.metrics.filter((m) => gateVerdictOf(m) !== 'viable' && gateIdsOf(m.metric).length > 0);
      expect(view.fixes.map((f) => f.metric).sort(), name).toEqual(failingGates.map((m) => m.metric).sort());
      for (const fix of view.fixes) {
        expect(fix.holdsBackCount, name).toBe(gateIdsOf(fix.metric).length);
        expect(fix.holdsBack.map((h) => h.id).sort(), name).toEqual([...gateIdsOf(fix.metric)].sort());
      }
    }
  });

  it('has a static action for exactly the checks that gate a use case', () => {
    for (const metric of Object.keys(THRESHOLDS) as MetricId[]) {
      expect(FIX_ACTIONS[metric] !== null, metric).toBe(gateIdsOf(metric).length > 0);
    }
    const total = (Object.keys(THRESHOLDS) as MetricId[]).reduce((n, m) => n + gateIdsOf(m).length, 0);
    expect(total).toBe(CAPABILITIES.reduce((n, c) => n + c.gates.length, 0));
  });

  it('shows the adapter hint, not the table text, for a can\'t-tell check', async () => {
    const flat = allPassing(await build('healthy', { withSecondSource: false }));
    const data = patchRows(flat, {
      note_coverage_rate: { ...CANT_TELL, fixHint: 'Turn on Enhanced Notes access.' },
      contact_linkage_rate: { ...CANT_TELL, fixHint: null },
      duplicate_account_rate: WEAK,
    });
    const fixes = buildDecisionView(data).fixes;
    expect(fixes.find((f) => f.metric === 'note_coverage_rate')!.action).toBe('Turn on Enhanced Notes access.');
    expect(fixes.find((f) => f.metric === 'contact_linkage_rate')!.action).toBeNull();
    expect(fixes.find((f) => f.metric === 'duplicate_account_rate')!.action).toBe(FIX_ACTIONS.duplicate_account_rate);
  });

  it('reports nothing to fix when every gating check passes', async () => {
    expect(buildDecisionView(allPassing(await build('healthy'))).fixes).toEqual([]);
  });

  it('takes the summary strip from the buildFullNarrative buckets', async () => {
    for (const { name, data } of await allCases()) {
      const n = buildFullNarrative(data);
      expect(buildDecisionView(data).summary, name).toEqual({
        ready: n.ready.length,
        caution: n.caution.length,
        notReady: n.notReady.length,
        cantTell: n.notMeasured.length,
      });
    }
  });

  it('puts each use case in the bucket whose list carries its narrative sentence', async () => {
    for (const { name, data } of await allCases()) {
      const n = buildFullNarrative(data);
      const bucketLists = { ready: n.ready, caution: n.caution, notReady: n.notReady, cantTell: n.notMeasured };
      for (const card of buildDecisionView(data).cards) {
        const hit = bucketLists[card.bucket].find((o) => o.label === card.label);
        expect(hit, `${name} ${card.id}`).toBeDefined();
        expect(card.why, `${name} ${card.id}`).toBe(hit!.outcome);
      }
    }
  });

  it('lists each card\'s gating checks with their real status and the display scale', async () => {
    const data = await build('legacy', { withSecondSource: false });
    for (const card of buildDecisionView(data).cards) {
      const spec = CAPABILITIES.find((c) => c.id === card.id)!;
      expect(card.checks.map((c) => c.metric).sort()).toEqual([...spec.gates].sort());
      for (const check of card.checks) {
        const row = data.metrics.find((m) => m.metric === check.metric)!;
        expect(check.status).toBe(plainStatusOf(row));
        expect(check.noSecondSystem).toBe(SECOND_SOURCE_METRICS.has(check.metric));
        if (check.kind === 'rate') expect(check.axisMax).toBe(1);
        else if (check.kind === 'yes_no') expect(check.axisMax).toBeNull();
        else {
          expect(check.axisMax).toBeCloseTo(1.25 * Math.max(row.value ?? 0, check.viableAt ?? 0, check.degradedAt ?? 0));
        }
      }
    }
  });

  it('keeps the real verdict on a cross-system check with no second source', async () => {
    const data = await build('healthy', { withSecondSource: false });
    const view = buildDecisionView(data);
    const temporal = view.cards.flatMap((c) => c.checks).find((c) => c.metric === 'temporal_anomaly_rate')!;
    expect(temporal.noSecondSystem).toBe(true);
    expect(temporal.status).toBe(plainStatusOf(data.metrics.find((m) => m.metric === 'temporal_anomaly_rate')!));
  });

  it('fills each heatmap cell with the worst gating check for the pair, and none where there is no gate', async () => {
    const flat = allPassing(await build('healthy', { withSecondSource: false }));
    const data = patchRows(flat, {
      activity_capture_rate: WEAK,
      temporal_anomaly_rate: CANT_TELL, // can't tell outranks weak in the same cell
      stage_mapping_coverage: FAILING,
      closed_deal_count_12m: WEAK,
    });
    const { heatmap } = buildDecisionView(data);
    const cell = (cap: string, obj: string) => {
      const col = heatmap.columns.findIndex((c) => c.object === obj);
      return heatmap.rows.find((r) => r.id === cap)!.cells[col]!;
    };
    expect(cell('pipeline_risk_signals', 'activities')).toEqual({ status: 'weak', metric: 'activity_capture_rate' });
    expect(cell('pipeline_risk_signals', 'opportunity')).toEqual({ status: 'failing', metric: 'stage_mapping_coverage' });
    expect(cell('forecast_assistance', 'opportunity')).toEqual({ status: 'failing', metric: 'stage_mapping_coverage' });
    expect(cell('grounded_account_brief', 'activities')).toEqual({ status: 'none', metric: null });
    expect(cell('close_date_realism', 'notes')).toEqual({ status: 'none', metric: null });

    // Only objects with a gating check become columns, in fixed order.
    const gating = new Set(data.metrics.filter((m) => gateIdsOf(m.metric).length > 0).map((m) => METRIC_OBJECT[m.metric]));
    expect(heatmap.columns.map((c) => c.object)).toEqual(OBJECT_ORDER.filter((o) => gating.has(o)));
  });
});

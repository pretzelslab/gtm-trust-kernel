/**
 * Decision view polish: use cards and heatmap rows ordered by verdict then
 * the README's lead order, and "Fix this first" rows that group checks
 * sharing one adapter setting hint. `fixes` itself stays flat and is
 * covered by decisionView.model.test.ts.
 */

import { describe, expect, it } from 'vitest';
import { MockAdapter, MockSecondSourceAdapter } from '@gtm-trust-kernel/adapters/mock.js';
import { FIXTURE_NAMES, MOCK_ORG_FIXTURES, type FixtureName } from '../../src/fixtures/mockOrgs.js';
import { buildReportData, type MetricRow, type ReportData } from '../../src/report/buildReport.js';
import { buildDecisionView, type CardBucket } from '../../src/report/decisionView/model.js';
import { renderDecisionView } from '../../src/report/decisionView/render.js';
import { CAPABILITIES, THRESHOLDS, type CapabilityId, type MetricId } from '../../src/rubric.js';

async function build(name: FixtureName): Promise<ReportData> {
  const fixture = MOCK_ORG_FIXTURES[name];
  const adapter = new MockAdapter(fixture.orgId, fixture.data, fixture.capabilities);
  const secondSource = fixture.secondSource
    ? new MockSecondSourceAdapter(fixture.secondSource.data, fixture.secondSource.capabilities)
    : undefined;
  return buildReportData(adapter, secondSource, {
    orgLabel: fixture.label,
    orgDescription: fixture.description,
    asOf: fixture.asOf,
  });
}

function patchRows(data: ReportData, patches: Partial<Record<MetricId, Partial<MetricRow>>>): ReportData {
  return { ...data, metrics: data.metrics.map((m) => (patches[m.metric] ? { ...m, ...patches[m.metric] } : m)) };
}

const PASS: Partial<MetricRow> = { status: 'ok', tier: 'viable', notMeasured: false, fixHint: null };
const WEAK: Partial<MetricRow> = { status: 'ok', tier: 'degraded', notMeasured: false, fixHint: null };
const FAILING: Partial<MetricRow> = { status: 'ok', tier: 'blocked', notMeasured: false, fixHint: null };
const CANT_TELL: Partial<MetricRow> = { status: 'not_instrumented', tier: null, notMeasured: true };

function allPassing(data: ReportData): ReportData {
  return { ...data, metrics: data.metrics.map((m) => ({ ...m, ...PASS })) };
}

const LEAD_ORDER: readonly CapabilityId[] = [
  'grounded_account_brief',
  'forecast_assistance',
  'pipeline_risk_signals',
  'close_date_realism',
  'next_action_recommendation',
  'enablement_answer_engine',
  'bulk_hygiene_automation',
  'autonomous_writeback',
];
const BUCKETS: readonly CardBucket[] = ['ready', 'caution', 'notReady', 'cantTell'];
const gateIdsOf = (metric: MetricId): string[] => CAPABILITIES.filter((c) => c.gates.includes(metric)).map((c) => c.id);

describe('use-case order', () => {
  it('lists the lead order exactly once each', () => {
    expect([...LEAD_ORDER].sort()).toEqual(CAPABILITIES.map((c) => c.id).sort());
  });

  it('groups cards by verdict, then the README lead order, in every fixture', async () => {
    for (const name of FIXTURE_NAMES) {
      const { cards } = buildDecisionView(await build(name));
      const expected = [...cards].sort(
        (a, b) =>
          BUCKETS.indexOf(a.bucket) - BUCKETS.indexOf(b.bucket) || LEAD_ORDER.indexOf(a.id) - LEAD_ORDER.indexOf(b.id),
      );
      expect(cards.map((c) => c.id), name).toEqual(expected.map((c) => c.id));
    }
  });

  it('orders a mixed case by verdict, then lead order', async () => {
    const flat = allPassing(await build('healthy'));
    const data = patchRows(flat, { close_date_fill_rate: FAILING, stage_mapping_coverage: WEAK });
    const view = buildDecisionView(data);
    const buckets = view.cards.map((c) => BUCKETS.indexOf(c.bucket));
    expect([...buckets].sort((a, b) => a - b)).toEqual(buckets);
    expect(new Set(buckets).size).toBeGreaterThan(1);
    for (const b of BUCKETS) {
      const ids = view.cards.filter((c) => c.bucket === b).map((c) => LEAD_ORDER.indexOf(c.id));
      expect([...ids].sort((x, y) => x - y)).toEqual(ids);
    }
  });

  it('gives the heatmap rows the card order', async () => {
    for (const name of FIXTURE_NAMES) {
      const view = buildDecisionView(await build(name));
      expect(view.heatmap.rows.map((r) => r.id), name).toEqual(view.cards.map((c) => c.id));
    }
  });
});

describe('fix groups', () => {
  const HINT = 'Turn on Enhanced Notes access.';
  const noteRows = ['note_coverage_rate', 'substantive_note_rate', 'median_note_length_chars'] as const;

  async function grouped(): Promise<ReportData> {
    const flat = allPassing(await build('healthy'));
    return patchRows(flat, {
      note_coverage_rate: { ...CANT_TELL, fixHint: HINT },
      substantive_note_rate: { ...CANT_TELL, fixHint: HINT },
      median_note_length_chars: { ...CANT_TELL, fixHint: HINT },
      duplicate_account_rate: WEAK,
    });
  }

  it('puts the can\'t-tell checks that share one hint in a single group', async () => {
    const view = buildDecisionView(await grouped());
    const matching = view.fixGroups.filter((g) => g.action === HINT);
    expect(matching).toHaveLength(1);
    expect(matching[0]!.items.map((f) => f.metric).sort()).toEqual([...noteRows].sort());
    // Every fix lands in exactly one group.
    expect(view.fixGroups.flatMap((g) => g.items.map((f) => f.metric)).sort()).toEqual(
      view.fixes.map((f) => f.metric).sort(),
    );
  });

  it('counts distinct use cases, not the sum, and lists each once', async () => {
    const view = buildDecisionView(await grouped());
    const group = view.fixGroups.find((g) => g.action === HINT)!;
    const distinct = new Set(noteRows.flatMap((m) => gateIdsOf(m)));
    const sum = noteRows.reduce((n, m) => n + gateIdsOf(m).length, 0);
    expect(group.holdsBackCount).toBe(distinct.size);
    expect(group.holdsBack.map((h) => h.id).sort()).toEqual([...distinct].sort());
    expect(sum).toBeGreaterThan(distinct.size); // the case where the two readings differ
  });

  it('never groups a check with a static action, or a can\'t-tell check with no hint', async () => {
    const flat = allPassing(await build('healthy'));
    const data = patchRows(flat, {
      duplicate_account_rate: WEAK,
      close_date_fill_rate: WEAK,
      contact_linkage_rate: { ...CANT_TELL, fixHint: null },
      stage_history_months: { ...CANT_TELL, fixHint: null },
    });
    const groups = buildDecisionView(data).fixGroups;
    expect(groups.length).toBeGreaterThan(0);
    for (const g of groups) expect(g.items).toHaveLength(1);
  });

  it('ranks groups by distinct use cases held back, then status, then metric order', async () => {
    const view = buildDecisionView(await grouped());
    const counts = view.fixGroups.map((g) => g.holdsBackCount);
    expect([...counts].sort((a, b) => b - a)).toEqual(counts);

    const flat = allPassing(await build('healthy'));
    const keys = Object.keys(THRESHOLDS);
    const twins = buildDecisionView(patchRows(flat, { note_coverage_rate: WEAK, contact_linkage_rate: WEAK }));
    expect(twins.fixGroups.map((g) => g.items[0]!.metric)).toEqual(
      ['note_coverage_rate', 'contact_linkage_rate'].sort((a, b) => keys.indexOf(a) - keys.indexOf(b)),
    );
    // Equal count, worse status first.
    const mixed = buildDecisionView(patchRows(flat, { note_coverage_rate: WEAK, contact_linkage_rate: FAILING }));
    expect(mixed.fixGroups.map((g) => g.status)).toEqual(['failing', 'weak']);
  });

  it('is empty when every gating check passes', async () => {
    expect(buildDecisionView(allPassing(await build('healthy'))).fixGroups).toEqual([]);
  });

  it('renders one row, "One setting unlocks 3 checks", with the hint once', async () => {
    const html = renderDecisionView(await grouped());
    expect(html).toContain('One setting unlocks 3 checks');
    expect(html.split('One setting unlocks').length - 1).toBe(1);
    const fixesSection = html.slice(html.indexOf('Fix this first'), html.indexOf('Use cases and the checks behind them'));
    expect(fixesSection.split(HINT).length - 1).toBe(1);
    expect(fixesSection).toContain('Duplicate accounts');
  });
});

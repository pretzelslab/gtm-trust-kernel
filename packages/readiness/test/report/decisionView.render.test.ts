/**
 * The decision view's HTML: bars and markers on the stated scale, threshold
 * direction, offline safety, escaping, a text label on every status mark,
 * the greyed rows, the can't-tell fallback, and where the view sits in both
 * reports. The markup also has to stay clear of what the existing report
 * tests count or forbid (<li>, <ul>, <table>, the "pill" class, "http://").
 */

import { describe, expect, it } from 'vitest';
import { MockAdapter, MockSecondSourceAdapter } from '@gtm-trust-kernel/adapters/mock.js';
import { FIXTURE_NAMES, MOCK_ORG_FIXTURES, type FixtureName } from '../../src/fixtures/mockOrgs.js';
import { buildReportData, type MetricRow, type ReportData } from '../../src/report/buildReport.js';
import { buildExecutiveSummary } from '../../src/report/plainSummary.js';
import { renderPlainReportHtml } from '../../src/report/plainReport.js';
import { renderReportHtml } from '../../src/report/render.js';
import { BUCKET_WORD, buildDecisionView, STATUS_WORD, type PlainStatus } from '../../src/report/decisionView/model.js';
import { barPercent, NO_HINT_FALLBACK, renderDecisionView } from '../../src/report/decisionView/render.js';
import { escapeHtml } from '../../src/report/shell.js';
import { THRESHOLDS, type MetricId } from '../../src/rubric.js';

async function build(name: FixtureName, withSecondSource = true): Promise<ReportData> {
  const fixture = MOCK_ORG_FIXTURES[name];
  const adapter = new MockAdapter(fixture.orgId, fixture.data, fixture.capabilities);
  const secondSource =
    withSecondSource && fixture.secondSource
      ? new MockSecondSourceAdapter(fixture.secondSource.data, fixture.secondSource.capabilities)
      : undefined;
  return buildReportData(adapter, secondSource, {
    orgLabel: fixture.label,
    orgDescription: fixture.description,
    asOf: fixture.asOf,
  });
}

async function allFixtures(): Promise<{ name: string; data: ReportData }[]> {
  const out: { name: string; data: ReportData }[] = [];
  for (const name of FIXTURE_NAMES) {
    out.push({ name, data: await build(name) });
    out.push({ name: `${name} (no second source)`, data: await build(name, false) });
  }
  return out;
}

function patchRows(data: ReportData, patches: Partial<Record<MetricId, Partial<MetricRow>>>): ReportData {
  return { ...data, metrics: data.metrics.map((m) => (patches[m.metric] ? { ...m, ...patches[m.metric] } : m)) };
}

/** Each check block in the cards, keyed by its data attributes. */
function checkBlocks(html: string): { metric: string; status: string; body: string }[] {
  return html
    .split('<div class="dv-check" ')
    .slice(1)
    .map((chunk) => {
      const m = chunk.match(/^data-metric="([^"]+)" data-status="([^"]+)">/)!;
      return { metric: m[1]!, status: m[2]!, body: chunk };
    });
}

describe('decision view bars', () => {
  it('draws each value at value / axis end, rates on 0 to 100% and the rest on 1.25 x the max', async () => {
    let rateBars = 0;
    let scaleBars = 0;
    for (const { name, data } of await allFixtures()) {
      const html = renderDecisionView(data);
      const view = buildDecisionView(data);
      const blocks = checkBlocks(html);
      for (const check of view.cards.flatMap((c) => c.checks)) {
        if (check.kind === 'yes_no' || check.status === 'cant_tell' || check.value === null) continue;
        const row = data.metrics.find((m) => m.metric === check.metric)!;
        const t = THRESHOLDS[check.metric];
        const axis =
          t.unit === 'rate'
            ? 1
            : 1.25 * Math.max(row.value!, t.viableAt as number, t.degradedAt as number);
        if (t.unit === 'rate') rateBars++;
        else scaleBars++;
        for (const block of blocks.filter((b) => b.metric === check.metric)) {
          expect(block.body, `${name} ${check.metric}`).toContain(`width="${barPercent(row.value!, axis)}%" height="8" data-value="${row.value}"`);
          expect(block.body, `${name} ${check.metric}`).toContain(`class="dv-mark dv-mark-pass" data-at="${barPercent(t.viableAt as number, axis)}"`);
          expect(block.body, `${name} ${check.metric}`).toContain(`class="dv-mark dv-mark-weak" data-at="${barPercent(t.degradedAt as number, axis)}"`);
        }
      }
    }
    expect(rateBars).toBeGreaterThan(0);
    expect(scaleBars).toBeGreaterThan(0);
  });

  it('pins the scale arithmetic', () => {
    expect(barPercent(0.84, 1)).toBe('84.00');
    expect(barPercent(30, 1.25 * 30)).toBe('80.00');
    expect(barPercent(2, 0)).toBe('0.00');
    expect(barPercent(1.5, 1)).toBe('100.00');
  });

  it('never prints the display-only axis end', async () => {
    const data = await build('legacy');
    const html = renderDecisionView(data);
    for (const check of buildDecisionView(data).cards.flatMap((c) => c.checks)) {
      if (check.kind !== 'scale' || check.axisMax === null) continue;
      expect(html).not.toContain(`>${check.axisMax}<`);
    }
  });
});

describe('decision view threshold direction', () => {
  /** gradeGate's rule, restated: viable at or better than viableAt, weak at or better than degradedAt (not for yes/no). */
  function expected(metric: MetricId, value: number): PlainStatus {
    const t = THRESHOLDS[metric];
    const better = (a: number, b: number) => (t.direction === 'higher_is_better' ? a >= b : a <= b);
    if (better(value, t.viableAt as number)) return 'pass';
    if (t.unit !== 'bool' && better(value, t.degradedAt as number)) return 'weak';
    return 'failing';
  }

  it('grades both directions the right way, and says "lower is better" only on lower-is-better checks', async () => {
    const seen = new Set<string>();
    for (const { name, data } of await allFixtures()) {
      const blocks = checkBlocks(renderDecisionView(data));
      for (const block of blocks) {
        const row = data.metrics.find((m) => m.metric === block.metric)!;
        if (row.value === null || row.status !== 'ok') continue;
        const metric = block.metric as MetricId;
        expect(block.status, `${name} ${metric}`).toBe(expected(metric, row.value));
        const lower = THRESHOLDS[metric].direction === 'lower_is_better';
        if (THRESHOLDS[metric].unit !== 'bool') {
          expect(block.body.includes('lower is better'), `${name} ${metric}`).toBe(lower);
          expect(block.body, `${name} ${metric}`).toContain(lower ? 'pass ≤ ' : 'pass ≥ ');
        }
        seen.add(`${THRESHOLDS[metric].direction}:${block.status}`);
      }
    }
    // Both directions are exercised, including a lower-is-better check that isn't passing.
    expect([...seen].some((s) => s.startsWith('higher_is_better:'))).toBe(true);
    expect(seen.has('lower_is_better:pass')).toBe(true);
    expect([...seen].some((s) => s === 'lower_is_better:weak' || s === 'lower_is_better:failing')).toBe(true);
  });

  it('passes a lower-is-better check below its pass line and fails it above (constructed)', async () => {
    const base = await build('healthy');
    const t = THRESHOLDS.past_due_close_date_rate;
    expect(t.direction).toBe('lower_is_better');
    const v = t.viableAt as number;
    const d = t.degradedAt as number;
    const at = (value: number, tier: 'viable' | 'degraded' | 'blocked') =>
      checkBlocks(renderDecisionView(patchRows(base, { past_due_close_date_rate: { status: 'ok', value, tier } }))).find(
        (b) => b.metric === 'past_due_close_date_rate',
      )!.status;
    expect(at(v / 2, 'viable')).toBe('pass');
    expect(at((v + d) / 2, 'degraded')).toBe('weak');
    expect(at(d + 0.1, 'blocked')).toBe('failing');
  });
});

describe('decision view offline safety and markup limits', () => {
  it('has no network reference, script, @import or outside url( in either report', async () => {
    for (const { name, data } of await allFixtures()) {
      for (const html of [renderReportHtml(data), renderPlainReportHtml(data)]) {
        expect(html, name).not.toContain('http://');
        expect(html, name).not.toContain('https://');
        expect(html, name).not.toMatch(/<script/i);
        expect(html, name).not.toContain('@import');
        expect(html, name).not.toContain('xmlns');
        for (const m of html.matchAll(/url\(([^)]*)\)/g)) expect(m[1], name).toMatch(/^#dv-/);
      }
    }
  });

  it('uses no <li>, <ul>, <table> or pill class, which the report tests count or forbid', async () => {
    for (const { name, data } of await allFixtures()) {
      const view = renderDecisionView(data);
      expect(view, name).not.toMatch(/<li/);
      expect(view, name).not.toMatch(/<ul/);
      expect(view, name).not.toContain('<table');
      expect(view, name).not.toContain('class="pill');
    }
  });
});

describe('decision view escaping', () => {
  it('escapes a hostile org label in both reports', async () => {
    const data = await build('healthy');
    const hostile: ReportData = { ...data, org: { ...data.org, orgLabel: '<script>alert(1)</script>' } };
    for (const html of [renderReportHtml(hostile), renderPlainReportHtml(hostile)]) {
      expect(html).not.toContain('<script>alert(1)</script>');
      expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    }
  });

  it('escapes a hostile adapter hint in the fix list and the cards', async () => {
    const hint = '<img src=x onerror="alert(1)"> \'quoted\'';
    const data = patchRows(await build('healthy'), {
      note_coverage_rate: { status: 'not_instrumented', tier: null, value: null, notMeasured: true, fixHint: hint },
    });
    const html = renderDecisionView(data);
    expect(html).not.toContain('<img');
    expect(html.split(escapeHtml(hint)).length - 1).toBeGreaterThanOrEqual(2); // fix list + card
  });
});

describe('decision view text labels', () => {
  it('gives every status tag, heatmap cell and summary tile a word, not colour alone', async () => {
    const words = new Set(
      [...Object.values(STATUS_WORD), ...Object.values(BUCKET_WORD)].map(escapeHtml),
    );
    for (const { name, data } of await allFixtures()) {
      const html = renderDecisionView(data);
      const tags = [...html.matchAll(/class="dv-(?:tag|cell) dv-s-(\w+)"[^>]*><span aria-hidden="true">[^<]+<\/span> ([^<]+)<\/(?:span|div)>/g)];
      const opens = html.match(/class="dv-(?:tag|cell) dv-s-\w+"/g) ?? [];
      expect(tags.length, name).toBe(opens.length);
      for (const [, status, word] of tags) {
        if (status === 'none') expect(word).toBe('none');
        else expect(words.has(word!), `${name} ${status} ${word}`).toBe(true);
      }
      // Each object-bar segment has a <title> naming its count and word.
      const segments = html.match(/<rect class="dv-f-\w+"[^>]*><title>\d+ [^<]+<\/title><\/rect>/g) ?? [];
      expect(segments.length, name).toBe((html.match(/<rect class="dv-f-/g) ?? []).length);
      expect(html.match(/class="dv-stat dv-s-/g), name).toHaveLength(4);
    }
  });

  it('labels each check status in words beside its bar', async () => {
    const data = await build('legacy', false);
    for (const block of checkBlocks(renderDecisionView(data))) {
      const word = escapeHtml(STATUS_WORD[block.status as PlainStatus]);
      expect(block.body, block.metric).toContain(`</span> ${word}</span>`);
    }
  });
});

describe('decision view rows and fallbacks', () => {
  it('shows a greyed Contact row "needs a second system" only with no second source', async () => {
    const alone = renderDecisionView(await build('healthy', false));
    expect(alone).toMatch(/<div class="dv-obj dv-obj-off">\s*<div class="dv-obj-name">Contact<\/div>[\s\S]*?needs a second system/);
    expect(alone).toContain('1 check needs a second system');
    expect(alone).toContain('2 checks need a second system');
    const connected = renderDecisionView(await build('healthy'));
    expect(connected).not.toContain('needs a second system');
    expect(connected).toContain('data-object="contact"');
  });

  it('always shows the unscanned objects last, greyed, in fixed order', async () => {
    const html = renderDecisionView(await build('fresh'));
    const labels = ['Leads', 'Quotes', 'Products / line items', 'Campaigns', 'Territories / targets'];
    let last = -1;
    for (const label of labels) {
      const at = html.indexOf(`<div class="dv-obj-name">${escapeHtml(label)}</div>`);
      expect(at, label).toBeGreaterThan(last);
      last = at;
    }
    expect(html.indexOf('data-object=')).toBeLessThan(html.indexOf('not scanned yet'));
  });

  it("shows the static fallback for a can't-tell check with no adapter hint", async () => {
    const data = patchRows(await build('healthy'), {
      contact_linkage_rate: { status: 'not_instrumented', tier: null, value: null, notMeasured: true, fixHint: null },
    });
    const html = renderDecisionView(data);
    expect(NO_HINT_FALLBACK).toBe("The scan can't see this data. Check field access or the integration.");
    expect(html.split(escapeHtml(NO_HINT_FALLBACK)).length - 1).toBeGreaterThanOrEqual(2); // fix list + card
  });

  it('shows the nothing-to-fix state when every gating check passes', async () => {
    const data = await build('healthy');
    const passing: ReportData = { ...data, metrics: data.metrics.map((m) => ({ ...m, status: 'ok' as const, tier: 'viable' as const, notMeasured: false })) };
    const html = renderDecisionView(passing);
    expect(html).toContain('Nothing to fix');
    expect(html).not.toContain('class="dv-fix ');
  });
});

describe('decision view placement', () => {
  it('sits after the plain-summary toggle and before the summary cards in latest.html', async () => {
    const html = renderReportHtml(await build('healthy'));
    const view = html.indexOf('<section class="dv"');
    expect(view).toBeGreaterThan(html.indexOf('</details>'));
    expect(html.indexOf('<details class="plain-summary">')).toBeLessThan(view);
    expect(view).toBeLessThan(html.indexOf('<div class="summary-grid">'));
    expect(html.split('<section class="dv"').length - 1).toBe(1);
  });

  it('sits after the title and meta lines and before the summary paragraph in the plain report', async () => {
    const data = await build('healthy');
    const html = renderPlainReportHtml(data);
    const view = html.indexOf('<section class="dv"');
    expect(view).toBeGreaterThan(html.lastIndexOf('<div class="meta">'));
    expect(view).toBeGreaterThan(html.indexOf('<h1>'));
    expect(view).toBeLessThan(html.indexOf(`<p>${escapeHtml(buildExecutiveSummary(data))}</p>`));
    expect(html.split('<section class="dv"').length - 1).toBe(1);
  });

  it('is not added to the multi-org comparison page', async () => {
    const { renderComparisonHtml } = await import('../../src/report/render.js');
    const html = renderComparisonHtml([await build('healthy'), await build('legacy')]);
    expect(html).not.toContain('<section class="dv"');
  });
});

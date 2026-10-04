/**
 * Use-case section: cards grouped under "Ready to use (N)" and so on in the
 * summary strip's order (empty groups left out), ready cards folded to one
 * "All N checks pass" line, other cards showing only their non-passing
 * checks with the passing ones folded, and a stable id per card. Folds are
 * native <details>; every check stays in the markup either way.
 */

import { describe, expect, it } from 'vitest';
import { MockAdapter, MockSecondSourceAdapter } from '@gtm-trust-kernel/adapters/mock.js';
import { FIXTURE_NAMES, MOCK_ORG_FIXTURES, type FixtureName } from '../../src/fixtures/mockOrgs.js';
import { buildReportData, type ReportData } from '../../src/report/buildReport.js';
import { BUCKET_WORD, buildDecisionView, type CardBucket } from '../../src/report/decisionView/model.js';
import { cardId, renderDecisionView } from '../../src/report/decisionView/render.js';
import { renderPlainReportHtml } from '../../src/report/plainReport.js';
import { renderReportHtml } from '../../src/report/render.js';

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

async function allData(): Promise<{ name: string; data: ReportData }[]> {
  const out: { name: string; data: ReportData }[] = [];
  for (const name of FIXTURE_NAMES) {
    out.push({ name, data: await build(name) });
    out.push({ name: `${name} (no second source)`, data: await build(name, false) });
  }
  return out;
}

const STRIP_ORDER: readonly CardBucket[] = ['ready', 'caution', 'notReady', 'cantTell'];

interface ParsedCard {
  id: string;
  capability: string;
  html: string;
}
interface ParsedGroup {
  bucket: string;
  heading: string;
  cards: ParsedCard[];
}

/** The groups of the use-case part, with each card's markup, parsed from the rendered HTML. */
function parseGroups(html: string): ParsedGroup[] {
  return html
    .split('<div class="dv-group" ')
    .slice(1)
    .map((chunk) => {
      const bucket = chunk.match(/^data-bucket="([^"]+)"/)![1]!;
      const heading = chunk.match(/<h4 class="dv-group-head">([^<]*)<\/h4>/)![1]!;
      const cards = chunk
        .split('<div class="dv-card ')
        .slice(1)
        .map((c) => ({
          id: c.match(/ id="([^"]+)"/)![1]!,
          capability: c.match(/data-capability="([^"]+)"/)![1]!,
          html: c,
        }));
      return { bucket, heading, cards };
    });
}

/** The checks shown outside any <details> in a card's markup, as "metric:status". */
function openChecks(cardHtml: string): string[] {
  const withoutFolds = cardHtml.replace(/<details class="dv-fold">[\s\S]*?<\/details>/g, '');
  return [...withoutFolds.matchAll(/<div class="dv-check" data-metric="([^"]+)" data-status="([^"]+)">/g)].map(
    (m) => `${m[1]}:${m[2]}`,
  );
}

/** The status of every check inside a card's folds. */
function foldedStatuses(cardHtml: string): string[] {
  const folds = [...cardHtml.matchAll(/<details class="dv-fold">([\s\S]*?)<\/details>/g)].map((m) => m[1]!);
  return folds.flatMap((f) => [...f.matchAll(/data-status="([^"]+)"/g)].map((m) => m[1]!));
}

describe('use-case groups', () => {
  it('lists groups in summary-strip order with counts that match the strip, leaving out empty groups', async () => {
    for (const { name, data } of await allData()) {
      const view = buildDecisionView(data);
      const groups = parseGroups(renderDecisionView(data));
      const counts: Record<CardBucket, number> = {
        ready: view.summary.ready,
        caution: view.summary.caution,
        notReady: view.summary.notReady,
        cantTell: view.summary.cantTell,
      };
      expect(
        groups.map((g) => g.bucket),
        name,
      ).toEqual(STRIP_ORDER.filter((b) => counts[b] > 0));
      for (const g of groups) {
        const b = g.bucket as CardBucket;
        expect(g.heading, name).toBe(`${BUCKET_WORD[b]} (${counts[b]})`.replace("'", '&#39;'));
        expect(g.cards.length, name).toBe(counts[b]);
      }
    }
  });

  it('keeps the README lead order inside each group', async () => {
    for (const { name, data } of await allData()) {
      const view = buildDecisionView(data);
      for (const g of parseGroups(renderDecisionView(data))) {
        const expected = view.cards.filter((c) => c.bucket === g.bucket).map((c) => c.id);
        expect(
          g.cards.map((c) => c.capability),
          `${name} ${g.bucket}`,
        ).toEqual(expected);
      }
    }
  });

  it('uses h4 group headings, so the plain report keeps its own h2 bucket headings', async () => {
    const html = renderPlainReportHtml(await build('healthy'));
    expect(html).toContain('<h2>Ready to use</h2>');
    expect(html).toContain('<h2>Usable with caution</h2>');
    expect(html).toContain('<h2>Not ready yet</h2>');
    expect(html).toMatch(/<h4 class="dv-group-head">Ready to use \(\d+\)<\/h4>/);
  });

  it('leaves out a group with no cards', async () => {
    const seen = new Set<string>();
    for (const { data } of await allData()) {
      const view = buildDecisionView(data);
      const html = renderDecisionView(data);
      for (const b of STRIP_ORDER) {
        const hasCards = view.cards.some((c) => c.bucket === b);
        expect(html.includes(`<div class="dv-group" data-bucket="${b}">`)).toBe(hasCards);
        if (!hasCards) seen.add(b);
      }
    }
    expect(seen.size).toBeGreaterThan(0);
  });
});

describe('use-case card ids', () => {
  it('gives every card exactly one uc-<capability id>, in both reports', async () => {
    for (const { name, data } of await allData()) {
      const view = buildDecisionView(data);
      for (const html of [renderReportHtml(data), renderPlainReportHtml(data)]) {
        for (const card of view.cards) {
          expect(cardId(card.id)).toBe(`uc-${card.id}`);
          expect(html.split(`id="uc-${card.id}"`).length - 1, `${name} ${card.id}`).toBe(1);
        }
        expect((html.match(/ id="uc-/g) ?? []).length, name).toBe(view.cards.length);
      }
    }
  });

  it('does not add the cards to the jump bar', async () => {
    const html = renderPlainReportHtml(await build('healthy'));
    const start = html.indexOf('<div class="jump"');
    expect(html.slice(start, html.indexOf('</div>', start))).not.toContain('#uc-');
  });
});

describe('use-case card folds', () => {
  it('collapses a ready card to one summary line with every check inside the fold', async () => {
    let seen = 0;
    for (const { name, data } of await allData()) {
      const view = buildDecisionView(data);
      for (const card of parseGroups(renderDecisionView(data)).flatMap((g) => g.cards)) {
        const model = view.cards.find((c) => c.id === card.capability)!;
        if (model.bucket !== 'ready') continue;
        seen++;
        expect(card.html, name).toContain(
          model.checks.length === 1 ? '<summary>The 1 check passes</summary>' : `<summary>All ${model.checks.length} checks pass</summary>`,
        );
        expect(card.html, name).not.toMatch(/<details[^>]*\sopen/);
        expect(openChecks(card.html), name).toEqual([]);
        expect(foldedStatuses(card.html), name).toHaveLength(model.checks.length);
        expect(new Set(foldedStatuses(card.html)), name).toEqual(new Set(['pass']));
      }
    }
    expect(seen).toBeGreaterThan(0);
  });

  it("shows only weak, failing and can't-tell checks openly on the other cards and folds the passing ones", async () => {
    let seen = 0;
    for (const { name, data } of await allData()) {
      const view = buildDecisionView(data);
      for (const card of parseGroups(renderDecisionView(data)).flatMap((g) => g.cards)) {
        const model = view.cards.find((c) => c.id === card.capability)!;
        if (model.bucket === 'ready') continue;
        seen++;
        const open = openChecks(card.html);
        const label = `${name} ${card.capability}`;
        expect(
          open.map((o) => o.split(':')[1]),
          label,
        ).not.toContain('pass');
        expect(open.map((o) => o.split(':')[0]).sort(), label).toEqual(
          model.checks
            .filter((c) => c.status !== 'pass')
            .map((c) => c.metric)
            .sort(),
        );
        const passing = model.checks.filter((c) => c.status === 'pass').length;
        if (passing === 0) {
          expect(card.html, label).not.toContain('<details');
        } else {
          expect(card.html, label).toContain(passing === 1 ? '<summary>1 check passes</summary>' : `<summary>${passing} checks pass</summary>`);
          expect(foldedStatuses(card.html), label).toHaveLength(passing);
          expect(new Set(foldedStatuses(card.html)), label).toEqual(new Set(['pass']));
        }
      }
    }
    expect(seen).toBeGreaterThan(0);
  });

  it('uses no script and no list markup, and keeps every check in the markup', async () => {
    for (const { name, data } of await allData()) {
      const html = renderDecisionView(data);
      expect(html, name).not.toMatch(/<script/i);
      expect(html, name).not.toMatch(/<li|<ul|<table/);
      const total = buildDecisionView(data).cards.reduce((n, c) => n + c.checks.length, 0);
      expect((html.match(/<div class="dv-check" /g) ?? []).length, name).toBe(total);
    }
  });
});

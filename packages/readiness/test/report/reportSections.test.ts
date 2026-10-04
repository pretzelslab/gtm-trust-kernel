/**
 * Report sections: the jump bar, the five numbered decision-view parts and
 * the details band in both single-org reports. Anchor ids are unique and
 * match the jump bar's links; the jump bar uses no list markup; the parts
 * come in order, each with its lede; the details band follows the decision
 * view and holds the existing content; a :target rule outlines the section a
 * link lands on. The --all comparison page is left as it was.
 */

import { describe, expect, it } from 'vitest';
import { MockAdapter, MockSecondSourceAdapter } from '@gtm-trust-kernel/adapters/mock.js';
import { FIXTURE_NAMES, MOCK_ORG_FIXTURES, type FixtureName } from '../../src/fixtures/mockOrgs.js';
import { buildReportData, type ReportData } from '../../src/report/buildReport.js';
import { buildFullNarrative } from '../../src/report/plainSummary.js';
import { PLAIN_DETAILS_LEDE, renderPlainReportHtml } from '../../src/report/plainReport.js';
import { DETAILED_DETAILS_LEDE, renderComparisonHtml, renderReportHtml } from '../../src/report/render.js';
import { DETAILS_ID, DV_PARTS, JUMP_LINKS, renderDecisionView, renderJumpBar } from '../../src/report/decisionView/render.js';
import { escapeHtml, STYLE } from '../../src/report/shell.js';

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

async function allReports(): Promise<{ name: string; html: string }[]> {
  const out: { name: string; html: string }[] = [];
  for (const name of FIXTURE_NAMES) {
    for (const second of [true, false]) {
      const data = await build(name, second);
      const label = second ? name : `${name} (no second source)`;
      out.push({ name: `${label}, latest.html`, html: renderReportHtml(data) });
      out.push({ name: `${label}, plain`, html: renderPlainReportHtml(data) });
    }
  }
  return out;
}

function jumpBarOf(html: string): string {
  const start = html.indexOf('<div class="jump"');
  expect(start).toBeGreaterThan(-1);
  return html.slice(start, html.indexOf('</div>', start) + '</div>'.length);
}

const ALL_IDS = [...DV_PARTS.map((p) => p.id), DETAILS_ID];

describe('report section ids and the jump bar', () => {
  it('has each section id exactly once in both reports', async () => {
    for (const { name, html } of await allReports()) {
      for (const id of ALL_IDS) expect(html.split(`id="${id}"`).length - 1, `${name}: ${id}`).toBe(1);
    }
  });

  it('links the jump bar to exactly those ids, in page order, with the agreed labels', async () => {
    expect(JUMP_LINKS.map((l) => l.id)).toEqual(ALL_IDS);
    expect(JUMP_LINKS.map((l) => l.label)).toEqual(['Data health', 'Counts', 'Fixes', 'Use cases', 'Grid', 'Details']);
    for (const { name, html } of await allReports()) {
      const bar = jumpBarOf(html);
      const hrefs = [...bar.matchAll(/<a href="#([^"]+)">/g)].map((m) => m[1]);
      expect(hrefs, name).toEqual(ALL_IDS);
      expect(html.split('<div class="jump"').length - 1, name).toBe(1);
    }
  });

  it('marks the jump bar as navigation and uses no list markup', () => {
    const bar = renderJumpBar();
    expect(bar).toMatch(/^<div class="jump" role="navigation" aria-label="Jump to section">/);
    expect(bar).not.toMatch(/<li/);
    expect(bar).not.toMatch(/<ul/);
    expect(bar).not.toMatch(/<nav/);
  });

  it('escapes the jump bar labels and links', () => {
    const bar = renderJumpBar();
    for (const l of JUMP_LINKS) expect(bar).toContain(`<a href="#${escapeHtml(l.id)}">${escapeHtml(l.label)}</a>`);
    const text = bar.replace(/<[^>]*>/g, '');
    expect(text).not.toMatch(/[<>"']/);
  });

  it('puts the jump bar right after the header meta lines', async () => {
    for (const { name, html } of await allReports()) {
      const bar = html.indexOf('<div class="jump"');
      expect(bar, name).toBeGreaterThan(html.lastIndexOf('<div class="meta">'));
      expect(bar, name).toBeLessThan(html.indexOf('<section class="dv"'));
    }
  });

  it('has no http reference in either report', async () => {
    for (const { name, html } of await allReports()) expect(html, name).not.toContain('http');
  });
});

describe('decision view parts', () => {
  it('renders the five parts in order, each numbered, with its lede', async () => {
    for (const name of FIXTURE_NAMES) {
      const view = renderDecisionView(await build(name));
      let last = -1;
      DV_PARTS.forEach((p, i) => {
        const at = view.indexOf(`<div class="dv-part" id="${p.id}">`);
        expect(at, `${name}: ${p.id}`).toBeGreaterThan(last);
        const head = view.slice(at, view.indexOf('</div>', view.indexOf('<div class="dv-part-head">', at)));
        expect(head).toContain(`<h3>${i + 1} · ${escapeHtml(p.title)}</h3>`);
        expect(head).toContain(`<p class="dv-lede">${escapeHtml(p.lede)}</p>`);
        last = at;
      });
      expect(view.split('<div class="dv-part"').length - 1).toBe(5);
    }
  });

  it('keeps the ledes clear of the headings a polish test slices on', () => {
    for (const p of DV_PARTS) {
      expect(p.lede).not.toContain('Fix this first');
      expect(p.lede).not.toContain('Use cases and the checks behind them');
    }
  });
});

describe('details band', () => {
  it('follows the decision view and holds the existing details in latest.html', async () => {
    for (const name of FIXTURE_NAMES) {
      const html = renderReportHtml(await build(name));
      const band = html.indexOf(`<div class="details-band" id="${DETAILS_ID}">`);
      expect(band, name).toBeGreaterThan(html.indexOf('</section>', html.indexOf('<section class="dv"')));
      expect(band, name).toBeLessThan(html.indexOf('<div class="summary-grid">'));
      expect(html.indexOf('<h2>Details</h2>'), name).toBeGreaterThan(band);
      expect(html, name).toContain(escapeHtml(DETAILED_DETAILS_LEDE));
      expect(html.indexOf('<h2>Capabilities</h2>'), name).toBeGreaterThan(band);
      expect(html.indexOf('<h2>Metrics</h2>'), name).toBeGreaterThan(band);
      expect(html.split('<div class="table-wrap"><table>').length - 1, name).toBe(2);
    }
  });

  it('follows the decision view and holds the summary and buckets in the plain report', async () => {
    for (const name of FIXTURE_NAMES) {
      const data = await build(name);
      const html = renderPlainReportHtml(data);
      const band = html.indexOf(`<div class="details-band" id="${DETAILS_ID}">`);
      expect(band, name).toBeGreaterThan(html.indexOf('</section>', html.indexOf('<section class="dv"')));
      expect(html.indexOf('<h2>Details</h2>'), name).toBeGreaterThan(band);
      expect(html, name).toContain(escapeHtml(PLAIN_DETAILS_LEDE));
      expect(html.indexOf(`<p>${escapeHtml(buildFullNarrative(data).summary)}</p>`), name).toBeGreaterThan(band);
    }
  });

  it('wraps both reports in a centred page, but not the comparison page', async () => {
    const data = await build('healthy');
    for (const html of [renderReportHtml(data), renderPlainReportHtml(data)]) {
      expect(html.split('<main class="page">').length - 1).toBe(1);
      expect(html.indexOf('<main class="page">')).toBeLessThan(html.indexOf('<h1>'));
      expect(html.indexOf('</main>')).toBeGreaterThan(html.indexOf('<div class="details-band"'));
    }
    const html = renderComparisonHtml([data]);
    const comparison = html.slice(html.indexOf('<body>'));
    expect(comparison).not.toContain('<main');
    expect(comparison).not.toContain('class="jump"');
    expect(comparison).not.toContain('details-band');
    expect(comparison).not.toContain('table-wrap');
  });
});

describe('section styles', () => {
  it('outlines a targeted part or the details band', () => {
    expect(STYLE).toMatch(/\.dv-part:target[^{]*\{[^}]*outline: 2px solid var\(--accent\)/);
    expect(STYLE).toMatch(/\.details-band:target[^{]*\{[^}]*outline: 2px solid var\(--accent\)/);
    expect(STYLE).toMatch(/scroll-margin-top/);
  });

  it('defines the accent and band tokens for light and dark', () => {
    const dark = STYLE.slice(STYLE.indexOf('@media (prefers-color-scheme: dark)'));
    for (const token of ['--accent:', '--band:']) {
      expect(STYLE.indexOf(token)).toBeLessThan(STYLE.indexOf('@media (prefers-color-scheme: dark)'));
      expect(dark).toContain(token);
    }
  });

  it('makes the jump bar sticky only on wide screens', () => {
    const wide = STYLE.slice(STYLE.indexOf('@media (min-width: 720px)'));
    expect(wide).toMatch(/\.jump \{[^}]*position: sticky/);
    expect(STYLE.slice(0, STYLE.indexOf('@media (min-width: 720px)'))).not.toContain('sticky');
  });
});

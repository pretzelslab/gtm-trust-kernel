import { describe, expect, it } from 'vitest';
import { MockAdapter, MockSecondSourceAdapter } from '@gtm-trust-kernel/adapters/mock.js';
import { MOCK_ORG_FIXTURES } from '../../src/fixtures/mockOrgs.js';
import { buildReportData, type ReportData } from '../../src/report/buildReport.js';
import { renderPlainReportHtml } from '../../src/report/plainReport.js';

/**
 * Same offline-safety/structural checks render.test.ts runs against the
 * tabular report, applied to the plain-English report — plus banner-mode
 * coverage so this renderer can never mislabel live data as fixture (or
 * vice versa), same requirement as render.ts's renderReportHtml.
 */

async function buildHealthy(): Promise<ReportData> {
  const fixture = MOCK_ORG_FIXTURES.healthy;
  const adapter = new MockAdapter(fixture.orgId, fixture.data, fixture.capabilities);
  const secondSourceAdapter = fixture.secondSource
    ? new MockSecondSourceAdapter(fixture.secondSource.data, fixture.secondSource.capabilities)
    : undefined;
  return buildReportData(adapter, secondSourceAdapter, {
    orgLabel: fixture.label,
    orgDescription: fixture.description,
    asOf: fixture.asOf,
  });
}

function assertOfflineSafe(html: string): void {
  expect(html).not.toContain('http://');
  expect(html).not.toContain('https://');
  expect(html).not.toMatch(/<script[^>]*\ssrc\s*=/i);
  expect(html).not.toMatch(/<link[^>]*\shref\s*=/i);
  expect(html).not.toContain('@import');
  expect(html).not.toContain('fetch(');
}

function assertStructurallyIntact(html: string): void {
  expect(html).toMatch(/^<!doctype html>/i);
  expect(html).toContain('<html');
  expect(html).toContain('</html>');
  expect(html.match(/<style>/g)).toHaveLength(1);
  const bodyMatch = html.match(/<body>([\s\S]*)<\/body>/i);
  expect(bodyMatch).not.toBeNull();
  expect(bodyMatch![1]!.trim().length).toBeGreaterThan(0);
}

describe('renderPlainReportHtml offline safety and structural integrity', () => {
  it('is offline-safe and structurally intact (default/fixture)', async () => {
    const data = await buildHealthy();
    const html = renderPlainReportHtml(data);
    assertOfflineSafe(html);
    assertStructurallyIntact(html);
  });

  it('has no metrics table and no verdict pills — bucketed lists and prose only', async () => {
    const data = await buildHealthy();
    const html = renderPlainReportHtml(data);
    expect(html).not.toContain('<table');
    expect(html).not.toContain('class="pill');
  });

  it('renders each populated bucket as its own heading + <ul> (healthy has all three)', async () => {
    const data = await buildHealthy();
    const html = renderPlainReportHtml(data);
    expect(html).toContain('<h2>Ready to use</h2>');
    expect(html).toContain('<h2>Usable with caution</h2>');
    expect(html).toContain('<h2>Not ready yet</h2>');
    expect(html.match(/<ul>/g)).toHaveLength(3);
  });

  it('uses a human date format, not ISO timestamps, in the meta line', async () => {
    const data = await buildHealthy();
    const html = renderPlainReportHtml(data);
    expect(html).toContain('Data as of 20 Sep 2026');
    expect(html).toMatch(/Report generated \d{1,2} [A-Z][a-z]{2} \d{4}/);
    expect(html).not.toContain('2026-09-20T00:00:00.000Z');
    expect(html).not.toContain(data.generatedAt);
  });
});

describe('renderPlainReportHtml banner mode', () => {
  it('defaults (no options) to the fixture banner', async () => {
    const data = await buildHealthy();
    const html = renderPlainReportHtml(data);
    expect(html).toContain('MOCK DATA — fixture:');
    expect(html).not.toContain('LIVE DATA');
  });

  it('mode: "live" renders the neutral live banner, not the mock banner', async () => {
    const data = await buildHealthy();
    const html = renderPlainReportHtml(data, { mode: 'live' });
    expect(html).toContain('LIVE DATA · read-only');
    expect(html).not.toContain('MOCK DATA');
  });
});

describe('renderPlainReportHtml escaping under adversarial input', () => {
  it('escapes a hostile orgLabel', async () => {
    const data = await buildHealthy();
    const hostile: ReportData = {
      ...data,
      org: { ...data.org, orgLabel: `<script>alert(1)</script>` },
    };
    const html = renderPlainReportHtml(hostile);
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
  });
});

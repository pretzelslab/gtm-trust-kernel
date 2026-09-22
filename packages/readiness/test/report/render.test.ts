import { describe, expect, it } from 'vitest';
import { MockAdapter, MockSecondSourceAdapter } from '@gtm-trust-kernel/adapters/mock.js';
import { MOCK_ORG_FIXTURES } from '../../src/fixtures/mockOrgs.js';
import { buildReportData, type ReportData } from '../../src/report/buildReport.js';
import { renderComparisonHtml, renderReportHtml } from '../../src/report/render.js';

/**
 * render.ts's own docblock claims "self-contained ... no external
 * fonts/scripts/network requests, works offline" but was, until this test,
 * "Not covered by tests." These assertions are deliberately string-only, not
 * a real DOM parse (no jsdom/linkedom dependency) — sufficient to catch a
 * regression that introduces a network call or malformed shell, per
 * docs/STATUS.md.
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

describe('render.ts offline safety and structural integrity (not previously covered by any test)', () => {
  it('renderReportHtml (single-fixture report) is offline-safe and structurally intact', async () => {
    const data = await buildHealthy();
    const html = renderReportHtml(data);
    assertOfflineSafe(html);
    assertStructurallyIntact(html);
  });

  it('renderComparisonHtml (the --all path) is offline-safe and structurally intact', async () => {
    const data = await buildHealthy();
    const html = renderComparisonHtml([data]);
    assertOfflineSafe(html);
    assertStructurallyIntact(html);
  });
});

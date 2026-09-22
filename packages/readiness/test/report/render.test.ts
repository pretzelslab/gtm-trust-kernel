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

/**
 * Adversarial escaping check (cold review finding: no test previously
 * exercised escapeHtml against a hostile orgLabel). orgLabel/orgDescription
 * are BuildReportOptions-supplied, not adapter-sourced free text (see
 * README.md's Design Rules) — but escapeHtml is the only thing standing
 * between any future caller and injected markup, so it earns its own test.
 */
describe('render.ts escaping under adversarial input', () => {
  it('escapes <script>, double quotes, and single quotes; preserves a unicode lookalike as inert text', async () => {
    const data = await buildHealthy();
    const hostile: ReportData = {
      ...data,
      org: {
        ...data.org,
        orgLabel: `<script>alert(1)</script> "double" 'single' аdmin`,
      },
    };

    const html = renderReportHtml(hostile);

    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).not.toContain('"double"');
    expect(html).not.toContain("'single'");
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(html).toContain('&quot;double&quot;');
    expect(html).toContain('&#39;single&#39;');
    // The Cyrillic "а" lookalike isn't an HTML metacharacter — it survives as
    // ordinary text, which is correct: escaping isn't meant to strip it.
    expect(html).toContain('аdmin');
  });
});

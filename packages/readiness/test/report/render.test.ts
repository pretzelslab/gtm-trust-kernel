import { describe, expect, it } from 'vitest';
import { MockAdapter, MockSecondSourceAdapter } from '@gtm-trust-kernel/adapters/mock.js';
import { MOCK_ORG_FIXTURES } from '../../src/fixtures/mockOrgs.js';
import { buildReportData, type ReportData } from '../../src/report/buildReport.js';
import { renderComparisonHtml, renderReportHtml } from '../../src/report/render.js';
import type { NarrativeResult } from '../../src/report/narrative.js';
import { buildExecutiveSummary } from '../../src/report/plainSummary.js';
import { escapeHtml } from '../../src/report/shell.js';

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
 * docs/ARCHITECTURE.md's Design rules) — but escapeHtml is the only thing standing
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

/**
 * Phase E commit 4 (decision 27): renderReportHtml's narrative option is a
 * canned NarrativeResult only -- no network, no real NarrativeModelClient.
 * buildNarrative (narrative.ts) already has its own orchestration tests
 * (narrative.test.ts); these cover only render.ts's own rendering of the
 * result it's handed.
 */
describe('render.ts narrative slot (Phase E commit 4)', () => {
  it('narrative undefined (the default) produces byte-identical output to a call with no narrative option at all', async () => {
    const data = await buildHealthy();

    const withoutOption = renderReportHtml(data);
    const withUndefined = renderReportHtml(data, { narrative: undefined });

    expect(withUndefined).toBe(withoutOption);
    expect(withoutOption).toContain(`<p>${escapeHtml(buildExecutiveSummary(data))}</p>`);
    // The class name itself is always present in the global <style> block; only the <div> using it is conditional.
    expect(withoutOption).not.toContain('<div class="narrative-fallback-notice">');
  });

  it('ok:true renders one <li> per claim, in order, with groundedIn ids in the title attribute', async () => {
    const data = await buildHealthy();
    const narrative: NarrativeResult = {
      ok: true,
      text: '- Claim one.\n- Claim two.',
      claims: [
        { text: 'Claim one.', groundedIn: ['metric_a' as never] },
        { text: 'Claim two.', groundedIn: ['metric_b' as never, 'metric_c' as never] },
      ],
    };

    const html = renderReportHtml(data, { narrative });

    expect(html.match(/<li/g)).toHaveLength(2);
    expect(html).toContain('<li title="metric_a">Claim one.</li>');
    expect(html).toContain('<li title="metric_b, metric_c">Claim two.</li>');
    expect(html.indexOf('Claim one.')).toBeLessThan(html.indexOf('Claim two.'));
  });

  it('ok:false renders the fallback notice callout directly above the deterministic summary paragraph', async () => {
    const data = await buildHealthy();
    const notice = 'LLM narrative rejected: ungrounded figure in claim 3; showing deterministic summary.';
    const narrative: NarrativeResult = {
      ok: false,
      reasonKind: 'grounding',
      notice,
      text: buildExecutiveSummary(data),
    };

    const html = renderReportHtml(data, { narrative });

    expect(html).toContain(`<div class="narrative-fallback-notice">${notice}</div>`);
    expect(html).toContain(`<p>${escapeHtml(buildExecutiveSummary(data))}</p>`);
    const noticeIndex = html.indexOf('narrative-fallback-notice');
    const summaryParaIndex = html.indexOf(`<p>${escapeHtml(buildExecutiveSummary(data))}</p>`);
    expect(noticeIndex).toBeLessThan(summaryParaIndex);
  });

  it('escapes hostile claim text and cited ids in both the <li> body and the title attribute', async () => {
    const data = await buildHealthy();
    const narrative: NarrativeResult = {
      ok: true,
      text: '',
      claims: [
        {
          text: `<script>alert(1)</script> "double" 'single'`,
          groundedIn: [`<script>bad</script>` as never],
        },
      ],
    };

    const html = renderReportHtml(data, { narrative });

    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).not.toContain('<script>bad</script>');
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt; &quot;double&quot; &#39;single&#39;');
    expect(html).toContain('title="&lt;script&gt;bad&lt;/script&gt;"');
  });
});

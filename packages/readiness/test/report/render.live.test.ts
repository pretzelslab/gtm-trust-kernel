import { describe, expect, it } from 'vitest';
import { MockAdapter, MockSecondSourceAdapter } from '@gtm-trust-kernel/adapters/mock.js';
import { MOCK_ORG_FIXTURES } from '../../src/fixtures/mockOrgs.js';
import { buildReportData, type ReportData } from '../../src/report/buildReport.js';
import { renderReportHtml } from '../../src/report/render.js';

/**
 * Regression coverage for the fixture/live banner bug: renderReportHtml
 * used to show "MOCK DATA" regardless of which adapter produced the data,
 * because cli.ts's --live path called it with no way to say so. Kept in
 * its own file rather than added to render.test.ts per this session's
 * explicit instruction.
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

describe('renderReportHtml banner mode', () => {
  it('defaults (no options) to the original fixture banner, unchanged', async () => {
    const data = await buildHealthy();
    const html = renderReportHtml(data);
    expect(html).toContain('MOCK DATA — fixture:');
    expect(html).toContain('No real CRM was contacted; nothing leaves this machine.');
    expect(html).not.toContain('LIVE DATA');
  });

  it('mode: "fixture" renders the same banner as the default', async () => {
    const data = await buildHealthy();
    const html = renderReportHtml(data, { mode: 'fixture' });
    expect(html).toContain('MOCK DATA — fixture:');
    expect(html).not.toContain('LIVE DATA');
  });

  it('mode: "live" renders a neutral live banner, not the mock banner', async () => {
    const data = await buildHealthy();
    const html = renderReportHtml(data, { mode: 'live' });
    expect(html).toContain('LIVE DATA · read-only');
    expect(html).not.toContain('MOCK DATA');
    expect(html).not.toContain('nothing leaves this machine');
  });
});

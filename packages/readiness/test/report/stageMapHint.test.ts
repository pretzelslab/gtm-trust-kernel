/**
 * The stage-map hint: shown only when the scan found deals or stage-history
 * rows whose stage has no standard mapping, and never naming a stage label
 * (labels are org configuration, not report content).
 */

import { describe, expect, it } from 'vitest';
import { MockAdapter } from '@gtm-trust-kernel/adapters/mock.js';
import type { AdapterCapabilities } from '@gtm-trust-kernel/adapters/types.js';
import { MOCK_ORG_FIXTURES, type FixtureName } from '../../src/fixtures/mockOrgs.js';
import { buildReportData, type ReportData } from '../../src/report/buildReport.js';
import { renderPlainReportHtml } from '../../src/report/plainReport.js';
import { renderReportHtml, stageMapNoticeText } from '../../src/report/render.js';

const HINT = 'Map your custom stages to standard ones in a JSON file and set SF_STAGE_MAP_PATH to its path.';

async function build(name: FixtureName, capabilities: Partial<AdapterCapabilities> = { stageMapHint: HINT }): Promise<ReportData> {
  const fixture = MOCK_ORG_FIXTURES[name];
  const adapter = new MockAdapter(fixture.orgId, fixture.data, { ...fixture.capabilities, ...capabilities });
  return buildReportData(adapter, undefined, { orgLabel: fixture.label, orgDescription: fixture.description, asOf: fixture.asOf });
}

const row = (data: ReportData, metric: string) => data.metrics.find((m) => m.metric === metric)!;

describe('stage-map hint', () => {
  it('is absent when every sampled stage is mapped', async () => {
    const data = await build('healthy');
    expect(row(data, 'stage_mapping_coverage').note).toMatch(/, 0 unmapped$/);
    expect(row(data, 'stage_mapping_coverage').fixHint).toBeNull();
    expect(stageMapNoticeText(data)).toBeNull();
    expect(renderReportHtml(data)).not.toContain('SF_STAGE_MAP_PATH');
    expect(renderPlainReportHtml(data)).not.toContain('SF_STAGE_MAP_PATH');
  });

  it('shows once, in both reports, when some sampled stages are unmapped', async () => {
    const data = await build('legacy');
    expect(row(data, 'stage_mapping_coverage').note).not.toMatch(/, 0 unmapped$/);
    expect(row(data, 'stage_mapping_coverage').fixHint).toBe(HINT);

    const text = stageMapNoticeText(data)!;
    expect(text).toBe(`Some deals have a stage this tool doesn't recognise, so stage-based checks skip them. ${HINT}`);
    for (const html of [renderReportHtml(data), renderPlainReportHtml(data)]) {
      expect(html.split("stage this tool doesn&#39;t recognise").length - 1).toBe(1);
    }
  });

  it('never prints a stage label', async () => {
    const data = await build('legacy');
    const labels = new Set(MOCK_ORG_FIXTURES.legacy.data.opportunities.map((o) => o.vendorStageLabel));
    expect(labels.size).toBeGreaterThan(0);
    for (const html of [renderReportHtml(data), renderPlainReportHtml(data)]) {
      for (const label of labels) expect(html).not.toContain(label);
    }
  });

  it('is absent when the adapter supplies no hint, even with unmapped stages', async () => {
    const data = await build('legacy', {});
    expect(row(data, 'stage_mapping_coverage').fixHint).toBeNull();
    expect(stageMapNoticeText(data)).toBeNull();
  });
});

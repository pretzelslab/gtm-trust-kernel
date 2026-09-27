import { describe, expect, it } from 'vitest';
import { MockAdapter, MockSecondSourceAdapter } from '@gtm-trust-kernel/adapters/mock.js';
import { MOCK_ORG_FIXTURES, type FixtureName } from '../../src/fixtures/mockOrgs.js';
import { buildReportData, type ReportData } from '../../src/report/buildReport.js';
import { buildNarrativePromptInput } from '../../src/report/narrativePromptInput.js';

async function buildFixture(name: FixtureName): Promise<ReportData> {
  const fixture = MOCK_ORG_FIXTURES[name];
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

describe('buildNarrativePromptInput', () => {
  it('excludes orgDescription entirely (fixture mode)', async () => {
    const data = await buildFixture('healthy');

    const input = buildNarrativePromptInput(data);

    expect('orgDescription' in input.org).toBe(false);
    expect(input.org.orgLabel).toBe(data.org.orgLabel);
  });

  it('excludes orgDescription entirely when it holds a live-mode-shaped value (a connected instance hostname)', async () => {
    const data = await buildFixture('healthy');
    const liveShaped: ReportData = {
      ...data,
      org: { ...data.org, orgLabel: 'Live Salesforce org', orgDescription: 'my-instance.my.salesforce.com' },
    };

    const input = buildNarrativePromptInput(liveShaped);

    expect('orgDescription' in input.org).toBe(false);
    expect(JSON.stringify(input)).not.toContain('my-instance.my.salesforce.com');
  });

  it('preserves every other field unchanged', async () => {
    const data = await buildFixture('healthy');

    const input = buildNarrativePromptInput(data);

    expect(input.generatedAt).toBe(data.generatedAt);
    expect(input.capabilities).toBe(data.capabilities);
    expect(input.org).toEqual({
      orgLabel: data.org.orgLabel,
      asOf: data.org.asOf,
      openSampleSize: data.org.openSampleSize,
      closedSampleSize: data.org.closedSampleSize,
      recordsScanned: data.org.recordsScanned,
      stopReason: data.org.stopReason,
    });
  });

  it('excludes capabilityVerdictCounts and metricStatusCounts entirely (decision 19, commit 2f)', async () => {
    const data = await buildFixture('healthy');

    const input = buildNarrativePromptInput(data);

    expect('capabilityVerdictCounts' in input.org).toBe(false);
    expect('metricStatusCounts' in input.org).toBe(false);
    expect(JSON.stringify(input)).not.toContain('capabilityVerdictCounts');
    expect(JSON.stringify(input)).not.toContain('metricStatusCounts');
  });

  it('copies each metric field-for-field, renaming viableAt/degradedAt to target/limit (decision 18, commit 2e)', async () => {
    const data = await buildFixture('healthy');

    const input = buildNarrativePromptInput(data);

    expect(input.metrics).toHaveLength(data.metrics.length);
    input.metrics.forEach((row, i) => {
      const original = data.metrics[i]!;
      expect(row.metric).toBe(original.metric);
      expect(row.dimension).toBe(original.dimension);
      expect(row.dimensionLabel).toBe(original.dimensionLabel);
      expect(row.status).toBe(original.status);
      expect(row.value).toBe(original.value);
      expect(row.sampleSize).toBe(original.sampleSize);
      expect(row.lowConfidence).toBe(original.lowConfidence);
      expect(row.note).toBe(original.note);
      expect(row.tier).toBe(original.tier);
      expect(row.floor).toBe(original.floor);
      expect(row.unit).toBe(original.unit);
      expect(row.target).toBe(original.viableAt);
      expect(row.limit).toBe(original.degradedAt);
      expect(row.gatesCapabilities).toBe(original.gatesCapabilities);
      expect(row).not.toHaveProperty('viableAt');
      expect(row).not.toHaveProperty('degradedAt');
    });
  });
});

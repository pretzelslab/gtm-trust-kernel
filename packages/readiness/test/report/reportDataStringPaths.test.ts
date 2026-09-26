/**
 * Structural guard (docs/narrative-design.md decision 12): enumerates every
 * string-valued path in a built ReportData -- the type narrative.ts's
 * prompt input is built from -- and pins it to an explicit, reviewed
 * allowlist. This is a change detector, not a correctness check by itself:
 * it fails equally if a new string path appears (unreviewed) or a known one
 * disappears, so the allowlist stays an accurate map of ReportData's
 * current string surface either way. Decision 10's field-by-field trace is
 * a point-in-time check; this test is what catches the next field added
 * later that trace didn't anticipate.
 */

import { describe, expect, it } from 'vitest';
import { MockAdapter, MockSecondSourceAdapter } from '@gtm-trust-kernel/adapters/mock.js';
import { FIXTURE_NAMES, MOCK_ORG_FIXTURES, type FixtureName } from '../../src/fixtures/mockOrgs.js';
import { buildReportData, type ReportData } from '../../src/report/buildReport.js';

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

/** Arrays are normalized to a single `[]` segment (not `[0]`, `[1]`, ...) so the path set doesn't depend on how many rows a fixture happens to produce. */
function collectStringPaths(value: unknown, path: string, into: Set<string>): void {
  if (typeof value === 'string') {
    into.add(path);
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectStringPaths(item, `${path}[]`, into);
    return;
  }
  if (value !== null && typeof value === 'object') {
    for (const [key, v] of Object.entries(value)) {
      collectStringPaths(v, path ? `${path}.${key}` : key, into);
    }
  }
}

/**
 * Reviewed 2026-09-26 against ReportData as it exists today (buildReport.ts:
 * MetricRow, ReportOrgSummary, ReportCapabilityRow). Adding a path here is a
 * deliberate review, not a mechanical sync with whatever the type currently
 * produces -- see this file's docblock.
 */
const EXPECTED_STRING_PATHS: readonly string[] = [
  'generatedAt',
  'org.orgLabel',
  'org.orgDescription',
  'org.asOf',
  'org.stopReason',
  'metrics[].metric',
  'metrics[].dimension',
  'metrics[].dimensionLabel',
  'metrics[].status',
  'metrics[].note',
  'metrics[].tier',
  'metrics[].unit',
  'metrics[].gatesCapabilities[].id',
  'metrics[].gatesCapabilities[].label',
  'capabilities[].id',
  'capabilities[].label',
  'capabilities[].description',
  'capabilities[].verdict',
].sort();

describe('ReportData string-valued path inventory (structural guard)', () => {
  it('matches the reviewed allowlist, across every mock-org fixture (so nullable-string fields surface from whichever fixture/row has a non-null value)', async () => {
    const found = new Set<string>();
    for (const name of FIXTURE_NAMES) {
      const data = await buildFixture(name);
      collectStringPaths(data as unknown, '', found);
    }

    expect([...found].sort()).toEqual(EXPECTED_STRING_PATHS);
  });
});

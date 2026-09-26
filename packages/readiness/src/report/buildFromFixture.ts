/**
 * Builds ReportData from a named mock-org fixture. Extracted from cli.ts's
 * former buildOne (Phase E commit 2) so scripts/narrativeSmoke.ts can build
 * fixture data without importing cli.ts itself — cli.ts runs main()
 * unconditionally at module load, so importing it for this one helper would
 * trigger the CLI's argument parsing and file writes.
 */

import { MockAdapter, MockSecondSourceAdapter } from '@gtm-trust-kernel/adapters/mock.js';
import { MOCK_ORG_FIXTURES, type FixtureName } from '../fixtures/mockOrgs.js';
import { buildReportData, type ReportData } from './buildReport.js';

export async function buildFromFixture(name: FixtureName): Promise<ReportData> {
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

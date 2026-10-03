/**
 * Report data for a live org (npm run report -- --live). Split out of
 * cli.ts so it can run against the fake Salesforce API in tests.
 *
 * The org's hostname (SalesforceAdapter.orgId, e.g. acme.my.salesforce.com)
 * identifies the customer, and reports get shared, so it is left out by
 * default: orgDescription says the hostname isn't shown. --show-org puts it
 * back, and the reports then carry ORG_HOST_NOTE (shell.ts).
 */

import { buildReportData, type BuildReportOptions, type ReportData } from './buildReport.js';

export const HIDDEN_ORG_DESCRIPTION = 'Salesforce org (hostname not shown; --show-org includes it)';

export interface LiveReportOptions {
  /** --show-org: put the org's hostname in the report. Off by default. */
  readonly showOrg: boolean;
  readonly sampling: Pick<BuildReportOptions, 'hydratePerStratum' | 'quick'>;
  readonly asOf?: string;
}

export async function buildLiveReportData(
  adapter: Parameters<typeof buildReportData>[0] & { readonly orgId: string },
  options: LiveReportOptions,
): Promise<ReportData> {
  return buildReportData(adapter, undefined, {
    orgLabel: 'Live Salesforce org',
    orgDescription: options.showOrg ? adapter.orgId : HIDDEN_ORG_DESCRIPTION,
    asOf: options.asOf ?? new Date().toISOString(),
    ...options.sampling,
  });
}

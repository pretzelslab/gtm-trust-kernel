/**
 * Report data for a live org (npm run report -- --live). Split out of
 * cli.ts so it can run against the fake Salesforce API in tests.
 *
 * The org's hostname (SalesforceAdapter.orgId, e.g. acme.my.salesforce.com)
 * identifies the customer, and reports get shared, so it is left out by
 * default: orgDescription says the hostname isn't shown. --show-org puts it
 * back, and the reports then carry ORG_HOST_NOTE (shell.ts).
 *
 * Before the scan, cli.ts calls runPreflight(): a credentials or access
 * problem stops the run with one line per problem, before the sampling
 * plan is printed or any record is read.
 */

import type { CrmAdapter, PreflightIssue, PreflightOptions } from '@gtm-trust-kernel/adapters/types.js';
import type { RetryInfo } from '@gtm-trust-kernel/adapters/salesforce.js';
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

/** A preflight found problems that stop the scan; its message lists them, one line each. */
export class PreflightError extends Error {
  constructor(readonly failures: readonly PreflightIssue[]) {
    super(
      [
        `Salesforce preflight found ${failures.length === 1 ? 'a problem' : `${failures.length} problems`}; no records were read. Fix ${failures.length === 1 ? 'it' : 'them'} and run again:`,
        ...failures.map((f) => `- ${f.message}`),
      ].join('\n'),
    );
    this.name = 'PreflightError';
  }
}

/**
 * Runs the adapter's preflight, if it has one. Throws PreflightError on any
 * failure; passes each warning to `warn` as one line and returns.
 */
export async function runPreflight(
  adapter: CrmAdapter,
  warn: (line: string) => void = (line) => console.error(line),
  options?: PreflightOptions,
): Promise<void> {
  if (!adapter.preflight) return;
  const result = await adapter.preflight(options);
  if (result.failures.length > 0) throw new PreflightError(result.failures);
  for (const w of result.warnings) warn(`Warning: ${w.message}`);
}

/** One stderr line for a wait before a retry (SalesforceAdapterDeps.onRetry). */
export function formatRetry(info: RetryInfo): string {
  const why = info.reason === '503' ? 'Salesforce is unavailable (503)' : `Salesforce is limiting requests (${info.reason})`;
  return `${why}; waiting ${(info.delayMs / 1000).toFixed(1)}s before attempt ${info.attempt} of ${info.maxAttempts}.`;
}

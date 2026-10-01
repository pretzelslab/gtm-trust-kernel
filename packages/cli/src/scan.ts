/**
 * `scan --demo` implementation, split out of cli.ts so it can be tested
 * in-process. Wraps @gtm-trust-kernel/readiness's existing report-building
 * functions and only ever touches the `healthy` fixture (never
 * `MOCK_ORG_FIXTURES` or `buildFromFixture`, which would pull the other
 * three fixtures' data into this package's bundle).
 *
 * With `useJson`, stdout carries only the report JSON: the sampling plan
 * (printed by readiness's runSample via console.log) and the "Report
 * written" lines are routed to stderr instead. HTML reports are still
 * written to `outDir` either way.
 */

import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { MockAdapter, MockSecondSourceAdapter } from '@gtm-trust-kernel/adapters/mock.js';
import { healthyFixture } from '@gtm-trust-kernel/readiness/fixtures/healthy.js';
import { AnthropicNarrativeModelClient } from '@gtm-trust-kernel/readiness/report/anthropicNarrativeModelClient.js';
import { buildReportData, type ReportData } from '@gtm-trust-kernel/readiness/report/buildReport.js';
import { evaluateFailOn, type FailOnVerdict } from '@gtm-trust-kernel/readiness/report/failOn.js';
import { buildNarrative, type NarrativeResult } from '@gtm-trust-kernel/readiness/report/narrative.js';
import { renderPlainReportHtml } from '@gtm-trust-kernel/readiness/report/plainReport.js';
import { renderReportHtml } from '@gtm-trust-kernel/readiness/report/render.js';

export interface ScanOptions {
  readonly outDir: string;
  readonly useNarrative: boolean;
  readonly useJson: boolean;
  /** Where the report JSON goes when `useJson` is set. Defaults to process.stdout. */
  readonly stdout?: (text: string) => void;
  /**
   * --fail-on verdicts (readiness's failOn.ts). Unset: the exit status
   * never depends on verdicts. Set: after the report is written, exit
   * code 2 if any capability has one of these verdicts.
   */
  readonly failOn?: ReadonlySet<FailOnVerdict>;
}

async function buildDemoReport(): Promise<ReportData> {
  const adapter = new MockAdapter(healthyFixture.orgId, healthyFixture.data, healthyFixture.capabilities);
  const secondSourceAdapter = healthyFixture.secondSource
    ? new MockSecondSourceAdapter(healthyFixture.secondSource.data, healthyFixture.secondSource.capabilities)
    : undefined;
  return buildReportData(adapter, secondSourceAdapter, {
    orgLabel: healthyFixture.label,
    orgDescription: healthyFixture.description,
    asOf: healthyFixture.asOf,
  });
}

/** Mirrors readiness's own cli.ts resolveNarrative: opt-in, loud failure on a missing key, never silently skipped. */
async function resolveNarrative(data: ReportData, useNarrative: boolean): Promise<NarrativeResult | undefined | 'exit'> {
  if (!useNarrative) return undefined;
  try {
    const client = new AnthropicNarrativeModelClient();
    return await buildNarrative(data, client);
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    process.exitCode = 1;
    return 'exit';
  }
}

async function writeHtml(outDir: string, filename: string, latestFilename: string, html: string): Promise<void> {
  const filePath = path.join(outDir, filename);
  const latestPath = path.join(outDir, latestFilename);
  await writeFile(filePath, html, 'utf8');
  await writeFile(latestPath, html, 'utf8');
  console.log(`Report written to: ${filePath}`);
  console.log(`Also updated:      ${latestPath}`);
}

async function scan(options: ScanOptions): Promise<void> {
  await mkdir(options.outDir, { recursive: true });
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');

  const data = await buildDemoReport();
  const narrative = await resolveNarrative(data, options.useNarrative);
  if (narrative === 'exit') return;

  const html = renderReportHtml(data, { narrative });
  await writeHtml(options.outDir, `report-${timestamp}.html`, 'latest.html', html);
  const plainHtml = renderPlainReportHtml(data);
  await writeHtml(options.outDir, `report-${timestamp}-plain.html`, 'latest-plain.html', plainHtml);

  if (options.useJson) {
    const write = options.stdout ?? ((text: string) => process.stdout.write(text));
    write(`${JSON.stringify(data, null, 2)}\n`);
  }

  const failOn = evaluateFailOn(data.capabilities, options.failOn);
  if (failOn.message) {
    console.error(failOn.message);
    process.exitCode = failOn.exitCode;
  }
}

export async function runScan(options: ScanOptions): Promise<void> {
  if (!options.useJson) {
    await scan(options);
    return;
  }
  // Readiness prints the sampling plan with console.log, and the helpers
  // above print progress the same way. Send all of it to stderr so stdout
  // stays parseable JSON; restore console.log even if the scan throws.
  const originalLog = console.log;
  console.log = (...args: unknown[]) => console.error(...args);
  try {
    await scan(options);
  } finally {
    console.log = originalLog;
  }
}

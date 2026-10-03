/**
 * `scan --demo` implementation, split out of cli.ts so it can be tested
 * in-process. Wraps @gtm-trust-kernel/readiness's existing report-building
 * functions and only ever touches the `healthy` fixture (never
 * `MOCK_ORG_FIXTURES` or `buildFromFixture`, which would pull the other
 * three fixtures' data into this package's bundle).
 *
 * Output: after the reports are written, a short verdict summary and which
 * file to open. The sampling plan (printed by readiness's runSample via
 * console.log) and the full file paths appear only with `verbose`.
 *
 * With `useJson`, stdout carries only the report JSON; everything else goes
 * to stderr. HTML reports are still written to `outDir` either way.
 *
 * With `narrativePreview`, stdout carries only the request --narrative would
 * send (readiness's narrativeRequest.ts, which never loads the SDK); nothing
 * is sent and nothing is written.
 */

import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { MockAdapter, MockSecondSourceAdapter } from '@gtm-trust-kernel/adapters/mock.js';
import { healthyFixture } from '@gtm-trust-kernel/readiness/fixtures/healthy.js';
import { buildReportData, type ReportData } from '@gtm-trust-kernel/readiness/report/buildReport.js';
import { evaluateFailOn, type FailOnVerdict } from '@gtm-trust-kernel/readiness/report/failOn.js';
import { buildNarrative, type NarrativeResult } from '@gtm-trust-kernel/readiness/report/narrative.js';
import { formatNarrativePreview, NARRATIVE_PREVIEW_NOTICE } from '@gtm-trust-kernel/readiness/report/narrativeRequest.js';
import {
  askOnTerminal,
  isInteractive,
  NARRATIVE_CONSENT_DECLINED,
  NARRATIVE_CONSENT_REQUIRED,
  resolveNarrativeConsent,
} from '@gtm-trust-kernel/readiness/report/narrativeConsent.js';
import { renderPlainReportHtml } from '@gtm-trust-kernel/readiness/report/plainReport.js';
import { buildFullNarrative } from '@gtm-trust-kernel/readiness/report/plainSummary.js';
import { renderReportHtml } from '@gtm-trust-kernel/readiness/report/render.js';

export interface ScanOptions {
  readonly outDir: string;
  readonly useNarrative: boolean;
  /** --narrative-consent: consent given up front, so no prompt. */
  readonly narrativeConsent?: boolean;
  /** Whether a person can answer the consent prompt. Defaults to isInteractive(). */
  readonly interactive?: boolean;
  /** Shows the consent prompt and resolves to the answer. Defaults to askOnTerminal. */
  readonly ask?: (prompt: string) => Promise<string>;
  /**
   * Builds the narrative model client. Defaults to the Anthropic client,
   * loaded lazily (which checks ANTHROPIC_API_KEY). Tests pass a stub, so
   * no SDK is loaded and nothing is sent.
   */
  readonly createNarrativeClient?: () => Promise<NarrativeClient>;
  readonly useJson: boolean;
  /** --narrative-preview: print the narrative request to `stdout` and stop; no files, no network. */
  readonly narrativePreview?: boolean;
  /** --verbose: also print the sampling plan and every file written. */
  readonly verbose?: boolean;
  /** Where the report JSON (or the narrative preview) goes. Defaults to process.stdout. */
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

/** Runs fn with console.log silenced (restored even if fn throws). */
async function withoutConsoleLog<T>(fn: () => Promise<T>): Promise<T> {
  const original = console.log;
  console.log = () => {};
  try {
    return await fn();
  } finally {
    console.log = original;
  }
}

export type NarrativeClient = Parameters<typeof buildNarrative>[1];

async function createAnthropicClient(): Promise<NarrativeClient> {
  const { AnthropicNarrativeModelClient } = await import('@gtm-trust-kernel/readiness/report/anthropicNarrativeModelClient.js');
  return new AnthropicNarrativeModelClient();
}

/**
 * Mirrors readiness's own cli.ts prepareNarrative: opt-in, loud failure on a
 * missing key, then consent (readiness's narrativeConsent.ts), both before
 * the scan reads anything. A "no" at the prompt returns undefined: the scan
 * runs without the AI summary. The narrative client (the only code that imports
 * @anthropic-ai/sdk) is loaded here, so a scan without --narrative never
 * loads the SDK.
 */
async function prepareNarrative(options: ScanOptions): Promise<NarrativeClient | undefined | 'exit'> {
  if (!options.useNarrative) return undefined;
  let client: NarrativeClient;
  try {
    client = await (options.createNarrativeClient ?? createAnthropicClient)();
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    process.exitCode = 1;
    return 'exit';
  }
  const decision = await resolveNarrativeConsent({
    flag: options.narrativeConsent ?? false,
    interactive: options.interactive ?? isInteractive(),
    ask: options.ask ?? askOnTerminal,
  });
  if (decision === 'needs-flag') {
    console.error(NARRATIVE_CONSENT_REQUIRED);
    process.exitCode = 1;
    return 'exit';
  }
  if (decision === 'declined') {
    console.error(NARRATIVE_CONSENT_DECLINED);
    return undefined;
  }
  return client;
}

/** buildNarrative() never throws: a failed call resolves to an ok:false result. */
async function resolveNarrative(data: ReportData, client: NarrativeClient | undefined): Promise<NarrativeResult | undefined> {
  return client ? buildNarrative(data, client) : undefined;
}

async function writeHtml(outDir: string, filename: string, latestFilename: string, html: string): Promise<string[]> {
  const filePath = path.join(outDir, filename);
  const latestPath = path.join(outDir, latestFilename);
  await writeFile(filePath, html, 'utf8');
  await writeFile(latestPath, html, 'utf8');
  return [filePath, latestPath];
}

/** A path as the user would type it: relative when inside the working directory. */
function displayPath(file: string): string {
  const rel = path.relative(process.cwd(), file);
  return rel && !rel.startsWith('..') && !path.isAbsolute(rel) ? rel : file;
}

/**
 * "4 ready, 3 use with caution, 1 not ready" (plus "N not measured" when
 * any): the same buckets as the plain-English report the summary points to
 * (buildFullNarrative), not raw verdict counts. They differ where a use
 * case needs more than "degraded" to be usable at all (autonomous
 * write-back), which the plain report lists as not ready.
 */
export function verdictSummary(data: ReportData): string {
  const b = buildFullNarrative(data);
  const parts = [`${b.ready.length} ready`, `${b.caution.length} use with caution`, `${b.notReady.length} not ready`];
  if (b.notMeasured.length > 0) parts.push(`${b.notMeasured.length} not measured`);
  return parts.join(', ');
}

async function scan(options: ScanOptions): Promise<void> {
  const write = options.stdout ?? ((text: string) => process.stdout.write(text));
  const narrativeClient = await prepareNarrative(options);
  if (narrativeClient === 'exit') return;
  const data = options.verbose ? await buildDemoReport() : await withoutConsoleLog(buildDemoReport);

  if (options.narrativePreview) {
    write(formatNarrativePreview(data));
    console.error(NARRATIVE_PREVIEW_NOTICE);
    return;
  }

  await mkdir(options.outDir, { recursive: true });
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const narrative = await resolveNarrative(data, narrativeClient);

  const written = [
    ...(await writeHtml(options.outDir, `report-${timestamp}.html`, 'latest.html', renderReportHtml(data, { narrative }))),
    ...(await writeHtml(options.outDir, `report-${timestamp}-plain.html`, 'latest-plain.html', renderPlainReportHtml(data, { narrativeSent: narrative !== undefined }))),
  ];

  if (options.useJson) {
    write(`${JSON.stringify(data, null, 2)}\n`);
  }

  console.log(`Demo scan of sample CRM data ("${data.org.orgLabel}"): ${verdictSummary(data)}.`);
  console.log(
    `Open ${displayPath(path.join(options.outDir, 'latest-plain.html'))} for the plain-English report ` +
      `(full detail: ${displayPath(path.join(options.outDir, 'latest.html'))}).`,
  );
  if (options.verbose) {
    for (const file of written) console.log(`Wrote ${file}`);
  }

  const failOn = evaluateFailOn(data.capabilities, options.failOn);
  if (failOn.message) {
    console.error(failOn.message);
    process.exitCode = failOn.exitCode;
  }
}

export async function runScan(options: ScanOptions): Promise<void> {
  if (!options.useJson && !options.narrativePreview) {
    await scan(options);
    return;
  }
  // With --json or --narrative-preview, stdout carries only JSON: send every human line
  // (the summary, and with --verbose the plan and file list) to stderr.
  // Restore console.log even if the scan throws.
  const originalLog = console.log;
  console.log = (...args: unknown[]) => console.error(...args);
  try {
    await scan(options);
  } finally {
    console.log = originalLog;
  }
}

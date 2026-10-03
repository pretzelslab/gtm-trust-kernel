#!/usr/bin/env node
/**
 * `report` CLI: by default runs the readiness assessment against the mock
 * adapter (never a real CRM) and writes two self-contained HTML files (the
 * tabular report and a plain-English narrative version), plus an optional
 * JSON file of the same data. --live switches to a real Salesforce org
 * instead (see SalesforceAdapter) — still read-only, no writes ever happen
 * through this path. --all (comparison across every fixture) only writes
 * the tabular version — no plain-English narrative for a multi-org page.
 *
 * Usage (from packages/readiness):
 *   npm run report                          # fixture: healthy
 *   npm run report -- --fixture legacy
 *   npm run report -- --all                 # side-by-side comparison page
 *   npm run report -- --fixture fresh --json
 *   npm run report -- --live --json         # real Salesforce org, from .env
 *   npm run report -- --narrative           # adds an LLM narrative (needs ANTHROPIC_API_KEY and consent); not supported with --all
 *   npm run report -- --narrative --narrative-consent   # consent up front, for unattended runs
 *   npm run report -- --narrative-preview   # print the request --narrative would send; sends nothing, writes no report
 *   npm run report -- --live --hydrate-per-stratum 10   # detailed checks on 10 deals per stage (default 20)
 *   npm run report -- --live --quick        # stop scanning once every stage's sample is full
 *   npm run report -- --live --fail-on      # exit 2 if any capability is blocked
 *   npm run report -- --fail-on blocked,degraded,not_measured
 *
 * --fail-on is opt-in (see failOn.ts). Unset, a finished report exits 0
 * whatever its verdicts. Set, the report is still written, then the exit
 * code is 2 if any capability has a listed verdict. Errors exit 1.
 *
 * --narrative asks for consent before sending (narrativeConsent.ts): a
 * prompt in a terminal, or --narrative-consent. Answering no runs the
 * report without the AI summary; with no terminal and no flag it stops,
 * exit 1, before reading any data.
 *
 * --narrative-preview builds the report data (from a fixture, or the org
 * with --live), prints the exact Anthropic request on stdout and exits 0.
 * It needs no API key, sends nothing and writes no files.
 */

import { parseArgs } from 'node:util';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { loadSalesforceConfigFromEnv, SalesforceAdapter } from '@gtm-trust-kernel/adapters/salesforce.js';
import { FIXTURE_NAMES, type FixtureName } from '../fixtures/mockOrgs.js';
import { buildFromFixture } from './buildFromFixture.js';
import { loadEnvFileIfPresent } from './envFile.js';
import { buildReportData, type BuildReportOptions, type ReportData } from './buildReport.js';
import { sampleOptionsFromFlags } from './sampleFlags.js';
import { renderComparisonHtml, renderReportHtml } from './render.js';
import { renderPlainReportHtml } from './plainReport.js';
import { AnthropicNarrativeModelClient } from './anthropicNarrativeModelClient.js';
import { buildNarrative, type NarrativeResult } from './narrative.js';
import { formatNarrativePreview, NARRATIVE_PREVIEW_NOTICE } from './narrativeRequest.js';
import {
  askOnTerminal,
  isInteractive,
  NARRATIVE_CONSENT_DECLINED,
  NARRATIVE_CONSENT_REQUIRED,
  NARRATIVE_CONSENT_WITHOUT_NARRATIVE,
  resolveNarrativeConsent,
} from './narrativeConsent.js';
import { evaluateFailOn, normalizeFailOnArgs, parseFailOn, type FailOnVerdict } from './failOn.js';

function isFixtureName(name: string): name is FixtureName {
  return (FIXTURE_NAMES as readonly string[]).includes(name);
}

async function buildLive(sampling: Pick<BuildReportOptions, 'hydratePerStratum' | 'quick'>): Promise<ReportData> {
  const config = loadSalesforceConfigFromEnv();
  const adapter = new SalesforceAdapter(config);
  return buildReportData(adapter, undefined, {
    orgLabel: 'Live Salesforce org',
    orgDescription: adapter.orgId,
    asOf: new Date().toISOString(),
    ...sampling,
  });
}

/**
 * Decision 25: --narrative is an explicit opt-in, so a missing
 * ANTHROPIC_API_KEY fails the whole run loudly (clear message, exit 1)
 * rather than silently continuing without a narrative --
 * AnthropicNarrativeModelClient's constructor already names the var in its
 * thrown message, reused verbatim here. Then consent (narrativeConsent.ts):
 * the key is checked first, so nobody is asked to agree to a send that
 * couldn't happen. Both run before any data is read. A "no" at the prompt
 * returns undefined: the report runs without the AI summary. Returns 'exit' (with exitCode already set) rather than throwing,
 * so the caller decides when to stop -- same pattern buildLive()'s caller
 * uses.
 */
async function prepareNarrative(useNarrative: boolean, consentFlag: boolean): Promise<AnthropicNarrativeModelClient | undefined | 'exit'> {
  if (!useNarrative) return undefined;
  let client: AnthropicNarrativeModelClient;
  try {
    client = new AnthropicNarrativeModelClient();
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    process.exitCode = 1;
    return 'exit';
  }
  const decision = await resolveNarrativeConsent({ flag: consentFlag, interactive: isInteractive(), ask: askOnTerminal });
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

/**
 * buildNarrative() never throws (every client.generate() failure is caught
 * internally and resolves to an ok:false NarrativeResult, decision 8/21).
 */
async function resolveNarrative(data: ReportData, client: AnthropicNarrativeModelClient | undefined): Promise<NarrativeResult | undefined> {
  return client ? buildNarrative(data, client) : undefined;
}

async function writeHtml(outDir: string, filename: string, latestFilename: string, html: string): Promise<void> {
  const filePath = path.join(outDir, filename);
  const latestPath = path.join(outDir, latestFilename);
  await writeFile(filePath, html, 'utf8');
  await writeFile(latestPath, html, 'utf8');
  console.log(`Report written to: ${filePath}`);
  console.log(`Also updated:      ${latestPath}`);
}

async function writeJson(outDir: string, filename: string, data: unknown): Promise<void> {
  const filePath = path.join(outDir, filename);
  await writeFile(filePath, JSON.stringify(data, null, 2), 'utf8');
  console.log(`JSON written to:   ${filePath}`);
}

function printNarrativePreview(data: ReportData): void {
  process.stdout.write(formatNarrativePreview(data));
  console.error(NARRATIVE_PREVIEW_NOTICE);
}

/** Report each org's --fail-on result on stderr and set exit code 2 if any capability failed. */
function applyFailOn(datas: readonly ReportData[], failOn: ReadonlySet<FailOnVerdict> | undefined): void {
  for (const data of datas) {
    const result = evaluateFailOn(data.capabilities, failOn);
    if (result.message) {
      console.error(datas.length > 1 ? `${data.org.orgLabel}: ${result.message}` : result.message);
      process.exitCode = result.exitCode;
    }
  }
}

async function main(): Promise<void> {
  await loadEnvFileIfPresent();

  const { values } = parseArgs({
    args: normalizeFailOnArgs(process.argv.slice(2)),
    options: {
      fixture: { type: 'string' },
      all: { type: 'boolean', default: false },
      json: { type: 'boolean', default: false },
      live: { type: 'boolean', default: false },
      narrative: { type: 'boolean', default: false },
      'narrative-consent': { type: 'boolean', default: false },
      'narrative-preview': { type: 'boolean', default: false },
      'hydrate-per-stratum': { type: 'string' },
      quick: { type: 'boolean', default: false },
      'fail-on': { type: 'string' },
    },
    allowPositionals: false,
  });

  let failOn: ReadonlySet<FailOnVerdict> | undefined;
  try {
    failOn = parseFailOn(values['fail-on']);
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    process.exitCode = 1;
    return;
  }

  let sampling: ReturnType<typeof sampleOptionsFromFlags>;
  try {
    sampling = sampleOptionsFromFlags(values);
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    process.exitCode = 1;
    return;
  }

  // Decision 24: no plain-English narrative for a multi-org comparison page -- same reason renderComparisonHtml never took a narrative option.
  if (values.all && values.narrative) {
    console.error('--narrative is not supported with --all (no plain-English narrative for a multi-org comparison page).');
    process.exitCode = 1;
    return;
  }

  if (values['narrative-consent'] && !values.narrative) {
    console.error(NARRATIVE_CONSENT_WITHOUT_NARRATIVE);
    process.exitCode = 1;
    return;
  }

  const preview = values['narrative-preview'];
  if (preview && (values.all || values.narrative || values.json || values['fail-on'] !== undefined)) {
    console.error("--narrative-preview prints the request only; it can't be combined with --all, --narrative, --json or --fail-on.");
    process.exitCode = 1;
    return;
  }
  if (preview) {
    // stdout carries only the request JSON: progress lines (the sampling plan) go to stderr.
    console.log = (...args: unknown[]) => console.error(...args);
  }

  const narrativeClient = await prepareNarrative(values.narrative, values['narrative-consent']);
  if (narrativeClient === 'exit') return;

  const outDir = path.resolve(process.cwd(), 'out');
  if (!preview) await mkdir(outDir, { recursive: true });
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');

  if (values.live) {
    let data: ReportData;
    try {
      data = await buildLive(sampling);
    } catch (err) {
      console.error(err instanceof Error ? err.message : String(err));
      process.exitCode = 1;
      return;
    }
    if (preview) {
      printNarrativePreview(data);
      return;
    }
    const narrative = await resolveNarrative(data, narrativeClient);
    const html = renderReportHtml(data, { mode: 'live', narrative });
    await writeHtml(outDir, `report-live-${timestamp}.html`, 'live-latest.html', html);
    const plainHtml = renderPlainReportHtml(data, { mode: 'live' });
    await writeHtml(outDir, `report-live-${timestamp}-plain.html`, 'live-latest-plain.html', plainHtml);
    if (values.json) {
      await writeJson(outDir, `report-live-${timestamp}.json`, data);
    }
    applyFailOn([data], failOn);
    return;
  }

  if (values.all) {
    const datas: ReportData[] = [];
    for (const name of FIXTURE_NAMES) {
      datas.push(await buildFromFixture(name, sampling));
    }
    const html = renderComparisonHtml(datas);
    await writeHtml(outDir, `report-all-${timestamp}.html`, 'latest-all.html', html);
    if (values.json) {
      await writeJson(outDir, `report-all-${timestamp}.json`, datas);
    }
    applyFailOn(datas, failOn);
    return;
  }

  const fixtureArg = values.fixture ?? 'healthy';
  if (!isFixtureName(fixtureArg)) {
    console.error(`Unknown fixture "${fixtureArg}". Valid: ${FIXTURE_NAMES.join(', ')}`);
    process.exitCode = 1;
    return;
  }

  const data = await buildFromFixture(fixtureArg, sampling);
  if (preview) {
    printNarrativePreview(data);
    return;
  }
  const narrative = await resolveNarrative(data, narrativeClient);
  const html = renderReportHtml(data, { narrative });
  await writeHtml(outDir, `report-${timestamp}.html`, 'latest.html', html);
  const plainHtml = renderPlainReportHtml(data);
  await writeHtml(outDir, `report-${timestamp}-plain.html`, 'latest-plain.html', plainHtml);
  if (values.json) {
    await writeJson(outDir, `report-${timestamp}.json`, data);
  }
  applyFailOn([data], failOn);
}

main().catch((err: unknown) => {
  console.error(err);
  process.exitCode = 1;
});

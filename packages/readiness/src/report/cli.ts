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
 *   npm run report -- --narrative           # adds an LLM narrative (needs ANTHROPIC_API_KEY); not supported with --all
 */

import { parseArgs } from 'node:util';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { loadSalesforceConfigFromEnv, SalesforceAdapter } from '@gtm-trust-kernel/adapters/salesforce.js';
import { FIXTURE_NAMES, type FixtureName } from '../fixtures/mockOrgs.js';
import { buildFromFixture } from './buildFromFixture.js';
import { loadEnvFileIfPresent } from './envFile.js';
import { buildReportData, type ReportData } from './buildReport.js';
import { renderComparisonHtml, renderReportHtml } from './render.js';
import { renderPlainReportHtml } from './plainReport.js';
import { AnthropicNarrativeModelClient } from './anthropicNarrativeModelClient.js';
import { buildNarrative, type NarrativeResult } from './narrative.js';

function isFixtureName(name: string): name is FixtureName {
  return (FIXTURE_NAMES as readonly string[]).includes(name);
}

async function buildLive(): Promise<ReportData> {
  const config = loadSalesforceConfigFromEnv();
  const adapter = new SalesforceAdapter(config);
  return buildReportData(adapter, undefined, {
    orgLabel: 'Live Salesforce org',
    orgDescription: adapter.orgId,
    asOf: new Date().toISOString(),
  });
}

/**
 * Decision 25: --narrative is an explicit opt-in, so a missing
 * ANTHROPIC_API_KEY fails the whole run loudly (clear message, exit 1)
 * rather than silently continuing without a narrative --
 * AnthropicNarrativeModelClient's constructor already names the var in its
 * thrown message, reused verbatim here. buildNarrative() itself never
 * throws (every client.generate() failure is caught internally and
 * resolves to an ok:false NarrativeResult, decision 8/21) -- the only
 * failure this can realistically report is the client construction above,
 * but the whole step is wrapped for a single, simple bail-out path anyway.
 * Returns 'exit' (with exitCode already set) rather than throwing, so the
 * caller decides when to stop -- same pattern buildLive()'s caller uses.
 */
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

async function writeJson(outDir: string, filename: string, data: unknown): Promise<void> {
  const filePath = path.join(outDir, filename);
  await writeFile(filePath, JSON.stringify(data, null, 2), 'utf8');
  console.log(`JSON written to:   ${filePath}`);
}

async function main(): Promise<void> {
  await loadEnvFileIfPresent();

  const { values } = parseArgs({
    options: {
      fixture: { type: 'string' },
      all: { type: 'boolean', default: false },
      json: { type: 'boolean', default: false },
      live: { type: 'boolean', default: false },
      narrative: { type: 'boolean', default: false },
    },
    allowPositionals: false,
  });

  // Decision 24: no plain-English narrative for a multi-org comparison page -- same reason renderComparisonHtml never took a narrative option.
  if (values.all && values.narrative) {
    console.error('--narrative is not supported with --all (no plain-English narrative for a multi-org comparison page).');
    process.exitCode = 1;
    return;
  }

  const outDir = path.resolve(process.cwd(), 'out');
  await mkdir(outDir, { recursive: true });
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');

  if (values.live) {
    let data: ReportData;
    try {
      data = await buildLive();
    } catch (err) {
      console.error(err instanceof Error ? err.message : String(err));
      process.exitCode = 1;
      return;
    }
    const narrative = await resolveNarrative(data, values.narrative);
    if (narrative === 'exit') return;
    const html = renderReportHtml(data, { mode: 'live', narrative });
    await writeHtml(outDir, `report-live-${timestamp}.html`, 'live-latest.html', html);
    const plainHtml = renderPlainReportHtml(data, { mode: 'live' });
    await writeHtml(outDir, `report-live-${timestamp}-plain.html`, 'live-latest-plain.html', plainHtml);
    if (values.json) {
      await writeJson(outDir, `report-live-${timestamp}.json`, data);
    }
    return;
  }

  if (values.all) {
    const datas: ReportData[] = [];
    for (const name of FIXTURE_NAMES) {
      datas.push(await buildFromFixture(name));
    }
    const html = renderComparisonHtml(datas);
    await writeHtml(outDir, `report-all-${timestamp}.html`, 'latest-all.html', html);
    if (values.json) {
      await writeJson(outDir, `report-all-${timestamp}.json`, datas);
    }
    return;
  }

  const fixtureArg = values.fixture ?? 'healthy';
  if (!isFixtureName(fixtureArg)) {
    console.error(`Unknown fixture "${fixtureArg}". Valid: ${FIXTURE_NAMES.join(', ')}`);
    process.exitCode = 1;
    return;
  }

  const data = await buildFromFixture(fixtureArg);
  const narrative = await resolveNarrative(data, values.narrative);
  if (narrative === 'exit') return;
  const html = renderReportHtml(data, { narrative });
  await writeHtml(outDir, `report-${timestamp}.html`, 'latest.html', html);
  const plainHtml = renderPlainReportHtml(data);
  await writeHtml(outDir, `report-${timestamp}-plain.html`, 'latest-plain.html', plainHtml);
  if (values.json) {
    await writeJson(outDir, `report-${timestamp}.json`, data);
  }
}

main().catch((err: unknown) => {
  console.error(err);
  process.exitCode = 1;
});

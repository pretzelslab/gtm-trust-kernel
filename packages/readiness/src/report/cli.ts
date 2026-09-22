#!/usr/bin/env node
/**
 * `report` CLI: by default runs the readiness assessment against the mock
 * adapter (never a real CRM) and writes a single self-contained HTML file,
 * plus an optional JSON file of the same data. --live switches to a real
 * Salesforce org instead (see SalesforceAdapter) — still read-only, no
 * writes ever happen through this path.
 *
 * Usage (from packages/readiness):
 *   npm run report                          # fixture: healthy
 *   npm run report -- --fixture legacy
 *   npm run report -- --all                 # side-by-side comparison page
 *   npm run report -- --fixture fresh --json
 *   npm run report -- --live --json         # real Salesforce org, from .env
 */

import { parseArgs } from 'node:util';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { MockAdapter, MockSecondSourceAdapter } from '@gtm-trust-kernel/adapters/mock.js';
import { loadSalesforceConfigFromEnv, SalesforceAdapter } from '@gtm-trust-kernel/adapters/salesforce.js';
import { FIXTURE_NAMES, MOCK_ORG_FIXTURES, type FixtureName } from '../fixtures/mockOrgs.js';
import { buildReportData, type ReportData } from './buildReport.js';
import { renderComparisonHtml, renderReportHtml } from './render.js';

function isFixtureName(name: string): name is FixtureName {
  return (FIXTURE_NAMES as readonly string[]).includes(name);
}

const REPO_ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');

/**
 * Minimal KEY=VALUE .env loader — no dotenv dependency, per this feature's
 * "no new dependencies" scope. Never overrides a var already set in the
 * shell environment. Silently no-ops if .env doesn't exist.
 */
async function loadEnvFileIfPresent(): Promise<void> {
  let raw: string;
  try {
    raw = await readFile(path.join(REPO_ROOT, '.env'), 'utf8');
  } catch {
    return;
  }
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (key && !(key in process.env)) {
      process.env[key] = value;
    }
  }
}

async function buildLive(): Promise<ReportData> {
  await loadEnvFileIfPresent();
  const config = loadSalesforceConfigFromEnv();
  const adapter = new SalesforceAdapter(config);
  return buildReportData(adapter, undefined, {
    orgLabel: 'Live Salesforce org',
    orgDescription: adapter.orgId,
    asOf: new Date().toISOString(),
  });
}

async function buildOne(name: FixtureName): Promise<ReportData> {
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
  const { values } = parseArgs({
    options: {
      fixture: { type: 'string' },
      all: { type: 'boolean', default: false },
      json: { type: 'boolean', default: false },
      live: { type: 'boolean', default: false },
    },
    allowPositionals: false,
  });

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
    const html = renderReportHtml(data);
    await writeHtml(outDir, `report-live-${timestamp}.html`, 'live-latest.html', html);
    if (values.json) {
      await writeJson(outDir, `report-live-${timestamp}.json`, data);
    }
    return;
  }

  if (values.all) {
    const datas: ReportData[] = [];
    for (const name of FIXTURE_NAMES) {
      datas.push(await buildOne(name));
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

  const data = await buildOne(fixtureArg);
  const html = renderReportHtml(data);
  await writeHtml(outDir, `report-${timestamp}.html`, 'latest.html', html);
  if (values.json) {
    await writeJson(outDir, `report-${timestamp}.json`, data);
  }
}

main().catch((err: unknown) => {
  console.error(err);
  process.exitCode = 1;
});

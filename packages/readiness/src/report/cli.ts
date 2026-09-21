#!/usr/bin/env node
/**
 * `report` CLI: runs the readiness assessment against the mock adapter
 * (never a real CRM) and writes a single self-contained HTML file, plus an
 * optional JSON file of the same data.
 *
 * Usage (from packages/readiness):
 *   npm run report                          # fixture: healthy
 *   npm run report -- --fixture legacy
 *   npm run report -- --all                 # side-by-side comparison page
 *   npm run report -- --fixture fresh --json
 */

import { parseArgs } from 'node:util';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { MockAdapter } from '@gtm-trust-kernel/adapters/mock.js';
import { FIXTURE_NAMES, MOCK_ORG_FIXTURES, type FixtureName } from '../fixtures/mockOrgs.js';
import { buildReportData, type ReportData } from './buildReport.js';
import { renderComparisonHtml, renderReportHtml } from './render.js';

function isFixtureName(name: string): name is FixtureName {
  return (FIXTURE_NAMES as readonly string[]).includes(name);
}

async function buildOne(name: FixtureName): Promise<ReportData> {
  const fixture = MOCK_ORG_FIXTURES[name];
  const adapter = new MockAdapter(fixture.orgId, fixture.data, fixture.capabilities);
  return buildReportData(adapter, {
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
    },
    allowPositionals: false,
  });

  const outDir = path.resolve(process.cwd(), 'out');
  await mkdir(outDir, { recursive: true });
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');

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

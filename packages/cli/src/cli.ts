#!/usr/bin/env node
/**
 * `gtm-trust-kernel` CLI. Only `scan --demo` is supported right now: it runs
 * the readiness assessment against the bundled `healthy` mock org (no CRM
 * credentials involved) and writes an HTML report to ./out. --narrative is
 * an opt-in extra (needs ANTHROPIC_API_KEY only when passed).
 *
 * Deliberately narrow: this wraps @gtm-trust-kernel/readiness's existing
 * report-building functions rather than adding new report logic, and it
 * only ever touches the `healthy` fixture — never `MOCK_ORG_FIXTURES` or
 * `buildFromFixture`, which would pull the other three fixtures' data into
 * this package's bundle. A fuller `scan` (--live, --fixture, a
 * contract-runner command) is out of scope for this pass.
 *
 * Usage:
 *   npx gtm-trust-kernel scan --demo
 *   npx gtm-trust-kernel scan --demo --json
 *   npx gtm-trust-kernel scan --demo --narrative   # needs ANTHROPIC_API_KEY
 *   npx gtm-trust-kernel --version
 *   npx gtm-trust-kernel --help
 */

import { readFileSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { MockAdapter, MockSecondSourceAdapter } from '@gtm-trust-kernel/adapters/mock.js';
import { healthyFixture } from '@gtm-trust-kernel/readiness/fixtures/healthy.js';
import { AnthropicNarrativeModelClient } from '@gtm-trust-kernel/readiness/report/anthropicNarrativeModelClient.js';
import { buildReportData, type ReportData } from '@gtm-trust-kernel/readiness/report/buildReport.js';
import { buildNarrative, type NarrativeResult } from '@gtm-trust-kernel/readiness/report/narrative.js';
import { renderPlainReportHtml } from '@gtm-trust-kernel/readiness/report/plainReport.js';
import { renderReportHtml } from '@gtm-trust-kernel/readiness/report/render.js';

const USAGE = `Usage:
  gtm-trust-kernel scan --demo [--narrative] [--json]
  gtm-trust-kernel --version
  gtm-trust-kernel --help

Only "scan --demo" is supported right now (runs the readiness report
against a bundled mock org, no CRM credentials needed).`;

function readOwnVersion(): string {
  const pkgUrl = new URL('../package.json', import.meta.url);
  const pkg = JSON.parse(readFileSync(pkgUrl, 'utf8')) as { version: string };
  return pkg.version;
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

async function writeJson(outDir: string, filename: string, data: unknown): Promise<void> {
  const filePath = path.join(outDir, filename);
  await writeFile(filePath, JSON.stringify(data, null, 2), 'utf8');
  console.log(`JSON written to:   ${filePath}`);
}

async function runScan(useNarrative: boolean, useJson: boolean): Promise<void> {
  const outDir = path.resolve(process.cwd(), 'out');
  await mkdir(outDir, { recursive: true });
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');

  const data = await buildDemoReport();
  const narrative = await resolveNarrative(data, useNarrative);
  if (narrative === 'exit') return;

  const html = renderReportHtml(data, { narrative });
  await writeHtml(outDir, `report-${timestamp}.html`, 'latest.html', html);
  const plainHtml = renderPlainReportHtml(data);
  await writeHtml(outDir, `report-${timestamp}-plain.html`, 'latest-plain.html', plainHtml);
  if (useJson) {
    await writeJson(outDir, `report-${timestamp}.json`, data);
  }
}

async function main(): Promise<void> {
  const { values, positionals } = parseArgs({
    options: {
      demo: { type: 'boolean', default: false },
      narrative: { type: 'boolean', default: false },
      json: { type: 'boolean', default: false },
      version: { type: 'boolean', default: false },
      help: { type: 'boolean', default: false },
    },
    allowPositionals: true,
  });

  if (values.version) {
    console.log(readOwnVersion());
    return;
  }

  if (values.help || positionals.length === 0) {
    console.log(USAGE);
    return;
  }

  if (positionals[0] !== 'scan' || !values.demo) {
    console.error('Only "scan --demo" is supported right now.\n');
    console.error(USAGE);
    process.exitCode = 1;
    return;
  }

  await runScan(values.narrative, values.json);
}

main().catch((err: unknown) => {
  console.error(err);
  process.exitCode = 1;
});

#!/usr/bin/env node
/**
 * `gtm-trust-kernel` CLI. Only `scan --demo` is supported right now: it runs
 * the readiness assessment against the bundled `healthy` mock org (no CRM
 * credentials involved) and writes an HTML report to ./out. --narrative is
 * an opt-in extra (needs ANTHROPIC_API_KEY only when passed). --json prints
 * the report JSON to stdout (plan and progress lines go to stderr).
 *
 * Deliberately narrow: the scan itself lives in scan.ts and wraps
 * @gtm-trust-kernel/readiness's existing report-building functions. A
 * fuller `scan` (--live, --fixture, a contract-runner command) is out of
 * scope for this pass.
 *
 * Usage:
 *   npx gtm-trust-kernel scan --demo
 *   npx gtm-trust-kernel scan --demo --json > report.json
 *   npx gtm-trust-kernel scan --demo --narrative   # needs ANTHROPIC_API_KEY
 *   npx gtm-trust-kernel scan --demo --fail-on degraded   # exit 2 on a degraded capability
 *   npx gtm-trust-kernel --version
 *   npx gtm-trust-kernel --help
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { normalizeFailOnArgs, parseFailOn } from '@gtm-trust-kernel/readiness/report/failOn.js';
import { runScan } from './scan.js';

const USAGE = `Usage:
  gtm-trust-kernel scan --demo [--narrative] [--json] [--fail-on [<verdicts>]]
  gtm-trust-kernel --version
  gtm-trust-kernel --help

Only "scan --demo" is supported right now (runs the readiness report
against a bundled mock org, no CRM credentials needed).

--fail-on <verdicts>  Comma list of blocked, degraded, not_measured. After
                      the report is written, exit 2 if any capability has
                      one of them. A bare --fail-on means blocked. Off by
                      default: without it, a finished scan exits 0.
Exit codes: 0 success, 1 error (including an invalid --fail-on value),
2 a capability matched --fail-on.`;

function readOwnVersion(): string {
  const pkgUrl = new URL('../package.json', import.meta.url);
  const pkg = JSON.parse(readFileSync(pkgUrl, 'utf8')) as { version: string };
  return pkg.version;
}

async function main(): Promise<void> {
  const { values, positionals } = parseArgs({
    args: normalizeFailOnArgs(process.argv.slice(2)),
    options: {
      demo: { type: 'boolean', default: false },
      narrative: { type: 'boolean', default: false },
      json: { type: 'boolean', default: false },
      version: { type: 'boolean', default: false },
      help: { type: 'boolean', default: false },
      'fail-on': { type: 'string' },
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

  let failOn: ReturnType<typeof parseFailOn>;
  try {
    failOn = parseFailOn(values['fail-on']);
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    process.exitCode = 1;
    return;
  }

  await runScan({
    outDir: path.resolve(process.cwd(), 'out'),
    useNarrative: values.narrative,
    useJson: values.json,
    ...(failOn ? { failOn } : {}),
  });
}

main().catch((err: unknown) => {
  console.error(err);
  process.exitCode = 1;
});

#!/usr/bin/env node
/**
 * `gtm-trust-kernel` CLI. Only `scan --demo` is supported right now: it runs
 * the readiness assessment against the bundled `healthy` mock org (no CRM
 * credentials involved), writes HTML reports to ./out, and prints a verdict
 * summary. --narrative is an opt-in extra (needs ANTHROPIC_API_KEY only when
 * passed, and consent: a terminal prompt or --narrative-consent). --json prints the report JSON to stdout (everything else goes to
 * stderr). --verbose also prints the sampling plan and every file written.
 *
 * Deliberately narrow: the scan itself lives in scan.ts and wraps
 * @gtm-trust-kernel/readiness's existing report-building functions. A
 * fuller `scan` (--live, --fixture, a contract-runner command) is out of
 * scope for this pass.
 *
 * Usage:
 *   npx gtm-trust-kernel scan --demo
 *   npx gtm-trust-kernel scan --demo --json > report.json
 *   npx gtm-trust-kernel scan --demo --narrative   # needs ANTHROPIC_API_KEY; asks before sending
 *   npx gtm-trust-kernel scan --demo --narrative --narrative-consent   # unattended: consent up front
 *   npx gtm-trust-kernel scan --demo --narrative-preview   # print what --narrative would send
 *   npx gtm-trust-kernel scan --demo --fail-on degraded   # exit 2 on a degraded capability
 *   npx gtm-trust-kernel --version
 *   npx gtm-trust-kernel --help
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { normalizeFailOnArgs, parseFailOn } from '@gtm-trust-kernel/readiness/report/failOn.js';
import { NARRATIVE_CONSENT_WITHOUT_NARRATIVE } from '@gtm-trust-kernel/readiness/report/narrativeConsent.js';
import { runScan } from './scan.js';

const USAGE = `Usage:
  gtm-trust-kernel scan --demo [--narrative [--narrative-consent]] [--json] [--verbose] [--fail-on [<verdicts>]]
  gtm-trust-kernel scan --demo --narrative-preview
  gtm-trust-kernel --version
  gtm-trust-kernel --help

Only "scan --demo" is supported right now (runs the readiness report
against a bundled mock org, no CRM credentials needed).

--narrative           Add an AI-written summary. Sends metric names, values,
                      sample sizes and ratings (no record text) to
                      Anthropic's API. Needs ANTHROPIC_API_KEY, and asks
                      before sending; answering no runs the scan without
                      it.
--narrative-consent   Consent to that send up front, for runs with no
                      terminal to answer the prompt (CI, scripts). Without
                      it, such a run exits 1 before sending anything.
--narrative-preview   Print the exact request --narrative would send, then
                      exit. Sends nothing, writes no report, needs no key.
--verbose             Also print the sampling plan and every file written.
--fail-on <verdicts>  Comma list of blocked, degraded, not_measured. After
                      the report is written, exit 2 if any capability has
                      one of them. blocked also matches anything the plain
                      report shows as "Not ready yet". A bare --fail-on
                      means blocked. Off by default: without it, a
                      finished scan exits 0.
Exit codes: 0 success, 1 error (including an invalid --fail-on value),
2 a capability matched --fail-on.`;

function readOwnVersion(): string {
  const pkgUrl = new URL('../package.json', import.meta.url);
  const pkg = JSON.parse(readFileSync(pkgUrl, 'utf8')) as { version: string };
  return pkg.version;
}

/** Bad usage: one line naming the problem, then the usage text; exit 1, no stack trace. */
function usageError(message: string): void {
  console.error(`gtm-trust-kernel: ${message}\n\n${USAGE}`);
  process.exitCode = 1;
}

/** node:util parseArgs errors run on with advice about '--'; keep the first sentence. */
function firstSentence(message: string): string {
  const end = message.indexOf('. ');
  return end === -1 ? message : message.slice(0, end + 1);
}

function parseCli() {
  return parseArgs({
    args: normalizeFailOnArgs(process.argv.slice(2)),
    options: {
      demo: { type: 'boolean', default: false },
      narrative: { type: 'boolean', default: false },
      'narrative-consent': { type: 'boolean', default: false },
      'narrative-preview': { type: 'boolean', default: false },
      json: { type: 'boolean', default: false },
      version: { type: 'boolean', default: false },
      help: { type: 'boolean', default: false },
      verbose: { type: 'boolean', default: false },
      'fail-on': { type: 'string' },
    },
    allowPositionals: true,
  });
}

async function main(): Promise<void> {
  let parsed: ReturnType<typeof parseCli>;
  try {
    parsed = parseCli();
  } catch (err) {
    usageError(firstSentence(err instanceof Error ? err.message : String(err)));
    return;
  }
  const { values, positionals } = parsed;

  if (values.version) {
    console.log(readOwnVersion());
    return;
  }

  if (values.help || positionals.length === 0) {
    console.log(USAGE);
    return;
  }

  if (positionals[0] !== 'scan' || !values.demo) {
    usageError('only "scan --demo" is supported right now.');
    return;
  }

  if (values['narrative-consent'] && !values.narrative) {
    usageError(NARRATIVE_CONSENT_WITHOUT_NARRATIVE);
    return;
  }

  if (values['narrative-preview'] && (values.narrative || values.json || values['fail-on'] !== undefined)) {
    usageError("--narrative-preview prints the request only; it can't be combined with --narrative, --json or --fail-on.");
    return;
  }

  let failOn: ReturnType<typeof parseFailOn>;
  try {
    failOn = parseFailOn(values['fail-on']);
  } catch (err) {
    usageError(err instanceof Error ? err.message : String(err));
    return;
  }

  await runScan({
    outDir: path.resolve(process.cwd(), 'out'),
    useNarrative: values.narrative,
    narrativeConsent: values['narrative-consent'],
    narrativePreview: values['narrative-preview'],
    useJson: values.json,
    verbose: values.verbose,
    ...(failOn ? { failOn } : {}),
  });
}

// Anything else that fails: the message only, no stack trace.
main().catch((err: unknown) => {
  console.error(`gtm-trust-kernel: ${err instanceof Error ? err.message : String(err)}`);
  process.exitCode = 1;
});

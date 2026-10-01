/**
 * `--fail-on`: an opt-in exit status for the readiness report, shared by
 * the `report` script (cli.ts) and the `gtm-trust-kernel scan` command.
 *
 *   --fail-on                      same as --fail-on blocked
 *   --fail-on blocked              exit 2 if any capability is blocked
 *   --fail-on blocked,degraded     exit 2 if any is blocked or degraded
 *   --fail-on not_measured         not_measured counts only when listed
 *
 * Unset (the default): the exit status never depends on verdicts; a
 * finished report exits 0 whatever it found. Exit codes:
 *   0  report written, and no capability has a listed verdict (or --fail-on unset)
 *   1  error: the run failed, or the flag's value is invalid
 *   2  report written, and at least one capability has a listed verdict
 * The report files are always written before the exit status is set.
 */

import type { CapabilityVerdict } from '../rubric.js';
import type { ReportCapabilityRow } from './buildReport.js';

export const FAIL_ON_VERDICTS = ['blocked', 'degraded', 'not_measured'] as const satisfies readonly CapabilityVerdict[];
export type FailOnVerdict = (typeof FAIL_ON_VERDICTS)[number];

/** The value a bare `--fail-on` stands for. */
export const FAIL_ON_DEFAULT: FailOnVerdict = 'blocked';

export const EXIT_ERROR = 1;
export const EXIT_VERDICT_FAILURE = 2;

/**
 * node:util parseArgs has no optional-value strings, so a bare `--fail-on`
 * (last, or followed by another option) is rewritten to
 * `--fail-on=blocked` before parsing. `--fail-on <value>` and
 * `--fail-on=<value>` pass through unchanged.
 */
export function normalizeFailOnArgs(args: readonly string[]): string[] {
  return args.map((arg, i) => {
    if (arg !== '--fail-on') return arg;
    const next = args[i + 1];
    return next === undefined || next.startsWith('-') ? `--fail-on=${FAIL_ON_DEFAULT}` : arg;
  });
}

/** The parsed flag value: undefined when unset (off). Throws on an empty or unknown value. */
export function parseFailOn(raw: string | undefined): ReadonlySet<FailOnVerdict> | undefined {
  if (raw === undefined) return undefined;
  const parts = raw.split(',').map((p) => p.trim());
  const verdicts = new Set<FailOnVerdict>();
  for (const part of parts) {
    if (!(FAIL_ON_VERDICTS as readonly string[]).includes(part)) {
      throw new Error(
        `Invalid --fail-on value ${JSON.stringify(raw)}. Use a comma-separated list of: ${FAIL_ON_VERDICTS.join(', ')} (a bare --fail-on means ${FAIL_ON_DEFAULT}).`,
      );
    }
    verdicts.add(part as FailOnVerdict);
  }
  return verdicts;
}

export interface FailOnResult {
  /** 0, or EXIT_VERDICT_FAILURE. */
  readonly exitCode: 0 | typeof EXIT_VERDICT_FAILURE;
  /** Capabilities with a listed verdict, in report order. */
  readonly failing: readonly ReportCapabilityRow[];
  /** One line for stderr when exitCode is non-zero; undefined otherwise. */
  readonly message?: string;
}

/** Pure. With failOn unset, always exit 0. */
export function evaluateFailOn(
  capabilities: readonly ReportCapabilityRow[],
  failOn: ReadonlySet<FailOnVerdict> | undefined,
): FailOnResult {
  if (!failOn) return { exitCode: 0, failing: [] };
  const failing = capabilities.filter((c) => (failOn as ReadonlySet<string>).has(c.verdict));
  if (failing.length === 0) return { exitCode: 0, failing };
  const list = failing.map((c) => `${c.label} (${c.verdict})`).join(', ');
  return {
    exitCode: EXIT_VERDICT_FAILURE,
    failing,
    message: `--fail-on ${[...failOn].join(',')}: ${failing.length} capabilit${failing.length === 1 ? 'y' : 'ies'} failed: ${list}`,
  };
}

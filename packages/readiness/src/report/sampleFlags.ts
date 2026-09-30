/**
 * The report CLI's sampling flags, parsed apart from cli.ts (which runs
 * main() on import) so they can be tested. --hydrate-per-stratum sets the
 * detailed-check sample per stratum (default 20, buildReport.ts); --quick
 * stops the scan once every stratum's sample is full.
 */

import type { BuildReportOptions } from './buildReport.js';

export interface SampleFlags {
  readonly 'hydrate-per-stratum'?: string;
  readonly quick?: boolean;
}

export function sampleOptionsFromFlags(flags: SampleFlags): Pick<BuildReportOptions, 'hydratePerStratum' | 'quick'> {
  const raw = flags['hydrate-per-stratum'];
  let hydratePerStratum: number | undefined;
  if (raw !== undefined) {
    hydratePerStratum = /^\d+$/.test(raw) ? Number(raw) : NaN;
    if (!(hydratePerStratum >= 1)) {
      throw new Error(`Invalid --hydrate-per-stratum value ${JSON.stringify(raw)}. Use a whole number of 1 or more.`);
    }
  }
  return {
    ...(hydratePerStratum !== undefined ? { hydratePerStratum } : {}),
    ...(flags.quick ? { quick: true } : {}),
  };
}

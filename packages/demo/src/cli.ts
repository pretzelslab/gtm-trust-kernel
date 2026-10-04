/**
 * npm run demo:kernel                    prints the transcript
 * npm run demo:kernel -- --write-samples also rewrites docs/demo/ (text samples and screenshots)
 */

import { parseArgs } from 'node:util';
import path from 'node:path';
import { runDemo } from './demoKernel.js';
import { SAMPLES_DIR, writeSamples } from './samples.js';

async function main(): Promise<void> {
  const { values } = parseArgs({ options: { 'write-samples': { type: 'boolean', default: false } } });
  if (!values['write-samples']) {
    process.stdout.write((await runDemo()).transcript);
    return;
  }
  const { run, written, glance } = await writeSamples();
  written.push(glance);
  process.stdout.write(run.transcript);
  for (const file of written) console.log(`Wrote ${path.relative(process.cwd(), file) || file}`);
  console.log(`Samples are in ${SAMPLES_DIR}`);
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
});

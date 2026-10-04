import { defaultClientConditions, defaultServerConditions } from 'vite';
import { defineConfig } from 'vitest/config';

// Same "source" condition setup as packages/readiness/vitest.config.ts:
// workspace packages resolve to their .ts source, with no build step.
export default defineConfig({
  resolve: {
    conditions: ['source', ...defaultClientConditions],
  },
  ssr: {
    resolve: {
      conditions: ['source', ...defaultServerConditions],
    },
  },
  test: {
    // runSample prints its sample plan on every report build; drop only that block.
    onConsoleLog(log, type) {
      if (type === 'stdout' && log.startsWith('Stratified sample plan')) return false;
      return undefined;
    },
    // The screenshot test starts a real browser.
    testTimeout: 60_000,
  },
});

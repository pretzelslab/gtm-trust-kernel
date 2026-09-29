import { defineConfig } from 'vitest/config';

// Same as readiness: adds the "source" condition so workspace packages
// (@gtm-trust-kernel/adapters, /readiness) resolve to their .ts source in
// tests, with no build step.
export default defineConfig({
  resolve: {
    conditions: ['source'],
  },
});

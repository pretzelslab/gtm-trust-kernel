import { defaultClientConditions, defaultServerConditions } from 'vite';
import { defineConfig } from 'vitest/config';

// Adds the "source" export condition so workspace packages
// (@gtm-trust-kernel/adapters, /readiness) resolve to their .ts source in
// tests, with no build step. Vite 6+ (vitest 3+) replaces the default
// conditions rather than adding to them, and resolves Node-side imports
// with ssr.resolve.conditions, so both lists are set, each keeping Vite's
// defaults. Without the ssr list, tests silently fall back to dist/ (and
// fail where there is no build, as in CI).
export default defineConfig({
  resolve: {
    conditions: ['source', ...defaultClientConditions],
  },
  ssr: {
    resolve: {
      conditions: ['source', ...defaultServerConditions],
    },
  },
});

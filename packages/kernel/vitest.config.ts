import { defineConfig } from 'vitest/config';

// Vite 5 (installed here via vitest ^2.1.3): resolve.conditions is additive
// to Vite's built-in defaults, so this only adds the "source" condition
// rather than replacing anything. It's what makes @gtm-trust-kernel/adapters
// resolve straight to its .ts source during tests, with no build step.
export default defineConfig({
  resolve: {
    conditions: ['source'],
  },
});

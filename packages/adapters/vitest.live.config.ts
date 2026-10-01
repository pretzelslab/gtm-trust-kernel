import { defineConfig } from 'vitest/config';

// `npm run test:live`: tests against a real org. Read-only; they skip when
// the org's credentials are unset. A real API round trip takes far longer
// than vitest's 5s default, so the timeouts are raised.
export default defineConfig({
  test: {
    include: ['test/**/*.live.test.ts'],
    testTimeout: 60_000,
    hookTimeout: 60_000,
  },
});

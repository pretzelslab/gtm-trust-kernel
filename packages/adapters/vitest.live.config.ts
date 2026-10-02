import { defineConfig } from 'vitest/config';

// `npm run test:live`: tests against a real org. Read-only; they skip when
// the org's credentials are unset. A real API round trip takes far longer
// than vitest's 5s default, so the timeouts are raised.
export default defineConfig({
  test: {
    include: ['test/**/*.live.test.ts'],
    testTimeout: 60_000,
    hookTimeout: 60_000,
    // The live tests report their findings (API calls used, child pages)
    // with console.info from passing tests; vitest 5 hides that output by
    // default, so keep it visible here and in the weekly CI log.
    silent: false,
  },
});

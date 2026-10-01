import { configDefaults, defineConfig } from 'vitest/config';

// `npm test` stays offline: live tests (*.live.test.ts) run only through
// `npm run test:live` (vitest.live.config.ts).
export default defineConfig({
  test: {
    exclude: [...configDefaults.exclude, '**/*.live.test.ts'],
  },
});

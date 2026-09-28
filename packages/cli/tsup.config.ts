import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/cli.ts'],
  format: ['esm'],
  platform: 'node',
  target: 'node20',
  outDir: 'dist',
  clean: true,
  dts: false,
  external: ['@gtm-trust-kernel/adapters', '@anthropic-ai/sdk', 'tldts'],
  noExternal: [/@gtm-trust-kernel\/readiness/],
});

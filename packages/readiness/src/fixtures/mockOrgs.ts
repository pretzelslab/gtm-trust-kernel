/**
 * Composes the four mock org fixtures (one per file: healthy.ts, fresh.ts,
 * legacy.ts, volume.ts) into the FIXTURE_NAMES/MOCK_ORG_FIXTURES surface
 * this module has always exported. Kept split by org so a bundler that only
 * imports one org's file (e.g. gtm-trust-kernel's CLI, which only needs
 * `healthy`) never pulls the other three's generated data into its output.
 */

import { freshFixture } from './fresh.js';
import { healthyFixture } from './healthy.js';
import { legacyFixture } from './legacy.js';
import type { FixtureName, MockOrgFixture } from './mockOrgShared.js';
import { volumeFixture } from './volume.js';

export type { FixtureName, MockOrgFixture } from './mockOrgShared.js';

export const FIXTURE_NAMES: readonly FixtureName[] = ['healthy', 'fresh', 'legacy', 'volume'];

export const MOCK_ORG_FIXTURES: Readonly<Record<FixtureName, MockOrgFixture>> = {
  healthy: healthyFixture,
  fresh: freshFixture,
  legacy: legacyFixture,
  volume: volumeFixture,
};

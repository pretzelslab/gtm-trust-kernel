/**
 * Both files a scan writes say the same thing about what left the machine.
 * The narrative case uses a stubbed model client (no SDK, no network) and
 * --narrative-consent.
 */

import { readFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { runScan } from '../src/scan.js';

// readiness's shell.ts NARRATIVE_EGRESS_TEXT (not exported from that package).
const NARRATIVE_EGRESS_TEXT = 'metric values (no record text) were sent to Anthropic for the AI summary';

afterEach(() => {
  vi.restoreAllMocks();
});

async function scanBanners(useNarrative: boolean): Promise<string[]> {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'gtm-cli-banner-'));
  vi.spyOn(console, 'log').mockImplementation(() => {});
  try {
    await runScan({
      outDir: path.join(dir, 'out'),
      useNarrative,
      useJson: false,
      narrativeConsent: true,
      createNarrativeClient: async () => ({ generate: async () => ({ claims: [] }) }),
    });
    return ['latest.html', 'latest-plain.html'].map((f) => readFileSync(path.join(dir, 'out', f), 'utf8'));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

describe('scan --demo banners', () => {
  it('with the AI summary sent: both files say metric values went to Anthropic', async () => {
    for (const html of await scanBanners(true)) expect(html).toContain(NARRATIVE_EGRESS_TEXT);
  });

  it('without it: both files say nothing leaves this machine', async () => {
    for (const html of await scanBanners(false)) {
      expect(html).toContain('No real CRM was contacted; nothing leaves this machine.');
      expect(html).not.toContain(NARRATIVE_EGRESS_TEXT);
    }
  });
});

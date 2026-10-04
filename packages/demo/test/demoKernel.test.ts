/**
 * The demo kit's committed samples (docs/demo/) must match what the code
 * produces now, hold no record text, and tell the story they claim to.
 * Refresh them with `npm run demo:kernel -- --write-samples`.
 */

import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { NOTES_ACCESS_HINT } from '@gtm-trust-kernel/adapters/salesforce.js';
import { healthyFixture } from '@gtm-trust-kernel/readiness/fixtures/healthy.js';
import { gateVerdictOf } from '@gtm-trust-kernel/readiness/report/buildReport.js';
import {
  DARK_SCREENSHOTS,
  GLANCE_DARK_SCREENSHOT,
  MOTION_CAPABILITY,
  plainBucketOf,
  renderTextSamples,
  runDemo,
  SCREENSHOTS,
  SUGGESTED_NEXT_STEP,
  TEXT_SAMPLES,
  type DemoRun,
} from '../src/demoKernel.js';
import { SAMPLES_DIR, writeSamples } from '../src/samples.js';

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

const NOTE_METRICS = [
  'note_coverage_rate',
  'substantive_note_rate',
  'median_note_length_chars',
  'outcome_evidence_retention_rate',
  'pii_density',
  'untrusted_text_ratio',
] as const;

let run: DemoRun;
beforeAll(async () => {
  run = await runDemo();
});

describe('committed samples', () => {
  it('match the current code byte for byte (screenshots excluded)', () => {
    const rendered = renderTextSamples(run);
    for (const name of TEXT_SAMPLES) {
      expect(readFileSync(path.join(SAMPLES_DIR, name), 'utf8'), `${name}: run npm run demo:kernel -- --write-samples`).toBe(rendered[name]);
    }
  });

  it('include a PNG screenshot of each plain report', () => {
    for (const png of Object.keys(SCREENSHOTS)) {
      const file = path.join(SAMPLES_DIR, png);
      expect(existsSync(file), png).toBe(true);
      expect(readFileSync(file).subarray(0, 8).equals(PNG_SIGNATURE), png).toBe(true);
    }
  });

  it('include the dark-mode PNG screenshots', () => {
    for (const png of [...Object.keys(DARK_SCREENSHOTS), GLANCE_DARK_SCREENSHOT.png]) {
      const file = path.join(SAMPLES_DIR, png);
      expect(existsSync(file), png).toBe(true);
      expect(readFileSync(file).subarray(0, 8).equals(PNG_SIGNATURE), png).toBe(true);
    }
  });

  it('hold no record text, emails, account domains, hostnames or local paths', () => {
    const d = healthyFixture.data;
    const noteBodies = d.notes.map((n) => n.body.value);
    const domains = d.accounts.map((a) => a.domain).filter((x): x is string => Boolean(x));
    expect(noteBodies.length).toBeGreaterThan(0);
    expect(domains.length).toBeGreaterThan(0);
    for (const name of TEXT_SAMPLES) {
      const text = readFileSync(path.join(SAMPLES_DIR, name), 'utf8');
      expect(text, name).not.toMatch(/[\w.+-]+@[\w-]+\.[\w.-]+/);
      expect(text, name).not.toMatch(/salesforce\.com/i);
      expect(text, name).not.toMatch(/[A-Za-z]:\\|\/home\/|\/Users\//);
      for (const body of noteBodies) expect(text.includes(body), `${name} contains a note body`).toBe(false);
      for (const domain of domains) expect(text.includes(domain), `${name} contains ${domain}`).toBe(false);
    }
  });
});

describe('--write-samples', () => {
  let dir: string;
  beforeAll(() => {
    dir = mkdtempSync(path.join(os.tmpdir(), 'gtk-demo-samples-'));
  });
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it('regenerates every text sample and both screenshots', async () => {
    const { written } = await writeSamples(dir);
    expect(written.map((f) => path.basename(f)).sort()).toEqual([...TEXT_SAMPLES, ...Object.keys(SCREENSHOTS)].sort());
    for (const name of TEXT_SAMPLES) {
      expect(readFileSync(path.join(dir, name), 'utf8'), name).toBe(readFileSync(path.join(SAMPLES_DIR, name), 'utf8'));
    }
    for (const png of Object.keys(SCREENSHOTS)) {
      const file = path.join(dir, png);
      expect(readFileSync(file).subarray(0, 8).equals(PNG_SIGNATURE), png).toBe(true);
      expect(statSync(file).size, png).toBeGreaterThan(10_000);
    }
  });

  it('also writes the dark-mode screenshots, apart from the written list', async () => {
    const { written, dark } = await writeSamples(dir);
    expect(written.map((f) => path.basename(f))).not.toContain('scan-plain-dark.png');
    expect(dark.map((f) => path.basename(f)).sort()).toEqual([...Object.keys(DARK_SCREENSHOTS), GLANCE_DARK_SCREENSHOT.png].sort());
    for (const file of dark) expect(statSync(file).size, file).toBeGreaterThan(10_000);
  });
});

describe('the scan verdicts', () => {
  it('next-step suggestions are ready on the healthy sample', () => {
    expect(plainBucketOf(run.scans.healthy, MOTION_CAPABILITY)).toBe('Ready to use');
  });

  it("unreadable Enhanced Notes: every note metric is not measured with the adapter's hint, and the use case reads Can't tell yet", () => {
    const data = run.scans.notesNotMeasured;
    for (const metric of NOTE_METRICS) {
      const row = data.metrics.find((m) => m.metric === metric)!;
      expect(gateVerdictOf(row), metric).toBe('not_measured');
      expect(row.fixHint, metric).toBe(NOTES_ACCESS_HINT);
    }
    expect(plainBucketOf(data, MOTION_CAPABILITY)).toBe("Can't tell yet");
    expect(readFileSync(path.join(SAMPLES_DIR, 'scan-notes-not-measured-plain.html'), 'utf8')).toContain(NOTES_ACCESS_HINT);
  });
});

describe('the approval-gated change', () => {
  it('refuses the out-of-role, uncited-evidence and injected suggestions, and any write before approval', () => {
    expect(run.story.refusals).toEqual(['FIELD_NOT_ALLOWED', 'CITATION_OUT_OF_SET', 'CONTENT_INJECTION_SUSPECTED', 'NOT_APPROVED']);
  });

  it('writes only after approval, rolls back to the value it read, and logs a verified hash chain', () => {
    const s = run.story;
    expect(s.nextStepAfterApply).toBe(SUGGESTED_NEXT_STEP);
    expect(s.nextStepBefore).not.toBe(SUGGESTED_NEXT_STEP);
    expect(s.nextStepAfterRollback).toBe(s.nextStepBefore);
    expect(s.finalStatus).toBe('rolled_back');
    expect(s.ledgerVerified).toBe(true);
    expect(s.ledger.map((e) => e.kind)).toEqual(['proposal_created', 'proposal_approved', 'applied', 'rolled_back']);
  });

  it('never touches the shared fixture data', () => {
    const deal = healthyFixture.data.opportunities.find((o) => o.ref.id === 'opp-1')!;
    expect(deal.nextStep?.value).toBe(run.story.nextStepBefore);
  });
});

/**
 * The cropped "At a glance" screenshot used by the README: committed, a
 * valid PNG, and exactly 1000 x 1696.
 */

import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { GLANCE_DARK_SCREENSHOT, GLANCE_SCREENSHOT } from '../src/demoKernel.js';
import { SAMPLES_DIR } from '../src/samples.js';

describe('glance screenshot', () => {
  it('is committed as a 1000 x 1696 PNG', () => {
    const file = path.join(SAMPLES_DIR, GLANCE_SCREENSHOT.png);
    expect(existsSync(file)).toBe(true);
    const bytes = readFileSync(file);
    expect(bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toBe(true);
    expect(bytes.readUInt32BE(16)).toBe(GLANCE_SCREENSHOT.width);
    expect(bytes.readUInt32BE(20)).toBe(GLANCE_SCREENSHOT.height);
  });

  it('has a dark-mode twin of the same size', () => {
    const file = path.join(SAMPLES_DIR, GLANCE_DARK_SCREENSHOT.png);
    expect(existsSync(file)).toBe(true);
    const bytes = readFileSync(file);
    expect(bytes.readUInt32BE(16)).toBe(GLANCE_SCREENSHOT.width);
    expect(bytes.readUInt32BE(20)).toBe(GLANCE_SCREENSHOT.height);
  });
});

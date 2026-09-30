import { describe, expect, it } from 'vitest';
import { sampleOptionsFromFlags } from '../../src/report/sampleFlags.js';

describe('report sampling flags', () => {
  it('leaves the defaults alone when no flag is given', () => {
    expect(sampleOptionsFromFlags({})).toEqual({});
  });

  it('reads --hydrate-per-stratum and --quick', () => {
    expect(sampleOptionsFromFlags({ 'hydrate-per-stratum': '5', quick: true })).toEqual({ hydratePerStratum: 5, quick: true });
  });

  it.each([['0'], ['-3'], ['2.5'], ['abc'], ['']])('rejects --hydrate-per-stratum %j with a clear error', (raw) => {
    expect(() => sampleOptionsFromFlags({ 'hydrate-per-stratum': raw })).toThrow(
      `Invalid --hydrate-per-stratum value ${JSON.stringify(raw)}. Use a whole number of 1 or more.`,
    );
  });
});

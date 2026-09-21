import { describe, expect, it } from 'vitest';
import { generateRunSalt, hashEmail } from '../../src/secondSource/hash.js';

describe('hashEmail', () => {
  it('is deterministic for the same raw email and salt', () => {
    expect(hashEmail('dana@example.com', 'salt-a')).toBe(hashEmail('dana@example.com', 'salt-a'));
  });

  it('produces a different hash for a different salt', () => {
    expect(hashEmail('dana@example.com', 'salt-a')).not.toBe(hashEmail('dana@example.com', 'salt-b'));
  });

  it('is trim- and case-insensitive', () => {
    expect(hashEmail(' Dana@Example.com ', 'salt-a')).toBe(hashEmail('dana@example.com', 'salt-a'));
  });

  it('produces a 64-character hex SHA-256 digest', () => {
    expect(hashEmail('dana@example.com', 'salt-a')).toMatch(/^[0-9a-f]{64}$/);
  });

  it('produces different hashes for different emails under the same salt', () => {
    expect(hashEmail('dana@example.com', 'salt-a')).not.toBe(hashEmail('sam@example.com', 'salt-a'));
  });
});

describe('generateRunSalt', () => {
  it('produces a different salt on every call', () => {
    expect(generateRunSalt()).not.toBe(generateRunSalt());
  });

  it('produces a non-empty hex string', () => {
    expect(generateRunSalt()).toMatch(/^[0-9a-f]+$/);
  });
});

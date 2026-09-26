/**
 * Pure-function tests only -- no network call, no ANTHROPIC_API_KEY. The
 * real generate() happy path is exercised by scripts/narrativeSmoke.ts
 * (manual, gated on the env var, excluded from npm run ci), not here, per
 * docs/narrative-design.md's Test strategy.
 */

import { describe, expect, it } from 'vitest';
import {
  AnthropicNarrativeModelClient,
  isClaimsShape,
  resolveNarrativeModel,
} from '../../src/report/anthropicNarrativeModelClient.js';

describe('resolveNarrativeModel', () => {
  it('defaults to claude-haiku-4-5-20251001 when NARRATIVE_MODEL is unset', () => {
    expect(resolveNarrativeModel({})).toBe('claude-haiku-4-5-20251001');
  });

  it('uses NARRATIVE_MODEL when set', () => {
    expect(resolveNarrativeModel({ NARRATIVE_MODEL: 'claude-sonnet-5' })).toBe('claude-sonnet-5');
  });
});

describe('isClaimsShape', () => {
  it('accepts a well-formed claims object', () => {
    expect(isClaimsShape({ claims: [{ text: 'x', groundedIn: ['close_date_fill_rate'] }] })).toBe(true);
  });

  it('accepts zero claims', () => {
    expect(isClaimsShape({ claims: [] })).toBe(true);
  });

  it.each([
    ['null', null],
    ['a string', 'not an object'],
    ['missing claims', {}],
    ['claims not an array', { claims: 'nope' }],
    ['a claim missing groundedIn', { claims: [{ text: 'x' }] }],
    ['a claim missing text', { claims: [{ groundedIn: ['x'] }] }],
    ['a claim with non-string text', { claims: [{ text: 1, groundedIn: ['x'] }] }],
    ['a claim with a non-string id in groundedIn', { claims: [{ text: 'x', groundedIn: [1] }] }],
  ])('rejects %s', (_label, value) => {
    expect(isClaimsShape(value)).toBe(false);
  });
});

describe('AnthropicNarrativeModelClient construction', () => {
  it('throws immediately, naming the missing var, when ANTHROPIC_API_KEY is unset -- never constructs the SDK client', () => {
    expect(() => new AnthropicNarrativeModelClient({})).toThrow(/ANTHROPIC_API_KEY/);
  });
});

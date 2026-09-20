import { describe, expect, it } from 'vitest';
import { computeSignals, riskScore } from '../src/signals/deterministic.js';
import { makeMockAdapter, makeEvidenceSet, NOW } from './fixtures.js';
import { buildEnvelope, canaryTripped, CANARY_TOKEN, TrustTier } from '../src/model/trust.js';

const caps = makeMockAdapter().capabilities();

describe('deterministic signals', () => {
  it('is reproducible for the same input', () => {
    const ev = makeEvidenceSet();
    expect(computeSignals(ev, caps, undefined, NOW)).toEqual(
      computeSignals(ev, caps, undefined, NOW),
    );
  });

  it('flags activity silence with a citation', () => {
    const out = computeSignals(makeEvidenceSet(), caps, undefined, NOW);
    const s = out.results.find((r) => r.id === 'activity_silence')!;
    expect(s.severity).toBe('high');
    expect(s.citedRecordIds).toContain('act-1');
  });

  it('counts close date pushes', () => {
    const out = computeSignals(makeEvidenceSet(), caps, undefined, NOW);
    const s = out.results.find((r) => r.id === 'close_date_pushed')!;
    expect(s.value).toBe(2);
  });

  it('suppresses stage signals when the vendor stage is unmapped', () => {
    const ev = makeEvidenceSet();
    const unmapped = {
      ...ev,
      opportunity: { ...ev.opportunity, stageConfidence: 'unmapped' as const },
    };
    const out = computeSignals(unmapped, caps, undefined, NOW);
    expect(out.suppressed.some((s) => s.id === 'stage_age_vs_cohort')).toBe(true);
    expect(out.results.some((r) => r.id === 'stage_age_vs_cohort')).toBe(false);
  });

  it('suppresses history signals when the adapter lacks the capability', () => {
    const out = computeSignals(
      makeEvidenceSet(),
      { ...caps, stageHistory: false, ownerHistory: false },
      undefined,
      NOW,
    );
    const ids = out.suppressed.map((s) => s.id);
    expect(ids).toContain('close_date_pushed');
    expect(ids).toContain('owner_changed_mid_cycle');
  });

  it('produces a score with an inspectable basis', () => {
    const { score, basis } = riskScore(computeSignals(makeEvidenceSet(), caps, undefined, NOW));
    expect(score).toBeGreaterThan(0);
    expect(basis).toBeGreaterThanOrEqual(score);
  });
});

describe('trust envelope', () => {
  it('keeps untrusted content out of instruction space', () => {
    const ev = makeEvidenceSet();
    const env = buildEnvelope([ev.activities[0]!.body!]);
    expect(env.kind).toBe('untrusted_content');
    expect(env.items[0]!.tier).toBe(TrustTier.ExternallySourced);
    // The injected instruction is present as DATA, carried in a typed field.
    expect(env.items[0]!.content).toMatch(/ignore all previous instructions/i);
  });

  it('detects a canary leak', () => {
    expect(canaryTripped(`some output ${CANARY_TOKEN}`)).toBe(true);
    expect(canaryTripped('clean output')).toBe(false);
  });
});

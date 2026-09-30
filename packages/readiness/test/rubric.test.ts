/**
 * The rubric truth-table test.
 *
 * This suite FAILS while any threshold is PENDING or any rationale is empty.
 * That is the forcing function: CI stays red until the judgment has been made.
 * Do not weaken these tests to get green. Fill in the rubric instead.
 */

import { describe, expect, it } from 'vitest';
import {
  CAPABILITIES,
  PENDING,
  THRESHOLDS,
  gradeAll,
  gradeCapability,
  gradeGate,
  type MetricId,
  type MetricReading,
} from '../src/rubric.js';

const allMetrics = Object.keys(THRESHOLDS) as MetricId[];

const readAt = (metric: MetricId, value: number): MetricReading => ({ metric, value, sampleSize: 100 });

/** Every given gate read exactly at its viableAt. */
function viableReadingsFor(gates: readonly MetricId[]): Map<MetricId, MetricReading> {
  return new Map(gates.map((g) => [g, readAt(g, THRESHOLDS[g].viableAt as number)]));
}

describe('rubric completeness', () => {
  it.each(allMetrics)('%s has both thresholds set', (m) => {
    expect(THRESHOLDS[m].viableAt, `${m}.viableAt is still PENDING`).not.toBe(PENDING);
    expect(THRESHOLDS[m].degradedAt, `${m}.degradedAt is still PENDING`).not.toBe(PENDING);
  });

  it.each(allMetrics)('%s has a written rationale', (m) => {
    expect(THRESHOLDS[m].rationale.trim(), `${m} has no rationale`).not.toBe('');
  });

  it.each(allMetrics)('%s has a remediation', (m) => {
    expect(THRESHOLDS[m].remediation.trim()).not.toBe('');
  });

  it('orders every threshold pair correctly for its direction', () => {
    for (const m of allMetrics) {
      const t = THRESHOLDS[m];
      if (t.viableAt === PENDING || t.degradedAt === PENDING) continue;
      if (t.direction === 'higher_is_better') {
        expect(t.viableAt, `${m}: viableAt must be >= degradedAt`).toBeGreaterThanOrEqual(t.degradedAt);
      } else {
        expect(t.viableAt, `${m}: viableAt must be <= degradedAt`).toBeLessThanOrEqual(t.degradedAt);
      }
    }
  });

  it('references only defined metrics from capabilities', () => {
    for (const c of CAPABILITIES) {
      for (const g of c.gates) expect(THRESHOLDS[g]).toBeDefined();
      if (c.coverageDrivenBy) expect(THRESHOLDS[c.coverageDrivenBy]).toBeDefined();
    }
  });

  it('gates every capability on at least one metric', () => {
    for (const c of CAPABILITIES) expect(c.gates.length).toBeGreaterThan(0);
  });
});

describe('gate grading', () => {
  const read = (metric: MetricId, value: number): MetricReading => ({
    metric,
    value,
    sampleSize: 100,
  });

  it('grades higher_is_better metrics in the right direction', () => {
    const t = THRESHOLDS.activity_capture_rate;
    if (t.viableAt === PENDING || t.degradedAt === PENDING) return;
    expect(gradeGate(read('activity_capture_rate', t.viableAt)).verdict).toBe('viable');
    expect(gradeGate(read('activity_capture_rate', t.degradedAt)).verdict).toBe('degraded');
    expect(gradeGate(read('activity_capture_rate', t.degradedAt - 0.01)).verdict).toBe('blocked');
  });

  it('grades lower_is_better metrics in the right direction', () => {
    const t = THRESHOLDS.past_due_close_date_rate;
    if (t.viableAt === PENDING || t.degradedAt === PENDING) return;
    expect(gradeGate(read('past_due_close_date_rate', t.viableAt)).verdict).toBe('viable');
    expect(gradeGate(read('past_due_close_date_rate', t.degradedAt)).verdict).toBe('degraded');
    expect(gradeGate(read('past_due_close_date_rate', t.degradedAt + 0.01)).verdict).toBe('blocked');
  });
});

describe('capability grading', () => {
  it('takes the worst gate as the capability verdict', () => {
    const spec = CAPABILITIES.find((c) => c.id === 'close_date_realism')!;
    const readings = new Map<MetricId, MetricReading>();
    for (const g of spec.gates) {
      const t = THRESHOLDS[g];
      if (t.viableAt === PENDING) return;
      readings.set(g, { metric: g, value: t.viableAt, sampleSize: 100 });
    }
    expect(gradeCapability(spec, readings).verdict).toBe('viable');

    const worst = spec.gates[0]!;
    const tw = THRESHOLDS[worst];
    if (tw.degradedAt === PENDING) return;
    readings.set(worst, {
      metric: worst,
      value: tw.direction === 'higher_is_better' ? tw.degradedAt - 1 : tw.degradedAt + 1,
      sampleSize: 100,
    });
    expect(gradeCapability(spec, readings).verdict).toBe('blocked');
  });

  it('treats an unmeasured metric as blocked, never as a pass', () => {
    const spec = CAPABILITIES.find((c) => c.id === 'close_date_realism')!;
    if (spec.gates.some((g) => THRESHOLDS[g].viableAt === PENDING)) return;
    const result = gradeCapability(spec, new Map());
    expect(result.verdict).toBe('blocked');
    expect(result.blockers.length).toBe(spec.gates.length);
  });

  it('grades a gate the tool cannot see as not_measured, never as a pass', () => {
    const spec = CAPABILITIES.find((c) => c.id === 'close_date_realism')!;
    const readings = viableReadingsFor(spec.gates);
    const unseen = spec.gates[0]!;
    readings.delete(unseen);
    const result = gradeCapability(spec, readings, new Set([unseen]));
    expect(result.verdict).toBe('not_measured');
    expect(result.blockers.map((b) => [b.metric, b.verdict])).toEqual([[unseen, 'not_measured']]);
    expect(result.blockers[0]!.remediation).toMatch(/^Not measured:/);
  });

  it('ranks blocked above not_measured, and not_measured above degraded', () => {
    const spec = CAPABILITIES.find((c) => c.id === 'forecast_assistance')!;
    const [unseen, degradedGate, blockedGate] = spec.gates as readonly MetricId[];
    const readings = viableReadingsFor(spec.gates);
    readings.delete(unseen!);
    readings.set(degradedGate!, { metric: degradedGate!, value: THRESHOLDS[degradedGate!].degradedAt as number, sampleSize: 100 });

    const notMeasured = gradeCapability(spec, readings, new Set([unseen!]));
    expect(notMeasured.verdict).toBe('not_measured');
    // The degraded gate is still listed under a not-measured capability.
    expect(notMeasured.blockers.map((b) => b.verdict)).toEqual(['not_measured', 'degraded']);

    const t = THRESHOLDS[blockedGate!];
    const worse = t.direction === 'higher_is_better' ? (t.degradedAt as number) - 1 : (t.degradedAt as number) + 1;
    readings.set(blockedGate!, { metric: blockedGate!, value: worse, sampleSize: 100 });
    const blocked = gradeCapability(spec, readings, new Set([unseen!]));
    expect(blocked.verdict).toBe('blocked');
    expect(blocked.blockers.map((b) => b.verdict)).toEqual(['blocked', 'not_measured', 'degraded']);
  });

  it('grades a bool gate at 0 as blocked, not degraded (no degraded band for bools)', () => {
    for (const m of ['close_date_history_enabled', 'owner_history_enabled'] as const) {
      expect(THRESHOLDS[m].unit).toBe('bool');
      expect(gradeGate(readAt(m, 0)).verdict).toBe('blocked');
      expect(gradeGate(readAt(m, 1)).verdict).toBe('viable');
    }
  });

  it('grades every capability without throwing once the rubric is complete', () => {
    const readings = new Map<MetricId, MetricReading>();
    for (const m of allMetrics) {
      const t = THRESHOLDS[m];
      if (t.viableAt === PENDING) return;
      readings.set(m, { metric: m, value: t.viableAt, sampleSize: 100 });
    }
    const results = gradeAll(readings);
    expect(results).toHaveLength(CAPABILITIES.length);
    expect(results.every((r) => r.verdict === 'viable')).toBe(true);
  });
});

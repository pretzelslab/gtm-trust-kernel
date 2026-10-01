import { describe, expect, it } from 'vitest';
import type { ReportCapabilityRow } from '../../src/report/buildReport.js';
import {
  EXIT_ERROR,
  EXIT_VERDICT_FAILURE,
  evaluateFailOn,
  normalizeFailOnArgs,
  parseFailOn,
} from '../../src/report/failOn.js';
import type { CapabilityVerdict } from '../../src/rubric.js';

function row(label: string, verdict: CapabilityVerdict): ReportCapabilityRow {
  return { id: label as ReportCapabilityRow['id'], label, description: '', verdict, coverageCeiling: null, blockerCount: 0 };
}

const ALL = [row('A', 'viable'), row('B', 'degraded'), row('C', 'not_measured'), row('D', 'blocked')];

describe('--fail-on exit codes', () => {
  it('uses 1 for errors and 2 for a verdict failure', () => {
    expect(EXIT_ERROR).toBe(1);
    expect(EXIT_VERDICT_FAILURE).toBe(2);
  });
});

describe('normalizeFailOnArgs', () => {
  it('turns a bare --fail-on into --fail-on=blocked, last or before another option', () => {
    expect(normalizeFailOnArgs(['scan', '--demo', '--fail-on'])).toEqual(['scan', '--demo', '--fail-on=blocked']);
    expect(normalizeFailOnArgs(['--fail-on', '--json'])).toEqual(['--fail-on=blocked', '--json']);
  });

  it('leaves --fail-on <value> and --fail-on=<value> alone', () => {
    expect(normalizeFailOnArgs(['--fail-on', 'degraded'])).toEqual(['--fail-on', 'degraded']);
    expect(normalizeFailOnArgs(['--fail-on=degraded'])).toEqual(['--fail-on=degraded']);
    expect(normalizeFailOnArgs(['--json'])).toEqual(['--json']);
  });
});

describe('parseFailOn', () => {
  it('is off (undefined) when unset', () => {
    expect(parseFailOn(undefined)).toBeUndefined();
  });

  it.each(['blocked', 'degraded', 'not_measured'] as const)('accepts %s', (value) => {
    expect([...parseFailOn(value)!]).toEqual([value]);
  });

  it('accepts a comma list, ignoring spaces and repeats', () => {
    expect([...parseFailOn('blocked, degraded,blocked')!]).toEqual(['blocked', 'degraded']);
  });

  it.each(['', 'viable', 'Blocked', 'blocked,', 'blocked,nope'])('rejects %j', (value) => {
    expect(() => parseFailOn(value)).toThrow(/Invalid --fail-on value/);
  });
});

describe('evaluateFailOn', () => {
  it('always exits 0 when unset, even with blocked capabilities', () => {
    expect(evaluateFailOn(ALL, undefined)).toEqual({ exitCode: 0, failing: [] });
  });

  it('fails on blocked only, for blocked (the bare flag)', () => {
    const result = evaluateFailOn(ALL, parseFailOn('blocked'));
    expect(result.exitCode).toBe(2);
    expect(result.failing.map((c) => c.label)).toEqual(['D']);
    expect(result.message).toBe('--fail-on blocked: 1 capability failed: D (blocked)');
  });

  it('fails on degraded only, for degraded', () => {
    const result = evaluateFailOn(ALL, parseFailOn('degraded'));
    expect(result.exitCode).toBe(2);
    expect(result.failing.map((c) => c.label)).toEqual(['B']);
  });

  it('counts not_measured only when listed', () => {
    expect(evaluateFailOn([row('C', 'not_measured')], parseFailOn('blocked,degraded')).exitCode).toBe(0);
    const result = evaluateFailOn(ALL, parseFailOn('not_measured'));
    expect(result.exitCode).toBe(2);
    expect(result.failing.map((c) => c.label)).toEqual(['C']);
  });

  it('lists every failing capability in report order', () => {
    const result = evaluateFailOn(ALL, parseFailOn('blocked,degraded,not_measured'));
    expect(result.message).toBe('--fail-on blocked,degraded,not_measured: 3 capabilities failed: B (degraded), C (not_measured), D (blocked)');
  });

  it('exits 0 when no capability has a listed verdict', () => {
    expect(evaluateFailOn([row('A', 'viable')], parseFailOn('blocked,degraded,not_measured'))).toEqual({ exitCode: 0, failing: [] });
  });
});

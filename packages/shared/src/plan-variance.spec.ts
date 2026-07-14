import { describe, expect, it } from 'vitest';
import { computePlanVariance, formatVariancePct } from './plan-variance';

describe('computePlanVariance', () => {
  it('is on-target (success) when actual equals baseline', () => {
    const v = computePlanVariance(1000, 1000);
    expect(v.delta).toBe(0);
    expect(v.pct).toBe(0);
    expect(v.tone).toBe('success');
  });

  it('flags an overage as warning', () => {
    const v = computePlanVariance(1000, 1200);
    expect(v.delta).toBe(200);
    expect(v.pct).toBe(20);
    expect(v.tone).toBe('warning');
  });

  it('flags an underage as info', () => {
    const v = computePlanVariance(1000, 800);
    expect(v.delta).toBe(-200);
    expect(v.pct).toBe(-20);
    expect(v.tone).toBe('info');
  });

  it('returns null pct when baseline is zero', () => {
    expect(computePlanVariance(0, 500).pct).toBeNull();
  });
});

describe('formatVariancePct', () => {
  it('formats matching, over, and under variances', () => {
    expect(formatVariancePct(computePlanVariance(1000, 1000))).toBe('תואם');
    expect(formatVariancePct(computePlanVariance(1000, 1200))).toBe('+20%');
    expect(formatVariancePct(computePlanVariance(1000, 900))).toBe('-10%');
  });

  it('handles a zero baseline', () => {
    expect(formatVariancePct(computePlanVariance(0, 500))).toBe('חריגה');
  });
});

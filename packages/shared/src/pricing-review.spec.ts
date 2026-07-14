import { describe, expect, it } from 'vitest';
import { computeFinalAmount, evaluateFinalReview } from './pricing-review';

const base = {
  quotationEstimate: 5000,
  scheduledEstimate: 5200,
  actualBillableHours: null as number | null,
  fixedFees: 300,
  supplies: 150,
  discounts: 200,
  hourlyRate: 120,
};

describe('computeFinalAmount', () => {
  it('uses the scheduled estimate as labor base when actuals are unknown', () => {
    expect(computeFinalAmount(base)).toBe(5200 + 300 + 150 - 200);
  });

  it('uses actual billable hours when known', () => {
    expect(computeFinalAmount({ ...base, actualBillableHours: 40 })).toBe(40 * 120 + 300 + 150 - 200);
  });

  it('never returns a negative amount', () => {
    expect(computeFinalAmount({ ...base, actualBillableHours: 0, fixedFees: 0, supplies: 0, discounts: 999 })).toBe(0);
  });
});

describe('evaluateFinalReview', () => {
  it('is ready when there are no open reasons', () => {
    const result = evaluateFinalReview([]);
    expect(result.requiresReview).toBe(false);
    expect(result.tone).toBe('success');
  });

  it('requires review and lists reasons when present', () => {
    const result = evaluateFinalReview(['MISSING_FORM', 'DISCOUNT_UNCONFIRMED']);
    expect(result.requiresReview).toBe(true);
    expect(result.label).toBe('הסכום הסופי עדיין דורש בדיקה');
    expect(result.reasons).toHaveLength(2);
    expect(result.tone).toBe('warning');
  });
});

import { describe, expect, it } from 'vitest';
import {
  roundPaidHours,
  computeWorkerPayLine,
  summarizeWorkerPay,
  projectWorkerFacingReport,
  type WorkerPayLine,
} from './worker-report-math';

describe('roundPaidHours (nearest half hour, half rounds up)', () => {
  it('matches the spec boundary examples', () => {
    expect(roundPaidHours(4.88)).toBe(5.0);
    expect(roundPaidHours(4.56)).toBe(4.5);
    expect(roundPaidHours(4.74)).toBe(4.5);
    expect(roundPaidHours(4.75)).toBe(5.0);
  });

  it('leaves exact halves and integers unchanged', () => {
    expect(roundPaidHours(5)).toBe(5);
    expect(roundPaidHours(4.5)).toBe(4.5);
    expect(roundPaidHours(0)).toBe(0);
  });
});

describe('computeWorkerPayLine', () => {
  it('preserves exact hours and pays on the rounded hours', () => {
    const line = computeWorkerPayLine({ approvedHours: 4.88, hourlyWage: 90, dailyPayment: 0, isDailyPaymentEligible: false });
    expect(line.exactHours).toBe(4.88); // exact preserved
    expect(line.paidHours).toBe(5.0); // rounded
    expect(line.hourlyPay).toBe(450); // 5.0 × 90, NOT 4.88 × 90 (439.20)
    expect(line.pay).toBe(450);
  });

  it('adds the fixed daily payment once when eligible, unaffected by rounding', () => {
    const line = computeWorkerPayLine({ approvedHours: 4.56, hourlyWage: 100, dailyPayment: 50, isDailyPaymentEligible: true });
    expect(line.paidHours).toBe(4.5);
    expect(line.hourlyPay).toBe(450); // 4.5 × 100
    expect(line.dailyPay).toBe(50); // fixed daily unchanged
    expect(line.pay).toBe(500);
  });

  it('does not add the daily payment when not eligible', () => {
    const line = computeWorkerPayLine({ approvedHours: 3, hourlyWage: 100, dailyPayment: 50, isDailyPaymentEligible: false });
    expect(line.dailyPay).toBe(0);
    expect(line.pay).toBe(300);
  });
});

describe('summarizeWorkerPay (per-job rounding before aggregation)', () => {
  const lines: WorkerPayLine[] = [
    computeWorkerPayLine({ approvedHours: 4.88, hourlyWage: 90, dailyPayment: 0, isDailyPaymentEligible: false }), // 5.0h
    computeWorkerPayLine({ approvedHours: 4.56, hourlyWage: 90, dailyPayment: 0, isDailyPaymentEligible: false }), // 4.5h
  ];

  it('sums per-job rounded paid hours, not the rounded aggregate', () => {
    const totals = summarizeWorkerPay(lines);
    // Per-job: 5.0 + 4.5 = 9.5. Rounding the exact aggregate (4.88+4.56=9.44 → 9.5)
    // happens to match here, so use a case where they differ:
    expect(totals.totalPaidHours).toBe(9.5);
    expect(totals.totalExactHours).toBeCloseTo(9.44, 5); // exact preserved
  });

  it('per-job rounding differs from rounding the monthly aggregate', () => {
    // 4.74 → 4.5 and 4.74 → 4.5 per job = 9.0. Exact aggregate 9.48 would round to 9.5.
    const perJob = summarizeWorkerPay([
      computeWorkerPayLine({ approvedHours: 4.74, hourlyWage: 100, dailyPayment: 0, isDailyPaymentEligible: false }),
      computeWorkerPayLine({ approvedHours: 4.74, hourlyWage: 100, dailyPayment: 0, isDailyPaymentEligible: false }),
    ]);
    expect(perJob.totalPaidHours).toBe(9.0); // 4.5 + 4.5
    expect(roundPaidHours(4.74 + 4.74)).toBe(9.5); // rounding the aggregate would be wrong
    expect(perJob.hourlyPay).toBe(900); // paid on 9.0h, not 9.5h
  });

  it('sums the amounts from the per-job rounded pay', () => {
    const totals = summarizeWorkerPay(lines);
    expect(totals.hourlyPay).toBe(5.0 * 90 + 4.5 * 90); // 855
    expect(totals.total).toBe(855);
  });
});

describe('projectWorkerFacingReport (immutable snapshot rendering)', () => {
  it('renders a legacy published snapshot verbatim (historical version unchanged)', () => {
    // A v1 published before half-hour rounding: amount was computed from exact
    // hours (4.88 × 90 = 439.20) and there is no paidHours.
    const legacy = {
      shifts: [{ shiftId: 's1', date: '2026-06-01', customerName: 'א', shiftLabel: 'אריזה', approvedHours: '4.88', pay: '439.20' }],
      summary: { shiftsCount: 1, totalApprovedHours: '4.88', total: '439.20' },
    };
    const view = projectWorkerFacingReport(legacy);
    expect(view.shifts[0].approvedHours).toBe('4.88');
    expect(view.shifts[0].paidHours).toBeNull(); // no rounding on legacy version
    expect(view.shifts[0].dayTotal).toBe('439.20'); // stored amount unchanged
    expect(view.summary.totalPaidHours).toBeNull();
    expect(view.summary.total).toBe('439.20');
  });

  it('surfaces paid hours from a new snapshot (corrected/new version uses the rule)', () => {
    const line = computeWorkerPayLine({ approvedHours: 4.88, hourlyWage: 90, dailyPayment: 0, isDailyPaymentEligible: false });
    const totals = summarizeWorkerPay([line]);
    const fresh = {
      shifts: [{ shiftId: 's1', date: '2026-07-01', customerName: 'א', shiftLabel: 'אריזה', approvedHours: '4.88', paidHours: line.paidHours, pay: '450.00' }],
      summary: { shiftsCount: 1, totalApprovedHours: '4.88', totalPaidHours: totals.totalPaidHours, total: '450.00' },
    };
    const view = projectWorkerFacingReport(fresh);
    expect(view.shifts[0].approvedHours).toBe('4.88'); // exact preserved
    expect(view.shifts[0].paidHours).toBe(5.0); // rounded hours surfaced
    expect(view.shifts[0].dayTotal).toBe('450.00'); // amount from paid hours
    expect(view.summary.totalPaidHours).toBe(5.0);
  });
});

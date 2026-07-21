import { describe, expect, it } from 'vitest';
import { computeCustomerReport, type CustomerReportJobInput } from './customer-report';

const jobs: CustomerReportJobInput[] = [
  { jobId: 'j1', date: '2026-08-01T00:00:00.000Z', jobType: 'PACKING', workedHours: [5, 5, 4.5] },
  { jobId: 'j2', date: '2026-08-03T00:00:00.000Z', jobType: 'UNPACKING', workedHours: [6, 6] },
];

describe('computeCustomerReport', () => {
  it('sums per-job hours and worker counts', () => {
    const report = computeCustomerReport(jobs, { mode: 'HOURLY', hourlyRate: 175 });
    expect(report.jobs[0]).toMatchObject({ jobId: 'j1', date: '2026-08-01', workerCount: 3, actualHours: 14.5 });
    expect(report.jobs[1]).toMatchObject({ jobId: 'j2', workerCount: 2, actualHours: 12 });
    expect(report.totalActualHours).toBe(26.5);
  });

  it('computes hourly final amount = hours × rate + additions (no discount)', () => {
    const report = computeCustomerReport(jobs, {
      mode: 'HOURLY',
      hourlyRate: 100,
      additions: [
        { description: 'ציוד', amount: 200 },
        { description: 'נסיעות', amount: 50 },
      ],
    });
    // 26.5 * 100 + (200 + 50) = 2900
    expect(report.finalAmount).toBe(2900);
    expect(report.additionsTotal).toBe(250);
    expect(report.additions).toHaveLength(2);
    expect(report.hourlyRate).toBe(100);
  });

  it('ignores blank addition lines', () => {
    const report = computeCustomerReport(jobs, {
      mode: 'HOURLY',
      hourlyRate: 100,
      additions: [{ description: '', amount: 0 }],
    });
    expect(report.additions).toHaveLength(0);
    expect(report.finalAmount).toBe(2650);
  });

  it('carries an internal per-job owner note into the line (not customer-facing)', () => {
    const report = computeCustomerReport(
      [{ jobId: 'j1', date: '2026-08-01', jobType: 'PACKING', workedHours: [8], ownerNote: 'הערה פנימית' }],
      { mode: 'HOURLY', hourlyRate: 100 },
    );
    expect(report.jobs[0].ownerNote).toBe('הערה פנימית');
  });

  it('uses the global amount and still reports total hours', () => {
    const report = computeCustomerReport(jobs, { mode: 'GLOBAL', globalAmount: 5000 });
    expect(report.mode).toBe('GLOBAL');
    expect(report.finalAmount).toBe(5000);
    expect(report.totalActualHours).toBe(26.5);
    expect(report.hourlyRate).toBeUndefined();
    expect(report.additions).toHaveLength(0);
  });

  it('handles jobs with no worked hours', () => {
    const report = computeCustomerReport(
      [{ jobId: 'j3', date: '2026-08-05', jobType: 'HOME_ORGANIZATION', workedHours: [] }],
      { mode: 'HOURLY', hourlyRate: 175 },
    );
    expect(report.jobs[0].workerCount).toBe(0);
    expect(report.totalActualHours).toBe(0);
    expect(report.finalAmount).toBe(0);
  });
});

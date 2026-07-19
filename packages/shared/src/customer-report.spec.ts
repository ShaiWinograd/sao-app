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

  it('computes hourly final amount with additions and discount', () => {
    const report = computeCustomerReport(jobs, {
      mode: 'HOURLY',
      hourlyRate: 100,
      manualAdditions: 200,
      discount: 150,
    });
    // 26.5 * 100 + 200 - 150 = 2700
    expect(report.finalAmount).toBe(2700);
    expect(report.hourlyRate).toBe(100);
  });

  it('uses the global amount and still reports total hours', () => {
    const report = computeCustomerReport(jobs, { mode: 'GLOBAL', globalAmount: 5000 });
    expect(report.mode).toBe('GLOBAL');
    expect(report.finalAmount).toBe(5000);
    expect(report.totalActualHours).toBe(26.5);
    expect(report.hourlyRate).toBeUndefined();
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

import { describe, expect, it } from 'vitest';
import {
  computeCustomerReport,
  roundToHalfHour,
  buildCustomerReportPdfModel,
  formatShekel,
  formatHours,
  type CustomerReportJobInput,
} from './customer-report';

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

describe('half-hour billable rounding', () => {
  it('rounds each worker to the nearest 0.5h (half rounds up)', () => {
    expect(roundToHalfHour(4.88)).toBe(5.0);
    expect(roundToHalfHour(4.56)).toBe(4.5);
    expect(roundToHalfHour(4.74)).toBe(4.5);
    expect(roundToHalfHour(4.75)).toBe(5.0);
  });

  it('rounds per worker BEFORE aggregating (not on the job total)', () => {
    // Two workers at 4.74: per-worker → 4.5 + 4.5 = 9.0 billable.
    // Rounding the job total (9.48) to the nearest 0.5 would give 9.5 — which must NOT happen.
    const r = computeCustomerReport(
      [{ jobId: 'j', date: '2026-08-01', jobType: 'PACKING', workedHours: [4.74, 4.74] }],
      { mode: 'HOURLY', hourlyRate: 100 },
    );
    expect(r.jobs[0].actualHours).toBe(9.48); // exact preserved
    expect(r.jobs[0].billableHours).toBe(9.0); // per-worker rounded
    expect(r.totalActualHours).toBe(9.48);
    expect(r.totalBillableHours).toBe(9.0);
    expect(r.finalAmount).toBe(900); // billed on 9.0, not 9.48 / 9.5
  });

  it('HOURLY billing uses billable hours; exact hours are preserved but not billed', () => {
    const r = computeCustomerReport(
      [{ jobId: 'j', date: '2026-08-01', jobType: 'PACKING', workedHours: [4.88, 4.56] }],
      { mode: 'HOURLY', hourlyRate: 200, additions: [{ description: 'ציוד', amount: 100 }] },
    );
    // per worker: 5.0 + 4.5 = 9.5 billable; exact 9.44.
    expect(r.jobs[0].billableHours).toBe(9.5);
    expect(r.jobs[0].actualHours).toBe(9.44);
    expect(r.finalAmount).toBe(9.5 * 200 + 100); // 2000
  });

  it('GLOBAL billing keeps the manual amount but still exposes exact + billable hours', () => {
    const r = computeCustomerReport(
      [{ jobId: 'j', date: '2026-08-01', jobType: 'PACKING', workedHours: [4.74, 4.75] }],
      { mode: 'GLOBAL', globalAmount: 3000 },
    );
    expect(r.finalAmount).toBe(3000);
    expect(r.jobs[0].actualHours).toBe(9.49);
    expect(r.jobs[0].billableHours).toBe(9.5); // 4.5 + 5.0
    expect(r.totalBillableHours).toBe(9.5);
    expect(r.totalActualHours).toBe(9.49);
  });
});

describe('buildCustomerReportPdfModel (RTL Hebrew layout)', () => {
  const report = computeCustomerReport(
    [{ jobId: 'j', date: '2026-08-01', jobType: 'PACKING', workedHours: [4.88, 4.56] }],
    { mode: 'HOURLY', hourlyRate: 200, additions: [{ description: 'ציוד', amount: 100 }] },
  );
  const model = buildCustomerReportPdfModel({
    customerName: 'דנה כהן',
    versionNumber: 2,
    generatedAt: '2026-08-10T00:00:00.000Z',
    report,
  });

  it('lays columns right-to-left: date → job type → workers → billable hours', () => {
    expect(model.table.headers).toEqual(['תאריך', 'סוג עבודה', 'עובדים', 'שעות לחיוב']);
  });

  it('never renders internal version text in the customer PDF', () => {
    const all = [model.title, ...model.subtitle, ...model.totals.map((t) => `${t.label} ${t.value}`)].join(' ');
    expect(all).not.toContain('גרסה');
    expect(all).not.toMatch(/version/i);
    // The subtitle is customer name + a DD.MM.YYYY generation date only.
    expect(model.subtitle).toHaveLength(2);
    expect(model.subtitle[0]).toBe('לקוח: דנה כהן');
    expect(model.subtitle[1]).toMatch(/^\d{2}\.\d{2}\.\d{4}$/);
  });

  it('formats currency as "₪ <amount>" (symbol first) for the customer', () => {
    expect(formatShekel(175)).toBe('₪ 175');
    expect(formatShekel(875)).toBe('₪ 875');
  });

  it('renders rows with BILLABLE hours and DD.MM.YYYY dates', () => {
    expect(model.table.rows[0]).toEqual(['01.08.2026', 'אריזה', '2', formatHours(9.5)]);
  });

  it('totals show the final amount in shekels, emphasised', () => {
    const final = model.totals.find((t) => t.label === 'סכום סופי');
    expect(final?.value).toBe(formatShekel(2000));
    expect(final?.emphasis).toBe(true);
  });

  it('GLOBAL model omits the hourly-rate row', () => {
    const g = buildCustomerReportPdfModel({
      customerName: 'x',
      versionNumber: 1,
      report: computeCustomerReport([], { mode: 'GLOBAL', globalAmount: 500 }),
    });
    expect(g.totals.some((t) => t.label === 'תעריף שעתי')).toBe(false);
    expect(g.totals.find((t) => t.label === 'סכום סופי')?.value).toBe(formatShekel(500));
  });
});

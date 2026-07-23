import { describe, expect, it } from 'vitest';
import {
  roundPaidHours,
  computeWorkerPayLine,
  summarizeWorkerPay,
  projectWorkerFacingReport,
  buildWorkerReportPdfLines,
  buildWorkerReportPdfModel,
  hebrewMonthYear,
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

  it('preserves approved clock-in/out on each work line', () => {
    const view = projectWorkerFacingReport({
      shifts: [{ shiftId: 's1', date: '2026-07-22', customerName: 'נסיון', shiftLabel: 'אריזה', clockIn: '12:00', clockOut: '16:53', approvedHours: '4.88', paidHours: 5, pay: '450.00' }],
      summary: { shiftsCount: 1, totalApprovedHours: '4.88', totalPaidHours: 5, total: '450.00' },
    });
    expect(view.shifts[0].clockIn).toBe('12:00');
    expect(view.shifts[0].clockOut).toBe('16:53');
  });
});

describe('buildWorkerReportPdfLines', () => {
  const projected = projectWorkerFacingReport({
    shifts: [
      { shiftId: 's1', date: '2026-07-22', customerName: 'נסיון', shiftLabel: 'אריזה', roleLabel: 'עובדת', clockIn: '12:00', clockOut: '16:53', approvedHours: '4.88', paidHours: 5, pay: '450.00' },
    ],
    summary: { shiftsCount: 1, totalApprovedHours: '4.88', totalPaidHours: 5, total: '450.00' },
  });
  const text = buildWorkerReportPdfLines(
    { workerName: 'נועה וינוגרד', month: 7, year: 2026, version: 2, publishedAt: '2026-07-22T09:00:00.000Z' },
    projected,
  ).join('\n');

  it('includes worker name, month, publication date, clock-in/out, hours and totals', () => {
    expect(text).toContain('עובד/ת: נועה וינוגרד');
    expect(text).toContain('חודש: 7/2026');
    expect(text).toContain('פורסם:');
    expect(text).toContain('כניסה: 12:00');
    expect(text).toContain('יציאה: 16:53');
    expect(text).toContain('שעות נוכחות: 4.88');
    expect(text).toContain('שעות לתשלום: 5');
    expect(text).toContain('סכום: 450 ₪');
    expect(text).toContain('ימי עבודה: 1');
    expect(text).toContain('סה"כ שעות נוכחות: 4.88');
    expect(text).toContain('סה"כ שעות לתשלום: 5');
    expect(text).toContain('סה"כ לחודש: 450 ₪');
  });

  it('excludes hourly rate, payment status, paidAt and internal notes', () => {
    expect(text).not.toMatch(/תעריף|שכר שעתי|hourlyRate/i);
    expect(text).not.toMatch(/paidAt|PAID|שולם|תשלום סטטוס/i);
    expect(text).not.toMatch(/הערה פנימית|internal/i);
  });

  it('renders an unresolved clock time as a dash rather than scheduled hours', () => {
    const t = buildWorkerReportPdfLines(
      { workerName: 'x', month: 7, year: 2026, version: 1 },
      projectWorkerFacingReport({ shifts: [{ shiftId: 's', date: '2026-07-01', customerName: 'a', shiftLabel: 'אריזה', clockIn: null, clockOut: null, approvedHours: '0', paidHours: 0, pay: '0' }], summary: {} }),
    ).join('\n');
    expect(t).toContain('כניסה: — · יציאה: —');
  });
});

describe('buildWorkerReportPdfModel (structured RTL layout)', () => {
  const projected = projectWorkerFacingReport({
    shifts: [
      { shiftId: 's1', date: '2026-07-22', customerName: 'נסיון', shiftLabel: 'אריזה', roleLabel: 'עובדת', clockIn: '09:05', clockOut: '13:58', approvedHours: '4.88', paidHours: 5, pay: '450' },
    ],
    summary: { shiftsCount: 1, totalApprovedHours: '4.88', totalPaidHours: 5, total: '450' },
  });
  const model = buildWorkerReportPdfModel(
    { workerName: 'נועה וינוגרד', month: 7, year: 2026, version: 2, publishedAt: '2026-07-22T09:00:00.000Z' },
    projected,
  );

  it('titles the document for the worker and lists worker/month/publication in the subtitle', () => {
    expect(model.title).toBe('דוח חודשי לעובדת');
    expect(model.subtitle[0]).toBe('עובדת: נועה וינוגרד');
    expect(model.subtitle[1]).toBe('חודש: יולי 2026');
    expect(model.subtitle[2]).toBe('תאריך פרסום: 22.07.2026');
  });

  it('orders columns right-to-left: date, customer, job type, role, in, out, hours, paid, amount', () => {
    expect(model.table.headers).toEqual([
      'תאריך', 'לקוחה', 'סוג עבודה', 'תפקיד', 'כניסה', 'יציאה', 'שעות נוכחות', 'שעות לתשלום', 'סכום',
    ]);
  });

  it('places each date/time/number/currency value in its own cell', () => {
    const row = model.table.rows[0];
    expect(row[0]).toBe('22.07.2026');
    expect(row[4]).toBe('09:05'); // clock-in
    expect(row[5]).toBe('13:58'); // clock-out
    expect(row[6]).toBe('4.88'); // exact approved hours (preserved)
    expect(row[7]).toBe('5'); // paid hours (nearest half hour)
    expect(row[8]).toBe('450 ₪'); // amount with the shekel sign after the number
  });

  it('summarizes workdays, attendance hours, paid hours and monthly amount (amount emphasized)', () => {
    expect(model.totals.map((t) => t.label)).toEqual(['ימי עבודה', 'שעות נוכחות', 'שעות לתשלום', 'סכום חודשי']);
    expect(model.totals[0].value).toBe('1');
    expect(model.totals[1].value).toBe('4.88');
    expect(model.totals[2].value).toBe('5');
    expect(model.totals[3].value).toBe('450 ₪');
    expect(model.totals[3].emphasis).toBe(true);
  });

  it('never exposes hourly rate, payment status, internal notes or a version number', () => {
    const flat = JSON.stringify(model);
    expect(flat).not.toMatch(/תעריף|שכר שעתי|hourlyRate/i);
    expect(flat).not.toMatch(/paidAt|PAID|שולם/i);
    expect(flat).not.toMatch(/הערה פנימית|internal/i);
    expect(flat).not.toMatch(/גרסה|\bv2\b/i); // version is stored/known but never rendered
  });

  it('renders unresolved clock times and legacy null paid hours as a dash', () => {
    const m = buildWorkerReportPdfModel(
      { workerName: 'x', month: 3, year: 2026, version: 1, publishedAt: null },
      projectWorkerFacingReport({ shifts: [{ shiftId: 's', date: '2026-03-01', customerName: 'a', shiftLabel: 'אריזה', clockIn: null, clockOut: null, approvedHours: '0', paidHours: null, pay: '0' }], summary: {} }),
    );
    expect(m.subtitle).toHaveLength(2); // no publication line when unpublished
    expect(m.table.rows[0][4]).toBe('—');
    expect(m.table.rows[0][5]).toBe('—');
    expect(m.table.rows[0][7]).toBe('—'); // legacy null paid hours
  });
});

describe('hebrewMonthYear', () => {
  it('maps 1-based months to Hebrew names with the year', () => {
    expect(hebrewMonthYear(1, 2026)).toBe('ינואר 2026');
    expect(hebrewMonthYear(7, 2026)).toBe('יולי 2026');
    expect(hebrewMonthYear(12, 2025)).toBe('דצמבר 2025');
  });
});

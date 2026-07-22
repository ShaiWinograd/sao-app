import { roundToHalfHour } from './customer-report';

// Worker monthly-report pay math (spec §19).
//
// Each worked job/day is paid on hours rounded to the NEAREST HALF HOUR, applied
// PER JOB before the monetary amount is computed and before monthly aggregation
// (mirrors the customer report's per-worker rounding). Exact approved attendance
// is always preserved for display and audit; only the paid amount uses the
// rounded hours. The fixed daily payment is unaffected (it is applied once per
// worked calendar date via `isDailyPaymentEligible`).

export interface WorkerShiftPayInput {
  /** Exact approved attendance hours for the worked job/day. */
  approvedHours: number;
  hourlyWage: number;
  dailyPayment: number;
  /** True on exactly one shift per worked calendar date. */
  isDailyPaymentEligible: boolean;
}

export interface WorkerPayLine {
  /** Exact approved attendance hours (preserved, never rounded). */
  exactHours: number;
  /** Nearest-half-hour hours actually used to compute the amount. */
  paidHours: number;
  hourlyPay: number;
  dailyPay: number;
  pay: number;
}

/** Nearest half hour, half rounds up: Math.round(h * 2) / 2 (e.g. 4.88 → 5.0). */
export function roundPaidHours(exactHours: number): number {
  return roundToHalfHour(exactHours);
}

/**
 * Compute one worked job/day's pay line. The amount is derived from the rounded
 * paid hours; the fixed daily payment is added only when eligible.
 */
export function computeWorkerPayLine(input: WorkerShiftPayInput): WorkerPayLine {
  const exactHours = Number(input.approvedHours) || 0;
  const paidHours = roundPaidHours(exactHours);
  const hourlyPay = paidHours * (Number(input.hourlyWage) || 0);
  const dailyPay = input.isDailyPaymentEligible ? Number(input.dailyPayment) || 0 : 0;
  return { exactHours, paidHours, hourlyPay, dailyPay, pay: hourlyPay + dailyPay };
}

export interface WorkerPayTotals {
  /** Sum of exact approved hours (attendance truth). */
  totalExactHours: number;
  /** Sum of PER-JOB rounded paid hours (not the rounded monthly aggregate). */
  totalPaidHours: number;
  hourlyPay: number;
  dailyPay: number;
  total: number;
}

/** Aggregate pay lines; paid hours are summed per job (already rounded), never re-rounded on the total. */
export function summarizeWorkerPay(lines: WorkerPayLine[]): WorkerPayTotals {
  return lines.reduce<WorkerPayTotals>(
    (acc, l) => ({
      totalExactHours: acc.totalExactHours + l.exactHours,
      totalPaidHours: acc.totalPaidHours + l.paidHours,
      hourlyPay: acc.hourlyPay + l.hourlyPay,
      dailyPay: acc.dailyPay + l.dailyPay,
      total: acc.total + l.pay,
    }),
    { totalExactHours: 0, totalPaidHours: 0, hourlyPay: 0, dailyPay: 0, total: 0 },
  );
}

// ─── Worker-facing projection ─────────────────────────────────────────────────
// Strip the internal money breakdown (hourly rate, subtotals) from a stored or
// freshly-computed report snapshot so the worker UI/PDF only sees the §19.3 line
// and summary. Reads the snapshot VERBATIM — it never recomputes — so a published
// historical version always renders its own immutable stored values. `paidHours`
// / `totalPaidHours` are null on legacy snapshots that predate half-hour rounding.
export function projectWorkerFacingReport(payload: any) {
  const lines = Array.isArray(payload?.shifts) ? payload.shifts : [];
  const summary = payload?.summary ?? {};
  return {
    shifts: lines.map((s: any) => ({
      shiftId: s.shiftId,
      date: s.date,
      customerName: s.customerName,
      jobType: s.jobType,
      jobTypeLabel: s.shiftLabel ?? s.jobTypeLabel ?? '',
      role: s.role ?? null,
      roleLabel: s.roleLabel ?? '',
      clockIn: s.clockIn ?? null,
      clockOut: s.clockOut ?? null,
      approvedHours: s.approvedHours,
      paidHours: s.paidHours ?? null,
      dayTotal: s.pay,
    })),
    summary: {
      workdays: summary.shiftsCount ?? lines.length,
      totalApprovedHours: summary.totalApprovedHours ?? 0,
      totalPaidHours: summary.totalPaidHours ?? null,
      total: summary.total ?? 0,
    },
  };
}

// ─── Worker-facing PDF text ───────────────────────────────────────────────────
// Build the text lines for the worker monthly-report PDF from a stored/computed
// snapshot. Included: worker name, month, publication date, each work line with
// approved clock-in/out and amounts, workday count, total exact hours, total
// paid hours, and the monthly total. EXCLUDED: hourly rate, daily-rate breakdown,
// payment status, paidAt, internal owner notes, and any other worker's data.

export interface WorkerReportPdfMeta {
  workerName: string;
  month: number;
  year: number;
  version: number | null;
  publishedAt?: string | Date | null;
}

function pdfDay(isoDay: string): string {
  const parts = String(isoDay).slice(0, 10).split('-');
  return parts.length === 3 ? `${parts[2]}.${parts[1]}.${parts[0]}` : String(isoDay);
}

function pdfDateTime(value: string | Date): string {
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  const iso = new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
  return pdfDay(iso);
}

export function buildWorkerReportPdfLines(
  meta: WorkerReportPdfMeta,
  projected: ReturnType<typeof projectWorkerFacingReport>,
): string[] {
  const nis = (n: unknown) => `${Number(n).toLocaleString('he-IL')} ₪`;
  const lines: string[] = [];
  lines.push(`עובד/ת: ${meta.workerName}`);
  const versionText = meta.version ? ` · גרסה ${meta.version}` : '';
  const publishedText = meta.publishedAt ? ` · פורסם: ${pdfDateTime(meta.publishedAt)}` : '';
  lines.push(`חודש: ${meta.month}/${meta.year}${versionText}${publishedText}`);
  lines.push('');
  for (const s of projected.shifts) {
    const role = s.roleLabel ? ` · ${s.roleLabel}` : '';
    lines.push(`${pdfDay(s.date)} · ${s.customerName || 'לקוח/ה'} · ${s.jobTypeLabel}${role}`);
    lines.push(`  כניסה: ${s.clockIn ?? '—'} · יציאה: ${s.clockOut ?? '—'}`);
    const paid = s.paidHours != null ? ` · שעות לתשלום: ${s.paidHours}` : '';
    lines.push(`  שעות נוכחות: ${s.approvedHours}${paid} · סכום: ${nis(s.dayTotal)}`);
    lines.push('');
  }
  lines.push(`ימי עבודה: ${projected.summary.workdays}`);
  lines.push(`סה"כ שעות נוכחות: ${projected.summary.totalApprovedHours}`);
  if (projected.summary.totalPaidHours != null) lines.push(`סה"כ שעות לתשלום: ${projected.summary.totalPaidHours}`);
  lines.push(`סה"כ לחודש: ${nis(projected.summary.total)}`);
  return lines;
}

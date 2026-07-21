// Customer report computation (spec §18).
//
// After a case's jobs are completed the owner generates a customer report
// summarising the work and its price. Two billing modes (spec §18.4):
//   • HOURLY — one customer hourly rate for the whole case:
//       total = aggregate approved worker-hours × rate + sum(additions)
//   • GLOBAL — the owner enters the total manually; actual hours are still shown,
//       no hourly rate is displayed.
// Additions (spec §18.5) are free manual line items {description, amount}; there
// are no fixed categories, no discounts, no invoices/payments. Individual worker
// hours and names are never exposed — only per-job worker counts and hours
// (spec §18.7). A per-job owner note is INTERNAL (kept in the snapshot for the
// owner) and is never rendered on the customer-facing PDF.

export type CustomerReportAddition = {
  description: string;
  amount: number;
};

export type CustomerReportJobInput = {
  jobId: string;
  date: string | Date;
  jobType: string;
  // Approved hours for each worker who actually worked this job (backups who
  // worked are included; workers who did not work are excluded — spec §18.7).
  workedHours: number[];
  // Optional INTERNAL owner note; not shown to the customer.
  ownerNote?: string | null;
};

export type CustomerReportPricing =
  | { mode: 'HOURLY'; hourlyRate: number; additions?: CustomerReportAddition[] }
  | { mode: 'GLOBAL'; globalAmount: number };

export type CustomerReportJobLine = {
  jobId: string;
  date: string; // YYYY-MM-DD
  jobType: string;
  workerCount: number;
  // Exact aggregate approved hours for the job (attendance truth, preserved).
  actualHours: number;
  // Customer-billable hours: each worker's approved duration rounded to the
  // nearest 0.5h individually, then summed (spec §18.4 half-hour rounding).
  billableHours: number;
  ownerNote?: string | null;
};

export type CustomerReport = {
  jobs: CustomerReportJobLine[];
  // Exact total (sum of per-job actualHours) — internal truth, never billed on.
  totalActualHours: number;
  // Billable total (sum of per-job billableHours) — customer calculations + PDF.
  totalBillableHours: number;
  mode: 'HOURLY' | 'GLOBAL';
  hourlyRate?: number;
  additions: CustomerReportAddition[];
  additionsTotal: number;
  finalAmount: number;
};

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/**
 * Round a single worker's approved duration to the nearest half hour (0.5).
 * Half rounds up (4.75 → 5.0). Rounding is applied per worker BEFORE aggregating
 * so the customer is billed on clean half-hour units without distorting the
 * exact attendance hours kept internally.
 */
export function roundToHalfHour(n: number): number {
  return Math.round((Number(n) || 0) * 2) / 2;
}

function toDateKey(value: string | Date): string {
  const d = value instanceof Date ? value : new Date(value);
  return d.toISOString().slice(0, 10);
}

function normalizeAdditions(additions?: CustomerReportAddition[]): CustomerReportAddition[] {
  return (additions ?? [])
    .filter((a) => a && ((a.description ?? '').trim() || a.amount))
    .map((a) => ({ description: (a.description ?? '').trim(), amount: round2(Number(a.amount) || 0) }));
}

export function computeCustomerReport(
  jobs: CustomerReportJobInput[],
  pricing: CustomerReportPricing,
): CustomerReport {
  const jobLines: CustomerReportJobLine[] = jobs.map((j) => ({
    jobId: j.jobId,
    date: toDateKey(j.date),
    jobType: j.jobType,
    workerCount: j.workedHours.length,
    actualHours: round2(j.workedHours.reduce((sum, h) => sum + h, 0)),
    // Round each worker's duration to the nearest 0.5h, then sum (per-worker
    // rounding before aggregation).
    billableHours: round2(j.workedHours.reduce((sum, h) => sum + roundToHalfHour(h), 0)),
    ownerNote: j.ownerNote ?? null,
  }));

  const totalActualHours = round2(jobLines.reduce((sum, j) => sum + j.actualHours, 0));
  const totalBillableHours = round2(jobLines.reduce((sum, j) => sum + j.billableHours, 0));

  if (pricing.mode === 'GLOBAL') {
    return {
      jobs: jobLines,
      totalActualHours,
      totalBillableHours,
      mode: 'GLOBAL',
      additions: [],
      additionsTotal: 0,
      finalAmount: round2(pricing.globalAmount),
    };
  }

  const additions = normalizeAdditions(pricing.additions);
  const additionsTotal = round2(additions.reduce((sum, a) => sum + a.amount, 0));
  // Customer is billed on rounded billable hours, not exact attendance hours.
  const base = totalBillableHours * pricing.hourlyRate;
  const finalAmount = round2(base + additionsTotal);

  return {
    jobs: jobLines,
    totalActualHours,
    totalBillableHours,
    mode: 'HOURLY',
    hourlyRate: pricing.hourlyRate,
    additions,
    additionsTotal,
    finalAmount,
  };
}

// ─── Customer-facing PDF layout model (pure, RTL Hebrew) ──────────────────────
// The renderer (packages/api/src/lib/pdf.ts) draws this structured model as a
// right-to-left table; keeping the layout as data makes it unit-testable without
// parsing the binary PDF.

export type CustomerReportPdfModel = {
  title: string;
  subtitle: string[];
  // Columns are listed right-to-left: index 0 renders at the far right.
  table: { headers: string[]; rows: string[][] };
  totals: Array<{ label: string; value: string; emphasis?: boolean }>;
};

const JOB_TYPE_HE_PDF: Record<string, string> = {
  PACKING: 'אריזה',
  UNPACKING: 'פריקה',
  HOME_ORGANIZATION: 'סידור',
};

export function formatShekel(n: number): string {
  // Symbol before the amount so the customer-facing PDF reads "₪ 175".
  return `₪ ${Number(n).toLocaleString('he-IL')}`;
}

export function formatHours(n: number): string {
  return `${Number(n).toLocaleString('he-IL')} שעות`;
}

function toDisplayDate(isoDay: string): string {
  const parts = isoDay.split('-');
  return parts.length === 3 ? `${parts[2]}.${parts[1]}.${parts[0]}` : isoDay;
}

// DD.MM.YYYY with leading zeros (e.g. 22.07.2026), matching the table dates.
function toDisplayDateFromDate(d: Date): string {
  const iso = new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
  return toDisplayDate(iso);
}

export function buildCustomerReportPdfModel(args: {
  customerName: string;
  versionNumber: number;
  generatedAt?: string | Date;
  report: CustomerReport;
}): CustomerReportPdfModel {
  // versionNumber is retained in the signature (and stored in the DB / shown in
  // the management UI), but it is intentionally NOT rendered into the customer
  // PDF — the customer-facing document must never expose internal version text.
  const { customerName, report } = args;
  const generated = args.generatedAt ? new Date(args.generatedAt) : new Date();
  const dateStr = toDisplayDateFromDate(generated);

  const headers = ['תאריך', 'סוג עבודה', 'עובדים', 'שעות לחיוב'];
  const rows = report.jobs.map((j) => [
    toDisplayDate(j.date),
    JOB_TYPE_HE_PDF[j.jobType] ?? j.jobType,
    String(j.workerCount),
    formatHours(j.billableHours),
  ]);

  const totals: Array<{ label: string; value: string; emphasis?: boolean }> = [
    { label: 'סך שעות לחיוב', value: formatHours(report.totalBillableHours) },
  ];
  if (report.mode === 'HOURLY') {
    totals.push({ label: 'תעריף שעתי', value: formatShekel(report.hourlyRate ?? 0) });
    for (const add of report.additions) {
      totals.push({ label: `תוספת — ${add.description || 'ללא תיאור'}`, value: formatShekel(add.amount) });
    }
  }
  totals.push({ label: 'סכום סופי', value: formatShekel(report.finalAmount), emphasis: true });

  return {
    title: 'דוח לקוח',
    subtitle: [`לקוח: ${customerName}`, dateStr],
    table: { headers, rows },
    totals,
  };
}

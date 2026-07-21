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
  actualHours: number;
  ownerNote?: string | null;
};

export type CustomerReport = {
  jobs: CustomerReportJobLine[];
  totalActualHours: number;
  mode: 'HOURLY' | 'GLOBAL';
  hourlyRate?: number;
  additions: CustomerReportAddition[];
  additionsTotal: number;
  finalAmount: number;
};

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
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
    ownerNote: j.ownerNote ?? null,
  }));

  const totalActualHours = round2(jobLines.reduce((sum, j) => sum + j.actualHours, 0));

  if (pricing.mode === 'GLOBAL') {
    return {
      jobs: jobLines,
      totalActualHours,
      mode: 'GLOBAL',
      additions: [],
      additionsTotal: 0,
      finalAmount: round2(pricing.globalAmount),
    };
  }

  const additions = normalizeAdditions(pricing.additions);
  const additionsTotal = round2(additions.reduce((sum, a) => sum + a.amount, 0));
  const base = totalActualHours * pricing.hourlyRate;
  const finalAmount = round2(base + additionsTotal);

  return {
    jobs: jobLines,
    totalActualHours,
    mode: 'HOURLY',
    hourlyRate: pricing.hourlyRate,
    additions,
    additionsTotal,
    finalAmount,
  };
}

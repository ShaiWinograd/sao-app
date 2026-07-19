// Customer report computation (spec §23).
//
// After a project's jobs are completed the owner can generate a customer report
// summarising the work and its price. Two pricing modes are supported: hourly
// (total actual worker-hours × the customer's hourly rate, with optional manual
// additions and discounts) and a fixed global amount. Individual worker hours
// are never shown — only per-job worker counts and the project total.

export type CustomerReportJobInput = {
  jobId: string;
  date: string | Date;
  jobType: string;
  // Approved hours for each worker who actually worked this job (backups who
  // worked are included; workers who did not work are excluded — spec §23.2).
  workedHours: number[];
};

export type CustomerReportPricing =
  | { mode: 'HOURLY'; hourlyRate: number; manualAdditions?: number; discount?: number }
  | { mode: 'GLOBAL'; globalAmount: number };

export type CustomerReportJobLine = {
  jobId: string;
  date: string; // YYYY-MM-DD
  jobType: string;
  workerCount: number;
  actualHours: number;
};

export type CustomerReport = {
  jobs: CustomerReportJobLine[];
  totalActualHours: number;
  mode: 'HOURLY' | 'GLOBAL';
  hourlyRate?: number;
  manualAdditions: number;
  discount: number;
  finalAmount: number;
};

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

function toDateKey(value: string | Date): string {
  const d = value instanceof Date ? value : new Date(value);
  return d.toISOString().slice(0, 10);
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
  }));

  const totalActualHours = round2(jobLines.reduce((sum, j) => sum + j.actualHours, 0));

  if (pricing.mode === 'GLOBAL') {
    return {
      jobs: jobLines,
      totalActualHours,
      mode: 'GLOBAL',
      manualAdditions: 0,
      discount: 0,
      finalAmount: round2(pricing.globalAmount),
    };
  }

  const manualAdditions = pricing.manualAdditions ?? 0;
  const discount = pricing.discount ?? 0;
  const base = totalActualHours * pricing.hourlyRate;
  const finalAmount = round2(base + manualAdditions - discount);

  return {
    jobs: jobLines,
    totalActualHours,
    mode: 'HOURLY',
    hourlyRate: pricing.hourlyRate,
    manualAdditions,
    discount,
    finalAmount,
  };
}

import { FastifyInstance } from 'fastify';
import { prisma } from '../lib/prisma.js';
import { authenticate, requireOwner, requireAdmin } from '../middleware/auth.js';
import { money, round2 } from '../lib/money.js';

type ReportingBasis = 'ACCRUAL' | 'CASH';

type PeriodSummary = {
  completedJobs: number;
  cancelledJobs: number;
  totalJobs: number;
  totalApprovedHours: number;
  invoiced: number;
  collected: number;
  grossRevenue: number;
  outstanding: number;
  hourlyPay: number;
  dailyPayments: number;
  labourTotal: number;
  jobExpenses: number;
  overheadExpenses: number;
  grossProfit: number;
  netProfit: number;
  marginPct: number;
  activeCases: number;
};

type SerializedSummary = {
  workVolume: {
    completedJobs: number;
    cancelledJobs: number;
    totalJobs: number;
    totalApprovedHours: string;
    activeCases: number;
  };
  revenue: {
    total: string;
    invoiced: string;
    collected: string;
    outstanding: string;
  };
  labourCost: {
    hourlyPay: string;
    dailyPayments: string;
    total: string;
  };
  jobExpenses: string;
  overheadExpenses: string;
  profitability: {
    grossRevenue: string;
    grossProfit: string;
    netProfit: string;
    marginPct: string;
  };
};

type MonthlyReportPayload = SerializedSummary & {
  period: { month: number; year: number };
  basis: ReportingBasis;
};

type YearlyMonthlyBreakdownRow = SerializedSummary & {
  month: number;
  label: string;
};

type YearlyReportPayload = SerializedSummary & {
  period: { year: number };
  basis: ReportingBasis;
  monthlyBreakdown: YearlyMonthlyBreakdownRow[];
};

function normalizeBasis(basis?: string): ReportingBasis {
  const normalized = String(basis ?? 'ACCRUAL').trim().toUpperCase();
  return normalized === 'CASH' ? 'CASH' : 'ACCRUAL';
}

function parseMonthYear(month: string, year: string) {
  const m = Number(month);
  const y = Number(year);
  if (!Number.isInteger(m) || m < 1 || m > 12 || !Number.isInteger(y) || y < 2000 || y > 2100) {
    return null;
  }
  return { month: m, year: y };
}

function parseYear(year: string) {
  const y = Number(year);
  if (!Number.isInteger(y) || y < 2000 || y > 2100) return null;
  return y;
}

async function computePeriodSummary(start: Date, end: Date, basis: ReportingBasis): Promise<PeriodSummary> {
  const jobs = await prisma.job.findMany({
    where: { date: { gte: start, lt: end } },
    include: {
      shifts: true,
      expenses: true,
      case: { select: { status: true } },
    },
  });

  const completedJobs = jobs.filter((job: (typeof jobs)[number]) => job.status === 'COMPLETED');
  const nonCancelledJobs = jobs; // All jobs are non-cancelled since we removed CANCELLED status

  let totalHours = 0;
  let totalLabour = 0;
  let totalDaily = 0;

  for (const job of completedJobs) {
    for (const shift of job.shifts) {
      if (shift.attendanceStatus === 'CLOCKED_OUT' || shift.attendanceStatus === 'CORRECTED') {
        const approvedHours = money(shift.approvedHours);
        totalHours += approvedHours;
        totalLabour += approvedHours * money(shift.hourlyWageSnapshot);
        if (shift.isDailyPaymentEligible) {
          totalDaily += money(shift.dailyPaymentSnapshot);
        }
      }
    }
  }

  const totalJobExpenses = nonCancelledJobs
    .flatMap((job: (typeof nonCancelledJobs)[number]) => job.expenses)
    .reduce(
      (sum: number, expense: (typeof nonCancelledJobs)[number]['expenses'][number]) => sum + money(expense.amount),
      0,
    );

  const invoices = await prisma.invoice.findMany({
    where: {
      createdAt: { gte: start, lt: end },
      status: { not: 'CANCELLED' },
    },
    select: { total: true },
  });

  const payments = await prisma.customerPayment.findMany({
    where: { paymentDate: { gte: start, lt: end } },
    select: { amount: true },
  });

  const invoiced = invoices.reduce((sum: number, invoice: (typeof invoices)[number]) => sum + money(invoice.total), 0);
  const collected = payments.reduce(
    (sum: number, payment: (typeof payments)[number]) => sum + money(payment.amount),
    0,
  );
  const grossRevenue = basis === 'CASH' ? collected : invoiced;

  const overheadExpenses = await prisma.businessExpense.findMany({
    where: {
      date: { gte: start, lt: end },
    },
    select: { amount: true },
  });
  const totalOverhead = overheadExpenses.reduce(
    (sum: number, expense: (typeof overheadExpenses)[number]) => sum + money(expense.amount),
    0,
  );

  const labourTotal = totalLabour + totalDaily;
  const grossProfit = grossRevenue - labourTotal - totalJobExpenses;
  const netProfit = grossProfit - totalOverhead;
  const activeCases = new Set(
    nonCancelledJobs
      .map((job: (typeof nonCancelledJobs)[number]) => job.caseId),
  ).size;

  return {
    completedJobs: completedJobs.length,
    cancelledJobs: 0, // No longer tracked since CANCELLED status was removed
    totalJobs: jobs.length,
    totalApprovedHours: totalHours,
    invoiced,
    collected,
    grossRevenue,
    outstanding: Math.max(invoiced - collected, 0),
    hourlyPay: totalLabour,
    dailyPayments: totalDaily,
    labourTotal,
    jobExpenses: totalJobExpenses,
    overheadExpenses: totalOverhead,
    grossProfit,
    netProfit,
    marginPct: grossRevenue > 0 ? (netProfit / grossRevenue) * 100 : 0,
    activeCases,
  };
}

function serializeSummary(summary: PeriodSummary) {
  return {
    workVolume: {
      completedJobs: summary.completedJobs,
      cancelledJobs: summary.cancelledJobs,
      totalJobs: summary.totalJobs,
      totalApprovedHours: round2(summary.totalApprovedHours),
      activeCases: summary.activeCases,
    },
    revenue: {
      total: round2(summary.grossRevenue),
      invoiced: round2(summary.invoiced),
      collected: round2(summary.collected),
      outstanding: round2(summary.outstanding),
    },
    labourCost: {
      hourlyPay: round2(summary.hourlyPay),
      dailyPayments: round2(summary.dailyPayments),
      total: round2(summary.labourTotal),
    },
    jobExpenses: round2(summary.jobExpenses),
    overheadExpenses: round2(summary.overheadExpenses),
    profitability: {
      grossRevenue: round2(summary.grossRevenue),
      grossProfit: round2(summary.grossProfit),
      netProfit: round2(summary.netProfit),
      marginPct: round2(summary.marginPct),
    },
  };
}

async function buildMonthlyReportPayload(month: number, year: number, basis: ReportingBasis): Promise<MonthlyReportPayload> {
  const start = new Date(year, month - 1, 1);
  const end = new Date(year, month, 1);
  const summary = await computePeriodSummary(start, end, basis);
  return {
    period: { month, year },
    basis,
    ...serializeSummary(summary),
  };
}

async function buildYearlyReportPayload(year: number, basis: ReportingBasis): Promise<YearlyReportPayload> {
  const monthlyBreakdown: YearlyMonthlyBreakdownRow[] = [];

  let aggregate: PeriodSummary = {
    completedJobs: 0,
    cancelledJobs: 0, // No longer tracked since CANCELLED status was removed
    totalJobs: 0,
    totalApprovedHours: 0,
    invoiced: 0,
    collected: 0,
    grossRevenue: 0,
    outstanding: 0,
    hourlyPay: 0,
    dailyPayments: 0,
    labourTotal: 0,
    jobExpenses: 0,
    overheadExpenses: 0,
    grossProfit: 0,
    netProfit: 0,
    marginPct: 0,
    activeCases: 0,
  };

  for (let month = 1; month <= 12; month += 1) {
    const start = new Date(year, month - 1, 1);
    const end = new Date(year, month, 1);
    const summary = await computePeriodSummary(start, end, basis);
    const serialized = serializeSummary(summary);

    monthlyBreakdown.push({
      month,
      label: `${String(month).padStart(2, '0')}/${year}`,
      ...serialized,
    });

    aggregate = {
      completedJobs: aggregate.completedJobs + summary.completedJobs,
      cancelledJobs: 0, // No longer tracked
      totalJobs: aggregate.totalJobs + summary.totalJobs,
      totalApprovedHours: aggregate.totalApprovedHours + summary.totalApprovedHours,
      invoiced: aggregate.invoiced + summary.invoiced,
      collected: aggregate.collected + summary.collected,
      grossRevenue: aggregate.grossRevenue + summary.grossRevenue,
      outstanding: aggregate.outstanding + summary.outstanding,
      hourlyPay: aggregate.hourlyPay + summary.hourlyPay,
      dailyPayments: aggregate.dailyPayments + summary.dailyPayments,
      labourTotal: aggregate.labourTotal + summary.labourTotal,
      jobExpenses: aggregate.jobExpenses + summary.jobExpenses,
      overheadExpenses: aggregate.overheadExpenses + summary.overheadExpenses,
      grossProfit: aggregate.grossProfit + summary.grossProfit,
      netProfit: aggregate.netProfit + summary.netProfit,
      marginPct: 0,
      activeCases: aggregate.activeCases + summary.activeCases,
    };
  }

  aggregate.marginPct = aggregate.grossRevenue > 0 ? (aggregate.netProfit / aggregate.grossRevenue) * 100 : 0;

  return {
    period: { year },
    basis,
    ...serializeSummary(aggregate),
    monthlyBreakdown,
  };
}

function asHebrewBasis(basis: ReportingBasis) {
  return basis === 'CASH' ? 'מזומן' : 'מצטבר';
}

function csvEscape(value: string | number) {
  const normalized = String(value ?? '');
  if (/[",\n]/.test(normalized)) {
    return `"${normalized.replace(/"/g, '""')}"`;
  }
  return normalized;
}

function toCsv(rows: Array<Array<string | number>>) {
  return `\uFEFF${rows.map((row) => row.map(csvEscape).join(',')).join('\n')}\n`;
}

function buildMonthlyCsv(report: MonthlyReportPayload) {
  return toCsv([
    ['דוח ניהולי חודשי', `${String(report.period.month).padStart(2, '0')}/${report.period.year}`],
    ['בסיס דיווח', asHebrewBasis(report.basis)],
    [],
    ['מדד', 'ערך'],
    ['הכנסה ברוטו', report.profitability.grossRevenue],
    ['רווח גולמי', report.profitability.grossProfit],
    ['רווח נקי', report.profitability.netProfit],
    ['שולי רווח (%)', report.profitability.marginPct],
    ['סה״כ חשבוניות', report.revenue.invoiced],
    ['סה״כ תשלומים שהתקבלו', report.revenue.collected],
    ['יתרה פתוחה', report.revenue.outstanding],
    ['עלות שכר (כולל יומי)', report.labourCost.total],
    ['הוצאות ישירות', report.jobExpenses],
    ['הוצאות תקורה', report.overheadExpenses],
    ['תיקים פעילים', report.workVolume.activeCases],
    ['עבודות שהושלמו', report.workVolume.completedJobs],
    ['סה״כ עבודות', report.workVolume.totalJobs],
    ['סה״כ שעות מאושרות', report.workVolume.totalApprovedHours],
  ]);
}

function buildYearlyCsv(report: YearlyReportPayload) {
  const rows: Array<Array<string | number>> = [
    ['דוח ניהולי שנתי', String(report.period.year)],
    ['בסיס דיווח', asHebrewBasis(report.basis)],
    [],
    ['מדד', 'ערך'],
    ['הכנסה ברוטו', report.profitability.grossRevenue],
    ['רווח גולמי', report.profitability.grossProfit],
    ['רווח נקי', report.profitability.netProfit],
    ['שולי רווח (%)', report.profitability.marginPct],
    ['סה״כ חשבוניות', report.revenue.invoiced],
    ['סה״כ תשלומים שהתקבלו', report.revenue.collected],
    ['יתרה פתוחה', report.revenue.outstanding],
    ['עלות שכר (כולל יומי)', report.labourCost.total],
    ['הוצאות ישירות', report.jobExpenses],
    ['הוצאות תקורה', report.overheadExpenses],
    ['תיקים פעילים (מצטבר)', report.workVolume.activeCases],
    ['עבודות שהושלמו (מצטבר)', report.workVolume.completedJobs],
    [],
    ['פירוט חודשי', '', '', '', ''],
    ['חודש', 'הכנסה ברוטו', 'רווח נקי', 'שולי רווח (%)', 'עבודות שהושלמו'],
  ];

  for (const monthRow of report.monthlyBreakdown) {
    rows.push([
      monthRow.label,
      monthRow.profitability.grossRevenue,
      monthRow.profitability.netProfit,
      monthRow.profitability.marginPct,
      monthRow.workVolume.completedJobs,
    ]);
  }

  return toCsv(rows);
}

async function buildPdfFromLines(title: string, subtitle: string, lines: string[]) {
  const PDFDocument = (await import('pdfkit')).default as any;
  const doc = new PDFDocument({ size: 'A4', margin: 40 });
  const chunks: Buffer[] = [];

  return await new Promise<Buffer>((resolve, reject) => {
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    doc.fontSize(18).text(title);
    doc.moveDown(0.3);
    doc.fontSize(11).fillColor('#555555').text(subtitle);
    doc.moveDown(1);
    doc.fillColor('#111111').fontSize(11);

    for (const line of lines) {
      doc.text(line);
    }
    doc.end();
  });
}

function buildMonthlyPdfLines(report: MonthlyReportPayload) {
  return [
    `Reporting basis: ${report.basis}`,
    `Gross revenue: ${report.profitability.grossRevenue}`,
    `Gross profit: ${report.profitability.grossProfit}`,
    `Net profit: ${report.profitability.netProfit}`,
    `Profit margin (%): ${report.profitability.marginPct}`,
    `Invoiced: ${report.revenue.invoiced}`,
    `Collected: ${report.revenue.collected}`,
    `Outstanding: ${report.revenue.outstanding}`,
    `Labour total: ${report.labourCost.total}`,
    `Direct expenses: ${report.jobExpenses}`,
    `Overhead expenses: ${report.overheadExpenses}`,
    `Active cases: ${report.workVolume.activeCases}`,
    `Completed jobs: ${report.workVolume.completedJobs}`,
    `Total approved hours: ${report.workVolume.totalApprovedHours}`,
  ];
}

function buildYearlyPdfLines(report: YearlyReportPayload) {
  const lines = [
    `Reporting basis: ${report.basis}`,
    `Gross revenue: ${report.profitability.grossRevenue}`,
    `Gross profit: ${report.profitability.grossProfit}`,
    `Net profit: ${report.profitability.netProfit}`,
    `Profit margin (%): ${report.profitability.marginPct}`,
    `Invoiced: ${report.revenue.invoiced}`,
    `Collected: ${report.revenue.collected}`,
    `Outstanding: ${report.revenue.outstanding}`,
    `Labour total: ${report.labourCost.total}`,
    `Direct expenses: ${report.jobExpenses}`,
    `Overhead expenses: ${report.overheadExpenses}`,
    'Monthly breakdown:',
  ];

  for (const monthRow of report.monthlyBreakdown) {
    lines.push(
      `${monthRow.label} | revenue: ${monthRow.profitability.grossRevenue} | net: ${monthRow.profitability.netProfit} | margin: ${monthRow.profitability.marginPct}%`,
    );
  }

  return lines;
}

export async function reportsRoutes(app: FastifyInstance) {
  app.get('/monthly', { preHandler: [authenticate, requireOwner] }, async (req, reply) => {
    const { month, year, basis } = req.query as { month: string; year: string; basis?: string };
    const monthYear = parseMonthYear(month, year);
    if (!monthYear) {
      return reply.status(400).send({ error: 'month/year must be valid numbers' });
    }

    const selectedBasis = normalizeBasis(basis);
    return await buildMonthlyReportPayload(monthYear.month, monthYear.year, selectedBasis);
  });

  app.get('/yearly', { preHandler: [authenticate, requireOwner] }, async (req, reply) => {
    const { year, basis } = req.query as { year: string; basis?: string };
    const selectedYear = parseYear(year);
    if (!selectedYear) {
      return reply.status(400).send({ error: 'year must be a valid number' });
    }

    const selectedBasis = normalizeBasis(basis);
    return await buildYearlyReportPayload(selectedYear, selectedBasis);
  });

  app.get('/export/monthly.csv', { preHandler: [authenticate, requireOwner] }, async (req, reply) => {
    const { month, year, basis } = req.query as { month: string; year: string; basis?: string };
    const monthYear = parseMonthYear(month, year);
    if (!monthYear) {
      return reply.status(400).send({ error: 'month/year must be valid numbers' });
    }

    const selectedBasis = normalizeBasis(basis);
    const report = await buildMonthlyReportPayload(monthYear.month, monthYear.year, selectedBasis);
    const csv = buildMonthlyCsv(report);
    const fileName = `management-report-${monthYear.year}-${String(monthYear.month).padStart(2, '0')}.csv`;

    reply.header('Content-Type', 'text/csv; charset=utf-8');
    reply.header('Content-Disposition', `attachment; filename="${fileName}"`);
    return reply.send(csv);
  });

  app.get('/export/yearly.csv', { preHandler: [authenticate, requireOwner] }, async (req, reply) => {
    const { year, basis } = req.query as { year: string; basis?: string };
    const selectedYear = parseYear(year);
    if (!selectedYear) {
      return reply.status(400).send({ error: 'year must be a valid number' });
    }

    const selectedBasis = normalizeBasis(basis);
    const report = await buildYearlyReportPayload(selectedYear, selectedBasis);
    const csv = buildYearlyCsv(report);
    const fileName = `management-report-${selectedYear}.csv`;

    reply.header('Content-Type', 'text/csv; charset=utf-8');
    reply.header('Content-Disposition', `attachment; filename="${fileName}"`);
    return reply.send(csv);
  });

  app.get('/export/monthly.pdf', { preHandler: [authenticate, requireOwner] }, async (req, reply) => {
    const { month, year, basis } = req.query as { month: string; year: string; basis?: string };
    const monthYear = parseMonthYear(month, year);
    if (!monthYear) {
      return reply.status(400).send({ error: 'month/year must be valid numbers' });
    }

    const selectedBasis = normalizeBasis(basis);
    const report = await buildMonthlyReportPayload(monthYear.month, monthYear.year, selectedBasis);
    const pdf = await buildPdfFromLines(
      'Monthly Management Report',
      `${String(monthYear.month).padStart(2, '0')}/${monthYear.year}`,
      buildMonthlyPdfLines(report),
    );
    const fileName = `management-report-${monthYear.year}-${String(monthYear.month).padStart(2, '0')}.pdf`;

    reply.header('Content-Type', 'application/pdf');
    reply.header('Content-Disposition', `attachment; filename="${fileName}"`);
    return reply.send(pdf);
  });

  app.get('/export/yearly.pdf', { preHandler: [authenticate, requireOwner] }, async (req, reply) => {
    const { year, basis } = req.query as { year: string; basis?: string };
    const selectedYear = parseYear(year);
    if (!selectedYear) {
      return reply.status(400).send({ error: 'year must be a valid number' });
    }

    const selectedBasis = normalizeBasis(basis);
    const report = await buildYearlyReportPayload(selectedYear, selectedBasis);
    const pdf = await buildPdfFromLines(
      'Yearly Management Report',
      String(selectedYear),
      buildYearlyPdfLines(report),
    );
    const fileName = `management-report-${selectedYear}.pdf`;

    reply.header('Content-Type', 'application/pdf');
    reply.header('Content-Disposition', `attachment; filename="${fileName}"`);
    return reply.send(pdf);
  });

  app.post('/month-close', { preHandler: [authenticate, requireOwner] }, async (req, reply) => {
    const { month, year, notes } = req.body as { month: number; year: number; notes?: string };
    const user = (req as any).user;
    return prisma.monthClose.upsert({
      where: { month_year: { month, year } },
      update: { closedById: user.id, closedAt: new Date(), notes },
      create: { month, year, closedById: user.id, notes },
    });
  });

  app.post('/month-reopen', { preHandler: [authenticate, requireOwner] }, async (req, reply) => {
    const { month, year } = req.body as { month: number; year: number };
    const user = (req as any).user;
    return prisma.monthClose.update({
      where: { month_year: { month, year } },
      data: { reopenedById: user.id, reopenedAt: new Date() },
    });
  });

  app.get('/month-status', { preHandler: [authenticate, requireAdmin] }, async (req, reply) => {
    const { month, year } = req.query as { month: string; year: string };
    const close = await prisma.monthClose.findUnique({
      where: { month_year: { month: Number(month), year: Number(year) } },
    });
    return { isClosed: !!close, closedAt: close?.closedAt ?? null };
  });
}

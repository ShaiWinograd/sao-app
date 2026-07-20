import { Prisma } from '@prisma/client';
import { FastifyInstance } from 'fastify';
import { prisma } from '../lib/prisma.js';
import { deleteCaseCascade } from '../lib/deleteCase.js';
import { buildLinesPdf } from '../lib/pdf.js';
import { authenticate, requireAdmin } from '../middleware/auth.js';
import {
  CaseStatusSchema,
  computeCustomerReport,
  deriveProjectStatus,
} from '@workforce/shared';
import { subDays } from 'date-fns';
import { z } from 'zod';

// CustomerCase is an internal grouping entity (spec §10): jobs are auto-grouped
// into an open case, and cases back customer reports + history. There is no
// owner-facing create/manage-project workflow — only report + grouping support.

const CasesListQuerySchema = z.object({
  customerId: z.string().optional(),
  status: CaseStatusSchema.optional(),
});

// Customer report pricing (spec §18): hourly (rate × total actual worker-hours,
// with optional manual additions and discount) or a fixed global amount.
const CustomerReportPricingSchema = z.union([
  z.object({
    mode: z.literal('HOURLY'),
    hourlyRate: z.number().nonnegative(),
    manualAdditions: z.number().optional(),
    discount: z.number().optional(),
  }),
  z.object({
    mode: z.literal('GLOBAL'),
    globalAmount: z.number().nonnegative(),
  }),
]);

const JOB_TYPE_HE_LABEL: Record<string, string> = {
  PACKING: 'אריזה',
  UNPACKING: 'פריקה',
  HOME_ORGANIZATION: 'סידור',
};

// Build the customer-report payload for a case: per-job worker counts and actual
// worker-hours (backups who worked included; individual hours never exposed).
async function buildCustomerReportForCase(
  caseId: string,
  pricing: z.infer<typeof CustomerReportPricingSchema>,
) {
  const kase = await prisma.customerCase.findUnique({
    where: { id: caseId },
    include: {
      customer: { select: { firstName: true, lastName: true } },
      jobs: {
        orderBy: { date: 'asc' },
        include: {
          shifts: { select: { joinRequestStatus: true, approvedHours: true } },
        },
      },
    },
  });
  if (!kase) return null;

  const jobInputs = kase.jobs.map((job) => ({
    jobId: job.id,
    date: job.date,
    jobType: job.jobType,
    // A worker counts as having worked when they have approved billable hours.
    workedHours: job.shifts
      .filter((s) => s.joinRequestStatus === 'APPROVED' && s.approvedHours != null)
      .map((s) => Number(s.approvedHours)),
  }));

  const report = computeCustomerReport(jobInputs, pricing);
  const allJobsCompleted = kase.jobs.length > 0 && kase.jobs.every((j) => j.status === 'COMPLETED');

  return {
    customerName: `${kase.customer.firstName} ${kase.customer.lastName}`.trim(),
    projectName: kase.name,
    generatedAt: new Date().toISOString(),
    allJobsCompleted,
    report,
  };
}

export async function casesRoutes(app: FastifyInstance) {
  // List cases (filtered by customer or status) — supports customer history.
  app.get('/', { preHandler: [authenticate, requireAdmin] }, async (req, reply) => {
    const parseResult = CasesListQuerySchema.safeParse(req.query);
    if (!parseResult.success) {
      return reply.status(400).send({ error: 'Invalid cases query parameters' });
    }

    const { customerId, status } = parseResult.data;
    const cases = await prisma.customerCase.findMany({
      where: {
        ...(customerId ? { customerId } : {}),
        ...(status ? { status } : {}),
      },
      include: {
        customer: { select: { id: true, firstName: true, lastName: true, phone: true, email: true } },
        assignedAdmin: { select: { firstName: true, lastName: true } },
        jobs: {
          select: {
            id: true,
            date: true,
            status: true,
            jobType: true,
            requiredWorkerCount: true,
            address: { select: { fullAddress: true } },
          },
        },
      },
      orderBy: { updatedAt: 'desc' },
    });
    return cases.map((kase) => ({
      ...kase,
      derivedStatus: deriveProjectStatus(kase.jobs.map((j) => j.status)),
    }));
  });

  // Get single case (customer history / report context)
  app.get('/:id', { preHandler: [authenticate, requireAdmin] }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const kase = await prisma.customerCase.findUnique({
      where: { id },
      include: {
        customer: { include: { addresses: true } },
        jobs: { include: { address: true, shifts: { include: { worker: true } } } },
        assignedAdmin: { select: { id: true, firstName: true, lastName: true } },
      },
    });
    if (!kase) return reply.status(404).send({ error: 'Case not found' });
    return { ...kase, derivedStatus: deriveProjectStatus(kase.jobs.map((j) => j.status)) };
  });

  // Case hub summary for operational readiness + final report trigger
  app.get('/:id/hub', { preHandler: [authenticate, requireAdmin] }, async (req, reply) => {
    const { id } = req.params as { id: string };

    const kase = await prisma.customerCase.findUnique({
      where: { id },
      include: {
        customer: { select: { firstName: true, lastName: true } },
        jobs: {
          include: {
            shifts: {
              select: {
                id: true,
                attendanceStatus: true,
                formStatus: true,
                actualEnd: true,
                workerNameSnapshot: true,
              },
            },
          },
          orderBy: { date: 'asc' },
        },
      },
    });

    if (!kase) return reply.status(404).send({ error: 'Case not found' });

    const jobIds = kase.jobs.map((job: (typeof kase.jobs)[number]) => job.id);
    const linkedForms = await prisma.formSubmission.findMany({
      where: { shift: { jobId: { in: jobIds } } },
      include: {
        shift: {
          include: {
            worker: { select: { firstName: true, lastName: true } },
            job: { select: { date: true, jobType: true } },
          },
        },
      },
      orderBy: { submittedAt: 'desc' },
    });

    const totalShifts = kase.jobs.reduce((sum: number, job: (typeof kase.jobs)[number]) => sum + job.shifts.length, 0);
    const closedShifts = kase.jobs.reduce(
      (sum: number, job: (typeof kase.jobs)[number]) =>
        sum +
        job.shifts.filter(
          (shift: (typeof job.shifts)[number]) =>
            shift.attendanceStatus === 'CLOCKED_OUT' || shift.attendanceStatus === 'AUTO_CLOCKED_OUT',
        ).length,
      0,
    );
    const completedOrCancelledJobs = kase.jobs.filter(
      (job: (typeof kase.jobs)[number]) => job.status === 'COMPLETED' || job.status === 'ARCHIVED',
    ).length;
    const readyForFinalReport =
      kase.jobs.length > 0 &&
      completedOrCancelledJobs === kase.jobs.length &&
      totalShifts > 0 &&
      closedShifts === totalShifts &&
      linkedForms.length >= totalShifts;

    return {
      caseId: kase.id,
      caseName: kase.name,
      customerName: `${kase.customer.firstName} ${kase.customer.lastName}`.trim(),
      status: kase.status,
      checklist: {
        totalJobs: kase.jobs.length,
        completedOrCancelledJobs,
        totalShifts,
        closedShifts,
        linkedForms: linkedForms.length,
      },
      readyForFinalReport,
      forms: linkedForms.map((form: (typeof linkedForms)[number]) => ({
        id: form.id,
        shiftId: form.shiftId,
        completionStatus: form.completionStatus,
        submittedAt: form.submittedAt,
        managerNote: form.managerNote,
        workerName: `${form.shift.worker.firstName} ${form.shift.worker.lastName}`.trim(),
        jobType: form.shift.job.jobType,
        shiftDate: form.shift.job.date,
      })),
    };
  });

  /**
   * Smart case lookup for new job creation (spec §10.1):
   * Returns ACTIVE case or recently completed case (within configured days).
   */
  app.get('/match-for-customer/:customerId', { preHandler: [authenticate, requireAdmin] }, async (req, reply) => {
    const { customerId } = req.params as { customerId: string };
    const setting = await prisma.appSetting.findUnique({ where: { key: 'CASE_REOPEN_DAYS' } });
    const days = Number(setting?.value ?? 60);

    const activeCase = await prisma.customerCase.findFirst({
      where: { customerId, status: 'ACTIVE' },
      orderBy: { updatedAt: 'desc' },
    });
    if (activeCase) return { match: 'ACTIVE', case: activeCase };

    const recentCase = await prisma.customerCase.findFirst({
      where: {
        customerId,
        status: 'COMPLETED',
        latestActivityDate: { gte: subDays(new Date(), days) },
      },
      orderBy: { latestActivityDate: 'desc' },
    });
    if (recentCase) return { match: 'RECENT', case: recentCase };

    return { match: 'NONE', case: null };
  });

  // Permanently delete a case and all of its dependent records (dev/test only).
  app.delete('/:id', { preHandler: [authenticate, requireAdmin] }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const kase = await prisma.customerCase.findUnique({ where: { id }, select: { id: true } });
    if (!kase) return reply.status(404).send({ error: 'Case not found' });

    await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      await deleteCaseCascade(tx, id);
    });

    reply.status(204);
    return null;
  });

  // Customer report preview (spec §18). Returns computed totals for the editor.
  app.post('/:id/customer-report', { preHandler: [authenticate, requireAdmin] }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const pricing = CustomerReportPricingSchema.parse(req.body);
    const payload = await buildCustomerReportForCase(id, pricing);
    if (!payload) return reply.status(404).send({ error: 'Case not found' });
    return payload;
  });

  // Customer report PDF download (spec §18.6).
  app.post('/:id/customer-report.pdf', { preHandler: [authenticate, requireAdmin] }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const pricing = CustomerReportPricingSchema.parse(req.body);
    const payload = await buildCustomerReportForCase(id, pricing);
    if (!payload) return reply.status(404).send({ error: 'Case not found' });

    const { report } = payload;
    const money = (n: number) => `${n.toLocaleString('he-IL')} ₪`;
    const lines: string[] = [];
    lines.push(`לקוח: ${payload.customerName}`);
    lines.push(`פרויקט: ${payload.projectName}`);
    lines.push('');
    lines.push('עבודות:');
    for (const job of report.jobs) {
      lines.push(
        `  ${job.date} · ${JOB_TYPE_HE_LABEL[job.jobType] ?? job.jobType} · ${job.workerCount} עובדים · ${job.actualHours} שעות`,
      );
    }
    lines.push('');
    lines.push(`סך שעות עבודה בפועל: ${report.totalActualHours}`);
    if (report.mode === 'HOURLY') {
      lines.push(`תעריף שעתי: ${money(report.hourlyRate ?? 0)}`);
      if (report.manualAdditions) lines.push(`תוספות: ${money(report.manualAdditions)}`);
      if (report.discount) lines.push(`הנחה: ${money(report.discount)}`);
    }
    lines.push(`סכום סופי: ${money(report.finalAmount)}`);

    const pdf = await buildLinesPdf('דוח לקוח', payload.projectName, lines);
    const fileName = `customer-report-${id}.pdf`;
    reply.header('Content-Type', 'application/pdf');
    reply.header('Content-Disposition', `attachment; filename="${fileName}"`);
    return reply.send(pdf);
  });
}

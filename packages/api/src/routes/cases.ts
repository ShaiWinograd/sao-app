import { Prisma } from '@prisma/client';
import { FastifyInstance } from 'fastify';
import { prisma } from '../lib/prisma.js';
import { deleteCaseCascade } from '../lib/deleteCase.js';
import { buildLinesPdf } from '../lib/pdf.js';
import { authenticate, requireAdmin } from '../middleware/auth.js';
import { CaseStatusSchema, deriveProjectStatus } from '@workforce/shared';
import {
  getCaseReadiness,
  previewCustomerReport,
  finalizeCustomerReport,
  createCorrectedVersion,
  snapshotToPdfLines,
  listReportsOverview,
  type ReportEditorInput,
  type ReportSnapshot,
} from '../domain/customerReport.js';
import { z } from 'zod';

// CustomerCase is an internal grouping entity (spec §10): jobs are auto-grouped
// into an open case, and cases back customer reports + history. There is no
// owner-facing create/manage-project workflow — only report + grouping support.

const CasesListQuerySchema = z.object({
  customerId: z.string().optional(),
  status: CaseStatusSchema.optional(),
});

// Customer report editor input (spec §18): billing mode (hourly with a single
// case rate + manual addition line items, or a fixed global amount), the jobs to
// include (default = all completed), and optional INTERNAL per-job owner notes.
const AdditionSchema = z.object({ description: z.string().default(''), amount: z.number() });
const PricingSchema = z.union([
  z.object({ mode: z.literal('HOURLY'), hourlyRate: z.number().nonnegative(), additions: z.array(AdditionSchema).optional() }),
  z.object({ mode: z.literal('GLOBAL'), globalAmount: z.number().nonnegative() }),
]);
const ReportEditorSchema = z.object({
  pricing: PricingSchema,
  includedJobIds: z.array(z.string()).optional(),
  jobNotes: z.record(z.string()).optional(),
});

export async function casesRoutes(app: FastifyInstance) {
  // Customer-report hub (spec §18.2/§18.14): ready ACTIVE cases + finalized ones.
  // Optional ?customerId= scopes it to a single customer (customer-details entry).
  app.get('/reports-overview', { preHandler: [authenticate, requireAdmin] }, async (req) => {
    const { customerId } = (req.query ?? {}) as { customerId?: string };
    return listReportsOverview(prisma, customerId);
  });

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
    // Readiness is derived (spec §18.1) and does NOT depend on end-of-job forms.
    const readiness = await getCaseReadiness(prisma, id);

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
      readyForFinalReport: readiness.ready,
      readinessReasons: readiness.reasons,
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

  // Customer report preview (spec §18.3/§18.8): compute totals for the editor
  // WITHOUT persisting. Works for an ACTIVE case (draft) or a CLOSED case
  // (correction — the same bound jobs re-priced).
  app.post('/:id/customer-report/preview', { preHandler: [authenticate, requireAdmin] }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const input = ReportEditorSchema.parse(req.body) as ReportEditorInput;
    const readiness = await getCaseReadiness(prisma, id);
    const preview = await previewCustomerReport(prisma, id, input);
    return { ...preview, readiness };
  });

  // Finalize the customer report (spec §18.9): immutable version + close case +
  // mark included jobs reported + move excluded completed jobs to a new case.
  // Fully atomic + per-case advisory lock (concurrent finalize → 409).
  app.post('/:id/customer-report/finalize', { preHandler: [authenticate, requireAdmin] }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const input = ReportEditorSchema.parse(req.body) as ReportEditorInput;
    const version = await finalizeCustomerReport(id, input, (req as any).user);
    reply.status(201);
    return { versionId: version.id, versionNumber: version.versionNumber };
  });

  // Create a corrected version of an already-finalized report (spec §18.10).
  // Preserves all previous versions; same bound jobs (no double billing).
  app.post('/:id/customer-report/versions', { preHandler: [authenticate, requireAdmin] }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const input = ReportEditorSchema.parse(req.body) as ReportEditorInput;
    const version = await createCorrectedVersion(id, input, (req as any).user);
    reply.status(201);
    return { versionId: version.id, versionNumber: version.versionNumber };
  });

  // Version history (spec §18.10): all finalized versions, latest = current.
  app.get('/:id/customer-report/versions', { preHandler: [authenticate, requireAdmin] }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const versions = await prisma.customerReportVersion.findMany({
      where: { caseId: id },
      orderBy: { versionNumber: 'desc' },
      select: { id: true, versionNumber: true, status: true, createdAt: true, snapshot: true },
    });
    return versions.map((v, i) => ({
      id: v.id,
      versionNumber: v.versionNumber,
      status: v.status,
      createdAt: v.createdAt,
      finalAmount: (v.snapshot as any)?.report?.finalAmount ?? null,
      isCurrent: i === 0,
    }));
  });

  // Download a finalized version's PDF, rendered from the stored snapshot (spec
  // §18.8) — never regenerated from mutable live job data.
  app.get('/:id/customer-report/versions/:versionId/pdf', { preHandler: [authenticate, requireAdmin] }, async (req, reply) => {
    const { id, versionId } = req.params as { id: string; versionId: string };
    const version = await prisma.customerReportVersion.findFirst({ where: { id: versionId, caseId: id } });
    if (!version) return reply.status(404).send({ error: 'Report version not found' });
    const snapshot = version.snapshot as unknown as ReportSnapshot;
    // Durable artifact (spec §18.8): serve the exact PDF bytes finalized at that
    // time so template/renderer changes never alter an old finalized document.
    // Fall back to snapshot rendering only for legacy rows without stored bytes.
    const pdf = version.pdf ?? (await buildLinesPdf('דוח לקוח', snapshot.customerName, snapshotToPdfLines(snapshot)));
    reply.header('Content-Type', 'application/pdf');
    reply.header('Content-Disposition', `attachment; filename="customer-report-${id}-v${snapshot.versionNumber}.pdf"`);
    return reply.send(pdf);
  });
}

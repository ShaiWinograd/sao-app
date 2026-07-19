import { Prisma } from '@prisma/client';
import { FastifyInstance } from 'fastify';
import { prisma } from '../lib/prisma.js';
import { resolveActor } from '../lib/actor.js';
import { deleteCaseCascade } from '../lib/deleteCase.js';
import { authenticate, requireAdmin } from '../middleware/auth.js';
import {
  CaseStatusSchema,
  CreateCaseSchema,
  UpdateCaseSchema,
  canTransitionCaseStatus,
  getAllowedCaseTransitions,
  groupCasesIntoBoard,
  type CaseStatusValue,
} from '@workforce/shared';
import { subDays } from 'date-fns';
import { z } from 'zod';

const CasesListQuerySchema = z.object({
  customerId: z.string().optional(),
  status: CaseStatusSchema.optional(),
});

const ArchiveCaseSchema = z.object({
  reason: z.string().min(3, 'Reason is required'),
});

const CaseCommunicationTemplateSchema = z.enum(['quote', 'packing_form', 'move_reminder', 'completion_summary']);
const CaseCommunicationChannelSchema = z.enum(['whatsapp', 'email']);

const CreateCaseCommunicationSchema = z.object({
  templateKey: CaseCommunicationTemplateSchema,
  channel: CaseCommunicationChannelSchema,
  recipient: z.string().min(1, 'Recipient is required'),
  preview: z.string().min(1, 'Preview is required'),
});

type CaseCommunicationAuditLog = {
  id: string;
  newValue: unknown;
  createdAt: Date;
  performedBy: {
    firstName: string;
    lastName: string;
  };
};

export async function casesRoutes(app: FastifyInstance) {
  // List cases (filtered by customer or status)
  app.get('/', { preHandler: [authenticate, requireAdmin] }, async (req, reply) => {
    const parseResult = CasesListQuerySchema.safeParse(req.query);
    if (!parseResult.success) {
      return reply.status(400).send({ error: 'Invalid cases query parameters' });
    }

    const { customerId, status } = parseResult.data;
    return prisma.customerCase.findMany({
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
  });

  // Projects kanban board: cases grouped into lifecycle tabs/columns.
  app.get('/board', { preHandler: [authenticate, requireAdmin] }, async (req, reply) => {
    const cases = await prisma.customerCase.findMany({
      select: {
        id: true,
        name: true,
        status: true,
        latestActivityDate: true,
        updatedAt: true,
        customer: { select: { firstName: true, lastName: true } },
        jobs: { select: { id: true, date: true, jobType: true, status: true } },
      },
      orderBy: { updatedAt: 'desc' },
    });

    return groupCasesIntoBoard(
      cases.map((kase) => ({ ...kase, status: kase.status as CaseStatusValue })),
    );
  });

  // Get single case
  app.get('/:id', { preHandler: [authenticate, requireAdmin] }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const kase = await prisma.customerCase.findUnique({
      where: { id },
      include: {
        customer: { include: { addresses: true } },
        jobs: { include: { address: true, shifts: { include: { worker: true } } } },
        invoices: true,
        assignedAdmin: { select: { id: true, firstName: true, lastName: true } },
      },
    });
    if (!kase) return reply.status(404).send({ error: 'Case not found' });
    return kase;
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

  // List project communication send history (shared across devices)
  app.get('/:id/communications', { preHandler: [authenticate, requireAdmin] }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const kase = await prisma.customerCase.findUnique({ where: { id }, select: { id: true } });
    if (!kase) return reply.status(404).send({ error: 'Case not found' });

    const logs = await prisma.auditLog.findMany({
      where: {
        entityType: 'CustomerCaseCommunication',
        entityId: id,
      },
      include: {
        performedBy: { select: { firstName: true, lastName: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });

    return (logs as CaseCommunicationAuditLog[]).map((log: CaseCommunicationAuditLog) => {
      const newValue = (log.newValue ?? {}) as Record<string, unknown>;
      return {
        id: log.id,
        caseId: id,
        templateKey: String(newValue.templateKey ?? 'quote'),
        channel: String(newValue.channel ?? 'whatsapp'),
        recipient: String(newValue.recipient ?? ''),
        preview: String(newValue.preview ?? ''),
        sentAt: log.createdAt,
        performedByName: `${log.performedBy.firstName} ${log.performedBy.lastName}`.trim(),
      };
    });
  });

  // Create project communication send log entry
  app.post('/:id/communications', { preHandler: [authenticate, requireAdmin] }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = CreateCaseCommunicationSchema.parse(req.body);
    const user = (req as any).user as { id?: string } | undefined;

    const kase = await prisma.customerCase.findUnique({ where: { id }, select: { id: true } });
    if (!kase) return reply.status(404).send({ error: 'Case not found' });

    const performedBy = await resolveActor(user);

    const log = await prisma.auditLog.create({
      data: {
        performedById: performedBy.id,
        action: 'UPDATE',
        entityType: 'CustomerCaseCommunication',
        entityId: id,
        newValue: {
          templateKey: body.templateKey,
          channel: body.channel,
          recipient: body.recipient,
          preview: body.preview,
        },
        reason: `Communication sent: ${body.templateKey}`,
      },
    });

    reply.status(201);
    return {
      id: log.id,
      caseId: id,
      templateKey: body.templateKey,
      channel: body.channel,
      recipient: body.recipient,
      preview: body.preview,
      sentAt: log.createdAt,
      performedByName: `${performedBy.firstName} ${performedBy.lastName}`.trim(),
    };
  });

  // Create case
  app.post('/', { preHandler: [authenticate, requireAdmin] }, async (req, reply) => {
    const body = CreateCaseSchema.parse(req.body);
    const kase = await prisma.customerCase.create({
      data: {
        ...body,
        status: body.status ?? 'ACTIVE',
        startDate: body.startDate ? new Date(body.startDate) : undefined,
      },
    });
    reply.status(201);
    return kase;
  });

  // Update case
  app.patch('/:id', { preHandler: [authenticate, requireAdmin] }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = UpdateCaseSchema.parse(req.body);

    // Enforce lifecycle transition rules when the status changes (drag/drop or
    // explicit status change must not bypass business rules).
    if (body.status) {
      const existing = await prisma.customerCase.findUnique({
        where: { id },
        select: { status: true },
      });
      if (!existing) return reply.status(404).send({ error: 'Case not found' });

      const from = existing.status as CaseStatusValue;
      const to = body.status as CaseStatusValue;
      if (!canTransitionCaseStatus(from, to)) {
        return reply.status(409).send({
          error: `Invalid status transition from ${from} to ${to}`,
          allowedTransitions: getAllowedCaseTransitions(from),
        });
      }

      // Cancelling a project also archives its still-open jobs.
      if (to === 'CANCELLED') {
        const updated = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
          const updatedCase = await tx.customerCase.update({ where: { id }, data: body });
          await tx.job.updateMany({
            where: { caseId: id, status: { notIn: ['COMPLETED', 'ARCHIVED'] } },
            data: { status: 'ARCHIVED' },
          });
          return updatedCase;
        });
        return updated;
      }
    }

    return prisma.customerCase.update({ where: { id }, data: body });
  });

  /**
   * Smart case lookup for new job creation:
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

  // Reopen a completed case
  app.post('/:id/reopen', { preHandler: [authenticate, requireAdmin] }, async (req, reply) => {
    const { id } = req.params as { id: string };
    return prisma.customerCase.update({ where: { id }, data: { status: 'ACTIVE' } });
  });

  // Archive (soft delete) a case with mandatory reason + audit log
  app.post('/:id/archive', { preHandler: [authenticate, requireAdmin] }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const { reason } = ArchiveCaseSchema.parse(req.body);
    const user = (req as any).user as { id?: string } | undefined;

    const kase = await prisma.customerCase.findUnique({ where: { id } });
    if (!kase) return reply.status(404).send({ error: 'Case not found' });

    const performedBy = await resolveActor(user);

    const archiveNote = `[ארכוב ${new Date().toISOString()}] ${reason.trim()}`;
    const nextInternalNotes = [kase.internalNotes, archiveNote].filter(Boolean).join('\n');

    const archived = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const updatedCase = await tx.customerCase.update({
        where: { id },
        data: {
          status: 'CANCELLED',
          internalNotes: nextInternalNotes,
          latestActivityDate: new Date(),
        },
      });

      // Cancelling a project archives its still-open jobs so they stop appearing
      // as active work / needing attention.
      await tx.job.updateMany({
        where: { caseId: id, status: { notIn: ['COMPLETED', 'ARCHIVED'] } },
        data: { status: 'ARCHIVED' },
      });

      // Attribute the audit entry when a user is available; never block the
      // archive itself if there is no resolvable admin user (e.g. fresh DB).
      if (performedBy) {
        await tx.auditLog.create({
          data: {
            performedById: performedBy.id,
            action: 'DELETE',
            entityType: 'CustomerCase',
            entityId: id,
            previousValue: {
              status: kase.status,
              internalNotes: kase.internalNotes ?? null,
            },
            newValue: {
              status: updatedCase.status,
              internalNotes: updatedCase.internalNotes ?? null,
            },
            reason: reason.trim(),
          },
        });
      }

      return updatedCase;
    });

    return archived;
  });

  // Permanently delete a case and all of its dependent records.
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
}

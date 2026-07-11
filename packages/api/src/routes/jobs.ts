import { FastifyInstance } from 'fastify';
import { prisma } from '../lib/prisma.js';
import { authenticate, requireAdmin } from '../middleware/auth.js';
import { CreateJobSchema, UpdateJobSchema } from '@workforce/shared';
import { UserRole } from '@workforce/shared';
import { validateServiceAddition } from '@workforce/shared';
import { z } from 'zod';

const JobsListQuerySchema = z.object({
  status: z.enum(['DRAFT', 'PUBLISHED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED']).optional(),
  date: z.string().datetime().optional(),
  caseId: z.string().optional(),
  customerId: z.string().optional(),
});

type SiblingJob = {
  id: string;
  jobType: 'PACKING' | 'UNPACKING' | 'HOME_ORGANIZATION';
  date: Date;
};

async function validateProjectJobRules(input: {
  caseId: string;
  jobType: 'PACKING' | 'UNPACKING' | 'HOME_ORGANIZATION';
  date: Date;
  currentJobId?: string;
}) {
  const kase = await prisma.customerCase.findUnique({
    where: { id: input.caseId },
    select: { id: true, status: true },
  });

  if (!kase) {
    return { ok: false as const, statusCode: 404, error: 'Project not found' };
  }

  if (kase.status === 'CANCELLED') {
    return { ok: false as const, statusCode: 409, error: 'לא ניתן לתזמן עבודות לפרויקט שבוטל.' };
  }

  const siblingJobs = (await prisma.job.findMany({
    where: {
      caseId: input.caseId,
      ...(input.currentJobId ? { id: { not: input.currentJobId } } : {}),
    },
    select: { id: true, jobType: true, date: true },
  })) as SiblingJob[];

  const typeValidationMessage = validateServiceAddition(
    siblingJobs.map((job: SiblingJob) => job.jobType),
    input.jobType,
  );
  if (typeValidationMessage) {
    return { ok: false as const, statusCode: 409, error: typeValidationMessage };
  }

  if (input.jobType === 'UNPACKING') {
    const latestPackingDate = siblingJobs
      .filter((job: SiblingJob) => job.jobType === 'PACKING')
      .map((job: SiblingJob) => job.date)
      .sort((a: Date, b: Date) => b.getTime() - a.getTime())[0];

    if (latestPackingDate && input.date.getTime() <= latestPackingDate.getTime()) {
      return {
        ok: false as const,
        statusCode: 409,
        error: 'תאריך פריקה חייב להיות אחרי יום האריזה האחרון בפרויקט.',
      };
    }
  }

  return { ok: true as const };
}

export async function jobsRoutes(app: FastifyInstance) {
  // List jobs — workers only see PUBLISHED jobs for which they are eligible
  app.get('/', { preHandler: [authenticate] }, async (req, reply) => {
    const user = (req as any).user;
    const parseResult = JobsListQuerySchema.safeParse(req.query);
    if (!parseResult.success) {
      return reply.status(400).send({ error: 'Invalid jobs query parameters' });
    }
    const { status, date, caseId, customerId } = parseResult.data;

    if (user.role === UserRole.WORKER) {
      const worker = await prisma.worker.findUnique({ where: { userId: user.id } });
      if (!worker) return reply.status(403).send({ error: 'Worker profile not found' });

      const jobs = await prisma.job.findMany({
        where: {
          status: 'PUBLISHED',
          ...(date ? { date: new Date(date) } : {}),
          // Eligible: job has open slots matching worker skills or any-skill slots
          slots: {
            some: {
              filledByShiftId: null,
              OR: [
                { requiredSkill: null },
                { requiredSkill: { in: worker.skills } },
              ],
            },
          },
        },
        include: {
          address: {
            select: {
              fullAddress: true, apartmentDetails: true, label: true,
              parkingNotes: true, accessNotes: true, elevatorNotes: true,
            },
          },
          customer: { select: { firstName: true, lastName: true } }, // NO phone/email for workers
          slots: true,
          shifts: { select: { workerId: true, joinRequestStatus: true } },
        },
        orderBy: { date: 'asc' },
      });
      return jobs;
    }

    // Admin / Owner — full access
    return prisma.job.findMany({
      where: {
        ...(status ? { status } : {}),
        ...(date ? { date: new Date(date) } : {}),
        ...(caseId ? { caseId } : {}),
        ...(customerId ? { customerId } : {}),
      },
      include: {
        address: true,
        customer: true,
        case: { select: { id: true, name: true } },
        slots: true,
        shifts: { include: { worker: true } },
      },
      orderBy: { date: 'asc' },
    });
  });

  app.get('/:id', { preHandler: [authenticate] }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const user = (req as any).user;

    const job = await prisma.job.findUnique({
      where: { id },
      include: {
        address: true,
        customer: true,
        slots: true,
        shifts: { include: { worker: true } },
        formTemplate: { include: { questions: { orderBy: { order: 'asc' } } } },
      },
    });
    if (!job) return reply.status(404).send({ error: 'Job not found' });

    // Strip sensitive data for workers
    if (user.role === UserRole.WORKER) {
      const { customer, ...rest } = job as any;
      return {
        ...rest,
        customer: { firstName: customer.firstName, lastName: customer.lastName },
      };
    }
    return job;
  });

  app.post('/', { preHandler: [authenticate, requireAdmin] }, async (req, reply) => {
    const payload = z
      .object({
        publishNow: z.boolean().optional(),
      })
      .passthrough()
      .parse(req.body);
    const body = CreateJobSchema.parse(payload);
    const publishNow = payload.publishNow ?? false;
    const { workerSlots, ...jobData } = body;
    let formTemplateId = jobData.formTemplateId ?? null;

    const parsedJobDate = new Date(jobData.date);
    const validationResult = await validateProjectJobRules({
      caseId: jobData.caseId,
      jobType: jobData.jobType,
      date: parsedJobDate,
    });
    if (!validationResult.ok) {
      return reply.status(validationResult.statusCode).send({ error: validationResult.error });
    }

    if (!formTemplateId) {
      const defaultTemplate = await prisma.formTemplate.findFirst({
        where: { jobType: jobData.jobType, isDefault: true },
        select: { id: true },
      });
      formTemplateId = defaultTemplate?.id ?? null;
    }

    const job = await prisma.job.create({
      data: {
        ...jobData,
        date: parsedJobDate,
        plannedStart: new Date(jobData.plannedStart),
        plannedEnd: new Date(jobData.plannedEnd),
        formTemplateId,
        status: publishNow ? 'PUBLISHED' : 'DRAFT',
        slots: workerSlots
          ? { create: workerSlots.map((s) => ({ requiredSkill: s.requiredSkill ?? null, label: s.label })) }
          : {
              create: Array.from({ length: jobData.requiredWorkerCount }, () => ({ requiredSkill: null })),
            },
      },
      include: { slots: true },
    });

    reply.status(201);
    return job;
  });

  app.patch('/:id', { preHandler: [authenticate, requireAdmin] }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = UpdateJobSchema.parse(req.body);

    const existingJob = await prisma.job.findUnique({
      where: { id },
      select: { id: true, caseId: true, jobType: true, date: true },
    });
    if (!existingJob) {
      return reply.status(404).send({ error: 'Job not found' });
    }

    const nextJobType = (body.jobType ?? existingJob.jobType) as 'PACKING' | 'UNPACKING' | 'HOME_ORGANIZATION';
    const nextDate = body.date ? new Date(body.date) : existingJob.date;

    const validationResult = await validateProjectJobRules({
      caseId: existingJob.caseId,
      jobType: nextJobType,
      date: nextDate,
      currentJobId: existingJob.id,
    });
    if (!validationResult.ok) {
      return reply.status(validationResult.statusCode).send({ error: validationResult.error });
    }

    return prisma.job.update({ where: { id }, data: body as any });
  });

  // Publish a job (make it visible to workers)
  app.post('/:id/publish', { preHandler: [authenticate, requireAdmin] }, async (req, reply) => {
    const { id } = req.params as { id: string };
    return prisma.job.update({ where: { id }, data: { status: 'PUBLISHED' } });
  });

  // Cancel a job
  app.post('/:id/cancel', { preHandler: [authenticate, requireAdmin] }, async (req, reply) => {
    const { id } = req.params as { id: string };
    return prisma.job.update({ where: { id }, data: { status: 'CANCELLED' } });
  });
}

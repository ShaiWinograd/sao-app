import { FastifyInstance } from 'fastify';
import { prisma } from '../lib/prisma.js';
import { refreshScheduleStatus } from '../services/caseSchedule.js';
import { authenticate, requireAdmin } from '../middleware/auth.js';
import { CreateJobSchema, UpdateJobSchema } from '@workforce/shared';
import { UserRole, MANAGER_SKILL } from '@workforce/shared';
import { validateServiceAddition } from '@workforce/shared';
import { evaluateJobPublishReadiness } from '@workforce/shared';
import { logAudit } from '../lib/audit.js';
import { z } from 'zod';

const JOB_TYPE_HE: Record<string, string> = {
  PACKING: 'אריזה',
  UNPACKING: 'פריקה',
  HOME_ORGANIZATION: 'סידור',
};

function heDate(d: Date): string {
  const iso = d.toISOString().slice(0, 10);
  const [y, m, day] = iso.split('-');
  return `${day}.${m}.${y}`;
}

function heTime(d: Date): string {
  return d.toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Jerusalem' });
}

// Notify every active worker that a new job is available (integration spec §4).
async function notifyJobPublished(jobId: string): Promise<void> {
  const job = await prisma.job.findUnique({
    where: { id: jobId },
    include: { customer: { select: { firstName: true, lastName: true } } },
  });
  if (!job) return;
  const workers = await prisma.worker.findMany({ where: { isActive: true }, select: { userId: true } });
  if (!workers.length) return;
  const title = 'פורסמה עבודה חדשה';
  const body = `${JOB_TYPE_HE[job.jobType] ?? job.jobType} – ${job.customer.firstName} ${job.customer.lastName}\n${heDate(job.date)} | ${heTime(job.plannedStart)}–${heTime(job.plannedEnd)}`;
  await prisma.notification.createMany({
    data: workers.map((w) => ({ userId: w.userId, title, body, data: { type: 'JOB_PUBLISHED', jobId } as any })),
  });
}

// Notify workers with a confirmed shift on a job (job changed / cancelled, spec §12).
async function notifyAssignedWorkers(jobId: string, title: string, body: string, dataType: string): Promise<void> {
  const shifts = await prisma.shift.findMany({
    where: { jobId, joinRequestStatus: 'APPROVED' },
    include: { worker: { select: { userId: true } } },
  });
  const userIds = Array.from(new Set(shifts.map((s) => s.worker.userId)));
  if (!userIds.length) return;
  await prisma.notification.createMany({
    data: userIds.map((userId) => ({ userId, title, body, data: { type: dataType, jobId } as any })),
  });
}

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

  // Worker shift board: every published upcoming job with staffing + the viewer's
  // own status on it (worker_web_spec — consolidated shifts view).
  app.get('/board', { preHandler: [authenticate] }, async (req) => {
    const user = (req as any).user;
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const me = await prisma.worker.findUnique({ where: { userId: user.id }, select: { id: true } });

    const jobs = await prisma.job.findMany({
      where: { status: { in: ['PUBLISHED', 'IN_PROGRESS'] }, date: { gte: today } },
      include: {
        customer: { select: { firstName: true, lastName: true } },
        address: { select: { fullAddress: true } },
        slots: { select: { id: true, requiredSkill: true, filledByShiftId: true } },
        shifts: { include: { worker: { select: { id: true, firstName: true, lastName: true, skills: true } } } },
      },
      orderBy: [{ date: 'asc' }, { plannedStart: 'asc' }],
    });

    return jobs.map((job) => {
      const leaderShiftIds = new Set(
        job.slots.filter((s) => s.requiredSkill === MANAGER_SKILL && s.filledByShiftId).map((s) => s.filledByShiftId),
      );
      const approved = job.shifts.filter((s) => s.joinRequestStatus === 'APPROVED');
      const assignedWorkers = approved
        .map((s) => ({
          name: `${s.worker.firstName} ${s.worker.lastName}`.trim(),
          isTeamLeader: leaderShiftIds.has(s.id) || (s.worker.skills as string[]).includes(MANAGER_SKILL),
        }))
        .sort((a, b) => Number(b.isTeamLeader) - Number(a.isTeamLeader));
      const openSpots = Math.max(0, job.requiredWorkerCount - approved.length);
      const myShift = me
        ? job.shifts.find(
            (s) => s.workerId === me.id && s.joinRequestStatus !== 'REJECTED' && s.joinRequestStatus !== 'CANCELLED',
          )
        : undefined;
      return {
        jobId: job.id,
        jobType: job.jobType,
        date: job.date.toISOString(),
        plannedStart: job.plannedStart.toISOString(),
        plannedEnd: job.plannedEnd.toISOString(),
        customerName: `${job.customer.firstName} ${job.customer.lastName}`.trim(),
        address: job.address?.fullAddress ?? null,
        requiredWorkerCount: job.requiredWorkerCount,
        assignedWorkers,
        openSpots,
        myStatus: myShift ? myShift.joinRequestStatus : 'NONE',
        myShiftId: myShift?.id ?? null,
      };
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
        shifts: {
          include: {
            worker: true,
            replacementRequests: {
              where: { status: 'PENDING' },
              include: {
                volunteers: {
                  include: { worker: { select: { id: true, firstName: true, lastName: true, skills: true } } },
                  orderBy: { createdAt: 'asc' },
                },
              },
            },
          },
        },
        formTemplate: { include: { questions: { orderBy: { order: 'asc' } } } },
      },
    });
    if (!job) return reply.status(404).send({ error: 'Job not found' });

    // Strip sensitive data for workers
    if (user.role === UserRole.WORKER) {
      const { customer, shifts, formTemplate, ...rest } = job as any;
      // The assigned team leader may see the customer phone (acceptance §Discovery).
      const myWorker = await prisma.worker.findUnique({ where: { userId: user.id }, select: { id: true } });
      const leaderShiftIds = new Set(
        ((job as any).slots ?? [])
          .filter((s: any) => s.requiredSkill === MANAGER_SKILL && s.filledByShiftId)
          .map((s: any) => s.filledByShiftId),
      );
      const isTeamLeader = !!myWorker && (shifts ?? []).some((s: any) => s.workerId === myWorker.id && leaderShiftIds.has(s.id));
      return {
        ...rest,
        customer: {
          firstName: customer.firstName,
          lastName: customer.lastName,
          ...(isTeamLeader ? { phone: customer.phone } : {}),
        },
        shifts: (shifts ?? []).map(({ replacementRequests, ...shift }: any) => shift),
        // Workers only see/fill questions marked for them.
        formTemplate: formTemplate
          ? { ...formTemplate, questions: (formTemplate.questions ?? []).filter((q: any) => q.visibility === 'WORKER') }
          : null,
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

    await refreshScheduleStatus(prisma, job.caseId);

    await logAudit((req as any).user, 'CREATE', 'Job', job.id, null, { status: job.status }, publishNow ? 'created+published' : 'created');
    if (publishNow) await notifyJobPublished(job.id);

    reply.status(201);
    return job;
  });

  app.patch('/:id', { preHandler: [authenticate, requireAdmin] }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = UpdateJobSchema.parse(req.body);

    const existingJob = await prisma.job.findUnique({
      where: { id },
      select: { id: true, caseId: true, jobType: true, date: true, plannedStart: true, addressId: true, status: true },
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

    const updated = await prisma.job.update({ where: { id }, data: body as any });

    // Notify assigned workers of the change; flag material changes (spec §12).
    const dateChanged = body.date != null && new Date(body.date).toISOString().slice(0, 10) !== existingJob.date.toISOString().slice(0, 10);
    const startShiftMinutes = body.plannedStart != null
      ? Math.abs(new Date(body.plannedStart).getTime() - existingJob.plannedStart.getTime()) / 60000
      : 0;
    const addressChanged = body.addressId != null && body.addressId !== existingJob.addressId;
    const isMaterial = dateChanged || startShiftMinutes > 60 || addressChanged;
    if (existingJob.status === 'PUBLISHED' || existingJob.status === 'IN_PROGRESS') {
      const body_ = isMaterial
        ? `פרטי העבודה עודכנו (${heDate(nextDate)}). מומלץ לבדוק את המשמרת שלך.`
        : `בוצע עדכון קטן בפרטי העבודה בתאריך ${heDate(nextDate)}.`;
      await notifyAssignedWorkers(id, 'עדכון בפרטי העבודה', body_, 'JOB_CHANGED');
    }
    await logAudit((req as any).user, 'UPDATE', 'Job', id, { date: existingJob.date, plannedStart: existingJob.plannedStart, addressId: existingJob.addressId }, body, isMaterial ? 'material-change' : 'update');

    return updated;
  });

  // Publish a job (make it visible to workers)
  app.post('/:id/publish', { preHandler: [authenticate, requireAdmin] }, async (req, reply) => {
    const { id } = req.params as { id: string };

    const job = await prisma.job.findUnique({
      where: { id },
      select: {
        id: true,
        status: true,
        requiredWorkerCount: true,
        plannedStart: true,
        plannedEnd: true,
        addressId: true,
        _count: { select: { slots: true } },
      },
    });

    if (!job) {
      return reply.status(404).send({ error: 'Job not found' });
    }

    const readiness = evaluateJobPublishReadiness({
      status: job.status,
      requiredWorkerCount: job.requiredWorkerCount,
      slotCount: job._count.slots,
      plannedStart: job.plannedStart,
      plannedEnd: job.plannedEnd,
      hasAddress: Boolean(job.addressId),
    });

    if (!readiness.ready) {
      return reply.status(409).send({
        error: 'העבודה אינה מוכנה לפרסום',
        checks: readiness.checks,
        unmetReasons: readiness.unmetReasons,
      });
    }

    const published = await prisma.job.update({ where: { id }, data: { status: 'PUBLISHED' } });
    await logAudit((req as any).user, 'UPDATE', 'Job', id, { status: job.status }, { status: 'PUBLISHED' }, 'publish');
    await notifyJobPublished(id);
    return published;
  });

  // Cancel a job
  app.post('/:id/cancel', { preHandler: [authenticate, requireAdmin] }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const before = await prisma.job.findUnique({ where: { id }, select: { status: true, date: true } });
    const cancelled = await prisma.job.update({ where: { id }, data: { status: 'CANCELLED' } });
    await refreshScheduleStatus(prisma, cancelled.caseId);
    await notifyAssignedWorkers(id, 'עבודה בוטלה', `העבודה בתאריך ${heDate(cancelled.date)} בוטלה. אינך משובץ/ת אליה יותר.`, 'JOB_CANCELLED');
    await logAudit((req as any).user, 'UPDATE', 'Job', id, { status: before?.status ?? null }, { status: 'CANCELLED' }, 'cancel');
    return cancelled;
  });
}

import { FastifyInstance } from 'fastify';
import { prisma } from '../lib/prisma.js';
import { refreshScheduleStatus } from '../services/caseSchedule.js';
import { authenticate, requireAdmin } from '../middleware/auth.js';
import { CreateJobSchema, UpdateJobSchema } from '@workforce/shared';
import { UserRole, MANAGER_SKILL } from '@workforce/shared';
import { validateServiceAddition } from '@workforce/shared';
import { evaluateJobPublishReadiness } from '@workforce/shared';
import { requiresReapproval } from '@workforce/shared';
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
  status: z.enum(['RESERVATION', 'APPROVED', 'COMPLETED', 'ARCHIVED']).optional(),
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
          // Workers see active (reservation/approved) jobs; they never see the
          // reservation-vs-approved distinction itself (spec §7).
          status: { in: ['RESERVATION', 'APPROVED'] },
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
      where: { status: { in: ['RESERVATION', 'APPROVED'] }, date: { gte: today } },
      include: {
        customer: { select: { firstName: true, lastName: true } },
        address: { select: { fullAddress: true } },
        slots: { select: { id: true, requiredSkill: true, filledByShiftId: true } },
        shifts: { include: { worker: { select: { id: true, firstName: true, lastName: true, skills: true } } } },
      },
      orderBy: [{ date: 'asc' }, { plannedStart: 'asc' }],
    });

    // Dates the viewer is already occupied on (pending/awaiting/approved) — used
    // to mark same-day jobs as unavailable to join (spec §8.1).
    const occupiedDates = new Set<string>();
    if (me) {
      for (const j of jobs) {
        const mine = j.shifts.find(
          (s) =>
            s.workerId === me.id &&
            (s.joinRequestStatus === 'PENDING' ||
              s.joinRequestStatus === 'AWAITING_WORKER' ||
              s.joinRequestStatus === 'APPROVED'),
        );
        if (mine) occupiedDates.add(j.date.toISOString().slice(0, 10));
      }
    }

    return jobs.map((job) => {
      const leaderShiftIds = new Set(
        job.slots.filter((s) => s.requiredSkill === MANAGER_SKILL && s.filledByShiftId).map((s) => s.filledByShiftId),
      );
      const approved = job.shifts.filter((s) => s.joinRequestStatus === 'APPROVED');
      const assignedWorkers = approved
        .map((s) => ({
          name: `${s.worker.firstName} ${s.worker.lastName}`.trim(),
          isTeamLeader:
            s.assignmentRole === 'TEAM_LEADER' ||
            leaderShiftIds.has(s.id) ||
            (s.worker.skills as string[]).includes(MANAGER_SKILL),
          isBackup: s.assignmentRole === 'BACKUP',
        }))
        .sort((a, b) => Number(b.isTeamLeader) - Number(a.isTeamLeader));
      // Backups are extras beyond the requirement (spec §11) — they don't fill
      // a required position, so they don't reduce the open-spot count.
      const filledCount = approved.filter((s) => s.assignmentRole !== 'BACKUP').length;
      const openSpots = Math.max(0, job.requiredWorkerCount - filledCount);
      const myShift = me
        ? job.shifts.find(
            (s) => s.workerId === me.id && s.joinRequestStatus !== 'REJECTED' && s.joinRequestStatus !== 'CANCELLED',
          )
        : undefined;
      // Occupied elsewhere on this date and not on this job → cannot join (§8.1).
      const blockedSameDay = !myShift && occupiedDates.has(job.date.toISOString().slice(0, 10));
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
        blockedSameDay,
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
        // Spec §6.1: owner may create a job directly as APPROVED; default RESERVATION.
        initialStatus: z.enum(['RESERVATION', 'APPROVED']).optional(),
      })
      .passthrough()
      .parse(req.body);
    const body = CreateJobSchema.parse(payload);
    const initialStatus = payload.initialStatus ?? 'RESERVATION';
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
        status: initialStatus,
        slots: workerSlots
          ? { create: workerSlots.map((s) => ({ requiredSkill: s.requiredSkill ?? null, label: s.label })) }
          : {
              create: Array.from({ length: jobData.requiredWorkerCount }, () => ({ requiredSkill: null })),
            },
      },
      include: { slots: true },
    });

    await refreshScheduleStatus(prisma, job.caseId);

    // Spec §6.3: every new job is published to workers immediately (no draft).
    await logAudit((req as any).user, 'CREATE', 'Job', job.id, null, { status: job.status }, 'created+published');
    await notifyJobPublished(job.id);

    reply.status(201);
    return job;
  });

  app.patch('/:id', { preHandler: [authenticate, requireAdmin] }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = UpdateJobSchema.parse(req.body);

    const existingJob = await prisma.job.findUnique({
      where: { id },
      select: { id: true, caseId: true, jobType: true, date: true, plannedStart: true, plannedEnd: true, addressId: true, status: true },
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

    // Determine whether the change requires worker reapproval (spec §13):
    // a city/street change or a schedule shift of at least 3 hours.
    const nextStart = body.plannedStart ? new Date(body.plannedStart) : existingJob.plannedStart;
    const nextEnd = body.plannedEnd ? new Date(body.plannedEnd) : existingJob.plannedEnd;
    const nextAddressId = body.addressId ?? existingJob.addressId;
    let oldAddress: string | null = null;
    if (existingJob.addressId) {
      const a = await prisma.address.findUnique({ where: { id: existingJob.addressId }, select: { fullAddress: true } });
      oldAddress = a?.fullAddress ?? null;
    }
    let newAddress: string | null = oldAddress;
    if (nextAddressId !== existingJob.addressId && nextAddressId) {
      const a = await prisma.address.findUnique({ where: { id: nextAddressId }, select: { fullAddress: true } });
      newAddress = a?.fullAddress ?? null;
    }
    const needsReapproval = requiresReapproval({
      oldAddress,
      newAddress,
      oldStart: existingJob.plannedStart,
      oldEnd: existingJob.plannedEnd,
      newStart: nextStart,
      newEnd: nextEnd,
    });

    if (existingJob.status === 'RESERVATION' || existingJob.status === 'APPROVED') {
      if (needsReapproval) {
        // Approved workers must re-approve the changed job (spec §12.3). Capture
        // them, flip to awaiting-worker (they stay occupied), and ask them to
        // review each job individually.
        const approvedShifts = await prisma.shift.findMany({
          where: { jobId: id, joinRequestStatus: 'APPROVED' },
          include: { worker: { select: { userId: true } } },
        });
        if (approvedShifts.length) {
          await prisma.shift.updateMany({
            where: { jobId: id, joinRequestStatus: 'APPROVED' },
            data: { joinRequestStatus: 'AWAITING_WORKER' },
          });
          await prisma.notification.createMany({
            data: approvedShifts.map((s) => ({
              userId: s.worker.userId,
              title: 'העבודה עודכנה – נדרש אישור מחדש',
              body: `פרטי העבודה בתאריך ${heDate(nextDate)} השתנו (כתובת או שעות). יש לאשר או לדחות מ"היומן שלי".`,
              data: { type: 'CHANGE_APPROVAL_REQUIRED', jobId: id, shiftId: s.id } as any,
            })),
          });
        }
      } else {
        await notifyAssignedWorkers(id, 'עדכון בפרטי העבודה', `בוצע עדכון בפרטי העבודה בתאריך ${heDate(nextDate)}.`, 'JOB_CHANGED');
      }
    }
    await logAudit((req as any).user, 'UPDATE', 'Job', id, { date: existingJob.date, plannedStart: existingJob.plannedStart, addressId: existingJob.addressId }, body, needsReapproval ? 'material-change' : 'update');

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

    // Jobs are published to workers on creation (spec §6.3); this endpoint
    // re-broadcasts the job to workers after a readiness check.
    await logAudit((req as any).user, 'UPDATE', 'Job', id, { status: job.status }, { republished: true }, 'republish');
    await notifyJobPublished(id);
    return prisma.job.findUnique({ where: { id } });
  });

  // Archive a job (spec §15). Keeps records; does not permanently delete.
  app.post('/:id/cancel', { preHandler: [authenticate, requireAdmin] }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const before = await prisma.job.findUnique({ where: { id }, select: { status: true, date: true } });
    const archived = await prisma.job.update({ where: { id }, data: { status: 'ARCHIVED' } });
    await refreshScheduleStatus(prisma, archived.caseId);
    await notifyAssignedWorkers(id, 'עבודה הוסרה', `העבודה בתאריך ${heDate(archived.date)} הוסרה. אינך משובץ/ת אליה יותר.`, 'JOB_CANCELLED');
    await logAudit((req as any).user, 'UPDATE', 'Job', id, { status: before?.status ?? null }, { status: 'ARCHIVED' }, 'archive');
    return archived;
  });

  // Owner approves a job (spec §4.2). Requires a real customer (not General
  // Reservation); workers remain assigned and are not notified of the internal
  // status change.
  app.post('/:id/approve', { preHandler: [authenticate, requireAdmin] }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const job = await prisma.job.findUnique({
      where: { id },
      include: { customer: { select: { isSystem: true } } },
    });
    if (!job) return reply.status(404).send({ error: 'Job not found' });
    if (job.customer.isSystem) {
      return reply.status(409).send({ error: 'לא ניתן לאשר עבודה המשויכת לשריון כללי. יש לשייך ללקוח אמיתי תחילה.' });
    }
    if (job.status === 'ARCHIVED' || job.status === 'COMPLETED') {
      return reply.status(409).send({ error: 'לא ניתן לאשר עבודה שהושלמה או הוסרה.' });
    }
    const updated = await prisma.job.update({ where: { id }, data: { status: 'APPROVED' } });
    await logAudit((req as any).user, 'APPROVE', 'Job', id, { status: job.status }, { status: 'APPROVED' }, 'approve');
    return updated;
  });

  // Owner returns a job to reservation (spec §14–15). Workers remain assigned.
  app.post('/:id/return-to-reservation', { preHandler: [authenticate, requireAdmin] }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const job = await prisma.job.findUnique({ where: { id }, select: { status: true } });
    if (!job) return reply.status(404).send({ error: 'Job not found' });
    if (job.status === 'ARCHIVED' || job.status === 'COMPLETED') {
      return reply.status(409).send({ error: 'לא ניתן להחזיר לשריון עבודה שהושלמה או הוסרה.' });
    }
    const updated = await prisma.job.update({ where: { id }, data: { status: 'RESERVATION' } });
    await logAudit((req as any).user, 'UPDATE', 'Job', id, { status: job.status }, { status: 'RESERVATION' }, 'return-to-reservation');
    return updated;
  });

  // Owner activity log for a job — its own events plus its workers' events
  // (spec §16). Workers never see this.
  app.get('/:id/activity', { preHandler: [authenticate, requireAdmin] }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const shifts = await prisma.shift.findMany({ where: { jobId: id }, select: { id: true } });
    const shiftIds = shifts.map((s) => s.id);
    return prisma.auditLog.findMany({
      where: {
        OR: [
          { entityType: 'Job', entityId: id },
          ...(shiftIds.length ? [{ entityType: 'Shift', entityId: { in: shiftIds } }] : []),
        ],
      },
      include: { performedBy: { select: { firstName: true, lastName: true, role: true } } },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
  });

  // Move workers between two jobs on the same date (spec §12). Recalculates the
  // team-leader role, flags reapproval for material city/street/≥3h changes, and
  // notifies each moved worker.
  app.post('/move-workers', { preHandler: [authenticate, requireAdmin] }, async (req, reply) => {
    const body = z
      .object({
        sourceJobId: z.string(),
        targetJobId: z.string(),
        shiftIds: z.array(z.string()).min(1),
        roleChanges: z.record(z.enum(['REGULAR', 'TEAM_LEADER', 'BACKUP'])).optional(),
      })
      .parse(req.body);

    if (body.sourceJobId === body.targetJobId) {
      return reply.status(400).send({ error: 'Source and target jobs must differ' });
    }

    const [source, target] = await Promise.all([
      prisma.job.findUnique({ where: { id: body.sourceJobId }, include: { address: { select: { fullAddress: true } } } }),
      prisma.job.findUnique({ where: { id: body.targetJobId }, include: { address: { select: { fullAddress: true } } } }),
    ]);
    if (!source || !target) return reply.status(404).send({ error: 'Job not found' });

    // Workers may only be moved between jobs on the same calendar date (spec §12).
    if (source.date.toISOString().slice(0, 10) !== target.date.toISOString().slice(0, 10)) {
      return reply.status(409).send({ error: 'ניתן להעביר עובדים רק בין עבודות באותו תאריך.' });
    }

    const shifts = await prisma.shift.findMany({
      where: { id: { in: body.shiftIds }, jobId: body.sourceJobId },
      include: { worker: { select: { userId: true, firstName: true, lastName: true } } },
    });
    if (!shifts.length) return reply.status(404).send({ error: 'No matching workers on the source job' });

    // Preserve a moved worker's team-leader role only if the target has no leader
    // already (spec §10); otherwise they become a regular worker.
    const existingTargetLeader = await prisma.shift.findFirst({
      where: {
        jobId: body.targetJobId,
        assignmentRole: 'TEAM_LEADER',
        joinRequestStatus: { in: ['APPROVED', 'AWAITING_WORKER'] },
      },
    });
    let targetHasLeader = Boolean(existingTargetLeader);

    const needsReapproval = requiresReapproval({
      oldAddress: source.address?.fullAddress ?? null,
      newAddress: target.address?.fullAddress ?? null,
      oldStart: source.plannedStart,
      oldEnd: source.plannedEnd,
      newStart: target.plannedStart,
      newEnd: target.plannedEnd,
    });

    const dk = heDate(target.date);
    const moved: string[] = [];
    for (const shift of shifts) {
      // Skip if this worker is already on the target job.
      const already = await prisma.shift.findFirst({
        where: {
          jobId: body.targetJobId,
          workerId: shift.workerId,
          joinRequestStatus: { in: ['APPROVED', 'AWAITING_WORKER', 'PENDING'] },
        },
      });
      if (already) continue;

      let role = (body.roleChanges?.[shift.id] ?? shift.assignmentRole) as 'REGULAR' | 'TEAM_LEADER' | 'BACKUP';
      if (role === 'TEAM_LEADER') {
        if (targetHasLeader) role = 'REGULAR';
        else targetHasLeader = true;
      }

      await prisma.shift.update({
        where: { id: shift.id },
        data: {
          jobId: body.targetJobId,
          slotId: null,
          scheduledStart: target.plannedStart,
          scheduledEnd: target.plannedEnd,
          assignmentRole: role,
          // Material city/street or ≥3h changes require the worker to re-approve
          // (spec §12.2); otherwise the assignment carries over unchanged.
          joinRequestStatus: needsReapproval ? 'AWAITING_WORKER' : shift.joinRequestStatus,
        },
      });

      await prisma.notification.create({
        data: {
          userId: shift.worker.userId,
          title: needsReapproval ? 'הועברת לעבודה אחרת – נדרש אישור' : 'הועברת לעבודה אחרת',
          body: needsReapproval
            ? `הועברת לעבודה בתאריך ${dk}. הכתובת או השעות שונות – יש לאשר או לדחות מ"היומן שלי".`
            : `הועברת לעבודה בתאריך ${dk}. הפרטים עודכנו ביומן שלך.`,
          data: { type: needsReapproval ? 'CHANGE_APPROVAL_REQUIRED' : 'JOB_MOVED', jobId: body.targetJobId, shiftId: shift.id } as any,
        },
      });
      await logAudit(
        (req as any).user,
        'UPDATE',
        'Shift',
        shift.id,
        { jobId: body.sourceJobId },
        { jobId: body.targetJobId, assignmentRole: role, reapproval: needsReapproval },
        'move-worker',
      );
      moved.push(shift.id);
    }

    await refreshScheduleStatus(prisma, source.caseId);
    if (target.caseId !== source.caseId) await refreshScheduleStatus(prisma, target.caseId);

    return { movedCount: moved.length, movedShiftIds: moved, reapprovalRequired: needsReapproval };
  });
}

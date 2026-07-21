import { FastifyInstance } from 'fastify';
import { prisma } from '../lib/prisma.js';
import { authenticate, requireAdmin } from '../middleware/auth.js';
import { CreateJobSchema, UpdateJobSchema } from '@workforce/shared';
import { UserRole, MANAGER_SKILL } from '@workforce/shared';
import { GENERAL_RESERVATION_CUSTOMER_ID } from '@workforce/shared';
import { validateServiceAddition } from '@workforce/shared';
import { evaluateJobPublishReadiness } from '@workforce/shared';
import { requiresReapproval } from '@workforce/shared';
import { validateCapacityReduction } from '@workforce/shared';
import { isUnavailableOn } from '@workforce/shared';
import { evaluateJobCompletion } from '@workforce/shared';
import type { AvailabilityBlock } from '@workforce/shared';
import { logAudit } from '../lib/audit.js';
import { AppError } from '../lib/errors.js';
import { lockJob } from '../lib/commitment.js';
import { resolveOrCreateCaseForJob } from '../domain/caseResolution.js';
import { getCaseReadiness } from '../domain/customerReport.js';
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

  // A case closed by a finalized customer report is never reused (spec §18.11).
  if (kase.status === 'CLOSED') {
    return { ok: false as const, statusCode: 409, error: 'הפרויקט נסגר בדוח לקוחה ואינו זמין לעבודות חדשות.' };
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
    // to mark same-day jobs as unavailable to join (spec §8.1). Availability
    // blocks the worker marked are folded in so the board matches the same-day
    // commitment guard the join endpoint enforces (§12.1).
    const occupiedDates = new Set<string>();
    let availabilityBlocks: AvailabilityBlock[] = [];
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
      availabilityBlocks = (await prisma.workerAvailability.findMany({ where: { workerId: me.id } })).map((b) => ({
        type: b.type,
        startDate: b.startDate ? b.startDate.toISOString() : null,
        endDate: b.endDate ? b.endDate.toISOString() : null,
        weekday: b.weekday,
      }));
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
      const dateKey = job.date.toISOString().slice(0, 10);
      const blockedSameDay =
        !myShift && (occupiedDates.has(dateKey) || (me ? isUnavailableOn(availabilityBlocks, dateKey) : false));
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
    // Owner: attach the customer-report entry context (spec §18.2). The last
    // (latest-dated) job of a case that is ready surfaces a "create report" action.
    const readiness = await getCaseReadiness(prisma, (job as any).caseId);
    const lastJob = await prisma.job.findFirst({ where: { caseId: (job as any).caseId }, orderBy: { date: 'desc' }, select: { id: true } });
    return { ...job, reportEntry: { caseId: (job as any).caseId, readyForReport: readiness.ready, isLastJob: lastJob?.id === job.id } };
  });

  // Quick job creation from the shift board (spec §6.1). Reserve workers with a
  // tentative customer (existing / new / General Reservation), a city or address,
  // date and hours — the project and address are created/resolved automatically.
  const QuickJobSchema = z.object({
    customerMode: z.enum(['EXISTING', 'NEW', 'GENERAL_RESERVATION']),
    customerId: z.string().optional(),
    newCustomer: z
      .object({
        firstName: z.string().min(1),
        lastName: z.string().optional(),
        phone: z.string().optional(),
        email: z.string().optional(),
      })
      .optional(),
    jobType: z.enum(['PACKING', 'UNPACKING', 'HOME_ORGANIZATION']),
    date: z.string(),
    startTime: z.string(),
    endTime: z.string(),
    cityOrAddress: z.string().min(1),
    requiredWorkerCount: z.number().int().min(1),
    requiresTeamLeader: z.boolean().optional(),
    initialStatus: z.enum(['RESERVATION', 'APPROVED']).optional(),
    notes: z.string().optional(),
  });

  app.post('/quick', { preHandler: [authenticate, requireAdmin] }, async (req, reply) => {
    const body = QuickJobSchema.parse(req.body);

    // 1) Resolve the customer (existing / new / General Reservation).
    let customerId: string;
    if (body.customerMode === 'GENERAL_RESERVATION') {
      customerId = GENERAL_RESERVATION_CUSTOMER_ID;
    } else if (body.customerMode === 'EXISTING') {
      if (!body.customerId) return reply.status(400).send({ error: 'customerId required' });
      const exists = await prisma.customer.findUnique({ where: { id: body.customerId }, select: { id: true } });
      if (!exists) return reply.status(404).send({ error: 'Customer not found' });
      customerId = body.customerId;
    } else {
      if (!body.newCustomer) return reply.status(400).send({ error: 'newCustomer required' });
      const created = await prisma.customer.create({
        data: {
          firstName: body.newCustomer.firstName,
          lastName: body.newCustomer.lastName ?? '',
          phone: body.newCustomer.phone ?? '-',
          email: body.newCustomer.email ?? `${Date.now()}@placeholder.local`,
        },
      });
      customerId = created.id;
    }

    // 2) Datetimes + default form template.
    const customer = await prisma.customer.findUnique({ where: { id: customerId }, select: { firstName: true, lastName: true } });
    const dateOnly = body.date.slice(0, 10);
    const parsedDate = new Date(`${dateOnly}T00:00:00.000Z`);
    const plannedStart = new Date(`${dateOnly}T${body.startTime}:00.000Z`);
    const plannedEnd = new Date(`${dateOnly}T${body.endTime}:00.000Z`);
    const defaultTemplate = await prisma.formTemplate.findFirst({ where: { jobType: body.jobType, isDefault: true }, select: { id: true } });
    const caseName = `${customer?.firstName ?? ''} ${customer?.lastName ?? ''}`.trim();
    const teamLeaderSlots = body.requiresTeamLeader ? 1 : 0;

    // 3) Resolve the case (shared §18.12 grouping rule) + create the address and
    //    the job atomically so grouping is race-safe and nothing is orphaned.
    const job = await prisma.$transaction(async (tx) => {
      const caseId = await resolveOrCreateCaseForJob(tx, {
        customerId,
        caseName,
        newJobDate: parsedDate,
        actor: (req as any).user,
      });

      const address = await tx.address.create({
        data: { customerId, fullAddress: body.cityOrAddress.trim(), label: 'OTHER' },
      });

      return tx.job.create({
        data: {
          caseId,
          customerId,
          addressId: address.id,
          jobType: body.jobType,
          date: parsedDate,
          plannedStart,
          plannedEnd,
          requiredWorkerCount: body.requiredWorkerCount,
          jobNotes: body.notes ?? null,
          formTemplateId: defaultTemplate?.id ?? null,
          status: body.initialStatus ?? 'RESERVATION',
          slots: {
            create: [
              ...(teamLeaderSlots ? [{ requiredSkill: MANAGER_SKILL as any }] : []),
              ...Array.from({ length: Math.max(0, body.requiredWorkerCount - teamLeaderSlots) }, () => ({ requiredSkill: null })),
            ],
          },
        },
        include: { slots: true },
      });
    });

    await logAudit((req as any).user, 'CREATE', 'Job', job.id, null, { status: job.status, quick: true }, 'quick-created');
    await notifyJobPublished(job.id);

    // 5) Advisory capacity warning (spec §17) — never blocks creation.
    const activeWorkers = await prisma.worker.count({ where: { isActive: true } });
    const occupied = await prisma.shift.findMany({
      where: { joinRequestStatus: { in: ['PENDING', 'AWAITING_WORKER', 'APPROVED'] }, job: { date: parsedDate } },
      select: { workerId: true },
    });
    const available = Math.max(0, activeWorkers - new Set(occupied.map((s) => s.workerId)).size);

    reply.status(201);
    return { job, capacityWarning: available < body.requiredWorkerCount, availableWorkers: available };
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

    // Spec §6.3: every new job is published to workers immediately (no draft).
    await logAudit((req as any).user, 'CREATE', 'Job', job.id, null, { status: job.status }, 'created+published');
    await notifyJobPublished(job.id);

    reply.status(201);
    return job;
  });

  app.patch('/:id', { preHandler: [authenticate, requireAdmin] }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = UpdateJobSchema.parse(req.body);
    // Owner's chosen shifts to demote to backup when capacity is reduced (§13).
    const demoteToBackupIds: string[] = Array.isArray((req.body as any)?.demoteToBackupIds)
      ? ((req.body as any).demoteToBackupIds as string[])
      : [];

    const existingJob = await prisma.job.findUnique({
      where: { id },
      select: { id: true, caseId: true, jobType: true, date: true, plannedStart: true, plannedEnd: true, addressId: true, status: true, requiredWorkerCount: true },
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

    // §13 capacity change. Handled atomically under a per-job advisory lock so a
    // concurrent staffing change cannot invalidate the owner's backup selection
    // between validation and apply. When the required count drops below the number
    // of assigned regular/leader workers the owner must pick exactly which of them
    // become backups (MUST_SELECT_BACKUPS) — the system never auto-selects, deletes
    // or rejects anyone. The team-leader requirement must survive the reduction.
    // Any invalid selection (including a shift concurrently removed or already
    // demoted) rolls the whole change back. When the count increases, active
    // workers are told that more positions opened.
    const newCount = body.requiredWorkerCount;
    let demotedUserIds: string[] = [];
    let capacityIncreased = false;

    const updated = await prisma.$transaction(async (tx) => {
      if (typeof newCount === 'number' && newCount !== existingJob.requiredWorkerCount) {
        await lockJob(tx, id);
        const regulars = await tx.shift.findMany({
          where: { jobId: id, joinRequestStatus: 'APPROVED', assignmentRole: { in: ['REGULAR', 'TEAM_LEADER'] } },
          select: { id: true, assignmentRole: true, worker: { select: { userId: true } } },
        });
        if (newCount < regulars.length) {
          const regularShiftIds = regulars.map((r) => r.id);
          // Selection validity + exact count. A selected shift that was concurrently
          // removed or demoted is no longer in regularShiftIds → INVALID_SELECTION.
          const check = validateCapacityReduction({ newRequiredCount: newCount, regularShiftIds, demoteToBackupIds });
          if (!check.ok) {
            throw new AppError(409, check.code, check.message, { needed: check.needed, regularShiftIds });
          }
          // The team-leader requirement must remain valid: the only leader may not
          // be demoted while the job still requires a leader slot.
          const requiresLeader = (await tx.jobSlot.count({ where: { jobId: id, requiredSkill: MANAGER_SKILL } })) > 0;
          const demotedSet = new Set(demoteToBackupIds);
          const leaderRemains = regulars.some((r) => r.assignmentRole === 'TEAM_LEADER' && !demotedSet.has(r.id));
          if (requiresLeader && !leaderRemains) {
            throw new AppError(409, 'LEADER_REQUIRED', 'לא ניתן להעביר את ראש הצוות לגיבוי — העבודה דורשת ראש צוות.', { regularShiftIds });
          }
          await tx.shift.updateMany({ where: { id: { in: demoteToBackupIds }, jobId: id }, data: { assignmentRole: 'BACKUP' } });
          for (const sid of demoteToBackupIds) {
            await logAudit((req as any).user, 'UPDATE', 'Shift', sid, { assignmentRole: 'REGULAR' }, { assignmentRole: 'BACKUP' }, 'capacity-reduced', tx);
          }
          demotedUserIds = regulars.filter((r) => demotedSet.has(r.id)).map((r) => r.worker.userId);
        } else if (newCount > existingJob.requiredWorkerCount) {
          capacityIncreased = true;
        }
      }
      return tx.job.update({ where: { id }, data: body as any });
    });

    const capDateKey = heDate(nextDate);
    if (demotedUserIds.length) {
      await prisma.notification.createMany({
        data: demotedUserIds.map((userId) => ({
          userId,
          title: 'עודכן שיבוצך לגיבוי',
          body: `כמות העובדים לעבודה בתאריך ${capDateKey} הוקטנה ושובצת כגיבוי. תקבל/י עדכון אם תידרש/י.`,
          data: { type: 'MOVED_TO_BACKUP', jobId: id } as any,
        })),
      });
    }
    if (capacityIncreased) {
      await notifyAssignedWorkers(id, 'נוספו מקומות לעבודה', `נפתחו מקומות נוספים לעבודה בתאריך ${capDateKey}.`, 'CAPACITY_INCREASED');
    }

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

  // Owner manually marks a job Completed (spec §17.2). Every assigned regular
  // worker and team leader must have a resolved attendance outcome first. The
  // owner may resolve any that are missing inline via `resolutions`: each is
  // either { outcome: 'DID_NOT_WORK' } or { outcome: 'WORKED', clockIn, clockOut }.
  // When outcomes are still missing, responds 409 with the list so the UI can
  // show the per-worker resolution screen. All resolutions + the status change +
  // audits are atomic.
  app.post('/:id/complete', { preHandler: [authenticate, requireAdmin] }, async (req, reply) => {
    const user = (req as any).user;
    const { id } = req.params as { id: string };
    const { resolutions } = (req.body ?? {}) as {
      resolutions?: Array<{ shiftId: string; outcome: 'WORKED' | 'DID_NOT_WORK'; clockIn?: string; clockOut?: string }>;
    };

    const job = await prisma.job.findUnique({ where: { id }, select: { id: true, status: true } });
    if (!job) return reply.status(404).send({ error: 'Job not found' });
    if (job.status === 'COMPLETED') return reply.status(409).send({ error: 'העבודה כבר הושלמה.' });
    if (job.status === 'ARCHIVED') return reply.status(409).send({ error: 'לא ניתן להשלים עבודה שהוסרה.' });

    const completed = await prisma.$transaction(async (tx) => {
      for (const r of resolutions ?? []) {
        const s = await tx.shift.findFirst({ where: { id: r.shiftId, jobId: id }, select: { id: true, attendanceStatus: true } });
        if (!s) throw new AppError(400, 'INVALID_RESOLUTION', 'אחת מהעובדות שנבחרו אינה משובצת לעבודה זו.');
        if (r.outcome === 'DID_NOT_WORK') {
          await tx.shift.update({
            where: { id: r.shiftId },
            data: { attendanceStatus: 'NO_SHOW', requiresReview: false, actualStart: null, actualEnd: null, approvedHours: null, isDailyPaymentEligible: false },
          });
          await logAudit(user, 'UPDATE', 'Shift', r.shiftId, { attendanceStatus: s.attendanceStatus }, { attendanceStatus: 'NO_SHOW' }, 'manual-complete:did-not-work', tx);
        } else {
          if (!r.clockIn || !r.clockOut) throw new AppError(400, 'INVALID_RESOLUTION', 'יש להזין שעת התחלה וסיום עבור עובד/ת שעבד/ה.');
          const hours = (new Date(r.clockOut).getTime() - new Date(r.clockIn).getTime()) / (1000 * 60 * 60);
          if (!(hours > 0)) throw new AppError(400, 'INVALID_RESOLUTION', 'שעת הסיום חייבת להיות אחרי שעת ההתחלה.');
          await tx.shift.update({
            where: { id: r.shiftId },
            data: {
              actualStart: new Date(r.clockIn),
              actualEnd: new Date(r.clockOut),
              attendanceStatus: 'CORRECTED',
              clockInMethod: 'MANUALLY_ADDED',
              clockOutMethod: 'MANUALLY_ADDED',
              requiresReview: false,
              approvedHours: hours.toFixed(2),
              isDailyPaymentEligible: true,
            },
          });
          await logAudit(user, 'CORRECTION', 'Shift', r.shiftId, { attendanceStatus: s.attendanceStatus }, { actualStart: r.clockIn, actualEnd: r.clockOut }, 'manual-complete:worked', tx);
        }
      }

      const shifts = await tx.shift.findMany({
        where: { jobId: id },
        select: {
          id: true,
          joinRequestStatus: true,
          assignmentRole: true,
          attendanceStatus: true,
          actualStart: true,
          actualEnd: true,
          requiresReview: true,
          workerNameSnapshot: true,
        },
      });
      const result = evaluateJobCompletion(shifts);
      if (!result.complete) {
        const unresolved = shifts
          .filter(
            (s) =>
              s.joinRequestStatus === 'APPROVED' &&
              s.assignmentRole !== 'BACKUP' &&
              s.attendanceStatus !== 'NO_SHOW' &&
              (s.actualStart == null || s.actualEnd == null || s.attendanceStatus === 'CLOCKED_IN' || s.requiresReview),
          )
          .map((s) => ({ shiftId: s.id, workerName: s.workerNameSnapshot, attendanceStatus: s.attendanceStatus, requiresReview: s.requiresReview }));
        throw new AppError(409, 'ATTENDANCE_UNRESOLVED', 'יש עובדות ללא נוכחות סופית. יש לקבוע לכל אחת: עבדה או לא עבדה.', {
          blockingReasons: result.blockingReasons,
          unresolved,
        });
      }

      const upd = await tx.job.update({ where: { id }, data: { status: 'COMPLETED' } });
      await logAudit(user, 'UPDATE', 'Job', id, { status: job.status }, { status: 'COMPLETED' }, 'manual-complete', tx);
      return upd;
    });

    return completed;
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

  // Permanently delete a job (spec §15.1). Blocked when the job has any
  // attendance data — such jobs may only be archived (spec §15.2).
  app.delete('/:id', { preHandler: [authenticate, requireAdmin] }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const { reason } = (req.body ?? {}) as { reason?: string };

    const job = await prisma.job.findUnique({
      where: { id },
      include: {
        shifts: {
          select: {
            id: true,
            actualStart: true,
            actualEnd: true,
            approvedHours: true,
            attendanceStatus: true,
            worker: { select: { userId: true } },
          },
        },
      },
    });
    if (!job) return reply.status(404).send({ error: 'Job not found' });

    // §15.2 attendance protection.
    const hasAttendance = job.shifts.some(
      (s) => s.actualStart || s.actualEnd || s.approvedHours != null || (s.attendanceStatus && s.attendanceStatus !== 'SCHEDULED'),
    );
    const correctionCount = await prisma.attendanceCorrection.count({ where: { shift: { jobId: id } } });
    if (hasAttendance || correctionCount > 0) {
      return reply.status(409).send({
        error: 'attendance_exists',
        message: 'לא ניתן למחוק עבודה עם נתוני נוכחות. ניתן להעביר לארכיון בלבד.',
      });
    }

    // Notify assigned workers before removal (spec §15.1); deleting the shifts
    // releases their same-day blocking.
    const userIds = Array.from(new Set(job.shifts.map((s) => s.worker.userId)));
    if (userIds.length) {
      await prisma.notification.createMany({
        data: userIds.map((userId) => ({
          userId,
          title: 'עבודה נמחקה',
          body: `העבודה בתאריך ${heDate(job.date)} נמחקה. אינך משובץ/ת אליה יותר.`,
          data: { type: 'JOB_DELETED', jobId: id } as any,
        })),
      });
    }

    const shiftIds = job.shifts.map((s) => s.id);
    await prisma.$transaction([
      prisma.replacementVolunteer.deleteMany({ where: { request: { shiftId: { in: shiftIds } } } }),
      prisma.replacementRequest.deleteMany({ where: { shiftId: { in: shiftIds } } }),
      prisma.shiftSwap.deleteMany({ where: { OR: [{ fromShiftId: { in: shiftIds } }, { toShiftId: { in: shiftIds } }] } }),
      prisma.locationCheck.deleteMany({ where: { shiftId: { in: shiftIds } } }),
      prisma.shift.deleteMany({ where: { jobId: id } }),
      prisma.jobExpense.deleteMany({ where: { jobId: id } }),
      prisma.jobSlot.deleteMany({ where: { jobId: id } }),
      prisma.job.delete({ where: { id } }),
    ]);

    // Preserve deletion history in the audit log (spec §15.1).
    await logAudit((req as any).user, 'DELETE', 'Job', id, { status: job.status, date: job.date }, null, reason ? `deleted: ${reason}` : 'deleted');
    return { success: true };
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

    return { movedCount: moved.length, movedShiftIds: moved, reapprovalRequired: needsReapproval };
  });
}

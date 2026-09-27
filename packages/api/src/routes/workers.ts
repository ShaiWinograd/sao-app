import { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import { createClerkClient } from '@clerk/clerk-sdk-node';
import type { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma.js';
import { findEligibleReplacementCandidates } from '../domain/replacementCandidates.js';
import { authenticate, requireAdmin, requireAnyRole } from '../middleware/auth.js';
import { CreateWorkerSchema, UpdateWorkerSchema, CreateWorkerAvailabilitySchema, UpdateWorkerProfileSchema, UserRole, rankWorkerAvailability, findCandidateDates, isUnavailableOn, isUnavailableDuring } from '@workforce/shared';

const clerk = createClerkClient({ secretKey: process.env.CLERK_SECRET_KEY });

type AvailabilityInput = {
  type: 'DATE' | 'RANGE' | 'WEEKLY';
  startDate?: string;
  endDate?: string;
  weekday?: number;
  startTime?: string;
  endTime?: string;
};

function normalizeWorkerData<T extends { birthday?: string }>(body: T) {
  return {
    ...body,
    ...(body.birthday !== undefined
      ? { birthday: body.birthday ? new Date(`${body.birthday}T00:00:00.000Z`) : null }
      : {}),
  };
}

function omitSensitiveWorkerFinancials<T extends Record<string, unknown>>(worker: T) {
  const safe = { ...worker } as Record<string, unknown>;
  for (const field of ['hourlyWage', 'dailyPaymentAmount', 'bankNumber', 'bankBranch', 'bankAccountNumber', 'bankAccountHolder']) {
    delete safe[field];
  }
  return safe;
}

async function findAvailabilityConflicts(workerId: string, body: AvailabilityInput) {
  if (body.type === 'WEEKLY') return [];
  const startKey = body.startDate!.slice(0, 10);
  const endKey = (body.type === 'RANGE' ? body.endDate! : body.startDate!).slice(0, 10);
  const endExclusive = new Date(`${endKey}T00:00:00.000Z`);
  endExclusive.setUTCDate(endExclusive.getUTCDate() + 1);
  const shifts = await prisma.shift.findMany({
    where: {
      workerId,
      joinRequestStatus: 'APPROVED',
      job: { date: { gte: new Date(`${startKey}T00:00:00.000Z`), lt: endExclusive } },
    },
    include: {
      job: {
        select: {
          date: true,
          plannedStart: true,
          plannedEnd: true,
          jobType: true,
          customer: { select: { firstName: true, lastName: true } },
        },
      },
    },
  });
  const time = (value: Date) =>
    `${String(value.getUTCHours()).padStart(2, '0')}:${String(value.getUTCMinutes()).padStart(2, '0')}`;
  return shifts
    .filter((shift) =>
      !body.startTime || !body.endTime
        ? true
        : isUnavailableDuring(
            [{
              type: body.type,
              startDate: body.startDate,
              endDate: body.endDate,
              weekday: body.weekday,
              startTime: body.startTime,
              endTime: body.endTime,
            }],
            shift.job.date.toISOString().slice(0, 10),
            time(shift.job.plannedStart),
            time(shift.job.plannedEnd),
          ),
    )
    .map((shift) => ({
      shiftId: shift.id,
      date: shift.job.date.toISOString(),
      plannedStart: shift.job.plannedStart.toISOString(),
      plannedEnd: shift.job.plannedEnd.toISOString(),
      jobType: shift.job.jobType,
      customerName: `${shift.job.customer.firstName} ${shift.job.customer.lastName}`.trim(),
      replacementStatus: shift.replacementStatus,
    }));
}

export async function workersRoutes(app: FastifyInstance) {
  app.get('/', { preHandler: [authenticate, requireAdmin] }, async (req, reply) => {
    const { status = 'active' } = req.query as { status?: 'active' | 'archived' | 'all' };
    const workers = await prisma.worker.findMany({
      where: status === 'all' ? undefined : { isActive: status !== 'archived' },
      select: {
        id: true, firstName: true, lastName: true, phone: true, email: true,
        skills: true, isActive: true, paymentMethod: true,
        homeAddress: true, birthday: true, bankNumber: true, bankBranch: true,
        bankAccountNumber: true, bankAccountHolder: true, createdAt: true,
        // Sensitive financial fields are stripped below unless the caller is the owner.
        hourlyWage: true, dailyPaymentAmount: true,
      },
      orderBy: { firstName: 'asc' },
    });
    const user = (req as any).user;
    return user.role === UserRole.OWNER ? workers : workers.map(omitSensitiveWorkerFinancials);
  });

  // Worker availability finder — ranks active workers best-fit first for a date.
  app.get('/availability', { preHandler: [authenticate, requireAdmin] }, async (req, reply) => {
    const query = req.query as {
      date?: string;
      skill?: string;
      requiresManager?: string;
      area?: string;
    };
    if (!query.date || !/^\d{4}-\d{2}-\d{2}$/.test(query.date)) {
      return reply.status(400).send({ error: 'A valid date (YYYY-MM-DD) query parameter is required' });
    }

    const workers = await prisma.worker.findMany({
      where: { isActive: true },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        skills: true,
        isActive: true,
        homeArea: true,
        shifts: { select: { job: { select: { date: true } } } },
        availability: { select: { type: true, startDate: true, endDate: true, weekday: true, startTime: true, endTime: true } },
      },
    });

    const candidates = workers.map((worker) => {
      const bookedDates = worker.shifts
        .map((shift) => shift.job?.date)
        .filter((date): date is Date => Boolean(date))
        .map((date) => date.toISOString().slice(0, 10));
      // A worker who blocked this date is treated as unavailable for assignment.
      const blocks = worker.availability.map((b) => ({
        type: b.type,
        startDate: b.startDate ? b.startDate.toISOString() : null,
        endDate: b.endDate ? b.endDate.toISOString() : null,
        weekday: b.weekday,
        startTime: b.startTime,
        endTime: b.endTime,
      }));
      if (isUnavailableOn(blocks, query.date!)) bookedDates.push(query.date!);
      return {
        id: worker.id,
        name: `${worker.firstName} ${worker.lastName}`.trim(),
        skills: worker.skills as string[],
        isActive: worker.isActive,
        homeArea: worker.homeArea,
        bookedDates,
      };
    });

    return rankWorkerAvailability(
      {
        date: query.date,
        requiredSkill: query.skill ?? null,
        requiresManager: query.requiresManager === 'true',
        area: query.area ?? null,
      },
      candidates,
    );
  });

  // Owner calendar availability for a bounded visible date range.
  app.get('/calendar-availability', { preHandler: [authenticate, requireAdmin] }, async (req, reply) => {
    const query = req.query as { start?: string; end?: string };
    if (
      !query.start ||
      !query.end ||
      !/^\d{4}-\d{2}-\d{2}$/.test(query.start) ||
      !/^\d{4}-\d{2}-\d{2}$/.test(query.end) ||
      query.start > query.end
    ) {
      return reply.status(400).send({ error: 'A valid start and end date are required' });
    }

    const start = new Date(`${query.start}T00:00:00.000Z`);
    const end = new Date(`${query.end}T00:00:00.000Z`);
    const dayCount = Math.floor((end.getTime() - start.getTime()) / 86_400_000) + 1;
    if (dayCount > 62) {
      return reply.status(400).send({ error: 'Availability ranges are limited to 62 days' });
    }

    const workers = await prisma.worker.findMany({
      where: { isActive: true },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        availability: {
          select: { type: true, startDate: true, endDate: true, weekday: true, reason: true, startTime: true, endTime: true },
        },
      },
      orderBy: { firstName: 'asc' },
    });

    const dates = Array.from({ length: dayCount }, (_, index) => {
      const date = new Date(start);
      date.setUTCDate(start.getUTCDate() + index);
      return date.toISOString().slice(0, 10);
    });

    return workers.flatMap((worker) => {
      const blocks = worker.availability.map((block) => ({
        ...block,
        startDate: block.startDate?.toISOString() ?? null,
        endDate: block.endDate?.toISOString() ?? null,
      }));
      return dates.flatMap((dateKey) => {
        const block = blocks.find((candidate) => isUnavailableOn([candidate], dateKey));
        return block
          ? [{
              workerId: worker.id,
              workerName: `${worker.firstName} ${worker.lastName}`.trim(),
              dateKey,
              reason: block.reason?.trim() || 'סומנה כלא זמינה',
              startTime: block.startTime,
              endTime: block.endTime,
            }]
          : [];
      });
    });
  });

  // Candidate-date finder — ranks dates in a range by staffing coverage.
  app.get('/available-dates', { preHandler: [authenticate, requireAdmin] }, async (req, reply) => {
    const query = req.query as {
      start?: string;
      end?: string;
      requiredWorkers?: string;
      requiresManager?: string;
      weekdays?: string;
    };
    if (
      !query.start ||
      !query.end ||
      !/^\d{4}-\d{2}-\d{2}$/.test(query.start) ||
      !/^\d{4}-\d{2}-\d{2}$/.test(query.end)
    ) {
      return reply.status(400).send({ error: 'Valid start and end dates (YYYY-MM-DD) are required' });
    }

    const workers = await prisma.worker.findMany({
      where: { isActive: true },
      select: {
        id: true,
        isActive: true,
        skills: true,
        shifts: { select: { job: { select: { date: true } } } },
      },
    });

    const finderWorkers = workers.map((worker) => ({
      id: worker.id,
      isActive: worker.isActive,
      isManager: (worker.skills as string[]).includes('SHIFT_LEADER'),
      bookedDates: worker.shifts
        .map((shift) => shift.job?.date)
        .filter((date): date is Date => Boolean(date))
        .map((date) => date.toISOString().slice(0, 10)),
    }));

    const allowedWeekdays = query.weekdays
      ? query.weekdays
          .split(',')
          .map((value) => Number(value))
          .filter((value) => Number.isInteger(value) && value >= 0 && value <= 6)
      : undefined;

    return findCandidateDates(
      {
        startDate: query.start,
        endDate: query.end,
        requiredWorkers: Math.max(0, Number(query.requiredWorkers) || 0),
        requiresManager: query.requiresManager === 'true',
        allowedWeekdays,
      },
      finderWorkers,
    );
  });

  app.get('/:id', { preHandler: [authenticate, requireAdmin] }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const worker = await prisma.worker.findUnique({
      where: { id },
      include: {
        shifts: {
          include: { job: { select: { date: true, jobType: true } } },
          orderBy: { scheduledStart: 'desc' },
          take: 20,
        },
      },
    });
    if (!worker) return reply.status(404).send({ error: 'Worker not found' });
    const user = (req as any).user;
    return user.role === UserRole.OWNER ? worker : omitSensitiveWorkerFinancials(worker);
  });

  // Get own profile (worker)
  app.get('/me', { preHandler: [authenticate, requireAnyRole] }, async (req, reply) => {
    const user = (req as any).user;
    if (user.role !== UserRole.WORKER) return reply.status(403).send({ error: 'Forbidden' });
    const worker = await prisma.worker.findUnique({ where: { userId: user.id } });
    if (!worker) return reply.status(404).send({ error: 'Worker profile not found' });
    // Strip wage data
    const { hourlyWage, dailyPaymentAmount, internalNotes, ...safe } = worker;
    return safe;
  });

  // Worker: list colleagues (names only) — used to suggest a specific replacement.
  app.get('/colleagues', { preHandler: [authenticate, requireAnyRole] }, async (req, reply) => {
    const user = (req as any).user;
    const workers = await prisma.worker.findMany({
      where: { isActive: true, NOT: { userId: user.id } },
      select: { id: true, firstName: true, lastName: true },
      orderBy: [{ firstName: 'asc' }, { lastName: 'asc' }],
    });
    return workers.map((w) => ({ id: w.id, name: `${w.firstName} ${w.lastName}`.trim() }));
  });

  app.get('/replacement-candidates', { preHandler: [authenticate, requireAnyRole] }, async (req, reply) => {
    const user = (req as any).user;
    const { shiftId } = req.query as { shiftId?: string };
    if (!shiftId) return reply.status(400).send({ error: 'shiftId is required' });
    const worker = await prisma.worker.findUnique({ where: { userId: user.id }, select: { id: true } });
    if (!worker) return reply.status(403).send({ error: 'Worker profile not found' });
    const candidates = await findEligibleReplacementCandidates(shiftId, worker.id);
    if (!candidates) return reply.status(404).send({ error: 'Shift not found' });
    return candidates.map(({ id, name }) => ({ id, name }));
  });

  // Worker: update own contact details (phone, email, home area).
  app.patch('/me', { preHandler: [authenticate, requireAnyRole] }, async (req, reply) => {
    const user = (req as any).user;
    const worker = await prisma.worker.findUnique({ where: { userId: user.id } });
    if (!worker) return reply.status(404).send({ error: 'Worker profile not found' });
    const body = UpdateWorkerProfileSchema.parse(req.body);
    const updated = await prisma.worker.update({ where: { id: worker.id }, data: normalizeWorkerData(body) });
    const { hourlyWage, dailyPaymentAmount, internalNotes, ...safe } = updated;
    return safe;
  });

  // Worker: list own availability blocks
  app.get('/me/availability', { preHandler: [authenticate, requireAnyRole] }, async (req, reply) => {
    const user = (req as any).user;
    const worker = await prisma.worker.findUnique({ where: { userId: user.id } });
    if (!worker) return reply.status(404).send({ error: 'Worker profile not found' });
    return prisma.workerAvailability.findMany({
      where: { workerId: worker.id },
      orderBy: [{ startDate: 'asc' }, { weekday: 'asc' }],
    });
  });

  // Worker: add an availability block
  app.post('/me/availability', { preHandler: [authenticate, requireAnyRole] }, async (req, reply) => {
    const user = (req as any).user;
    const worker = await prisma.worker.findUnique({ where: { userId: user.id } });
    if (!worker) return reply.status(404).send({ error: 'Worker profile not found' });
    const body = CreateWorkerAvailabilitySchema.parse(req.body);

    const conflicts = await findAvailabilityConflicts(worker.id, body);
    if (conflicts.length) {
      return reply.status(409).send({
        error: 'AVAILABILITY_CONFLICT',
        message: 'כבר קיימת משמרת בזמן שסימנת. יש למצוא מחליפה לפני שמירת אי-הזמינות.',
        conflicts,
      });
    }

    const created = await prisma.workerAvailability.create({
      data: {
        workerId: worker.id,
        type: body.type,
        startDate: body.startDate ? new Date(body.startDate) : null,
        endDate: body.endDate ? new Date(body.endDate) : null,
        weekday: body.weekday ?? null,
        reason: body.reason ?? null,
        startTime: body.startTime ?? null,
        endTime: body.endTime ?? null,
      },
    });
    reply.status(201);
    return created;
  });

  app.patch('/me/availability/:id', { preHandler: [authenticate, requireAnyRole] }, async (req, reply) => {
    const user = (req as any).user;
    const { id } = req.params as { id: string };
    const worker = await prisma.worker.findUnique({ where: { userId: user.id } });
    if (!worker) return reply.status(404).send({ error: 'Worker profile not found' });
    const existing = await prisma.workerAvailability.findUnique({ where: { id } });
    if (!existing || existing.workerId !== worker.id) return reply.status(404).send({ error: 'Not found' });
    const body = CreateWorkerAvailabilitySchema.parse(req.body);

    const conflicts = await findAvailabilityConflicts(worker.id, body);
    if (conflicts.length) {
      return reply.status(409).send({
        error: 'AVAILABILITY_CONFLICT',
        message: 'כבר קיימת משמרת בזמן שסימנת. יש למצוא מחליפה לפני שמירת אי-הזמינות.',
        conflicts,
      });
    }

    return prisma.workerAvailability.update({
      where: { id },
      data: {
        type: body.type,
        startDate: body.startDate ? new Date(body.startDate) : null,
        endDate: body.endDate ? new Date(body.endDate) : null,
        weekday: body.weekday ?? null,
        reason: body.reason ?? null,
        startTime: body.startTime ?? null,
        endTime: body.endTime ?? null,
      },
    });
  });

  // Worker: remove one of their availability blocks
  app.delete('/me/availability/:id', { preHandler: [authenticate, requireAnyRole] }, async (req, reply) => {
    const user = (req as any).user;
    const { id } = req.params as { id: string };
    const worker = await prisma.worker.findUnique({ where: { userId: user.id } });
    if (!worker) return reply.status(404).send({ error: 'Worker profile not found' });
    const block = await prisma.workerAvailability.findUnique({ where: { id } });
    if (!block || block.workerId !== worker.id) return reply.status(404).send({ error: 'Not found' });
    await prisma.workerAvailability.delete({ where: { id } });
    reply.status(204);
    return null;
  });

  app.post('/', { preHandler: [authenticate, requireAdmin] }, async (req, reply) => {
    const body = CreateWorkerSchema.parse(req.body);
    let userId = (req.body as any).userId as string | undefined;
    // If no Clerk account was provided, create a placeholder user so the worker
    // record can exist and be managed in the app. (Future: provision a real
    // Clerk login here with a starter password the worker changes on first sign-in.)
    if (!userId) {
      userId = `local-worker-${randomUUID()}`;
      await prisma.user.create({
        data: {
          id: userId,
          email: body.email,
          firstName: body.firstName,
          lastName: body.lastName ?? '',
          role: UserRole.WORKER,
          isActive: true,
        },
      });
    }
    const worker = await prisma.worker.create({ data: { ...normalizeWorkerData(body), userId } });
    reply.status(201);
    return worker;
  });

  app.patch('/:id', { preHandler: [authenticate, requireAdmin] }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = UpdateWorkerSchema.parse(req.body);
    const user = (req as any).user;
    const includesSensitiveFinancials = [
      'hourlyWage',
      'dailyPaymentAmount',
      'bankNumber',
      'bankBranch',
      'bankAccountNumber',
      'bankAccountHolder',
    ].some((field) => Object.prototype.hasOwnProperty.call(body, field));
    if (user.role !== UserRole.OWNER && includesSensitiveFinancials) {
      return reply.status(403).send({ error: 'Only the owner may update sensitive financial details' });
    }
    return prisma.worker.update({ where: { id }, data: normalizeWorkerData(body) as any });
  });

  // Admin: invite / link a worker to a login account by email.
  // - No Clerk account yet → replace any pending invitation and send a fresh one.
  // - Clerk account exists → link the worker directly so the existing account can sign in.
  app.post('/:id/link-login', { preHandler: [authenticate, requireAdmin] }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const email = String((req.body as any)?.email ?? '').trim().toLowerCase();
    if (!email || !email.includes('@')) return reply.status(400).send({ error: 'A valid email is required' });

    const worker = await prisma.worker.findUnique({ where: { id } });
    if (!worker) return reply.status(404).send({ error: 'Worker not found' });

    const emailWorker = await prisma.worker.findUnique({ where: { email } });
    if (emailWorker && emailWorker.id !== worker.id) {
      return reply.status(409).send({ error: 'Another worker already uses this email' });
    }

    if (!process.env.CLERK_SECRET_KEY) {
      return reply.status(503).send({ error: 'Worker invitations are not configured' });
    }

    let clerkUser;
    try {
      const users = await clerk.users.getUserList({ emailAddress: [email], limit: 10 });
      clerkUser = users.data.find((candidate) =>
        candidate.emailAddresses.some((address) => address.emailAddress.toLowerCase() === email),
      );
    } catch (err) {
      req.log.error({ err }, 'Failed to look up Clerk worker account');
      return reply.status(502).send({ error: 'Could not check the worker login account' });
    }

    if (clerkUser) {
      const [clerkDbUser, emailDbUser, linkedWorker] = await Promise.all([
        prisma.user.findUnique({ where: { id: clerkUser.id } }),
        prisma.user.findUnique({ where: { email } }),
        prisma.worker.findUnique({ where: { userId: clerkUser.id } }),
      ]);
      if (linkedWorker && linkedWorker.id !== worker.id) {
        return reply.status(409).send({ error: 'This login is already linked to another worker' });
      }
      const privilegedUser = [clerkDbUser, emailDbUser].find(
        (candidate) =>
          candidate &&
          (candidate.role === UserRole.OWNER || candidate.role === UserRole.ADMIN),
      );
      if (privilegedUser) {
        return reply.status(409).send({ error: 'This email belongs to an owner or administrator' });
      }

      const previousUserId = worker.userId;
      await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
        if (previousUserId !== clerkUser.id) {
          await tx.user.updateMany({
            where: { id: previousUserId, email },
            data: { email: `migrated+${previousUserId}@spaceorder.local`, isActive: false },
          });
        }
        await tx.user.upsert({
          where: { id: clerkUser.id },
          update: {
            email,
            firstName: clerkUser.firstName ?? worker.firstName,
            lastName: clerkUser.lastName ?? worker.lastName,
            role: UserRole.WORKER,
            isActive: true,
          },
          create: {
            id: clerkUser.id,
            email,
            firstName: clerkUser.firstName ?? worker.firstName,
            lastName: clerkUser.lastName ?? worker.lastName,
            role: UserRole.WORKER,
            isActive: true,
          },
        });
        await tx.worker.update({ where: { id }, data: { userId: clerkUser.id, email } });
      });
      await clerk.users.updateUserMetadata(clerkUser.id, {
        publicMetadata: { role: UserRole.WORKER },
      });
      if (previousUserId !== clerkUser.id) {
        await prisma.user.delete({ where: { id: previousUserId } }).catch(() => undefined);
      }
      return { linked: true, existingAccount: true };
    }

    if (worker.email !== email) {
      await prisma.worker.update({ where: { id }, data: { email } });
    }

    try {
      const invitations = await clerk.invitations.getInvitationList({ status: 'pending', query: email });
      const pendingForEmail = invitations.data.filter(
        (invitation) => invitation.emailAddress.toLowerCase() === email,
      );
      await Promise.all(
        pendingForEmail.map((invitation) => clerk.invitations.revokeInvitation(invitation.id)),
      );
      await clerk.invitations.createInvitation({
        emailAddress: email,
        publicMetadata: { role: UserRole.WORKER },
        redirectUrl: process.env.NEXT_PUBLIC_APP_URL
          ? `${process.env.NEXT_PUBLIC_APP_URL.replace(/\/$/, '')}/sign-up`
          : undefined,
        ignoreExisting: false,
      });
      return { invited: true };
    } catch (err) {
      req.log.error({ err }, 'Failed to resend Clerk worker invitation');
      return reply.status(502).send({ error: 'Could not send the worker invitation' });
    }
  });

  // Update push token (worker self-service)
  app.post('/push-token', { preHandler: [authenticate, requireAnyRole] }, async (req, reply) => {
    const user = (req as any).user;
    const { token } = req.body as { token: string };
    const worker = await prisma.worker.findUnique({ where: { userId: user.id } });
    if (!worker) return reply.status(404).send({ error: 'Worker not found' });
    await prisma.worker.update({ where: { id: worker.id }, data: { expoPushToken: token } });
    return { success: true };
  });

  // Deactivate worker
  app.delete('/:id', { preHandler: [authenticate, requireAdmin] }, async (req, reply) => {
    const { id } = req.params as { id: string };
    await prisma.worker.update({ where: { id }, data: { isActive: false } });
    return { success: true };
  });
}

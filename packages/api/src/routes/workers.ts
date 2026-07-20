import { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import { createClerkClient } from '@clerk/clerk-sdk-node';
import { prisma } from '../lib/prisma.js';
import { authenticate, requireAdmin, requireAnyRole } from '../middleware/auth.js';
import { CreateWorkerSchema, UpdateWorkerSchema, CreateWorkerAvailabilitySchema, UpdateWorkerProfileSchema, UserRole, rankWorkerAvailability, findCandidateDates, isUnavailableOn } from '@workforce/shared';

const clerk = createClerkClient({ secretKey: process.env.CLERK_SECRET_KEY });

export async function workersRoutes(app: FastifyInstance) {
  app.get('/', { preHandler: [authenticate, requireAdmin] }, async (req, reply) => {
    return prisma.worker.findMany({
      where: { isActive: true },
      select: {
        id: true, firstName: true, lastName: true, phone: true, email: true,
        skills: true, isActive: true, paymentMethod: true,
        // Wages are owner/admin-only; this route is admin-guarded so they are safe to return.
        hourlyWage: true, dailyPaymentAmount: true,
      },
      orderBy: { firstName: 'asc' },
    });
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
        availability: { select: { type: true, startDate: true, endDate: true, weekday: true } },
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
    return worker;
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

  // Worker: update own contact details (phone, email, home area).
  app.patch('/me', { preHandler: [authenticate, requireAnyRole] }, async (req, reply) => {
    const user = (req as any).user;
    const worker = await prisma.worker.findUnique({ where: { userId: user.id } });
    if (!worker) return reply.status(404).send({ error: 'Worker profile not found' });
    const body = UpdateWorkerProfileSchema.parse(req.body);
    const updated = await prisma.worker.update({ where: { id: worker.id }, data: body });
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

    // Assigned dates cannot be blocked (acceptance criteria §Availability).
    if (body.type === 'DATE' || body.type === 'RANGE') {
      const startKey = body.startDate!.slice(0, 10);
      const endKey = (body.type === 'RANGE' ? body.endDate! : body.startDate!).slice(0, 10);
      const start = new Date(`${startKey}T00:00:00.000Z`);
      const endExclusive = new Date(`${endKey}T00:00:00.000Z`);
      endExclusive.setUTCDate(endExclusive.getUTCDate() + 1);
      const conflict = await prisma.shift.findFirst({
        where: {
          workerId: worker.id,
          joinRequestStatus: 'APPROVED',
          job: { date: { gte: start, lt: endExclusive } },
        },
      });
      if (conflict) {
        return reply.status(409).send({ error: 'You are already assigned to a shift on one of these dates' });
      }
    }

    const created = await prisma.workerAvailability.create({
      data: {
        workerId: worker.id,
        type: body.type,
        startDate: body.startDate ? new Date(body.startDate) : null,
        endDate: body.endDate ? new Date(body.endDate) : null,
        weekday: body.weekday ?? null,
        reason: body.reason ?? null,
      },
    });
    reply.status(201);
    return created;
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
    const worker = await prisma.worker.create({ data: { ...body, userId } });
    reply.status(201);
    return worker;
  });

  app.patch('/:id', { preHandler: [authenticate, requireAdmin] }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = UpdateWorkerSchema.parse(req.body);
    return prisma.worker.update({ where: { id }, data: body as any });
  });

  // Admin: invite / link a worker to a login account by email.
  // - No account yet  → send a Clerk sign-up invitation (role WORKER) so the
  //   worker gets an email with a sign-up link, and align the profile email so
  //   first-login auto-links.
  // - Account exists  → set it to role WORKER and relink the profile to it.
  app.post('/:id/link-login', { preHandler: [authenticate, requireAdmin] }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const email = String((req.body as any)?.email ?? '').trim().toLowerCase();
    if (!email || !email.includes('@')) return reply.status(400).send({ error: 'A valid email is required' });

    const worker = await prisma.worker.findUnique({ where: { id } });
    if (!worker) return reply.status(404).send({ error: 'Worker not found' });

    const loginUser = await prisma.user.findUnique({ where: { email } });

    if (!loginUser) {
      // Align the profile email so the first sign-in links itself.
      if (worker.email !== email) {
        const emailTaken = await prisma.worker.findUnique({ where: { email } });
        if (emailTaken && emailTaken.id !== worker.id) {
          return reply.status(409).send({ error: 'Another worker already uses this email' });
        }
        await prisma.worker.update({ where: { id }, data: { email } });
      }

      // Send a Clerk invitation so the worker receives a sign-up link by email.
      if (!process.env.CLERK_SECRET_KEY) {
        return { invited: false, pendingFirstLogin: true };
      }
      try {
        await clerk.invitations.createInvitation({
          emailAddress: email,
          publicMetadata: { role: UserRole.WORKER },
          redirectUrl: process.env.NEXT_PUBLIC_APP_URL
            ? `${process.env.NEXT_PUBLIC_APP_URL.replace(/\/$/, '')}/sign-up`
            : undefined,
          ignoreExisting: true,
        });
        return { invited: true };
      } catch (err) {
        req.log.error({ err }, 'Failed to send Clerk worker invitation');
        // A Clerk account may already exist without a DB user yet — she can just sign in.
        return { invited: false, pendingFirstLogin: true };
      }
    }

    // Make sure this login isn't already tied to a different worker.
    const otherWorker = await prisma.worker.findUnique({ where: { userId: loginUser.id } });
    if (otherWorker && otherWorker.id !== worker.id) {
      return reply.status(409).send({ error: 'This login is already linked to another worker' });
    }

    const previousUserId = worker.userId;
    await prisma.worker.update({ where: { id }, data: { userId: loginUser.id, email } });
    await prisma.user.update({ where: { id: loginUser.id }, data: { role: UserRole.WORKER } });
    // Keep Clerk metadata in sync so the web app routes/guards this login as a worker.
    await clerk.users
      .updateUserMetadata(loginUser.id, { publicMetadata: { role: UserRole.WORKER } })
      .catch(() => undefined);
    // Remove the now-orphaned placeholder login (best-effort).
    if (previousUserId && previousUserId !== loginUser.id) {
      await prisma.user.delete({ where: { id: previousUserId } }).catch(() => undefined);
    }
    return { linked: true };
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

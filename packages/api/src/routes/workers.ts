import { FastifyInstance } from 'fastify';
import { prisma } from '../lib/prisma.js';
import { authenticate, requireAdmin, requireAnyRole } from '../middleware/auth.js';
import { CreateWorkerSchema, UpdateWorkerSchema, UserRole, rankWorkerAvailability } from '@workforce/shared';

export async function workersRoutes(app: FastifyInstance) {
  app.get('/', { preHandler: [authenticate, requireAdmin] }, async (req, reply) => {
    return prisma.worker.findMany({
      where: { isActive: true },
      select: {
        id: true, firstName: true, lastName: true, phone: true, email: true,
        skills: true, isActive: true, paymentMethod: true,
        // Wages visible to owner/admin only (filtered in UI too, but filtered here for safety)
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
      },
    });

    const candidates = workers.map((worker) => ({
      id: worker.id,
      name: `${worker.firstName} ${worker.lastName}`.trim(),
      skills: worker.skills as string[],
      isActive: worker.isActive,
      homeArea: worker.homeArea,
      bookedDates: worker.shifts
        .map((shift) => shift.job?.date)
        .filter((date): date is Date => Boolean(date))
        .map((date) => date.toISOString().slice(0, 10)),
    }));

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
        adjustments: { orderBy: { createdAt: 'desc' } },
        workerPayments: { orderBy: { createdAt: 'desc' } },
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

  app.post('/', { preHandler: [authenticate, requireAdmin] }, async (req, reply) => {
    const body = CreateWorkerSchema.parse(req.body);
    // Worker profile is created after Clerk user is created
    // userId must be passed in body (admin creates worker account first in Clerk)
    const worker = await prisma.worker.create({ data: { ...body, userId: (req.body as any).userId } });
    reply.status(201);
    return worker;
  });

  app.patch('/:id', { preHandler: [authenticate, requireAdmin] }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = UpdateWorkerSchema.parse(req.body);
    return prisma.worker.update({ where: { id }, data: body as any });
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

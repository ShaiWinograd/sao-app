import { FastifyInstance } from 'fastify';
import { prisma } from '../lib/prisma.js';
import { authenticate, requireAdmin, requireAnyRole } from '../middleware/auth.js';
import { CreateWorkerSchema, UpdateWorkerSchema, UserRole } from '@workforce/shared';

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

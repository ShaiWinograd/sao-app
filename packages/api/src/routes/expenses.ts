import { FastifyInstance } from 'fastify';
import { prisma } from '../lib/prisma.js';
import { authenticate, requireAdmin, requireOwner } from '../middleware/auth.js';
import { BusinessExpenseSchema } from '@workforce/shared';

export async function expensesRoutes(app: FastifyInstance) {
  // Business expenses (monthly overhead)
  app.get('/business', { preHandler: [authenticate, requireOwner] }, async (req, reply) => {
    const { month, year } = req.query as { month: string; year: string };
    return prisma.businessExpense.findMany({
      where: {
        ...(month ? { month: Number(month) } : {}),
        ...(year ? { year: Number(year) } : {}),
      },
      orderBy: { date: 'desc' },
    });
  });

  app.post('/business', { preHandler: [authenticate, requireOwner] }, async (req, reply) => {
    const body = BusinessExpenseSchema.parse(req.body);
    const expense = await prisma.businessExpense.create({
      data: { ...body, date: new Date(body.date) },
    });
    reply.status(201);
    return expense;
  });

  app.patch('/business/:id', { preHandler: [authenticate, requireOwner] }, async (req, reply) => {
    const { id } = req.params as { id: string };
    return prisma.businessExpense.update({ where: { id }, data: req.body as any });
  });

  app.delete('/business/:id', { preHandler: [authenticate, requireOwner] }, async (req, reply) => {
    const { id } = req.params as { id: string };
    await prisma.businessExpense.delete({ where: { id } });
    return { success: true };
  });

  // Job-specific expenses
  app.get('/job/:jobId', { preHandler: [authenticate, requireAdmin] }, async (req, reply) => {
    const { jobId } = req.params as { jobId: string };
    return prisma.jobExpense.findMany({ where: { jobId } });
  });

  app.post('/job', { preHandler: [authenticate, requireAdmin] }, async (req, reply) => {
    const body = req.body as any;
    const expense = await prisma.jobExpense.create({ data: body });
    reply.status(201);
    return expense;
  });
}

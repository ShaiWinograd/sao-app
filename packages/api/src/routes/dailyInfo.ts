import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { logAudit } from '../lib/audit.js';
import { authenticate, requireAdmin, requireAnyRole } from '../middleware/auth.js';

const DateKeySchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const DailyInfoSchema = z
  .object({
    title: z.string().trim().max(100),
    body: z.string().trim().max(1000),
  })
  .refine((value) => value.title.length > 0 || value.body.length > 0, {
    message: 'יש להזין כותרת או הודעה',
  });

function toUtcDate(dateKey: string): Date {
  return new Date(`${dateKey}T00:00:00.000Z`);
}

export async function dailyInfoRoutes(app: FastifyInstance) {
  app.get('/', { preHandler: [authenticate, requireAnyRole] }, async (req, reply) => {
    const query = z.object({ start: DateKeySchema, end: DateKeySchema }).parse(req.query);
    if (query.start > query.end) {
      return reply.status(400).send({ error: 'טווח התאריכים אינו תקין' });
    }
    const start = toUtcDate(query.start);
    const end = toUtcDate(query.end);
    if ((end.getTime() - start.getTime()) / 86_400_000 > 62) {
      return reply.status(400).send({ error: 'טווח המידע היומי מוגבל ל־63 ימים' });
    }

    const entries = await prisma.dailyInfo.findMany({
      where: { date: { gte: start, lte: end } },
      orderBy: { date: 'asc' },
    });
    return entries.map((entry) => ({
      id: entry.id,
      dateKey: entry.date.toISOString().slice(0, 10),
      title: entry.title,
      body: entry.body,
      updatedAt: entry.updatedAt.toISOString(),
    }));
  });

  app.put('/:dateKey', { preHandler: [authenticate, requireAdmin] }, async (req) => {
    const { dateKey } = z.object({ dateKey: DateKeySchema }).parse(req.params);
    const body = DailyInfoSchema.parse(req.body);
    const actor = (req as any).user;
    const existing = await prisma.dailyInfo.findUnique({ where: { date: toUtcDate(dateKey) } });
    const entry = await prisma.dailyInfo.upsert({
      where: { date: toUtcDate(dateKey) },
      create: {
        date: toUtcDate(dateKey),
        title: body.title,
        body: body.body,
        createdByUserId: actor.id,
      },
      update: {
        title: body.title,
        body: body.body,
        createdByUserId: actor.id,
      },
    });
    await logAudit(
      actor,
      existing ? 'UPDATE' : 'CREATE',
      'DailyInfo',
      entry.id,
      existing ? { title: existing.title, body: existing.body, date: dateKey } : null,
      { title: entry.title, body: entry.body, date: dateKey },
      'daily-info',
    );
    return {
      id: entry.id,
      dateKey,
      title: entry.title,
      body: entry.body,
      updatedAt: entry.updatedAt.toISOString(),
    };
  });

  app.delete('/:dateKey', { preHandler: [authenticate, requireAdmin] }, async (req, reply) => {
    const { dateKey } = z.object({ dateKey: DateKeySchema }).parse(req.params);
    const existing = await prisma.dailyInfo.findUnique({ where: { date: toUtcDate(dateKey) } });
    if (!existing) return reply.status(204).send();
    await prisma.dailyInfo.delete({ where: { id: existing.id } });
    await logAudit(
      (req as any).user,
      'DELETE',
      'DailyInfo',
      existing.id,
      { title: existing.title, body: existing.body, date: dateKey },
      null,
      'daily-info',
    );
    return reply.status(204).send();
  });
}

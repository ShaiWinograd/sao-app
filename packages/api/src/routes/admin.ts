import { FastifyInstance } from 'fastify';
import { prisma } from '../lib/prisma.js';
import { UserRole } from '@workforce/shared';

/**
 * Demo workers seeded via the guarded seed endpoint. Each worker is backed by a
 * synthetic User row (role WORKER) because Worker.userId is a required FK.
 */
const DEMO_WORKERS = [
  { key: 'david-cohen', firstName: 'דוד', lastName: 'כהן', phone: '0501234561', email: 'david.cohen@sao.local', hourlyWage: 45, dailyPaymentAmount: 400, paymentMethod: 'BANK_TRANSFER', skills: ['SHIFT_LEADER', 'DRIVER'], homeArea: 'מרכז' },
  { key: 'moshe-levi', firstName: 'משה', lastName: 'לוי', phone: '0501234562', email: 'moshe.levi@sao.local', hourlyWage: 40, dailyPaymentAmount: 360, paymentMethod: 'BIT', skills: ['PACKING_SPECIALIST', 'GENERAL_WORKER'], homeArea: 'שרון' },
  { key: 'yossi-mizrahi', firstName: 'יוסי', lastName: 'מזרחי', phone: '0501234563', email: 'yossi.mizrahi@sao.local', hourlyWage: 42, dailyPaymentAmount: 380, paymentMethod: 'CASH', skills: ['UNPACKING_SPECIALIST', 'ORGANIZATION_SPECIALIST'], homeArea: 'מרכז' },
  { key: 'avi-peretz', firstName: 'אבי', lastName: 'פרץ', phone: '0501234564', email: 'avi.peretz@sao.local', hourlyWage: 38, dailyPaymentAmount: 340, paymentMethod: 'BANK_TRANSFER', skills: ['GENERAL_WORKER', 'DRIVER'], homeArea: 'דרום' },
  { key: 'ron-azoulay', firstName: 'רון', lastName: 'אזולאי', phone: '0501234565', email: 'ron.azoulay@sao.local', hourlyWage: 50, dailyPaymentAmount: 450, paymentMethod: 'BANK_TRANSFER', skills: ['SHIFT_LEADER', 'ORGANIZATION_SPECIALIST'], homeArea: 'ירושלים' },
  { key: 'noam-biton', firstName: 'נועם', lastName: 'ביטון', phone: '0501234566', email: 'noam.biton@sao.local', hourlyWage: 36, dailyPaymentAmount: 320, paymentMethod: 'CASH', skills: ['PACKING_SPECIALIST', 'UNPACKING_SPECIALIST'], homeArea: 'צפון' },
] as const;

export async function adminRoutes(app: FastifyInstance) {
  // One-shot demo data seeding. Guarded by BOOTSTRAP_SECRET: the endpoint is
  // inert unless the env var is set AND the request carries a matching
  // `x-seed-secret` header. Unset BOOTSTRAP_SECRET to disable it entirely.
  app.post('/seed', async (req, reply) => {
    const secret = process.env.BOOTSTRAP_SECRET;
    if (!secret) return reply.status(404).send({ error: 'Not found' });
    if (req.headers['x-seed-secret'] !== secret) {
      return reply.status(403).send({ error: 'Forbidden' });
    }

    let created = 0;
    for (const w of DEMO_WORKERS) {
      const userId = `seed-worker-${w.key}`;
      await prisma.user.upsert({
        where: { id: userId },
        update: {},
        create: {
          id: userId,
          email: w.email,
          firstName: w.firstName,
          lastName: w.lastName,
          role: UserRole.WORKER,
          isActive: true,
        },
      });
      await prisma.worker.upsert({
        where: { userId },
        update: {},
        create: {
          userId,
          firstName: w.firstName,
          lastName: w.lastName,
          phone: w.phone,
          email: w.email,
          hourlyWage: w.hourlyWage,
          dailyPaymentAmount: w.dailyPaymentAmount,
          paymentMethod: w.paymentMethod as never,
          skills: w.skills as unknown as never,
          homeArea: w.homeArea,
          isActive: true,
        },
      });
      created += 1;
    }

    const totalWorkers = await prisma.worker.count();
    return { seeded: created, totalWorkers };
  });
}

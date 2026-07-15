import { FastifyInstance } from 'fastify';
import { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma.js';
import { deleteCaseCascade } from '../lib/deleteCase.js';
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

  // One-shot seed of the real "Cara Paley" interior-design quotation (from the
  // owner's actual Word quote) so the full customer-facing quotation renders
  // end-to-end. Same BOOTSTRAP_SECRET guard as /seed. Idempotent per customer.
  app.post('/seed-quote', async (req, reply) => {
    const secret = process.env.BOOTSTRAP_SECRET;
    if (!secret) return reply.status(404).send({ error: 'Not found' });
    if (req.headers['x-seed-secret'] !== secret) {
      return reply.status(403).send({ error: 'Forbidden' });
    }

    const email = 'cara.paley@sao.local';
    let customer = await prisma.customer.findFirst({ where: { email } });
    if (!customer) {
      customer = await prisma.customer.create({
        data: { firstName: 'Cara', lastName: 'Paley', phone: '-', email },
      });
    }

    const caseName = 'Interior Design and Styling – Cara Paley';
    let kase = await prisma.customerCase.findFirst({
      where: { customerId: customer.id, name: caseName },
    });
    if (!kase) {
      kase = await prisma.customerCase.create({
        data: { customerId: customer.id, name: caseName, status: 'ACTIVE' },
      });
    }

    const existing = await prisma.quotation.findFirst({ where: { caseId: kase.id } });
    if (existing) {
      return { alreadySeeded: true, quotationId: existing.id, link: `/q/${existing.id}` };
    }

    const details = {
      scopeOfWork: 'Interior Design and Styling',
      projectStartDate: '2026-07-10',
      projectEndDate: '2026-09-10',
      lineItems: [
        {
          description: 'Full Home Design: color and materials concept',
          detail:
            'Furniture layout, furniture selection based on an agreed list, selection of materials and colors, curtains, and textiles.',
          price: 5500,
        },
        {
          description: 'Materials and inspiration presentation, including links to recommended products.',
        },
        {
          description: 'In-person shopping days (optional)',
          detail: 'The proposal does not include in-person shopping days. These can be added as an optional service.',
          hours: 'per day',
          price: 1300,
        },
      ],
      depositAmount: 2500,
      depositDueDate: '2026-07-10',
    };

    const quotation = await prisma.quotation.create({
      data: {
        caseId: kase.id,
        status: 'SENT',
        versions: {
          create: {
            versionNumber: 1,
            status: 'SENT',
            sentAt: new Date(),
            estimatedTotal: 5500,
            includedServices: [
              'Full Home Design: color and materials concept',
              'Materials and inspiration presentation',
            ],
            datePrecision: 'EXACT',
            details: details as never,
          },
        },
      },
    });

    return { seeded: true, quotationId: quotation.id, link: `/q/${quotation.id}` };
  });

  // One-shot cleanup of the seeded demo workers (email @sao.local, user id
  // seed-worker-*) so the owner starts from a clean list. Same BOOTSTRAP_SECRET
  // guard. Hard delete — demo workers have no shifts/payments referencing them.
  app.post('/delete-demo-workers', async (req, reply) => {
    const secret = process.env.BOOTSTRAP_SECRET;
    if (!secret) return reply.status(404).send({ error: 'Not found' });
    if (req.headers['x-seed-secret'] !== secret) {
      return reply.status(403).send({ error: 'Forbidden' });
    }

    const deletedWorkers = await prisma.worker.deleteMany({
      where: { email: { endsWith: '@sao.local' } },
    });
    const deletedUsers = await prisma.user.deleteMany({
      where: { id: { startsWith: 'seed-worker-' } },
    });

    const remaining = await prisma.worker.count();
    return { deletedWorkers: deletedWorkers.count, deletedUsers: deletedUsers.count, remainingWorkers: remaining };
  });

  // One-shot wipe of ALL customer cases (projects) and their dependent records,
  // for a clean start. Same BOOTSTRAP_SECRET guard. Does not touch workers.
  app.post('/wipe-cases', async (req, reply) => {
    const secret = process.env.BOOTSTRAP_SECRET;
    if (!secret) return reply.status(404).send({ error: 'Not found' });
    if (req.headers['x-seed-secret'] !== secret) {
      return reply.status(403).send({ error: 'Forbidden' });
    }

    const cases = await prisma.customerCase.findMany({ select: { id: true } });
    for (const c of cases) {
      await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
        await deleteCaseCascade(tx, c.id);
      });
    }

    const remaining = await prisma.customerCase.count();
    return { deletedCases: cases.length, remainingCases: remaining };
  });

  // Full data reset for a clean testing slate: wipes all projects, customers,
  // addresses and workers (keeps owner/admin logins). BOOTSTRAP_SECRET guarded.
  app.post('/reset-data', async (req, reply) => {
    const secret = process.env.BOOTSTRAP_SECRET;
    if (!secret) return reply.status(404).send({ error: 'Not found' });
    if (req.headers['x-seed-secret'] !== secret) {
      return reply.status(403).send({ error: 'Forbidden' });
    }

    const cases = await prisma.customerCase.findMany({ select: { id: true } });
    for (const c of cases) {
      await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
        await deleteCaseCascade(tx, c.id);
      });
    }

    await prisma.address.deleteMany({});
    const customers = await prisma.customer.deleteMany({});
    await prisma.workerPayment.deleteMany({});
    await prisma.workerAdjustment.deleteMany({});
    const workers = await prisma.worker.deleteMany({});
    await prisma.user.deleteMany({ where: { role: UserRole.WORKER } });

    return {
      deletedCases: cases.length,
      deletedCustomers: customers.count,
      deletedWorkers: workers.count,
    };
  });
}


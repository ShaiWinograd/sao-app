import { FastifyInstance } from 'fastify';
import { Prisma } from '@prisma/client';
import { createClerkClient } from '@clerk/clerk-sdk-node';
import { prisma } from '../lib/prisma.js';
import { deleteCaseCascade } from '../lib/deleteCase.js';
import { authenticate, requireAdmin } from '../middleware/auth.js';
import { UserRole, TeamInviteSchema } from '@workforce/shared';
import { countReadyCases } from '../domain/customerReport.js';

const clerk = createClerkClient({ secretKey: process.env.CLERK_SECRET_KEY });

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
  // Aggregated owner action items for the dashboard (integration spec §21).
  app.get('/tasks', { preHandler: [authenticate, requireAdmin] }, async () => {
    const [joinRequests, pendingAcceptance, replacementRequests, swapApprovals, attendanceReview, reportCorrections, customerReportReady] = await Promise.all([
      prisma.shift.count({ where: { joinRequestStatus: 'PENDING' } }),
      prisma.shift.count({ where: { joinRequestStatus: 'AWAITING_WORKER' } }),
      prisma.replacementRequest.count({ where: { status: 'PENDING' } }),
      prisma.shiftSwap.count({ where: { status: 'PENDING_OWNER' } }),
      // §16: attendance needing owner review — missing-clock-in proposals,
      // out-of-range / no-permission clock-ins, and automatic clock-outs. Missing
      // end forms are intentionally NOT here (they are informational — §17.3).
      prisma.shift.count({ where: { requiresReview: true } }),
      prisma.workerMonthlyReport.count({ where: { status: 'CORRECTION_REQUESTED' } }),
      // §18.1: cases ready for a customer report (owner action possible).
      countReadyCases(prisma),
    ]);
    return { joinRequests, pendingAcceptance, replacementRequests, swapApprovals, attendanceReview, reportCorrections, customerReportReady };
  });

  // Pending worker join requests across all jobs, for the owner's Requires
  // Attention side panel (spec item 8). Each row carries the shiftId so the panel
  // can approve/reject inline via POST /shifts/:shiftId/approve — no navigating to
  // a generic jobs board.
  app.get('/join-requests', { preHandler: [authenticate, requireAdmin] }, async () => {
    const shifts = await prisma.shift.findMany({
      where: { joinRequestStatus: 'PENDING' },
      select: {
        id: true,
        createdAt: true,
        worker: { select: { firstName: true, lastName: true } },
        job: {
          select: {
            id: true,
            jobType: true,
            date: true,
            plannedStart: true,
            plannedEnd: true,
            requiredWorkerCount: true,
            customer: { select: { firstName: true, lastName: true } },
            address: { select: { fullAddress: true } },
          },
        },
      },
      orderBy: { createdAt: 'asc' },
    });
    return shifts.map((s) => ({
      shiftId: s.id,
      requestedAt: s.createdAt,
      workerName: `${s.worker?.firstName ?? ''} ${s.worker?.lastName ?? ''}`.trim(),
      jobId: s.job.id,
      jobType: s.job.jobType,
      date: s.job.date,
      customerName: `${s.job.customer?.firstName ?? ''} ${s.job.customer?.lastName ?? ''}`.trim(),
      address: s.job.address?.fullAddress ?? '',
    }));
  });

  // Invite an owner/admin team member by email (no worker profile). The invited
  // role is carried in the Clerk invitation metadata and wins over any worker
  // match on first login. Only owners may invite owners.
  app.post('/invite', { preHandler: [authenticate, requireAdmin] }, async (req, reply) => {
    const caller = (req as any).user;
    const body = TeamInviteSchema.parse(req.body);
    if (body.role === UserRole.OWNER && caller.role !== UserRole.OWNER) {
      return reply.status(403).send({ error: 'Only an owner can invite another owner' });
    }
    if (!process.env.CLERK_SECRET_KEY) {
      return reply.status(503).send({ error: 'Invitations are not configured' });
    }
    try {
      await clerk.invitations.createInvitation({
        emailAddress: body.email.trim().toLowerCase(),
        publicMetadata: { role: body.role },
        redirectUrl: process.env.NEXT_PUBLIC_APP_URL
          ? `${process.env.NEXT_PUBLIC_APP_URL.replace(/\/$/, '')}/sign-up`
          : undefined,
        ignoreExisting: true,
      });
      return { invited: true };
    } catch (err) {
      req.log.error({ err }, 'Failed to send team invitation');
      return reply.status(400).send({ error: 'Could not send the invitation (the account may already exist).' });
    }
  });


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
    const workers = await prisma.worker.deleteMany({});
    await prisma.user.deleteMany({ where: { role: UserRole.WORKER } });

    return {
      deletedCases: cases.length,
      deletedCustomers: customers.count,
      deletedWorkers: workers.count,
    };
  });
}


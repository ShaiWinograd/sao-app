import { FastifyInstance } from 'fastify';
import { prisma } from '../lib/prisma.js';
import { authenticate, requireAdmin, requireOwner, requireAnyRole } from '../middleware/auth.js';
import { WorkerAdjustmentSchema, WorkerPaymentSchema } from '@workforce/shared';
import { UserRole } from '@workforce/shared';
import { money, round2 } from '../lib/money.js';

async function resolveAuditUser(userId?: string) {
  return (
    (userId ? await prisma.user.findUnique({ where: { id: userId }, select: { id: true } }) : null) ??
    (await prisma.user.findFirst({
      where: { role: { in: [UserRole.OWNER, UserRole.ADMIN] }, isActive: true },
      select: { id: true },
    }))
  );
}

async function ensureMonthOpenOrOwner(month: number, year: number, role: UserRole) {
  const closed = await prisma.monthClose.findUnique({ where: { month_year: { month, year } } });
  if (closed && role !== UserRole.OWNER) {
    const error = new Error('Month is closed');
    (error as any).statusCode = 409;
    throw error;
  }
}

export async function workerPayrollRoutes(app: FastifyInstance) {
  // Worker: read-only view of their own monthly earnings.
  app.get('/me', { preHandler: [authenticate, requireAnyRole] }, async (req, reply) => {
    const user = (req as any).user;
    const worker = await prisma.worker.findUnique({ where: { userId: user.id } });
    if (!worker) return reply.status(404).send({ error: 'Worker profile not found' });

    const now = new Date();
    const q = req.query as { month?: string; year?: string };
    const m = Number(q.month) || now.getMonth() + 1;
    const y = Number(q.year) || now.getFullYear();

    const shifts = await prisma.shift.findMany({
      where: {
        workerId: worker.id,
        attendanceStatus: { in: ['CLOCKED_OUT', 'CORRECTED'] },
        job: { date: { gte: new Date(y, m - 1, 1), lt: new Date(y, m, 1) } },
      },
      include: { job: { include: { customer: true } } },
      orderBy: { scheduledStart: 'asc' },
    });
    const adjustments = await prisma.workerAdjustment.findMany({
      where: { workerId: worker.id, payrollMonth: m, payrollYear: y, isIncluded: true },
    });
    const payments = await prisma.workerPayment.findMany({ where: { workerId: worker.id, month: m, year: y } });

    let hourlyPay = 0;
    let dailyPay = 0;
    let totalHours = 0;
    const lines = shifts.map((shift) => {
      const h = money(shift.approvedHours);
      const linePay = h * money(shift.hourlyWageSnapshot) + (shift.isDailyPaymentEligible ? money(shift.dailyPaymentSnapshot) : 0);
      hourlyPay += h * money(shift.hourlyWageSnapshot);
      if (shift.isDailyPaymentEligible) dailyPay += money(shift.dailyPaymentSnapshot);
      totalHours += h;
      return {
        shiftId: shift.id,
        date: shift.job.date,
        customerName: `${shift.job.customer.firstName} ${shift.job.customer.lastName}`.trim(),
        approvedHours: round2(h),
        pay: round2(linePay),
      };
    });

    const adjustmentTotal = adjustments.reduce((s: number, a: any) => s + money(a.amount), 0);
    const totalDue = hourlyPay + dailyPay + adjustmentTotal;
    const totalPaid = payments.reduce((s: number, p: any) => s + money(p.amount), 0);

    return {
      month: m,
      year: y,
      shifts: lines,
      adjustments: adjustments.map((a) => ({ id: a.id, amount: round2(money(a.amount)), reason: a.reason, category: a.category })),
      payments: payments.map((p) => ({ id: p.id, amount: round2(money(p.amount)), paymentDate: p.paymentDate, method: p.method })),
      summary: {
        shiftsCount: shifts.length,
        totalApprovedHours: round2(totalHours),
        hourlyPay: round2(hourlyPay),
        dailyPay: round2(dailyPay),
        adjustmentTotal: round2(adjustmentTotal),
        totalDue: round2(totalDue),
        totalPaid: round2(totalPaid),
        outstanding: round2(totalDue - totalPaid),
        status: totalPaid >= totalDue ? 'PAID' : totalPaid > 0 ? 'PARTIALLY_PAID' : 'NOT_PREPARED',
      },
    };
  });

  app.get('/worker/:workerId', { preHandler: [authenticate, requireAdmin] }, async (req, reply) => {
    const { workerId } = req.params as { workerId: string };
    const { month, year } = req.query as { month: string; year: string };
    const m = Number(month);
    const y = Number(year);

    const shifts = await prisma.shift.findMany({
      where: {
        workerId,
        attendanceStatus: { in: ['CLOCKED_OUT', 'CORRECTED'] },
        job: { date: { gte: new Date(y, m - 1, 1), lt: new Date(y, m, 1) } },
      },
      include: { job: { include: { case: true } } },
    });

    const adjustments = await prisma.workerAdjustment.findMany({
      where: { workerId, payrollMonth: m, payrollYear: y, isIncluded: true },
    });

    const payments = await prisma.workerPayment.findMany({ where: { workerId, month: m, year: y } });

    let hourlyPay = 0;
    let dailyPay = 0;
    let totalHours = 0;

    for (const shift of shifts) {
      const h = money(shift.approvedHours);
      hourlyPay += h * money(shift.hourlyWageSnapshot);
      if (shift.isDailyPaymentEligible) dailyPay += money(shift.dailyPaymentSnapshot);
      totalHours += h;
    }

    const adjustmentTotal = adjustments.reduce((s: number, a: any) => s + money(a.amount), 0);
    const totalDue = hourlyPay + dailyPay + adjustmentTotal;
    const totalPaid = payments.reduce((s: number, p: any) => s + money(p.amount), 0);

    return {
      workerId, month: m, year: y, shifts, adjustments, payments,
      summary: {
        shiftsCount: shifts.length,
        totalApprovedHours: round2(totalHours),
        hourlyPay: round2(hourlyPay),
        dailyPay: round2(dailyPay),
        adjustmentTotal: round2(adjustmentTotal),
        totalDue: round2(totalDue),
        totalPaid: round2(totalPaid),
        outstanding: round2(totalDue - totalPaid),
        status: totalPaid >= totalDue ? 'PAID' : totalPaid > 0 ? 'PARTIALLY_PAID' : 'NOT_PREPARED',
      },
    };
  });

  app.post('/adjustments', { preHandler: [authenticate, requireAdmin] }, async (req, reply) => {
    const user = (req as any).user as { id?: string; role: UserRole };
    const body = WorkerAdjustmentSchema.parse(req.body);
    await ensureMonthOpenOrOwner(body.payrollMonth, body.payrollYear, user.role);
    const adjustment = await prisma.workerAdjustment.create({ data: body as any });
    const auditUser = await resolveAuditUser(user.id);
    if (auditUser) {
      await prisma.auditLog.create({
        data: {
          performedById: auditUser.id,
          action: 'UPDATE',
          entityType: 'WorkerAdjustment',
          entityId: adjustment.id,
          previousValue: undefined,
          newValue: adjustment,
          reason: body.reason,
        },
      });
    }
    reply.status(201);
    return adjustment;
  });

  app.post('/payments', { preHandler: [authenticate, requireAdmin] }, async (req, reply) => {
    const user = (req as any).user as { id?: string; role: UserRole };
    const body = WorkerPaymentSchema.parse(req.body);
    await ensureMonthOpenOrOwner(body.month, body.year, user.role);
    const payment = await prisma.workerPayment.create({ data: { ...body, paymentDate: new Date(body.paymentDate) } });
    const auditUser = await resolveAuditUser(user.id);
    if (auditUser) {
      await prisma.auditLog.create({
        data: {
          performedById: auditUser.id,
          action: 'CREATE',
          entityType: 'WorkerPayment',
          entityId: payment.id,
          previousValue: undefined,
          newValue: payment,
          reason: body.notes ?? body.reference ?? undefined,
        },
      });
    }
    reply.status(201);
    return payment;
  });

  app.get('/summary', { preHandler: [authenticate, requireOwner] }, async (req, reply) => {
    const { month, year } = req.query as { month: string; year: string };
    const workers = await prisma.worker.findMany({ where: { isActive: true }, select: { id: true, firstName: true, lastName: true } });
    return { workers, month, year, message: 'Use /worker/:id endpoint for individual summaries' };
  });
}

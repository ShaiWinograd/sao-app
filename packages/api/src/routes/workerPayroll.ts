import { FastifyInstance } from 'fastify';
import { prisma } from '../lib/prisma.js';
import { authenticate, requireAdmin, requireOwner, requireAnyRole } from '../middleware/auth.js';
import { WorkerAdjustmentSchema, WorkerPaymentSchema, WorkerReportApprovalSchema, WorkerReportNoteSchema } from '@workforce/shared';
import { UserRole } from '@workforce/shared';
import { money, round2 } from '../lib/money.js';
import { buildLinesPdf } from '../lib/pdf.js';
import { latestWorkerReport as latestReport, flagWorkerReportStale as flagReportStale } from '../lib/workerReport.js';

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

// Compute a worker's monthly report payload (work diary + totals) from live data
// (spec §24). The daily fixed payment is added once per worked date via each
// shift's isDailyPaymentEligible flag (the system allows one job per worker/day).
async function computeMonthlyReport(workerId: string, m: number, y: number) {
  const shifts = await prisma.shift.findMany({
    where: {
      workerId,
      attendanceStatus: { in: ['CLOCKED_OUT', 'CORRECTED'] },
      job: { date: { gte: new Date(y, m - 1, 1), lt: new Date(y, m, 1) } },
    },
    include: { job: { include: { customer: true, case: true } } },
    orderBy: { scheduledStart: 'asc' },
  });
  const adjustments = await prisma.workerAdjustment.findMany({
    where: { workerId, payrollMonth: m, payrollYear: y, isIncluded: true },
  });
  const payments = await prisma.workerPayment.findMany({ where: { workerId, month: m, year: y } });

  const JOB_TYPE_LABEL: Record<string, string> = { PACKING: 'אריזה', UNPACKING: 'פריקה', HOME_ORGANIZATION: 'סידור' };
  const heTime = (d: Date) => d.toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Jerusalem' });

  let hourlyPay = 0;
  let dailyPay = 0;
  let totalHours = 0;
  const lines = shifts.map((shift) => {
    const h = money(shift.approvedHours);
    const hp = h * money(shift.hourlyWageSnapshot);
    const dp = shift.isDailyPaymentEligible ? money(shift.dailyPaymentSnapshot) : 0;
    hourlyPay += hp;
    dailyPay += dp;
    totalHours += h;
    return {
      id: shift.id,
      shiftId: shift.id,
      date: shift.job.date.toISOString().slice(0, 10),
      caseName: shift.job.case?.name ?? '',
      shiftLabel: JOB_TYPE_LABEL[shift.job.jobType] ?? shift.job.jobType,
      startTime: heTime(shift.scheduledStart),
      endTime: heTime(shift.scheduledEnd),
      jobType: shift.job.jobType,
      customerName: `${shift.job.customer.firstName} ${shift.job.customer.lastName}`.trim(),
      approvedHours: round2(h),
      hourlyRate: round2(money(shift.hourlyWageSnapshot)),
      dailyPayment: round2(dp),
      pay: round2(hp + dp),
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
      status: totalPaid >= totalDue && totalDue > 0 ? 'PAID' : totalPaid > 0 ? 'PARTIALLY_PAID' : 'NOT_PREPARED',
    },
  };
}

// Latest (current) published version of a worker's monthly report.
// Owner publishes a new immutable version snapshotting the current computed data.
async function publishReportVersion(workerId: string, m: number, y: number, publishedById?: string) {
  const payload = await computeMonthlyReport(workerId, m, y);
  const latest = await latestReport(workerId, m, y);
  const version = (latest?.version ?? 0) + 1;
  const status = version === 1 ? 'PUBLISHED' : 'REVISED';
  return prisma.workerMonthlyReport.create({
    data: { workerId, month: m, year: y, version, status, snapshot: payload as any, publishedById: publishedById ?? null },
  });
}

export async function workerPayrollRoutes(app: FastifyInstance) {
  // Worker: their own monthly report — the published immutable snapshot, or the
  // live draft if the owner has not published yet (spec §24).
  app.get('/me', { preHandler: [authenticate, requireAnyRole] }, async (req, reply) => {
    const user = (req as any).user;
    const worker = await prisma.worker.findUnique({ where: { userId: user.id } });
    if (!worker) return reply.status(404).send({ error: 'Worker profile not found' });

    const now = new Date();
    const q = req.query as { month?: string; year?: string };
    const m = Number(q.month) || now.getMonth() + 1;
    const y = Number(q.year) || now.getFullYear();

    const report = await latestReport(worker.id, m, y);
    const body = report ? (report.snapshot as any) : await computeMonthlyReport(worker.id, m, y);
    const notes = await prisma.workerReportNote.findMany({
      where: { workerId: worker.id, month: m, year: y },
      orderBy: { createdAt: 'desc' },
    });

    return {
      ...body,
      month: m,
      year: y,
      status: report?.status ?? 'DRAFT',
      version: report?.version ?? null,
      isPublished: Boolean(report),
      workerNote: report?.workerNote ?? null,
      paidAt: report?.paidAt ?? null,
      notes: notes.map((n) => ({ id: n.id, shiftId: n.shiftId, type: n.type, message: n.message, createdAt: n.createdAt })),
    };
  });

  // Worker: approve or request a correction on their published monthly report.
  app.post('/me/approval', { preHandler: [authenticate, requireAnyRole] }, async (req, reply) => {
    const user = (req as any).user;
    const worker = await prisma.worker.findUnique({ where: { userId: user.id } });
    if (!worker) return reply.status(404).send({ error: 'Worker profile not found' });

    const body = WorkerReportApprovalSchema.parse(req.body);
    const report = await latestReport(worker.id, body.month, body.year);
    if (!report) return reply.status(409).send({ error: 'אין דוח שפורסם לחודש זה' });
    if (report.status === 'PAID') return reply.status(409).send({ error: 'הדוח כבר סומן כשולם' });

    if (body.action === 'APPROVE') {
      if (!['PUBLISHED', 'REVISED'].includes(report.status)) {
        return reply.status(409).send({ error: 'הדוח אינו ממתין לאישור' });
      }
      const updated = await prisma.workerMonthlyReport.update({
        where: { id: report.id },
        data: { status: 'WORKER_APPROVED', workerApprovedAt: new Date(), workerNote: body.note ?? null },
      });
      const owners = await prisma.user.findMany({
        where: { role: { in: [UserRole.OWNER, UserRole.ADMIN] }, isActive: true },
        select: { id: true },
      });
      if (owners.length) {
        await prisma.notification.createMany({
          data: owners.map((o) => ({
            userId: o.id,
            title: 'דוח חודשי אושר',
            body: `${worker.firstName} ${worker.lastName} אישר/ה את הדוח ל-${body.month}/${body.year}.`,
            data: { type: 'REPORT_APPROVED', workerId: worker.id, month: body.month, year: body.year } as any,
          })),
        });
      }
      return { status: updated.status, version: updated.version, workerApprovedAt: updated.workerApprovedAt };
    }

    // REQUEST_CHANGES → correction requested; owner must publish a new version.
    const updated = await prisma.workerMonthlyReport.update({
      where: { id: report.id },
      data: { status: 'CORRECTION_REQUESTED', workerNote: body.note ?? null },
    });
    const owners = await prisma.user.findMany({
      where: { role: { in: [UserRole.OWNER, UserRole.ADMIN] }, isActive: true },
      select: { id: true },
    });
    if (owners.length) {
      await prisma.notification.createMany({
        data: owners.map((o) => ({
          userId: o.id,
          title: 'בקשת תיקון לדוח חודשי',
          body: `${worker.firstName} ${worker.lastName} ביקש/ה תיקון לדוח ${body.month}/${body.year}.`,
          data: { type: 'REPORT_CHANGES_REQUESTED', workerId: worker.id, month: body.month, year: body.year } as any,
        })),
      });
    }
    return { status: updated.status, version: updated.version, note: updated.workerNote };
  });

  // Worker: download their published monthly report as a PDF (spec §24.3).
  app.get('/me/report.pdf', { preHandler: [authenticate, requireAnyRole] }, async (req, reply) => {
    const user = (req as any).user;
    const worker = await prisma.worker.findUnique({ where: { userId: user.id } });
    if (!worker) return reply.status(404).send({ error: 'Worker profile not found' });

    const now = new Date();
    const q = req.query as { month?: string; year?: string };
    const m = Number(q.month) || now.getMonth() + 1;
    const y = Number(q.year) || now.getFullYear();

    const report = await latestReport(worker.id, m, y);
    if (!report) return reply.status(404).send({ error: 'אין דוח שפורסם לחודש זה' });

    const snap = report.snapshot as any;
    const nis = (n: number) => `${Number(n).toLocaleString('he-IL')} ₪`;
    const heDate = (d: string) => new Date(d).toISOString().slice(0, 10);
    const lines: string[] = [];
    lines.push(`עובד/ת: ${worker.firstName} ${worker.lastName}`);
    lines.push(`חודש: ${m}/${y} · גרסה ${report.version} · ${report.status}`);
    lines.push('');
    for (const s of snap.shifts as any[]) {
      lines.push(`  ${heDate(s.date)} · ${s.customerName} · ${s.approvedHours} שעות · ${nis(s.pay)}`);
    }
    lines.push('');
    lines.push(`שעות מאושרות: ${snap.summary.totalApprovedHours}`);
    lines.push(`תשלום שעתי: ${nis(snap.summary.hourlyPay)}`);
    lines.push(`תשלום יומי קבוע: ${nis(snap.summary.dailyPay)}`);
    if (snap.summary.adjustmentTotal) lines.push(`התאמות: ${nis(snap.summary.adjustmentTotal)}`);
    lines.push(`סה"כ לתשלום: ${nis(snap.summary.totalDue)}`);
    lines.push(`שולם: ${nis(snap.summary.totalPaid)}`);

    const pdf = await buildLinesPdf('דוח חודשי', `${worker.firstName} ${worker.lastName} · ${m}/${y}`, lines);
    reply.header('Content-Type', 'application/pdf');
    reply.header('Content-Disposition', `attachment; filename="worker-report-${y}-${String(m).padStart(2, '0')}.pdf"`);
    return reply.send(pdf);
  });

  // Worker: add a comment on a job or report a missing shift for a month.
  app.post('/me/notes', { preHandler: [authenticate, requireAnyRole] }, async (req, reply) => {
    const user = (req as any).user;
    const worker = await prisma.worker.findUnique({ where: { userId: user.id } });
    if (!worker) return reply.status(404).send({ error: 'Worker profile not found' });

    const body = WorkerReportNoteSchema.parse(req.body);
    // If a shift is referenced, it must belong to this worker.
    if (body.shiftId) {
      const owned = await prisma.shift.findFirst({ where: { id: body.shiftId, workerId: worker.id }, select: { id: true } });
      if (!owned) return reply.status(404).send({ error: 'Shift not found' });
    }

    const note = await prisma.workerReportNote.create({
      data: {
        workerId: worker.id,
        month: body.month,
        year: body.year,
        shiftId: body.shiftId ?? null,
        type: body.type,
        message: body.message,
      },
    });

    const owners = await prisma.user.findMany({
      where: { role: { in: [UserRole.OWNER, UserRole.ADMIN] }, isActive: true },
      select: { id: true },
    });
    if (owners.length) {
      const title = body.type === 'MISSING_SHIFT' ? 'דיווח על משמרת חסרה' : 'הערה לדוח חודשי';
      await prisma.notification.createMany({
        data: owners.map((o) => ({
          userId: o.id,
          title,
          body: `${worker.firstName} ${worker.lastName} · דוח ${body.month}/${body.year}: ${body.message}`,
          data: { type: 'REPORT_NOTE', noteType: body.type, workerId: worker.id, month: body.month, year: body.year } as any,
        })),
      });
    }

    reply.status(201);
    return { id: note.id, shiftId: note.shiftId, type: note.type, message: note.message, createdAt: note.createdAt };
  });

  // Worker: remove one of their own report notes.
  app.delete('/me/notes/:id', { preHandler: [authenticate, requireAnyRole] }, async (req, reply) => {
    const user = (req as any).user;
    const { id } = req.params as { id: string };
    const worker = await prisma.worker.findUnique({ where: { userId: user.id } });
    if (!worker) return reply.status(404).send({ error: 'Worker profile not found' });
    const note = await prisma.workerReportNote.findUnique({ where: { id } });
    if (!note || note.workerId !== worker.id) return reply.status(404).send({ error: 'Not found' });
    await prisma.workerReportNote.delete({ where: { id } });
    reply.status(204);
    return null;
  });

  app.get('/worker/:workerId', { preHandler: [authenticate, requireAdmin] }, async (req, reply) => {
    const { workerId } = req.params as { workerId: string };
    const { month, year } = req.query as { month: string; year: string };
    const m = Number(month);
    const y = Number(year);

    // Live draft (recomputed) plus the published version history (spec §24).
    const draft = await computeMonthlyReport(workerId, m, y);
    const versions = await prisma.workerMonthlyReport.findMany({
      where: { workerId, month: m, year: y },
      orderBy: { version: 'desc' },
    });
    const current = versions[0] ?? null;
    const notes = await prisma.workerReportNote.findMany({
      where: { workerId, month: m, year: y },
      orderBy: { createdAt: 'desc' },
    });

    return {
      workerId,
      ...draft,
      reportStatus: current?.status ?? 'DRAFT',
      version: current?.version ?? null,
      workerNote: current?.workerNote ?? null,
      versions: versions.map((v) => ({ id: v.id, version: v.version, status: v.status, publishedAt: v.publishedAt, workerApprovedAt: v.workerApprovedAt, paidAt: v.paidAt })),
      notes: notes.map((n) => ({ id: n.id, shiftId: n.shiftId, type: n.type, message: n.message, createdAt: n.createdAt })),
    };
  });

  // Owner: publish (or re-publish a corrected) monthly report as a new version.
  app.post('/worker/:workerId/publish', { preHandler: [authenticate, requireAdmin] }, async (req, reply) => {
    const user = (req as any).user as { id?: string; role: UserRole };
    const { workerId } = req.params as { workerId: string };
    const { month, year } = req.body as { month: number; year: number };
    await ensureMonthOpenOrOwner(month, year, user.role);

    const worker = await prisma.worker.findUnique({ where: { id: workerId }, select: { userId: true, firstName: true, lastName: true } });
    if (!worker) return reply.status(404).send({ error: 'Worker not found' });

    const published = await publishReportVersion(workerId, month, year, user.id);
    await prisma.notification.create({
      data: {
        userId: worker.userId,
        title: published.version === 1 ? 'הדוח החודשי פורסם' : 'פורסמה גרסה מעודכנת של הדוח',
        body: `הדוח ל-${month}/${year} זמין לצפייה ואישור.`,
        data: { type: 'REPORT_PUBLISHED', month, year, version: published.version } as any,
      },
    });
    const auditUser = await resolveAuditUser(user.id);
    if (auditUser) {
      await prisma.auditLog.create({
        data: { performedById: auditUser.id, action: 'CREATE', entityType: 'WorkerMonthlyReport', entityId: published.id, newValue: { version: published.version, status: published.status } as any, reason: 'report-published' },
      });
    }
    return { id: published.id, version: published.version, status: published.status };
  });

  // Owner: mark the current published report as paid (spec §24.3, §26).
  app.post('/worker/:workerId/mark-paid', { preHandler: [authenticate, requireAdmin] }, async (req, reply) => {
    const { workerId } = req.params as { workerId: string };
    const { month, year } = req.body as { month: number; year: number };
    const report = await latestReport(workerId, month, year);
    if (!report) return reply.status(409).send({ error: 'אין דוח שפורסם לחודש זה' });

    const worker = await prisma.worker.findUnique({ where: { id: workerId }, select: { userId: true } });
    const updated = await prisma.workerMonthlyReport.update({ where: { id: report.id }, data: { status: 'PAID', paidAt: new Date() } });
    if (worker) {
      await prisma.notification.create({
        data: {
          userId: worker.userId,
          title: 'הדוח סומן כשולם',
          body: `הדוח ל-${month}/${year} סומן כשולם.`,
          data: { type: 'REPORT_PAID', month, year } as any,
        },
      });
    }
    return { status: updated.status, paidAt: updated.paidAt };
  });

  app.post('/adjustments', { preHandler: [authenticate, requireAdmin] }, async (req, reply) => {
    const user = (req as any).user as { id?: string; role: UserRole };
    const body = WorkerAdjustmentSchema.parse(req.body);
    await ensureMonthOpenOrOwner(body.payrollMonth, body.payrollYear, user.role);
    const adjustment = await prisma.workerAdjustment.create({ data: body as any });
    // A correction flags the current published report as needing a new version.
    await flagReportStale(body.workerId, body.payrollMonth, body.payrollYear);
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
    // A correction flags the current published report as needing a new version.
    await flagReportStale(body.workerId, body.month, body.year);
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

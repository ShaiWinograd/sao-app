import { FastifyInstance } from 'fastify';
import { prisma } from '../lib/prisma.js';
import { authenticate, requireAdmin, requireOwner, requireAnyRole } from '../middleware/auth.js';
import { WorkerReportApprovalSchema, WorkerReportNoteSchema } from '@workforce/shared';
import { UserRole, presentWorkerReportStatus, computeWorkerPayLine, summarizeWorkerPay, projectWorkerFacingReport, buildWorkerReportPdfLines } from '@workforce/shared';
import { money, round2 } from '../lib/money.js';
import { buildLinesPdf } from '../lib/pdf.js';
import { latestWorkerReport as latestReport } from '../lib/workerReport.js';

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
// (spec §19). One total amount per worked day using the hourly wage plus the
// fixed daily payment (applied once per worked date via isDailyPaymentEligible).
// No manual additions, deductions, bonuses, or payment status (spec §19.2).
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

  const JOB_TYPE_LABEL: Record<string, string> = { PACKING: 'אריזה', UNPACKING: 'פריקה', HOME_ORGANIZATION: 'סידור' };
  const ROLE_LABEL: Record<string, string> = { REGULAR: 'עובדת', TEAM_LEADER: 'ראש צוות', BACKUP: 'גיבוי' };
  const heTime = (d: Date) => d.toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Jerusalem' });

  // Pay is computed per worked job/day on hours rounded to the nearest half hour
  // (spec §19), BEFORE monthly aggregation. Exact attendance is preserved.
  const payLines = shifts.map((shift) =>
    computeWorkerPayLine({
      approvedHours: money(shift.approvedHours),
      hourlyWage: money(shift.hourlyWageSnapshot),
      dailyPayment: money(shift.dailyPaymentSnapshot),
      isDailyPaymentEligible: shift.isDailyPaymentEligible,
    }),
  );
  const totals = summarizeWorkerPay(payLines);

  const lines = shifts.map((shift, i) => {
    const p = payLines[i];
    return {
      id: shift.id,
      shiftId: shift.id,
      date: shift.job.date.toISOString().slice(0, 10),
      caseName: shift.job.case?.name ?? '',
      shiftLabel: JOB_TYPE_LABEL[shift.job.jobType] ?? shift.job.jobType,
      startTime: heTime(shift.scheduledStart),
      endTime: heTime(shift.scheduledEnd),
      jobType: shift.job.jobType,
      role: shift.assignmentRole,
      roleLabel: ROLE_LABEL[shift.assignmentRole] ?? shift.assignmentRole,
      // Approved clock-in/out (final attendance); null until resolved.
      clockIn: shift.actualStart ? heTime(shift.actualStart) : null,
      clockOut: shift.actualEnd ? heTime(shift.actualEnd) : null,
      customerName: `${shift.job.customer.firstName} ${shift.job.customer.lastName}`.trim(),
      // Exact approved attendance (preserved) plus the rounded hours used for pay.
      approvedHours: round2(p.exactHours),
      paidHours: p.paidHours,
      // Internal only (owner / audit / salary history) — never shown to workers.
      hourlyRate: round2(money(shift.hourlyWageSnapshot)),
      dailyPayment: round2(p.dailyPay),
      pay: round2(p.pay),
    };
  });

  return {
    month: m,
    year: y,
    shifts: lines,
    summary: {
      shiftsCount: shifts.length,
      totalApprovedHours: round2(totals.totalExactHours),
      totalPaidHours: totals.totalPaidHours,
      hourlyPay: round2(totals.hourlyPay),
      dailyPay: round2(totals.dailyPay),
      total: round2(totals.total),
    },
  };
}
// Latest (current) published version of a worker's monthly report.
async function publishReportVersion(workerId: string, m: number, y: number, publishedById?: string) {
  const payload = await computeMonthlyReport(workerId, m, y);
  // Every included work line must have final owner-approved clock-in AND
  // clock-out before a report can be published as final (spec §19).
  const unresolved = (payload.shifts as Array<{ clockIn: string | null; clockOut: string | null }>).filter(
    (s) => !s.clockIn || !s.clockOut,
  );
  if (unresolved.length > 0) {
    const err = new Error('יש משמרות ללא שעון כניסה/יציאה מאושר — לא ניתן לפרסם דוח סופי');
    (err as any).statusCode = 409;
    throw err;
  }
  const latest = await latestReport(workerId, m, y);
  const version = (latest?.version ?? 0) + 1;
  const status = version === 1 ? 'PUBLISHED' : 'REVISED';
  return prisma.workerMonthlyReport.create({
    data: { workerId, month: m, year: y, version, status, snapshot: payload as any, publishedById: publishedById ?? null },
  });
}

// Strip internal money breakdown (hourly rate, hourly/daily subtotals) from a
// computed/snapshot report so the worker-facing UI and PDF only ever see the
// spec §19.3 line and summary. Delegates to the shared, unit-tested projection,
// which reads a stored snapshot verbatim (published versions stay immutable).
const toWorkerFacingReport = projectWorkerFacingReport;

// Render a worker monthly-report PDF from a stored (or freshly computed) report
// snapshot. Worker-facing content only — no hourly rate, subtotals, payment
// status, paidAt, internal notes, or any other worker's data.
async function renderWorkerReportPdf(
  report: { snapshot: unknown; month: number; year: number; version: number; publishedAt: Date | null },
  workerName: string,
): Promise<Buffer> {
  const projected = projectWorkerFacingReport(report.snapshot as any);
  const pdfLines = buildWorkerReportPdfLines(
    { workerName, month: report.month, year: report.year, version: report.version, publishedAt: report.publishedAt },
    projected,
  );
  return buildLinesPdf('דוח חודשי', `${workerName} · ${report.month}/${report.year}`, pdfLines);
}

export async function workerPayrollRoutes(app: FastifyInstance) {
  // Worker: their own monthly report — the published immutable snapshot, or the
  // live draft if the owner has not published yet (spec §19).
  app.get('/me', { preHandler: [authenticate, requireAnyRole] }, async (req, reply) => {
    const user = (req as any).user;
    const worker = await prisma.worker.findUnique({ where: { userId: user.id } });
    if (!worker) return reply.status(404).send({ error: 'Worker profile not found' });

    const now = new Date();
    const q = req.query as { month?: string; year?: string };
    const m = Number(q.month) || now.getMonth() + 1;
    const y = Number(q.year) || now.getFullYear();

    const report = await latestReport(worker.id, m, y);
    const raw = report ? (report.snapshot as any) : await computeMonthlyReport(worker.id, m, y);
    const body = toWorkerFacingReport(raw);
    const notes = await prisma.workerReportNote.findMany({
      where: { workerId: worker.id, month: m, year: y },
      orderBy: { createdAt: 'desc' },
    });
    const versions = await prisma.workerMonthlyReport.findMany({
      where: { workerId: worker.id, month: m, year: y },
      orderBy: { version: 'desc' },
      select: { id: true, version: true, status: true, publishedAt: true, workerApprovedAt: true },
    });

    return {
      ...body,
      month: m,
      year: y,
      status: presentWorkerReportStatus(report?.status),
      version: report?.version ?? null,
      isPublished: Boolean(report),
      workerNote: report?.workerNote ?? null,
      notes: notes.map((n) => ({ id: n.id, shiftId: n.shiftId, type: n.type, message: n.message, createdAt: n.createdAt })),
      versions: versions.map((v) => ({ id: v.id, version: v.version, status: presentWorkerReportStatus(v.status), publishedAt: v.publishedAt })),
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

  // Worker: download their published monthly report as a PDF (spec §19.6).
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

    const pdf = await renderWorkerReportPdf(report, `${worker.firstName} ${worker.lastName}`);
    reply.header('Content-Type', 'application/pdf');
    reply.header('Content-Disposition', `attachment; filename="worker-report-${y}-${String(m).padStart(2, '0')}.pdf"`);
    return reply.send(pdf);
  });

  // Worker: download a specific published version of their OWN report as a PDF.
  app.get('/me/version/:versionId/report.pdf', { preHandler: [authenticate, requireAnyRole] }, async (req, reply) => {
    const user = (req as any).user;
    const worker = await prisma.worker.findUnique({ where: { userId: user.id } });
    if (!worker) return reply.status(404).send({ error: 'Worker profile not found' });
    const { versionId } = req.params as { versionId: string };
    const report = await prisma.workerMonthlyReport.findUnique({ where: { id: versionId } });
    // Ownership guard: a worker may only access their OWN report versions.
    if (!report || report.workerId !== worker.id) return reply.status(404).send({ error: 'Report not found' });
    const pdf = await renderWorkerReportPdf(report, `${worker.firstName} ${worker.lastName}`);
    reply.header('Content-Type', 'application/pdf');
    reply.header('Content-Disposition', `attachment; filename="worker-report-${report.year}-${String(report.month).padStart(2, '0')}-v${report.version}.pdf"`);
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

  // Owner: monthly overview of every active worker's computed report (spec §19).
  app.get('/summary', { preHandler: [authenticate, requireOwner] }, async (req, reply) => {
    const now = new Date();
    const q = req.query as { month?: string; year?: string };
    const m = Number(q.month) || now.getMonth() + 1;
    const y = Number(q.year) || now.getFullYear();

    const workers = await prisma.worker.findMany({
      where: { isActive: true },
      select: { id: true, firstName: true, lastName: true },
      orderBy: { firstName: 'asc' },
    });

    const rows = await Promise.all(
      workers.map(async (w) => {
        const draft = await computeMonthlyReport(w.id, m, y);
        const current = await latestReport(w.id, m, y);
        return {
          id: w.id,
          firstName: w.firstName,
          lastName: w.lastName,
          summary: draft.summary,
          reportStatus: presentWorkerReportStatus(current?.status),
          version: current?.version ?? null,
        };
      }),
    );

    return { workers: rows, month: m, year: y };
  });

  // Owner: a worker's live draft plus published version history (spec §19).
  app.get('/worker/:workerId', { preHandler: [authenticate, requireAdmin] }, async (req, reply) => {
    const { workerId } = req.params as { workerId: string };
    const { month, year } = req.query as { month: string; year: string };
    const m = Number(month);
    const y = Number(year);

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
      reportStatus: presentWorkerReportStatus(current?.status),
      version: current?.version ?? null,
      workerNote: current?.workerNote ?? null,
      versions: versions.map((v) => ({ id: v.id, version: v.version, status: presentWorkerReportStatus(v.status), publishedAt: v.publishedAt, workerApprovedAt: v.workerApprovedAt })),
      notes: notes.map((n) => ({ id: n.id, shiftId: n.shiftId, type: n.type, message: n.message, createdAt: n.createdAt })),
    };
  });

  // Owner: view a specific published version from its immutable stored snapshot
  // (not the live draft), so what was issued is exactly what is shown (spec §19).
  app.get('/worker/:workerId/version/:versionId', { preHandler: [authenticate, requireAdmin] }, async (req, reply) => {
    const { workerId, versionId } = req.params as { workerId: string; versionId: string };
    const report = await prisma.workerMonthlyReport.findUnique({ where: { id: versionId } });
    if (!report || report.workerId !== workerId) return reply.status(404).send({ error: 'Report not found' });
    const body = projectWorkerFacingReport(report.snapshot as any);
    return {
      ...body,
      workerId,
      version: report.version,
      status: presentWorkerReportStatus(report.status),
      publishedAt: report.publishedAt,
      workerApprovedAt: report.workerApprovedAt,
      month: report.month,
      year: report.year,
    };
  });

  // Owner: download a specific published version as a PDF (from its stored snapshot).
  app.get('/worker/:workerId/version/:versionId/report.pdf', { preHandler: [authenticate, requireAdmin] }, async (req, reply) => {
    const { workerId, versionId } = req.params as { workerId: string; versionId: string };
    const report = await prisma.workerMonthlyReport.findUnique({ where: { id: versionId } });
    if (!report || report.workerId !== workerId) return reply.status(404).send({ error: 'Report not found' });
    const worker = await prisma.worker.findUnique({ where: { id: workerId }, select: { firstName: true, lastName: true } });
    if (!worker) return reply.status(404).send({ error: 'Worker not found' });
    const pdf = await renderWorkerReportPdf(report, `${worker.firstName} ${worker.lastName}`);
    reply.header('Content-Type', 'application/pdf');
    reply.header('Content-Disposition', `attachment; filename="worker-report-${report.year}-${String(report.month).padStart(2, '0')}-v${report.version}.pdf"`);
    return reply.send(pdf);
  });

  // Owner: publish (or re-publish a corrected) monthly report as a new version.
  app.post('/worker/:workerId/publish', { preHandler: [authenticate, requireAdmin] }, async (req, reply) => {
    const user = (req as any).user as { id?: string; role: UserRole };
    const { workerId } = req.params as { workerId: string };
    const { month, year } = req.body as { month: number; year: number };
    await ensureMonthOpenOrOwner(month, year, user.role);

    const worker = await prisma.worker.findUnique({ where: { id: workerId }, select: { userId: true, firstName: true, lastName: true } });
    if (!worker) return reply.status(404).send({ error: 'Worker not found' });

    let published;
    try {
      published = await publishReportVersion(workerId, month, year, user.id);
    } catch (e: any) {
      // Unresolved clock-in/out (or month closed) → cannot publish a final report.
      if (e?.statusCode === 409) return reply.status(409).send({ error: e.message });
      throw e;
    }
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
}

import { FastifyInstance } from 'fastify';
import { prisma } from '../lib/prisma.js';
import { authenticate, requireAdmin, requireAnyRole } from '../middleware/auth.js';
import { ClockInSchema, ClockOutSchema, AttendanceCorrectionSchema } from '@workforce/shared';
import { distanceInMeters } from '@workforce/shared';
import { evaluateJobCompletion } from '@workforce/shared';
import { logAudit } from '../lib/audit.js';
import { flagWorkerReportStale } from '../lib/workerReport.js';

// Auto-complete a job once all regular workers have clocked out with no
// unresolved attendance issues (spec §4.3). No-op unless the job is currently a
// reservation or approved.
async function maybeAutoCompleteJob(jobId: string, actor: unknown): Promise<void> {
  const job = await prisma.job.findUnique({ where: { id: jobId }, select: { id: true, status: true } });
  if (!job || (job.status !== 'RESERVATION' && job.status !== 'APPROVED')) return;

  const shifts = await prisma.shift.findMany({
    where: { jobId },
    select: {
      joinRequestStatus: true,
      assignmentRole: true,
      attendanceStatus: true,
      actualStart: true,
      actualEnd: true,
      requiresReview: true,
    },
  });

  const { complete } = evaluateJobCompletion(shifts);
  if (complete) {
    await prisma.job.update({ where: { id: jobId }, data: { status: 'COMPLETED' } });
    await logAudit(actor as any, 'UPDATE', 'Job', jobId, { status: job.status }, { status: 'COMPLETED' }, 'auto-complete');
  }
}

export async function attendanceRoutes(app: FastifyInstance) {
  // Clock in
  app.post('/clock-in', { preHandler: [authenticate, requireAnyRole] }, async (req, reply) => {
    const body = ClockInSchema.parse(req.body);
    const shift = await prisma.shift.findUnique({
      where: { id: body.shiftId },
      include: { job: { include: { address: true } } },
    });
    if (!shift) return reply.status(404).send({ error: 'Shift not found' });
    if (shift.actualStart) return reply.status(400).send({ error: 'Already clocked in' });

    // Workers may clock in at most 10 minutes early (spec §20.1).
    const EARLY_CLOCK_IN_MINUTES = 10;
    const clockInTime = new Date(body.timestamp).getTime();
    if (clockInTime < shift.scheduledStart.getTime() - EARLY_CLOCK_IN_MINUTES * 60_000) {
      return reply.status(400).send({
        error: 'too_early',
        message: 'ניתן להתחיל משמרת עד 10 דקות לפני שעת ההתחלה.',
      });
    }

    // Geocode job address to lat/lon (in production, use Google Maps Geocoding API)
    // For now we assume job address lat/lon is stored or passed in
    const jobLat = (shift.job as any).addressLat as number | null;
    const jobLon = (shift.job as any).addressLon as number | null;

    const radiusSetting = await prisma.appSetting.findUnique({
      where: { key: 'DEFAULT_LOCATION_RADIUS_METERS' },
    });
    const allowedRadius = shift.job.locationRadiusMeters ?? Number(radiusSetting?.value ?? 500);

    let distanceMeters: number | null = null;
    let withinRadius = true;

    if (jobLat !== null && jobLon !== null) {
      distanceMeters = distanceInMeters(body.latitude, body.longitude, jobLat, jobLon);
      withinRadius = distanceMeters <= allowedRadius;
    }

    if (!withinRadius) {
      return reply.status(400).send({
        error: 'outside_radius',
        message: 'לא ניתן להתחיל משמרת. התקרב למיקום העבודה או פנה למנהל.',
        distanceMeters,
        allowedRadius,
      });
    }

    const updated = await prisma.shift.update({
      where: { id: body.shiftId },
      data: {
        actualStart: new Date(body.timestamp),
        clockInLat: body.latitude,
        clockInLon: body.longitude,
        clockInDistanceMeters: distanceMeters,
        attendanceStatus: 'CLOCKED_IN',
        clockInMethod: 'NORMAL',
        isDailyPaymentEligible: true,
      },
    });
    await logAudit((req as any).user, 'CLOCK_IN', 'Shift', body.shiftId, null, { actualStart: updated.actualStart }, 'clock-in');
    return updated;
  });

  // Clock out
  app.post('/clock-out', { preHandler: [authenticate, requireAnyRole] }, async (req, reply) => {
    const body = ClockOutSchema.parse(req.body);
    const shift = await prisma.shift.findUnique({ where: { id: body.shiftId } });
    if (!shift) return reply.status(404).send({ error: 'Shift not found' });
    if (!shift.actualStart) return reply.status(400).send({ error: 'Not clocked in' });
    if (shift.actualEnd) return reply.status(400).send({ error: 'Already clocked out' });

    const start = shift.actualStart!.getTime();
    const end = new Date(body.timestamp).getTime();
    const approvedHours = (end - start) / (1000 * 60 * 60);

    const updated = await prisma.shift.update({
      where: { id: body.shiftId },
      data: {
        actualEnd: new Date(body.timestamp),
        clockOutLat: body.latitude,
        clockOutLon: body.longitude,
        attendanceStatus: 'CLOCKED_OUT',
        clockOutMethod: 'NORMAL',
        approvedHours: approvedHours.toFixed(2),
      },
    });
    await logAudit((req as any).user, 'CLOCK_OUT', 'Shift', body.shiftId, null, { actualEnd: updated.actualEnd, approvedHours: updated.approvedHours }, 'clock-out');
    await maybeAutoCompleteJob(shift.jobId, (req as any).user);
    return updated;
  });

  // Record periodic location check
  app.post('/location-check', { preHandler: [authenticate, requireAnyRole] }, async (req, reply) => {
    const { shiftId, latitude, longitude } = req.body as any;
    const shift = await prisma.shift.findUnique({
      where: { id: shiftId },
      include: { job: true },
    });
    if (!shift) return reply.status(404).send({ error: 'Shift not found' });

    const jobLat = (shift.job as any).addressLat as number | null;
    const jobLon = (shift.job as any).addressLon as number | null;
    const allowedRadius = shift.job.locationRadiusMeters;
    let distanceMeters = 0;
    let isWithinRadius = true;
    if (jobLat && jobLon) {
      distanceMeters = distanceInMeters(latitude, longitude, jobLat, jobLon);
      isWithinRadius = distanceMeters <= allowedRadius;
    }

    const check = await prisma.locationCheck.create({
      data: { shiftId, latitude, longitude, distanceMeters, isWithinRadius },
    });
    return { check, isWithinRadius, distanceMeters, allowedRadius };
  });

  // Admin: correct attendance
  app.post('/correct', { preHandler: [authenticate, requireAdmin] }, async (req, reply) => {
    const user = (req as any).user;
    const body = AttendanceCorrectionSchema.parse(req.body);
    // Correcting attendance also resolves any owner-review flag (e.g. an auto
    // clock-out awaiting review), which can unblock job completion (spec §4.3).
    const update: any = { attendanceStatus: 'CORRECTED', clockInMethod: 'ADMIN_CORRECTED', requiresReview: false };
    if (body.clockIn) update.actualStart = new Date(body.clockIn);
    if (body.clockOut) {
      update.actualEnd = new Date(body.clockOut);
      if (body.clockIn || (await prisma.shift.findUnique({ where: { id: body.shiftId } }))?.actualStart) {
        const start = new Date(body.clockIn ?? '').getTime() || 0;
        const end = new Date(body.clockOut).getTime();
        if (start) update.approvedHours = ((end - start) / (1000 * 60 * 60)).toFixed(2);
      }
    }

    const [shift] = await prisma.$transaction([
      prisma.shift.update({ where: { id: body.shiftId }, data: update }),
      prisma.attendanceCorrection.create({
        data: {
          shiftId: body.shiftId,
          correctedById: user.id,
          clockIn: body.clockIn ? new Date(body.clockIn) : null,
          clockOut: body.clockOut ? new Date(body.clockOut) : null,
          reason: body.reason,
          internalNote: body.internalNote,
        },
      }),
    ]);
    await logAudit(user, 'CORRECTION', 'Shift', body.shiftId, null, { clockIn: body.clockIn ?? null, clockOut: body.clockOut ?? null }, body.reason);
    await maybeAutoCompleteJob(shift.jobId, user);

    // If this shift's month was already signed off, the report is now stale and
    // must be re-approved (integration spec §24).
    let reportWarning = false;
    const info = await prisma.shift.findUnique({
      where: { id: body.shiftId },
      select: { workerId: true, job: { select: { date: true } }, worker: { select: { userId: true } } },
    });
    if (info) {
      const month = info.job.date.getMonth() + 1;
      const year = info.job.date.getFullYear();
      // Flag the current published monthly report as needing a new version.
      const flagged = await flagWorkerReportStale(info.workerId, month, year);
      if (flagged) {
        reportWarning = true;
        await prisma.notification.create({
          data: {
            userId: info.worker.userId,
            title: 'הדוח החודשי עודכן',
            body: `שעות הנוכחות בדוח לחודש ${month}/${year} עודכנו. יש לאשר את הדוח מחדש.`,
            data: { type: 'REPORT_REVISED', month, year } as any,
          },
        });
      }
    }

    return { ...shift, reportWarning };
  });

  // List shifts needing review
  app.get('/needs-review', { preHandler: [authenticate, requireAdmin] }, async (req, reply) => {
    return prisma.shift.findMany({
      where: { requiresReview: true },
      include: {
        worker: { select: { id: true, firstName: true, lastName: true } },
        job: { select: { date: true, jobType: true } },
      },
    });
  });
}

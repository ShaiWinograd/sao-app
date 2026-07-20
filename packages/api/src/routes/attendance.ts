import { FastifyInstance } from 'fastify';
import { prisma } from '../lib/prisma.js';
import { authenticate, requireAdmin, requireAnyRole } from '../middleware/auth.js';
import { ClockInSchema, ClockOutSchema, AttendanceCorrectionSchema } from '@workforce/shared';
import { distanceInMeters } from '@workforce/shared';
import { evaluateJobCompletion } from '@workforce/shared';
import { endOfNextDayDeadline, areaExitDeadline } from '@workforce/shared';
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
    let locationKnown = false;

    if (jobLat !== null && jobLon !== null && body.latitude != null && body.longitude != null) {
      locationKnown = true;
      distanceMeters = distanceInMeters(body.latitude, body.longitude, jobLat, jobLon);
      withinRadius = distanceMeters <= allowedRadius;
    }

    // §16.1: a clock-in is always allowed. It is final automatically only when it
    // is a normal in-range clock-in with no worker review note. Out-of-range, an
    // unknown/denied location, or a worker-supplied review note flags it for owner
    // review instead of blocking.
    const reviewNote = (req.body as any)?.reviewNote as string | undefined;
    const outOfRange = locationKnown && !withinRadius;
    const noLocation = !locationKnown;
    const needsReview = outOfRange || noLocation || Boolean(reviewNote);

    const updated = await prisma.shift.update({
      where: { id: body.shiftId },
      data: {
        actualStart: new Date(body.timestamp),
        clockInLat: body.latitude ?? null,
        clockInLon: body.longitude ?? null,
        clockInDistanceMeters: distanceMeters,
        attendanceStatus: 'CLOCKED_IN',
        clockInMethod: 'NORMAL',
        isDailyPaymentEligible: true,
        requiresReview: needsReview,
        // A real clock-in supersedes any missing-clock-in proposal (§16.2).
        proposedClockIn: null,
      },
    });
    await logAudit(
      (req as any).user,
      'CLOCK_IN',
      'Shift',
      body.shiftId,
      null,
      { actualStart: updated.actualStart, requiresReview: needsReview, distanceMeters, reason: outOfRange ? 'out-of-range' : noLocation ? 'no-location' : reviewNote ? 'review-note' : 'normal' },
      'clock-in',
    );
    return { ...updated, needsReview, distanceMeters, allowedRadius };
  });

  // Clock out
  app.post('/clock-out', { preHandler: [authenticate, requireAnyRole] }, async (req, reply) => {
    const body = ClockOutSchema.parse(req.body);
    const shift = await prisma.shift.findUnique({
      where: { id: body.shiftId },
      include: { job: { select: { formTemplateId: true } } },
    });
    if (!shift) return reply.status(404).send({ error: 'Shift not found' });
    if (!shift.actualStart) return reply.status(400).send({ error: 'Not clocked in' });
    if (shift.actualEnd) return reply.status(400).send({ error: 'Already clocked out' });

    const start = shift.actualStart!.getTime();
    const end = new Date(body.timestamp).getTime();
    const approvedHours = (end - start) / (1000 * 60 * 60);

    // §16.5: a normal manual clock-out is final automatically unless the worker
    // adds a review note. An existing review flag (e.g. an out-of-range clock-in)
    // is preserved.
    const needsReview = shift.requiresReview || Boolean((req.body as any)?.reviewNote);

    // §17.3: when the job has an end form, the completion deadline (end of the next
    // business day) is persisted now so the sweep can drive reminders/overdue even
    // if nobody opens the app.
    const clockOutAt = new Date(body.timestamp);
    const formDeadline = shift.job.formTemplateId ? endOfNextDayDeadline(clockOutAt) : null;

    const updated = await prisma.shift.update({
      where: { id: body.shiftId },
      data: {
        actualEnd: clockOutAt,
        clockOutLat: body.latitude ?? null,
        clockOutLon: body.longitude ?? null,
        attendanceStatus: 'CLOCKED_OUT',
        clockOutMethod: 'NORMAL',
        approvedHours: approvedHours.toFixed(2),
        requiresReview: needsReview,
        // Clear any pending area-exit timer — the shift is over.
        areaExitAt: null,
        areaExitDeadline: null,
        formDeadline,
      },
    });
    await logAudit((req as any).user, 'CLOCK_OUT', 'Shift', body.shiftId, null, { actualEnd: updated.actualEnd, approvedHours: updated.approvedHours, requiresReview: needsReview }, 'clock-out');
    await maybeAutoCompleteJob(shift.jobId, (req as any).user);
    return { ...updated, needsReview };
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

  // Worker reports leaving the geofence (§16.4). Persists the FIRST confirmed exit
  // time and a 15-minute auto-clock-out deadline so the sweep can act even if the
  // app is closed. Idempotent — a repeated report keeps the original exit time. We
  // deliberately store only this event metadata, never a route/coordinate history.
  app.post('/area-exit', { preHandler: [authenticate, requireAnyRole] }, async (req, reply) => {
    const { shiftId } = req.body as { shiftId: string };
    const shift = await prisma.shift.findUnique({ where: { id: shiftId }, select: { id: true, attendanceStatus: true, actualEnd: true, areaExitAt: true } });
    if (!shift) return reply.status(404).send({ error: 'Shift not found' });
    if (shift.attendanceStatus !== 'CLOCKED_IN' || shift.actualEnd) {
      return reply.status(409).send({ error: 'Shift is not active' });
    }
    if (shift.areaExitAt) {
      return { areaExitAt: shift.areaExitAt, areaExitDeadline: areaExitDeadline(shift.areaExitAt), alreadyPending: true };
    }
    const exitAt = new Date();
    const deadline = areaExitDeadline(exitAt);
    // Only set the first exit (race-safe).
    await prisma.shift.updateMany({
      where: { id: shiftId, attendanceStatus: 'CLOCKED_IN', actualEnd: null, areaExitAt: null },
      data: { areaExitAt: exitAt, areaExitDeadline: deadline },
    });
    await logAudit((req as any).user, 'UPDATE', 'Shift', shiftId, null, { areaExitAt: exitAt, areaExitDeadline: deadline }, 'area-exit');
    return { areaExitAt: exitAt, areaExitDeadline: deadline, alreadyPending: false };
  });

  // Worker returned to the area before the deadline (§16.4) — cancel the pending
  // auto clock-out and keep attendance active.
  app.post('/area-return', { preHandler: [authenticate, requireAnyRole] }, async (req, reply) => {
    const { shiftId } = req.body as { shiftId: string };
    const shift = await prisma.shift.findUnique({ where: { id: shiftId }, select: { id: true, attendanceStatus: true, actualEnd: true } });
    if (!shift) return reply.status(404).send({ error: 'Shift not found' });
    // Only clear while still an active clocked-in shift (not already auto-closed).
    const cleared = await prisma.shift.updateMany({
      where: { id: shiftId, attendanceStatus: 'CLOCKED_IN', actualEnd: null },
      data: { areaExitAt: null, areaExitDeadline: null },
    });
    if (cleared.count > 0) {
      await logAudit((req as any).user, 'UPDATE', 'Shift', shiftId, null, { areaExitAt: null }, 'area-return');
    }
    return { cancelled: cleared.count > 0 };
  });

  // Worker confirms or corrects the proposed clock-in for a missing-clock-in entry
  // (§16.2). The confirmed start still requires owner review before it is final.
  app.post('/:shiftId/confirm-proposed', { preHandler: [authenticate, requireAnyRole] }, async (req, reply) => {
    const user = (req as any).user;
    const { shiftId } = req.params as { shiftId: string };
    const { clockIn } = (req.body ?? {}) as { clockIn?: string };
    const worker = await prisma.worker.findUnique({ where: { userId: user.id }, select: { id: true } });
    const shift = await prisma.shift.findUnique({ where: { id: shiftId }, select: { id: true, workerId: true, attendanceStatus: true, proposedClockIn: true } });
    if (!shift) return reply.status(404).send({ error: 'Shift not found' });
    if (worker && shift.workerId !== worker.id) return reply.status(403).send({ error: 'Not your shift' });
    if (shift.attendanceStatus !== 'PROPOSED') return reply.status(409).send({ error: 'No proposed clock-in to confirm' });

    const start = clockIn ? new Date(clockIn) : shift.proposedClockIn ?? new Date();
    const updated = await prisma.shift.update({
      where: { id: shiftId },
      data: {
        actualStart: start,
        attendanceStatus: 'CLOCKED_IN',
        clockInMethod: 'NORMAL',
        requiresReview: true, // owner approves before it becomes final (§16.2)
        proposedClockIn: null,
        isDailyPaymentEligible: true,
      },
    });
    await logAudit(user, 'CLOCK_IN', 'Shift', shiftId, { attendanceStatus: 'PROPOSED' }, { actualStart: start, requiresReview: true }, clockIn ? 'proposed-corrected' : 'proposed-confirmed');
    return updated;
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

  // Owner: mark an assigned worker as "Did not work" (spec §16.5). This is an
  // explicit resolved absence — it clears any pending review, records no worked
  // attendance, and can unblock job completion (§17.1). The shift row is never
  // deleted; the outcome is recorded as NO_SHOW + audited.
  app.post('/:shiftId/did-not-work', { preHandler: [authenticate, requireAdmin] }, async (req, reply) => {
    const user = (req as any).user;
    const { shiftId } = req.params as { shiftId: string };
    const { reason } = (req.body ?? {}) as { reason?: string };

    const shift = await prisma.shift.findUnique({ where: { id: shiftId } });
    if (!shift) return reply.status(404).send({ error: 'Shift not found' });
    if (shift.joinRequestStatus !== 'APPROVED') {
      return reply.status(409).send({ error: 'Only an assigned worker can be marked as did-not-work' });
    }
    if (shift.attendanceStatus === 'CLOCKED_IN' || shift.attendanceStatus === 'CLOCKED_OUT') {
      return reply.status(409).send({ error: 'העובד/ת כבר דיווח/ה נוכחות. יש לתקן את הנוכחות במקום.' });
    }

    const updated = await prisma.shift.update({
      where: { id: shiftId },
      data: {
        attendanceStatus: 'NO_SHOW',
        requiresReview: false,
        actualStart: null,
        actualEnd: null,
        approvedHours: null,
        isDailyPaymentEligible: false,
      },
    });
    await logAudit(user, 'UPDATE', 'Shift', shiftId, { attendanceStatus: shift.attendanceStatus }, { attendanceStatus: 'NO_SHOW' }, reason ?? 'did-not-work');
    await maybeAutoCompleteJob(shift.jobId, user);
    return updated;
  });
}

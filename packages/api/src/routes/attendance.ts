import { FastifyInstance } from 'fastify';
import { prisma } from '../lib/prisma.js';
import { authenticate, requireAdmin, requireAnyRole } from '../middleware/auth.js';
import { ClockInSchema, ClockOutSchema, AttendanceCorrectionSchema } from '@workforce/shared';
import { distanceInMeters } from '@workforce/shared';

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
    const update: any = { attendanceStatus: 'CORRECTED', clockInMethod: 'ADMIN_CORRECTED' };
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
    return shift;
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

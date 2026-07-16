import { FastifyInstance } from 'fastify';
import { prisma } from '../lib/prisma.js';
import { authenticate, requireAdmin, requireAnyRole } from '../middleware/auth.js';
import { JoinRequestSchema, ApproveReplacementSchema, WorkerReplacementRequestSchema, UserRole, StaffingMode, isUnavailableOn, MANAGER_SKILL } from '@workforce/shared';

export async function shiftsRoutes(app: FastifyInstance) {
  // Worker: get my confirmed/pending shifts
  app.get('/mine', { preHandler: [authenticate, requireAnyRole] }, async (req, reply) => {
    const user = (req as any).user;
    const worker = await prisma.worker.findUnique({ where: { userId: user.id } });
    if (!worker) return reply.status(403).send({ error: 'Worker profile not found' });

    return prisma.shift.findMany({
      where: { workerId: worker.id },
      include: {
        job: {
          include: {
            address: { select: { fullAddress: true, apartmentDetails: true, parkingNotes: true, accessNotes: true, elevatorNotes: true } },
            customer: { select: { firstName: true, lastName: true } }, // No phone/email
          },
        },
      },
      orderBy: { scheduledStart: 'desc' },
    });
  });

  // Admin: get shifts for a specific job
  app.get('/for-job/:jobId', { preHandler: [authenticate, requireAdmin] }, async (req, reply) => {
    const { jobId } = req.params as { jobId: string };
    return prisma.shift.findMany({
      where: { jobId },
      include: {
        worker: { select: { id: true, firstName: true, lastName: true, phone: true, skills: true } },
      },
    });
  });

  // Worker: request to join a job
  app.post('/join-request', { preHandler: [authenticate, requireAnyRole] }, async (req, reply) => {
    const user = (req as any).user;
    const body = JoinRequestSchema.parse(req.body);
    const worker = await prisma.worker.findUnique({ where: { userId: user.id } });
    if (!worker) return reply.status(403).send({ error: 'Worker profile not found' });

    const job = await prisma.job.findUnique({ where: { id: body.jobId }, include: { slots: true } });
    if (!job) return reply.status(404).send({ error: 'Job not found' });
    if (job.status !== 'PUBLISHED') return reply.status(400).send({ error: 'Job is not open for applications' });

    // Check for overlapping confirmed shift
    const overlap = await prisma.shift.findFirst({
      where: {
        workerId: worker.id,
        joinRequestStatus: 'APPROVED',
        job: { date: job.date },
      },
    });
    if (overlap) return reply.status(409).send({ error: 'You already have a confirmed shift on this date' });

    // Block joining on a date the worker marked as unavailable.
    const jobDateKey = job.date.toISOString().slice(0, 10);
    const blocks = await prisma.workerAvailability.findMany({ where: { workerId: worker.id } });
    const isBlocked = isUnavailableOn(
      blocks.map((b) => ({
        type: b.type,
        startDate: b.startDate ? b.startDate.toISOString() : null,
        endDate: b.endDate ? b.endDate.toISOString() : null,
        weekday: b.weekday,
      })),
      jobDateKey,
    );
    if (isBlocked) return reply.status(409).send({ error: 'You marked yourself unavailable on this date' });

    // Determine auto-approve or pending
    const status = job.staffingMode === StaffingMode.AUTO_APPROVE ? 'APPROVED' : 'PENDING';

    const shift = await prisma.shift.create({
      data: {
        workerId: worker.id,
        jobId: job.id,
        slotId: body.slotId ?? null,
        scheduledStart: job.plannedStart,
        scheduledEnd: job.plannedEnd,
        joinRequestStatus: status,
        attendanceStatus: 'SCHEDULED',
        hourlyWageSnapshot: worker.hourlyWage,
        dailyPaymentSnapshot: worker.dailyPaymentAmount,
        workerNameSnapshot: `${worker.firstName} ${worker.lastName}`,
      },
    });

    reply.status(201);
    return { shift, autoApproved: status === 'APPROVED' };
  });

  // Admin: approve or reject a pending join request
  app.post('/:shiftId/approve', { preHandler: [authenticate, requireAdmin] }, async (req, reply) => {
    const { shiftId } = req.params as { shiftId: string };
    const { approved, reason } = req.body as { approved: boolean; reason?: string };
    return prisma.shift.update({
      where: { id: shiftId },
      data: { joinRequestStatus: approved ? 'APPROVED' : 'REJECTED' },
    });
  });

  // Admin: directly assign a worker to a job slot (creates an approved shift)
  app.post('/admin-assign', { preHandler: [authenticate, requireAdmin] }, async (req, reply) => {
    const { jobId, workerId, slotId } = req.body as { jobId: string; workerId: string; slotId?: string };
    if (!jobId || !workerId) {
      return reply.status(400).send({ error: 'jobId and workerId are required' });
    }

    const job = await prisma.job.findUnique({ where: { id: jobId } });
    if (!job) return reply.status(404).send({ error: 'Job not found' });

    const worker = await prisma.worker.findUnique({ where: { id: workerId } });
    if (!worker) return reply.status(404).send({ error: 'Worker not found' });

    // Prevent double-booking on the same date
    const overlap = await prisma.shift.findFirst({
      where: {
        workerId: worker.id,
        joinRequestStatus: 'APPROVED',
        job: { date: job.date },
      },
    });
    if (overlap) return reply.status(409).send({ error: 'Worker already has a confirmed shift on this date' });

    // Owner cannot assign a worker who marked themselves unavailable on this date.
    const jobDateKey = job.date.toISOString().slice(0, 10);
    const availabilityBlocks = await prisma.workerAvailability.findMany({ where: { workerId: worker.id } });
    const unavailable = isUnavailableOn(
      availabilityBlocks.map((b) => ({
        type: b.type,
        startDate: b.startDate ? b.startDate.toISOString() : null,
        endDate: b.endDate ? b.endDate.toISOString() : null,
        weekday: b.weekday,
      })),
      jobDateKey,
    );
    if (unavailable) return reply.status(409).send({ error: 'Worker is unavailable on this date' });

    // Prevent assigning the same slot twice
    if (slotId) {
      const slotTaken = await prisma.shift.findFirst({
        where: { slotId, joinRequestStatus: 'APPROVED' },
      });
      if (slotTaken) return reply.status(409).send({ error: 'This slot is already assigned' });
    }

    const shift = await prisma.shift.create({
      data: {
        workerId: worker.id,
        jobId: job.id,
        slotId: slotId ?? null,
        scheduledStart: job.plannedStart,
        scheduledEnd: job.plannedEnd,
        joinRequestStatus: 'APPROVED',
        attendanceStatus: 'SCHEDULED',
        hourlyWageSnapshot: worker.hourlyWage,
        dailyPaymentSnapshot: worker.dailyPaymentAmount,
        workerNameSnapshot: `${worker.firstName} ${worker.lastName}`,
      },
    });

    reply.status(201);
    return { shift };
  });

  // Admin: remove a worker from a job (deletes the shift / frees the slot)
  app.delete('/:id', { preHandler: [authenticate, requireAdmin] }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const shift = await prisma.shift.findUnique({ where: { id } });
    if (!shift) return reply.status(404).send({ error: 'Shift not found' });
    if (shift.attendanceStatus !== 'SCHEDULED') {
      return reply.status(409).send({ error: 'Cannot remove a worker who has already clocked in' });
    }
    await prisma.shift.delete({ where: { id } });
    return { success: true };
  });

  // Get single shift detail
  app.get('/:id', { preHandler: [authenticate] }, async (req, reply) => {    const { id } = req.params as { id: string };
    const shift = await prisma.shift.findUnique({
      where: { id },
      include: {
        worker: true,
        job: { include: { address: true, customer: true } },
        attendanceCorrections: true,
        locationChecks: true,
        replacementRequests: true,
        formSubmission: { include: { answers: { include: { question: true } } } },
      },
    });
    if (!shift) return reply.status(404).send({ error: 'Shift not found' });

    const user = (req as any).user;
    // Strip financials for worker
    if (user.role === UserRole.WORKER) {
      const { hourlyWageSnapshot, dailyPaymentSnapshot, ...safe } = shift as any;
      return safe;
    }
    return shift;
  });

  // Worker: request to leave / be replaced on their own confirmed shift.
  // The worker stays assigned until an owner approves; owners are notified.
  app.post('/:id/replacement', { preHandler: [authenticate, requireAnyRole] }, async (req, reply) => {
    const user = (req as any).user;
    const { id } = req.params as { id: string };
    const body = WorkerReplacementRequestSchema.parse(req.body);

    const worker = await prisma.worker.findUnique({ where: { userId: user.id } });
    if (!worker) return reply.status(403).send({ error: 'Worker profile not found' });

    const shift = await prisma.shift.findUnique({ where: { id }, include: { job: true } });
    if (!shift || shift.workerId !== worker.id) return reply.status(404).send({ error: 'Shift not found' });
    if (shift.joinRequestStatus !== 'APPROVED') return reply.status(400).send({ error: 'Only confirmed shifts can be dropped' });
    if (shift.attendanceStatus !== 'SCHEDULED') return reply.status(409).send({ error: 'Cannot leave a shift that already started' });

    const existing = await prisma.replacementRequest.findFirst({ where: { shiftId: id, status: 'PENDING' } });
    if (existing) return reply.status(409).send({ error: 'A replacement request is already pending for this shift' });

    const request = await prisma.replacementRequest.create({
      data: { shiftId: id, requestedByWorkerId: worker.id, reason: body.reason, status: 'PENDING' },
    });
    await prisma.shift.update({ where: { id }, data: { replacementStatus: 'PENDING' } });

    const owners = await prisma.user.findMany({
      where: { role: { in: [UserRole.OWNER, UserRole.ADMIN] }, isActive: true },
      select: { id: true },
    });
    const dateKey = shift.job.date.toISOString().slice(0, 10);
    if (owners.length) {
      await prisma.notification.createMany({
        data: owners.map((o) => ({
          userId: o.id,
          title: 'בקשת החלפה למשמרת',
          body: `${worker.firstName} ${worker.lastName} ביקש/ה החלפה למשמרת בתאריך ${dateKey}.`,
          data: { type: 'REPLACEMENT_REQUEST', shiftId: id, requestId: request.id } as any,
        })),
      });
    }

    // Notify all other active workers so they can volunteer to take the shift.
    const otherWorkers = await prisma.worker.findMany({
      where: { isActive: true, id: { not: worker.id } },
      select: { userId: true },
    });
    if (otherWorkers.length) {
      await prisma.notification.createMany({
        data: otherWorkers.map((w) => ({
          userId: w.userId,
          title: 'נפתחה משמרת להחלפה',
          body: `דרוש/ה מחליף/ה למשמרת בתאריך ${dateKey}. אפשר להתנדב מתוך "עבודות פתוחות".`,
          data: { type: 'REPLACEMENT_OPEN', shiftId: id, requestId: request.id } as any,
        })),
      });
    }

    reply.status(201);
    return request;
  });

  // Worker: cancel their own pending replacement request.
  app.delete('/:id/replacement', { preHandler: [authenticate, requireAnyRole] }, async (req, reply) => {
    const user = (req as any).user;
    const { id } = req.params as { id: string };

    const worker = await prisma.worker.findUnique({ where: { userId: user.id } });
    if (!worker) return reply.status(403).send({ error: 'Worker profile not found' });

    const request = await prisma.replacementRequest.findFirst({ where: { shiftId: id, status: 'PENDING' } });
    if (!request || request.requestedByWorkerId !== worker.id) {
      return reply.status(404).send({ error: 'No pending request to cancel' });
    }
    await prisma.replacementRequest.delete({ where: { id: request.id } });
    await prisma.shift.update({ where: { id }, data: { replacementStatus: 'NONE' } });
    reply.status(204);
    return null;
  });

  // Worker: list open replacement requests they could volunteer for.
  app.get('/replacement-requests/open', { preHandler: [authenticate, requireAnyRole] }, async (req, reply) => {
    const user = (req as any).user;
    const worker = await prisma.worker.findUnique({ where: { userId: user.id } });
    if (!worker) return reply.status(403).send({ error: 'Worker profile not found' });

    const now = new Date();
    const requests = await prisma.replacementRequest.findMany({
      where: {
        status: 'PENDING',
        requestedByWorkerId: { not: worker.id },
        shift: {
          attendanceStatus: 'SCHEDULED',
          job: { date: { gte: new Date(now.getFullYear(), now.getMonth(), now.getDate()) } },
        },
      },
      include: {
        shift: {
          include: {
            job: {
              include: {
                address: { select: { fullAddress: true } },
                customer: { select: { firstName: true, lastName: true } },
              },
            },
          },
        },
        volunteers: { select: { workerId: true } },
      },
      orderBy: { createdAt: 'desc' },
    });

    const myApproved = await prisma.shift.findMany({
      where: { workerId: worker.id, joinRequestStatus: 'APPROVED' },
      include: { job: { select: { date: true } } },
    });
    const myApprovedDates = new Set(myApproved.map((s) => s.job.date.toISOString().slice(0, 10)));
    const blocks = (await prisma.workerAvailability.findMany({ where: { workerId: worker.id } })).map((b) => ({
      type: b.type,
      startDate: b.startDate ? b.startDate.toISOString() : null,
      endDate: b.endDate ? b.endDate.toISOString() : null,
      weekday: b.weekday,
    }));

    return requests
      .filter((r) => {
        const dk = r.shift.job.date.toISOString().slice(0, 10);
        return !myApprovedDates.has(dk) && !isUnavailableOn(blocks, dk);
      })
      .map((r) => ({
        requestId: r.id,
        reason: r.reason,
        jobType: r.shift.job.jobType,
        date: r.shift.job.date,
        plannedStart: r.shift.job.plannedStart,
        plannedEnd: r.shift.job.plannedEnd,
        address: r.shift.job.address?.fullAddress ?? null,
        customerName: `${r.shift.job.customer.firstName} ${r.shift.job.customer.lastName}`.trim(),
        hasVolunteered: r.volunteers.some((v) => v.workerId === worker.id),
        volunteerCount: r.volunteers.length,
      }));
  });

  // Worker: volunteer to take over an open replacement request.
  app.post('/replacement/:requestId/volunteer', { preHandler: [authenticate, requireAnyRole] }, async (req, reply) => {
    const user = (req as any).user;
    const { requestId } = req.params as { requestId: string };
    const worker = await prisma.worker.findUnique({ where: { userId: user.id } });
    if (!worker) return reply.status(403).send({ error: 'Worker profile not found' });

    const request = await prisma.replacementRequest.findUnique({
      where: { id: requestId },
      include: { shift: { include: { job: true } } },
    });
    if (!request || request.status !== 'PENDING') return reply.status(404).send({ error: 'Request not available' });
    if (request.requestedByWorkerId === worker.id) return reply.status(400).send({ error: 'Cannot volunteer for your own request' });

    const dk = request.shift.job.date.toISOString().slice(0, 10);
    const conflict = await prisma.shift.findFirst({
      where: { workerId: worker.id, joinRequestStatus: 'APPROVED', job: { date: request.shift.job.date } },
    });
    if (conflict) return reply.status(409).send({ error: 'You already have a confirmed shift on this date' });
    const blocks = (await prisma.workerAvailability.findMany({ where: { workerId: worker.id } })).map((b) => ({
      type: b.type,
      startDate: b.startDate ? b.startDate.toISOString() : null,
      endDate: b.endDate ? b.endDate.toISOString() : null,
      weekday: b.weekday,
    }));
    if (isUnavailableOn(blocks, dk)) return reply.status(409).send({ error: 'You marked yourself unavailable on this date' });

    await prisma.replacementVolunteer.upsert({
      where: { replacementRequestId_workerId: { replacementRequestId: requestId, workerId: worker.id } },
      update: {},
      create: { replacementRequestId: requestId, workerId: worker.id },
    });

    const owners = await prisma.user.findMany({
      where: { role: { in: [UserRole.OWNER, UserRole.ADMIN] }, isActive: true },
      select: { id: true },
    });
    if (owners.length) {
      await prisma.notification.createMany({
        data: owners.map((o) => ({
          userId: o.id,
          title: 'מתנדב/ת חדש/ה להחלפה',
          body: `${worker.firstName} ${worker.lastName} התנדב/ה למשמרת בתאריך ${dk}.`,
          data: { type: 'REPLACEMENT_VOLUNTEER', requestId, workerId: worker.id } as any,
        })),
      });
    }

    reply.status(201);
    return { volunteered: true };
  });

  // Worker: withdraw their volunteering.
  app.delete('/replacement/:requestId/volunteer', { preHandler: [authenticate, requireAnyRole] }, async (req, reply) => {
    const user = (req as any).user;
    const { requestId } = req.params as { requestId: string };
    const worker = await prisma.worker.findUnique({ where: { userId: user.id } });
    if (!worker) return reply.status(403).send({ error: 'Worker profile not found' });
    await prisma.replacementVolunteer.deleteMany({ where: { replacementRequestId: requestId, workerId: worker.id } });
    reply.status(204);
    return null;
  });

  // Owner/admin: approve or reject a worker's replacement request.
  // Approve → release the worker and reopen the position; reject → keep them.
  app.post('/replacement/:requestId/resolve', { preHandler: [authenticate, requireAdmin] }, async (req, reply) => {
    const { requestId } = req.params as { requestId: string };
    const { approved, note, override } = req.body as { approved: boolean; note?: string; override?: boolean };

    const request = await prisma.replacementRequest.findUnique({
      where: { id: requestId },
      include: {
        shift: {
          include: {
            job: {
              include: {
                slots: true,
                shifts: { where: { joinRequestStatus: 'APPROVED' }, include: { worker: { select: { skills: true } } } },
              },
            },
          },
        },
        requestedByWorker: { select: { userId: true, firstName: true, lastName: true, skills: true } },
      },
    });
    if (!request) return reply.status(404).send({ error: 'Request not found' });
    if (request.status !== 'PENDING') return reply.status(409).send({ error: 'Request already resolved' });
    if (approved && request.shift.attendanceStatus !== 'SCHEDULED') {
      return reply.status(409).send({ error: 'Cannot release a shift that already started' });
    }

    // Team-leader coverage: releasing the only leader needs an explicit override.
    if (approved && !override) {
      const job = request.shift.job;
      const jobRequiresLeader = (job.slots ?? []).some((s) => s.requiredSkill === MANAGER_SKILL);
      const releasedIsLeader = (request.requestedByWorker.skills as string[]).includes(MANAGER_SKILL);
      const otherLeaderRemains = (job.shifts ?? []).some(
        (s) => s.id !== request.shiftId && ((s.worker?.skills as string[]) ?? []).includes(MANAGER_SKILL),
      );
      if (jobRequiresLeader && releasedIsLeader && !otherLeaderRemains) {
        return reply.status(409).send({
          error: 'team_leader_coverage',
          message: 'שחרור העובד/ת יותיר את המשמרת ללא ראש צוות. לאישור בכל זאת יש לאשר חריגה.',
        });
      }
    }

    const dateKey = request.shift.job.date.toISOString().slice(0, 10);

    if (approved) {
      // Release the original worker; the position reopens for restaffing.
      await prisma.replacementRequest.deleteMany({ where: { shiftId: request.shiftId } });
      await prisma.shift.delete({ where: { id: request.shiftId } });
    } else {
      await prisma.replacementRequest.update({
        where: { id: requestId },
        data: { status: 'REJECTED', adminNote: note ?? null, resolvedAt: new Date() },
      });
      await prisma.shift.update({ where: { id: request.shiftId }, data: { replacementStatus: 'NONE' } });
    }

    await prisma.notification.create({
      data: {
        userId: request.requestedByWorker.userId,
        title: approved ? 'בקשת ההחלפה אושרה' : 'בקשת ההחלפה נדחתה',
        body: approved
          ? `שוחררת מהמשמרת בתאריך ${dateKey}.`
          : `בקשתך להחלפה במשמרת בתאריך ${dateKey} נדחתה. את/ה עדיין משובץ/ת.`,
        data: { type: 'REPLACEMENT_DECISION', shiftId: request.shiftId, approved } as any,
      },
    });

    return { success: true };
  });
}

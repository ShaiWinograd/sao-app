import { FastifyInstance } from 'fastify';
import { prisma } from '../lib/prisma.js';
import { authenticate, requireAdmin, requireAnyRole } from '../middleware/auth.js';
import { JoinRequestSchema, ApproveReplacementSchema, WorkerReplacementRequestSchema, ProposeSwapSchema, SwapDecisionSchema, OwnerSwapSchema, UserRole, StaffingMode, isUnavailableOn, MANAGER_SKILL } from '@workforce/shared';

// After removing `outgoingShiftId`'s worker from `job`, does a team leader remain?
// True when the job needs no leader, the incoming worker is leader-eligible, or
// another assigned worker on the job can lead.
function leaderStillCovered(
  job: { slots?: { requiredSkill: string }[] | null; shifts?: { id: string; worker: { skills: string[] } | null }[] | null },
  outgoingShiftId: string,
  incomingSkills: string[],
): boolean {
  const requiresLeader = (job.slots ?? []).some((s) => s.requiredSkill === MANAGER_SKILL);
  if (!requiresLeader) return true;
  if (incomingSkills.includes(MANAGER_SKILL)) return true;
  return (job.shifts ?? []).some(
    (s) => s.id !== outgoingShiftId && ((s.worker?.skills as string[]) ?? []).includes(MANAGER_SKILL),
  );
}

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
        job: { include: { address: true, customer: true, slots: true } },
        attendanceCorrections: true,
        locationChecks: true,
        replacementRequests: true,
        formSubmission: { include: { answers: { include: { question: true } } } },
      },
    });
    if (!shift) return reply.status(404).send({ error: 'Shift not found' });

    const user = (req as any).user;
    // Strip financials + customer PII for workers. Only the assigned team leader
    // may see the customer phone (acceptance §Discovery).
    if (user.role === UserRole.WORKER) {
      const { hourlyWageSnapshot, dailyPaymentSnapshot, ...safe } = shift as any;
      const viewer = await prisma.worker.findUnique({ where: { userId: user.id }, select: { id: true } });
      const leaderSlot = ((safe.job?.slots ?? []) as any[]).find(
        (s) => s.requiredSkill === MANAGER_SKILL && s.filledByShiftId,
      );
      const isTeamLeader = !!viewer && !!leaderSlot && leaderSlot.filledByShiftId === safe.id && safe.workerId === viewer.id;
      const { customer, slots, ...jobRest } = (safe.job ?? {}) as any;
      safe.job = {
        ...jobRest,
        customer: customer
          ? { firstName: customer.firstName, lastName: customer.lastName, ...(isTeamLeader ? { phone: customer.phone } : {}) }
          : customer,
      };
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

    // Optional specific-worker suggestion (must be a different active worker).
    let suggestedWorkerId: string | null = null;
    if (body.suggestedWorkerId && body.suggestedWorkerId !== worker.id) {
      const suggested = await prisma.worker.findFirst({
        where: { id: body.suggestedWorkerId, isActive: true },
        select: { id: true, userId: true },
      });
      if (suggested) suggestedWorkerId = suggested.id;
    }

    const request = await prisma.replacementRequest.create({
      data: { shiftId: id, requestedByWorkerId: worker.id, reason: body.reason, suggestedWorkerId, status: 'PENDING' },
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

    // Extra targeted nudge for a specifically-suggested colleague.
    if (suggestedWorkerId) {
      const suggested = await prisma.worker.findUnique({ where: { id: suggestedWorkerId }, select: { userId: true } });
      if (suggested) {
        await prisma.notification.create({
          data: {
            userId: suggested.userId,
            title: 'הוצעת להחלפת משמרת',
            body: `${worker.firstName} ${worker.lastName} הציע/ה אותך להחלפה במשמרת בתאריך ${dateKey}. אפשר להתנדב מתוך "עבודות פתוחות".`,
            data: { type: 'REPLACEMENT_SUGGESTED', shiftId: id, requestId: request.id } as any,
          },
        });
      }
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
        suggestedForYou: r.suggestedWorkerId === worker.id,
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
    const { approved, note, override, approvedWorkerId } = req.body as {
      approved: boolean;
      note?: string;
      override?: boolean;
      approvedWorkerId?: string;
    };

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

    // When the owner picks a volunteer, load + validate them.
    let chosenWorker:
      | { id: string; userId: string; firstName: string; lastName: string; skills: string[]; hourlyWage: any; dailyPaymentAmount: any }
      | null = null;
    if (approved && approvedWorkerId) {
      const vol = await prisma.replacementVolunteer.findUnique({
        where: { replacementRequestId_workerId: { replacementRequestId: requestId, workerId: approvedWorkerId } },
      });
      if (!vol) return reply.status(400).send({ error: 'The selected worker did not volunteer for this request' });
      const w = await prisma.worker.findUnique({
        where: { id: approvedWorkerId },
        select: { id: true, userId: true, firstName: true, lastName: true, skills: true, hourlyWage: true, dailyPaymentAmount: true },
      });
      if (!w) return reply.status(404).send({ error: 'Selected worker not found' });
      const conflict = await prisma.shift.findFirst({
        where: { workerId: w.id, joinRequestStatus: 'APPROVED', job: { date: request.shift.job.date }, id: { not: request.shiftId } },
      });
      if (conflict) return reply.status(409).send({ error: 'The selected worker already has a confirmed shift on this date' });
      chosenWorker = w as any;
    }

    // Team-leader coverage: releasing the only leader needs an explicit override
    // (unless the chosen replacement is leader-eligible).
    if (approved && !override) {
      const job = request.shift.job;
      const jobRequiresLeader = (job.slots ?? []).some((s) => s.requiredSkill === MANAGER_SKILL);
      const releasedIsLeader = (request.requestedByWorker.skills as string[]).includes(MANAGER_SKILL);
      const otherLeaderRemains = (job.shifts ?? []).some(
        (s) => s.id !== request.shiftId && ((s.worker?.skills as string[]) ?? []).includes(MANAGER_SKILL),
      );
      const chosenIsLeader = chosenWorker ? (chosenWorker.skills as string[]).includes(MANAGER_SKILL) : false;
      if (jobRequiresLeader && releasedIsLeader && !otherLeaderRemains && !chosenIsLeader) {
        return reply.status(409).send({
          error: 'team_leader_coverage',
          message: 'שחרור העובד/ת יותיר את המשמרת ללא ראש צוות. לאישור בכל זאת יש לאשר חריגה.',
        });
      }
    }

    const dateKey = request.shift.job.date.toISOString().slice(0, 10);

    if (approved && chosenWorker) {
      // Reassign the shift to the chosen volunteer.
      await prisma.shift.update({
        where: { id: request.shiftId },
        data: {
          workerId: chosenWorker.id,
          workerNameSnapshot: `${chosenWorker.firstName} ${chosenWorker.lastName}`.trim(),
          hourlyWageSnapshot: chosenWorker.hourlyWage,
          dailyPaymentSnapshot: chosenWorker.dailyPaymentAmount,
          replacementStatus: 'NONE',
          joinRequestStatus: 'APPROVED',
          attendanceStatus: 'SCHEDULED',
        },
      });
      await prisma.replacementRequest.update({
        where: { id: requestId },
        data: { status: 'APPROVED', approvedWorkerId: chosenWorker.id, resolvedAt: new Date() },
      });
      await prisma.replacementVolunteer.deleteMany({ where: { replacementRequestId: requestId } });
      await prisma.notification.createMany({
        data: [
          {
            userId: request.requestedByWorker.userId,
            title: 'בקשת ההחלפה אושרה',
            body: `נמצא/ה מחליף/ה למשמרת בתאריך ${dateKey}. שוחררת מהמשמרת.`,
            data: { type: 'REPLACEMENT_DECISION', shiftId: request.shiftId, approved: true } as any,
          },
          {
            userId: chosenWorker.userId,
            title: 'שובצת כמחליף/ה',
            body: `שובצת למשמרת בתאריך ${dateKey}.`,
            data: { type: 'REPLACEMENT_ASSIGNED', shiftId: request.shiftId } as any,
          },
        ],
      });
      return { success: true, reassigned: true };
    }

    if (approved) {
      // No volunteer chosen: release the original worker; the position reopens.
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

  // ── Two-way shift swap (worker_web_spec §3 Two-way swap) ─────────────────────

  // Worker: a colleague's upcoming confirmed shifts they could swap into.
  app.get('/swaps/candidates/:workerId', { preHandler: [authenticate, requireAnyRole] }, async (req, reply) => {
    const user = (req as any).user;
    const { workerId } = req.params as { workerId: string };
    const me = await prisma.worker.findUnique({ where: { userId: user.id } });
    if (!me) return reply.status(403).send({ error: 'Worker profile not found' });
    if (workerId === me.id) return reply.status(400).send({ error: 'Choose a different colleague' });

    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const shifts = await prisma.shift.findMany({
      where: { workerId, joinRequestStatus: 'APPROVED', attendanceStatus: 'SCHEDULED', job: { date: { gte: today } } },
      include: { job: { include: { customer: { select: { firstName: true, lastName: true } } } } },
      orderBy: { scheduledStart: 'asc' },
    });
    // A swap collides if the proposer is already booked on the colleague's date.
    const myDates = new Set(
      (await prisma.shift.findMany({ where: { workerId: me.id, joinRequestStatus: 'APPROVED' }, include: { job: { select: { date: true } } } }))
        .map((s) => s.job.date.toISOString().slice(0, 10)),
    );
    return shifts
      .filter((s) => !myDates.has(s.job.date.toISOString().slice(0, 10)))
      .map((s) => ({
        shiftId: s.id,
        date: s.job.date.toISOString(),
        plannedStart: s.scheduledStart.toISOString(),
        plannedEnd: s.scheduledEnd.toISOString(),
        jobType: s.job.jobType,
        customerName: `${s.job.customer.firstName} ${s.job.customer.lastName}`.trim(),
      }));
  });

  // Worker: propose a two-way swap (my fromShift <-> colleague's toShift).
  app.post('/:fromShiftId/swap', { preHandler: [authenticate, requireAnyRole] }, async (req, reply) => {
    const user = (req as any).user;
    const { fromShiftId } = req.params as { fromShiftId: string };
    const body = ProposeSwapSchema.parse(req.body);
    const me = await prisma.worker.findUnique({ where: { userId: user.id } });
    if (!me) return reply.status(403).send({ error: 'Worker profile not found' });
    if (body.toShiftId === fromShiftId) return reply.status(400).send({ error: 'Choose two different shifts' });

    const fromShift = await prisma.shift.findUnique({ where: { id: fromShiftId }, include: { job: true } });
    if (!fromShift || fromShift.workerId !== me.id) return reply.status(404).send({ error: 'Shift not found' });
    if (fromShift.joinRequestStatus !== 'APPROVED' || fromShift.attendanceStatus !== 'SCHEDULED') {
      return reply.status(409).send({ error: 'Only upcoming confirmed shifts can be swapped' });
    }
    const toShift = await prisma.shift.findUnique({ where: { id: body.toShiftId }, include: { job: true } });
    if (!toShift) return reply.status(404).send({ error: 'Target shift not found' });
    if (toShift.workerId === me.id) return reply.status(400).send({ error: 'Choose a colleague\'s shift' });
    if (toShift.joinRequestStatus !== 'APPROVED' || toShift.attendanceStatus !== 'SCHEDULED') {
      return reply.status(409).send({ error: 'The target shift is not available for swapping' });
    }
    if (fromShift.job.date.toISOString().slice(0, 10) === toShift.job.date.toISOString().slice(0, 10)) {
      return reply.status(400).send({ error: 'Choose shifts on different dates' });
    }

    const openForEither = await prisma.shiftSwap.findFirst({
      where: {
        status: { in: ['PENDING_WORKER', 'PENDING_OWNER'] },
        OR: [{ fromShiftId }, { toShiftId: fromShiftId }, { fromShiftId: toShift.id }, { toShiftId: toShift.id }],
      },
    });
    if (openForEither) return reply.status(409).send({ error: 'A swap is already pending for one of these shifts' });

    const swap = await prisma.shiftSwap.create({
      data: {
        fromShiftId,
        toShiftId: toShift.id,
        fromWorkerId: me.id,
        toWorkerId: toShift.workerId,
        note: body.note ?? null,
        status: 'PENDING_WORKER',
      },
    });
    const target = await prisma.worker.findUnique({ where: { id: toShift.workerId }, select: { userId: true } });
    const dateKey = fromShift.job.date.toISOString().slice(0, 10);
    if (target) {
      await prisma.notification.create({
        data: {
          userId: target.userId,
          title: 'הוצעה לך החלפת משמרות',
          body: `${me.firstName} ${me.lastName} מציע/ה להחליף משמרות. יש לאשר או לדחות מ"היומן שלי".`,
          data: { type: 'SWAP_PROPOSED', swapId: swap.id, dateKey } as any,
        },
      });
    }
    return { success: true, swapId: swap.id };
  });

  // Worker: swaps I proposed or was asked to approve.
  app.get('/swaps/mine', { preHandler: [authenticate, requireAnyRole] }, async (req, reply) => {
    const user = (req as any).user;
    const me = await prisma.worker.findUnique({ where: { userId: user.id } });
    if (!me) return reply.status(403).send({ error: 'Worker profile not found' });

    const swaps = await prisma.shiftSwap.findMany({
      where: {
        status: { in: ['PENDING_WORKER', 'PENDING_OWNER'] },
        OR: [{ fromWorkerId: me.id }, { toWorkerId: me.id }],
      },
      include: {
        fromShift: { include: { job: { include: { customer: { select: { firstName: true, lastName: true } } } } } },
        toShift: { include: { job: { include: { customer: { select: { firstName: true, lastName: true } } } } } },
        fromWorker: { select: { firstName: true, lastName: true } },
        toWorker: { select: { firstName: true, lastName: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
    const view = (s: (typeof swaps)[number]['fromShift']) => ({
      date: s.job.date.toISOString(),
      plannedStart: s.scheduledStart.toISOString(),
      plannedEnd: s.scheduledEnd.toISOString(),
      jobType: s.job.jobType,
      customerName: `${s.job.customer.firstName} ${s.job.customer.lastName}`.trim(),
    });
    return swaps.map((s) => ({
      id: s.id,
      status: s.status,
      note: s.note,
      direction: s.fromWorkerId === me.id ? 'OUTGOING' : 'INCOMING',
      counterpartName:
        s.fromWorkerId === me.id
          ? `${s.toWorker.firstName} ${s.toWorker.lastName}`.trim()
          : `${s.fromWorker.firstName} ${s.fromWorker.lastName}`.trim(),
      myShift: s.fromWorkerId === me.id ? view(s.fromShift) : view(s.toShift),
      theirShift: s.fromWorkerId === me.id ? view(s.toShift) : view(s.fromShift),
      awaitingMe: s.status === 'PENDING_WORKER' && s.toWorkerId === me.id,
    }));
  });

  // Target worker: approve or reject a proposed swap.
  app.post('/swaps/:id/respond', { preHandler: [authenticate, requireAnyRole] }, async (req, reply) => {
    const user = (req as any).user;
    const { id } = req.params as { id: string };
    const body = SwapDecisionSchema.parse(req.body);
    const me = await prisma.worker.findUnique({ where: { userId: user.id } });
    if (!me) return reply.status(403).send({ error: 'Worker profile not found' });

    const swap = await prisma.shiftSwap.findUnique({ where: { id }, include: { fromShift: { include: { job: true } } } });
    if (!swap || swap.toWorkerId !== me.id) return reply.status(404).send({ error: 'Swap not found' });
    if (swap.status !== 'PENDING_WORKER') return reply.status(409).send({ error: 'This swap is no longer awaiting your response' });

    const proposer = await prisma.worker.findUnique({ where: { id: swap.fromWorkerId }, select: { userId: true } });
    const dateKey = swap.fromShift.job.date.toISOString().slice(0, 10);

    if (!body.approved) {
      await prisma.shiftSwap.update({ where: { id }, data: { status: 'REJECTED', workerRespondedAt: new Date(), resolvedAt: new Date() } });
      if (proposer) {
        await prisma.notification.create({
          data: {
            userId: proposer.userId,
            title: 'בקשת ההחלפה נדחתה',
            body: `${me.firstName} ${me.lastName} דחה/תה את הצעת החלפת המשמרות.`,
            data: { type: 'SWAP_DECISION', swapId: id, approved: false } as any,
          },
        });
      }
      return { success: true };
    }

    await prisma.shiftSwap.update({ where: { id }, data: { status: 'PENDING_OWNER', workerRespondedAt: new Date() } });
    const owners = await prisma.user.findMany({
      where: { role: { in: [UserRole.OWNER, UserRole.ADMIN] }, isActive: true },
      select: { id: true },
    });
    if (owners.length) {
      await prisma.notification.createMany({
        data: owners.map((o) => ({
          userId: o.id,
          title: 'בקשת החלפת משמרות לאישור',
          body: `${me.firstName} ${me.lastName} אישר/ה החלפת משמרות. נדרש אישור סופי.`,
          data: { type: 'SWAP_PENDING_OWNER', swapId: id, dateKey } as any,
        })),
      });
    }
    return { success: true };
  });

  // Proposer: cancel a swap that has not been finalized.
  app.delete('/swaps/:id', { preHandler: [authenticate, requireAnyRole] }, async (req, reply) => {
    const user = (req as any).user;
    const { id } = req.params as { id: string };
    const me = await prisma.worker.findUnique({ where: { userId: user.id } });
    if (!me) return reply.status(403).send({ error: 'Worker profile not found' });
    const swap = await prisma.shiftSwap.findUnique({ where: { id } });
    if (!swap || swap.fromWorkerId !== me.id) return reply.status(404).send({ error: 'Swap not found' });
    if (!['PENDING_WORKER', 'PENDING_OWNER'].includes(swap.status)) {
      return reply.status(409).send({ error: 'This swap can no longer be cancelled' });
    }
    await prisma.shiftSwap.update({ where: { id }, data: { status: 'CANCELLED', resolvedAt: new Date() } });
    reply.status(204);
    return null;
  });

  // Owner/admin: list swaps awaiting final approval.
  app.get('/swaps/pending-owner', { preHandler: [authenticate, requireAdmin] }, async () => {
    const swaps = await prisma.shiftSwap.findMany({
      where: { status: 'PENDING_OWNER' },
      include: {
        fromShift: { include: { job: { include: { customer: { select: { firstName: true, lastName: true } } } } } },
        toShift: { include: { job: { include: { customer: { select: { firstName: true, lastName: true } } } } } },
        fromWorker: { select: { firstName: true, lastName: true, skills: true } },
        toWorker: { select: { firstName: true, lastName: true, skills: true } },
      },
      orderBy: { workerRespondedAt: 'asc' },
    });
    const view = (s: (typeof swaps)[number]['fromShift']) => ({
      date: s.job.date.toISOString(),
      plannedStart: s.scheduledStart.toISOString(),
      plannedEnd: s.scheduledEnd.toISOString(),
      jobType: s.job.jobType,
      customerName: `${s.job.customer.firstName} ${s.job.customer.lastName}`.trim(),
    });
    return swaps.map((s) => ({
      id: s.id,
      note: s.note,
      fromWorkerName: `${s.fromWorker.firstName} ${s.fromWorker.lastName}`.trim(),
      toWorkerName: `${s.toWorker.firstName} ${s.toWorker.lastName}`.trim(),
      fromShift: view(s.fromShift),
      toShift: view(s.toShift),
    }));
  });

  // Owner/admin: approve (execute) or reject a swap awaiting final approval.
  app.post('/swaps/:id/resolve', { preHandler: [authenticate, requireAdmin] }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = SwapDecisionSchema.parse(req.body);

    const swap = await prisma.shiftSwap.findUnique({
      where: { id },
      include: {
        fromShift: { include: { job: { include: { slots: true, shifts: { where: { joinRequestStatus: 'APPROVED' }, include: { worker: { select: { skills: true } } } } } } } },
        toShift: { include: { job: { include: { slots: true, shifts: { where: { joinRequestStatus: 'APPROVED' }, include: { worker: { select: { skills: true } } } } } } } },
        fromWorker: { select: { id: true, userId: true, firstName: true, lastName: true, skills: true, hourlyWage: true, dailyPaymentAmount: true } },
        toWorker: { select: { id: true, userId: true, firstName: true, lastName: true, skills: true, hourlyWage: true, dailyPaymentAmount: true } },
      },
    });
    if (!swap) return reply.status(404).send({ error: 'Swap not found' });
    if (swap.status !== 'PENDING_OWNER') return reply.status(409).send({ error: 'This swap is not awaiting approval' });

    const fromDate = swap.fromShift.job.date.toISOString().slice(0, 10);
    const toDate = swap.toShift.job.date.toISOString().slice(0, 10);

    if (!body.approved) {
      await prisma.shiftSwap.update({ where: { id }, data: { status: 'REJECTED', adminNote: body.note ?? null, resolvedAt: new Date() } });
      await prisma.notification.createMany({
        data: [swap.fromWorker.userId, swap.toWorker.userId].map((userId) => ({
          userId,
          title: 'בקשת ההחלפה נדחתה',
          body: 'בעל/ת העסק דחה/תה את החלפת המשמרות.',
          data: { type: 'SWAP_DECISION', swapId: id, approved: false } as any,
        })),
      });
      return { success: true };
    }

    if (swap.fromShift.attendanceStatus !== 'SCHEDULED' || swap.toShift.attendanceStatus !== 'SCHEDULED') {
      return reply.status(409).send({ error: 'One of the shifts already started' });
    }

    // Availability: each worker must be free (aside from their own swapped shift) on the new date.
    const blocksFor = async (workerId: string) =>
      (await prisma.workerAvailability.findMany({ where: { workerId } })).map((b) => ({
        type: b.type,
        startDate: b.startDate ? b.startDate.toISOString() : null,
        endDate: b.endDate ? b.endDate.toISOString() : null,
        weekday: b.weekday,
      }));
    const fromBlocks = await blocksFor(swap.fromWorker.id);
    const toBlocks = await blocksFor(swap.toWorker.id);
    if (isUnavailableOn(fromBlocks, toDate)) return reply.status(409).send({ error: `${swap.fromWorker.firstName} סימן/ה חוסר זמינות בתאריך היעד` });
    if (isUnavailableOn(toBlocks, fromDate)) return reply.status(409).send({ error: `${swap.toWorker.firstName} סימן/ה חוסר זמינות בתאריך היעד` });

    const fromConflict = await prisma.shift.findFirst({
      where: { workerId: swap.fromWorker.id, joinRequestStatus: 'APPROVED', job: { date: swap.toShift.job.date }, id: { not: swap.toShiftId } },
    });
    if (fromConflict) return reply.status(409).send({ error: `${swap.fromWorker.firstName} כבר משובץ/ת למשמרת בתאריך היעד` });
    const toConflict = await prisma.shift.findFirst({
      where: { workerId: swap.toWorker.id, joinRequestStatus: 'APPROVED', job: { date: swap.fromShift.job.date }, id: { not: swap.fromShiftId } },
    });
    if (toConflict) return reply.status(409).send({ error: `${swap.toWorker.firstName} כבר משובץ/ת למשמרת בתאריך היעד` });

    // Team-leader coverage on each job after the swap (unless overridden).
    if (!body.override) {
      const fromOk = leaderStillCovered(swap.fromShift.job as any, swap.fromShiftId, swap.toWorker.skills as string[]);
      const toOk = leaderStillCovered(swap.toShift.job as any, swap.toShiftId, swap.fromWorker.skills as string[]);
      if (!fromOk || !toOk) {
        return reply.status(409).send({
          error: 'team_leader_coverage',
          message: 'ההחלפה תותיר משמרת ללא ראש צוות. לאישור בכל זאת יש לאשר חריגה.',
        });
      }
    }

    // Execute the swap: exchange the assigned worker (and wage snapshots) on both shifts.
    await prisma.$transaction([
      prisma.shift.update({
        where: { id: swap.fromShiftId },
        data: {
          workerId: swap.toWorker.id,
          workerNameSnapshot: `${swap.toWorker.firstName} ${swap.toWorker.lastName}`.trim(),
          hourlyWageSnapshot: swap.toWorker.hourlyWage,
          dailyPaymentSnapshot: swap.toWorker.dailyPaymentAmount,
        },
      }),
      prisma.shift.update({
        where: { id: swap.toShiftId },
        data: {
          workerId: swap.fromWorker.id,
          workerNameSnapshot: `${swap.fromWorker.firstName} ${swap.fromWorker.lastName}`.trim(),
          hourlyWageSnapshot: swap.fromWorker.hourlyWage,
          dailyPaymentSnapshot: swap.fromWorker.dailyPaymentAmount,
        },
      }),
      prisma.shiftSwap.update({ where: { id }, data: { status: 'APPROVED', resolvedAt: new Date() } }),
    ]);

    await prisma.notification.createMany({
      data: [swap.fromWorker.userId, swap.toWorker.userId].map((userId) => ({
        userId,
        title: 'החלפת המשמרות אושרה',
        body: `המשמרות בתאריכים ${fromDate} ו-${toDate} הוחלפו.`,
        data: { type: 'SWAP_DECISION', swapId: id, approved: true } as any,
      })),
    });
    return { success: true };
  });

  // Owner/admin: confirmed shifts on a given date (for an owner-initiated swap).
  app.get('/on-date/:date', { preHandler: [authenticate, requireAdmin] }, async (req, reply) => {
    const { date } = req.params as { date: string };
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return reply.status(400).send({ error: 'Invalid date' });
    const day = new Date(`${date}T00:00:00.000Z`);
    const shifts = await prisma.shift.findMany({
      where: { joinRequestStatus: 'APPROVED', attendanceStatus: 'SCHEDULED', job: { date: day } },
      include: { job: { include: { customer: { select: { firstName: true, lastName: true } } } } },
      orderBy: { scheduledStart: 'asc' },
    });
    return shifts.map((s) => ({
      shiftId: s.id,
      workerName: s.workerNameSnapshot,
      plannedStart: s.scheduledStart.toISOString(),
      plannedEnd: s.scheduledEnd.toISOString(),
      jobType: s.job.jobType,
      customerName: `${s.job.customer.firstName} ${s.job.customer.lastName}`.trim(),
    }));
  });

  // Owner/admin: directly swap two workers assigned on the same date (spec §Owner-created swap).
  app.post('/swaps/owner', { preHandler: [authenticate, requireAdmin] }, async (req, reply) => {
    const body = OwnerSwapSchema.parse(req.body);
    if (body.fromShiftId === body.toShiftId) return reply.status(400).send({ error: 'Choose two different shifts' });

    const include = {
      job: { include: { slots: true, shifts: { where: { joinRequestStatus: 'APPROVED' }, include: { worker: { select: { skills: true } } } } } },
      worker: { select: { id: true, userId: true, firstName: true, lastName: true, skills: true, hourlyWage: true, dailyPaymentAmount: true } },
    } as const;
    const fromShift = await prisma.shift.findUnique({ where: { id: body.fromShiftId }, include });
    const toShift = await prisma.shift.findUnique({ where: { id: body.toShiftId }, include });
    if (!fromShift || !toShift) return reply.status(404).send({ error: 'Shift not found' });
    if (fromShift.joinRequestStatus !== 'APPROVED' || toShift.joinRequestStatus !== 'APPROVED') {
      return reply.status(409).send({ error: 'Both shifts must be confirmed' });
    }
    if (fromShift.attendanceStatus !== 'SCHEDULED' || toShift.attendanceStatus !== 'SCHEDULED') {
      return reply.status(409).send({ error: 'One of the shifts already started' });
    }
    if (fromShift.workerId === toShift.workerId) return reply.status(400).send({ error: 'Both shifts belong to the same worker' });
    if (fromShift.job.date.toISOString().slice(0, 10) !== toShift.job.date.toISOString().slice(0, 10)) {
      return reply.status(400).send({ error: 'Owner swaps are limited to the same date' });
    }

    if (!body.override) {
      const fromOk = leaderStillCovered(fromShift.job as any, fromShift.id, toShift.worker.skills as string[]);
      const toOk = leaderStillCovered(toShift.job as any, toShift.id, fromShift.worker.skills as string[]);
      if (!fromOk || !toOk) {
        return reply.status(409).send({
          error: 'team_leader_coverage',
          message: 'ההחלפה תותיר משמרת ללא ראש צוות. לאישור בכל זאת יש לאשר חריגה.',
        });
      }
    }

    await prisma.$transaction([
      prisma.shift.update({
        where: { id: fromShift.id },
        data: {
          workerId: toShift.worker.id,
          workerNameSnapshot: `${toShift.worker.firstName} ${toShift.worker.lastName}`.trim(),
          hourlyWageSnapshot: toShift.worker.hourlyWage,
          dailyPaymentSnapshot: toShift.worker.dailyPaymentAmount,
        },
      }),
      prisma.shift.update({
        where: { id: toShift.id },
        data: {
          workerId: fromShift.worker.id,
          workerNameSnapshot: `${fromShift.worker.firstName} ${fromShift.worker.lastName}`.trim(),
          hourlyWageSnapshot: fromShift.worker.hourlyWage,
          dailyPaymentSnapshot: fromShift.worker.dailyPaymentAmount,
        },
      }),
      prisma.shiftSwap.create({
        data: {
          fromShiftId: fromShift.id,
          toShiftId: toShift.id,
          fromWorkerId: fromShift.worker.id,
          toWorkerId: toShift.worker.id,
          status: 'APPROVED',
          adminNote: 'owner-initiated',
          resolvedAt: new Date(),
        },
      }),
    ]);

    const dateKey = fromShift.job.date.toISOString().slice(0, 10);
    await prisma.notification.createMany({
      data: [fromShift.worker.userId, toShift.worker.userId].map((userId) => ({
        userId,
        title: 'המשמרת שלך הוחלפה',
        body: `בעל/ת העסק החליף/ה את שיבוץ המשמרות בתאריך ${dateKey}.`,
        data: { type: 'SWAP_OWNER', dateKey } as any,
      })),
    });
    return { success: true };
  });
}

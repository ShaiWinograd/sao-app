import { FastifyInstance } from 'fastify';
import { prisma } from '../lib/prisma.js';
import { authenticate, requireAdmin, requireAnyRole } from '../middleware/auth.js';
import { JoinRequestSchema, ApproveReplacementSchema, UserRole, StaffingMode } from '@workforce/shared';

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
}

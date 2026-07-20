import { Prisma } from '@prisma/client';
import { FastifyInstance } from 'fastify';
import { prisma } from '../lib/prisma.js';
import { authenticate, requireAdmin, requireAnyRole } from '../middleware/auth.js';
import {
  JoinRequestSchema, ApproveReplacementSchema, WorkerReplacementRequestSchema, ProposeSwapSchema, SwapDecisionSchema, OwnerSwapSchema,
  UserRole, isUnavailableOn, MANAGER_SKILL,
  decideApproval, nextBackupToPromote, hoursUntil, DROP_LOCK_HOURS, type StaffingRole,
} from '@workforce/shared';
import { logAudit } from '../lib/audit.js';
import { assertWorkerFreeOnDate, lockJob } from '../lib/commitment.js';
import { AppError } from '../lib/errors.js';

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
    if (job.status === 'ARCHIVED' || job.status === 'COMPLETED') return reply.status(400).send({ error: 'Job is not open for applications' });

    // All join requests require owner approval in Version 1 (§12.2). The pending
    // request immediately blocks the worker's full date (§12.1) — enforced by the
    // shared same-day commitment guard inside the transaction. A per-job lock keeps
    // the full-job check race-safe.
    const shift = await prisma.$transaction(async (tx) => {
      await lockJob(tx, job.id);
      await assertWorkerFreeOnDate(tx, worker.id, job.date);

      // Full job (§12.3): once the required normal positions are filled with
      // approved workers, no NEW join requests may be submitted. Extra requests
      // already pending remain pending until the owner rejects or approves them
      // as backups.
      const approvedNormal = await tx.shift.count({
        where: { jobId: job.id, joinRequestStatus: 'APPROVED', assignmentRole: { in: ['REGULAR', 'TEAM_LEADER'] } },
      });
      if (approvedNormal >= job.requiredWorkerCount) {
        throw new AppError(409, 'JOB_FULL', 'העבודה מלאה ולא ניתן להגיש בקשת הצטרפות חדשה');
      }

      const created = await tx.shift.create({
        data: {
          workerId: worker.id,
          jobId: job.id,
          slotId: body.slotId ?? null,
          scheduledStart: job.plannedStart,
          scheduledEnd: job.plannedEnd,
          joinRequestStatus: 'PENDING',
          attendanceStatus: 'SCHEDULED',
          hourlyWageSnapshot: worker.hourlyWage,
          dailyPaymentSnapshot: worker.dailyPaymentAmount,
          workerNameSnapshot: `${worker.firstName} ${worker.lastName}`,
        },
      });
      await logAudit(user, 'CREATE', 'Shift', created.id, null, { joinRequestStatus: 'PENDING', jobId: job.id, workerId: worker.id }, 'join-request', tx);
      return created;
    });

    // Notify the owners that a decision is waiting (spec §12.2, §7).
    const owners = await prisma.user.findMany({
      where: { role: { in: [UserRole.OWNER, UserRole.ADMIN] }, isActive: true },
      select: { id: true },
    });
    const dk = job.date.toISOString().slice(0, 10);
    if (owners.length) {
      await prisma.notification.createMany({
        data: owners.map((o) => ({
          userId: o.id,
          title: 'בקשת הצטרפות חדשה',
          body: `${worker.firstName} ${worker.lastName} ביקש/ה להצטרף לעבודה בתאריך ${dk}.`,
          data: { type: 'JOIN_REQUEST', shiftId: shift.id, jobId: job.id } as any,
        })),
      });
    }

    reply.status(201);
    return { shift };
  });

  // Admin: approve or reject a pending join request (spec §12.2, §12.6, §12.7).
  // Approval runs under a per-job advisory lock and the same-day commitment guard,
  // and applies the shared capacity / team-leader-slot / backup decision.
  app.post('/:shiftId/approve', { preHandler: [authenticate, requireAdmin] }, async (req, reply) => {
    const { shiftId } = req.params as { shiftId: string };
    const { approved, reason, role, confirmBackup } = req.body as {
      approved: boolean;
      reason?: string;
      role?: StaffingRole;
      confirmBackup?: boolean;
    };
    const user = (req as any).user;
    const shift = await prisma.shift.findUnique({
      where: { id: shiftId },
      include: {
        worker: { select: { id: true, userId: true, skills: true } },
        job: { select: { id: true, date: true, requiredWorkerCount: true, slots: { select: { requiredSkill: true } } } },
      },
    });
    if (!shift) return reply.status(404).send({ error: 'Shift not found' });
    if (!['PENDING', 'AWAITING_WORKER'].includes(shift.joinRequestStatus)) {
      return reply.status(409).send({ error: 'הבקשה אינה ממתינה לאישור' });
    }

    const dk = shift.job.date.toISOString().slice(0, 10);

    if (!approved) {
      await prisma.$transaction(async (tx) => {
        await tx.shift.update({ where: { id: shiftId }, data: { joinRequestStatus: 'REJECTED' } });
        await logAudit(user, 'REJECT', 'Shift', shiftId, { joinRequestStatus: shift.joinRequestStatus }, { joinRequestStatus: 'REJECTED' }, reason ?? 'join-rejected', tx);
      });
      await prisma.notification.create({
        data: {
          userId: shift.worker.userId,
          title: 'בקשת ההצטרפות נדחתה',
          body: `בקשתך להצטרף לעבודה בתאריך ${dk} נדחתה.${reason ? ' סיבה: ' + reason : ''}`,
          data: { type: 'JOIN_DECISION', shiftId, approved: false } as any,
        },
      });
      return { joinRequestStatus: 'REJECTED' };
    }

    const result = await prisma.$transaction(async (tx) => {
      await lockJob(tx, shift.job.id);
      // The worker must have no other commitment on this date (§12.1, guard #13).
      await assertWorkerFreeOnDate(tx, shift.worker.id, shift.job.date, { ignoreShiftId: shiftId });

      const requiresLeader = shift.job.slots.some((s) => s.requiredSkill === MANAGER_SKILL);
      const approvedNormalCount = await tx.shift.count({
        where: { jobId: shift.job.id, joinRequestStatus: 'APPROVED', assignmentRole: { in: ['REGULAR', 'TEAM_LEADER'] } },
      });
      const approvedLeaderCount = await tx.shift.count({
        where: { jobId: shift.job.id, joinRequestStatus: 'APPROVED', assignmentRole: 'TEAM_LEADER' },
      });
      const workerLeaderEligible = ((shift.worker.skills as string[]) ?? []).includes(MANAGER_SKILL);

      const decision = decideApproval({
        requiredWorkerCount: shift.job.requiredWorkerCount,
        requiresLeader,
        approvedNormalCount,
        approvedLeaderCount,
        workerLeaderEligible,
        requestedRole: role ?? 'REGULAR',
        confirmBackup: Boolean(confirmBackup),
      });

      if (decision.outcome === 'REJECT') {
        throw new AppError(409, decision.code, decision.message);
      }
      if (decision.outcome === 'NEEDS_BACKUP_CONFIRM') {
        throw new AppError(409, decision.code, decision.message, { needsBackupConfirm: true });
      }

      const assignRole: StaffingRole = decision.outcome === 'ASSIGN_BACKUP' ? 'BACKUP' : decision.role;
      const updated = await tx.shift.update({
        where: { id: shiftId },
        data: { joinRequestStatus: 'APPROVED', assignmentRole: assignRole },
      });

      // Confirming this worker for the date invalidates their other same-date
      // pending requests (they can hold only one commitment per date).
      await tx.shift.updateMany({
        where: { id: { not: shiftId }, workerId: shift.worker.id, joinRequestStatus: 'PENDING', job: { date: shift.job.date } },
        data: { joinRequestStatus: 'REJECTED' },
      });

      await logAudit(
        user,
        'APPROVE',
        'Shift',
        shiftId,
        { joinRequestStatus: shift.joinRequestStatus, assignmentRole: shift.assignmentRole },
        { joinRequestStatus: 'APPROVED', assignmentRole: assignRole },
        assignRole === 'BACKUP' ? 'approved-as-backup' : 'approved',
        tx,
      );

      return { updated, assignRole, warning: decision.outcome === 'ASSIGN_BACKUP' ? decision.warning : undefined };
    });

    await prisma.notification.create({
      data: {
        userId: shift.worker.userId,
        title: result.assignRole === 'BACKUP' ? 'שובצת כגיבוי' : 'בקשת ההצטרפות אושרה',
        body:
          result.assignRole === 'BACKUP'
            ? `שובצת כגיבוי לעבודה בתאריך ${dk}.`
            : `שובצת לעבודה בתאריך ${dk}.`,
        data: { type: 'JOIN_DECISION', shiftId, approved: true, role: result.assignRole } as any,
      },
    });
    return { ...result.updated, assignedRole: result.assignRole, warning: result.warning };
  });

  // Admin: directly assign a worker to a job slot (creates an approved shift)
  app.post('/admin-assign', { preHandler: [authenticate, requireAdmin] }, async (req, reply) => {
    const { jobId, workerId, slotId, role } = req.body as {
      jobId: string;
      workerId: string;
      slotId?: string;
      role?: 'REGULAR' | 'TEAM_LEADER' | 'BACKUP';
    };
    if (!jobId || !workerId) {
      return reply.status(400).send({ error: 'jobId and workerId are required' });
    }

    const job = await prisma.job.findUnique({ where: { id: jobId } });
    if (!job) return reply.status(404).send({ error: 'Job not found' });

    const worker = await prisma.worker.findUnique({ where: { id: workerId } });
    if (!worker) return reply.status(404).send({ error: 'Worker not found' });

    // Direct assignment (§12.4): the worker must accept; the pending
    // AWAITING_WORKER shift blocks her full date immediately and must not override
    // unavailability. Runs under the job lock + shared same-day commitment guard.
    const user = (req as any).user;
    const workerLeaderEligible = ((worker.skills as string[]) ?? []).includes(MANAGER_SKILL);
    if (role === 'TEAM_LEADER' && !workerLeaderEligible) {
      return reply.status(409).send({ error: 'NOT_LEADER_ELIGIBLE', message: 'רק עובדת שהוסמכה כראש צוות יכולה לשמש כראש צוות.' });
    }

    const shift = await prisma.$transaction(async (tx) => {
      await lockJob(tx, job.id);
      await assertWorkerFreeOnDate(tx, worker.id, job.date);

      // Only one team leader per job (§12.6).
      if (role === 'TEAM_LEADER') {
        const existingLeader = await tx.shift.findFirst({
          where: { jobId, assignmentRole: 'TEAM_LEADER', joinRequestStatus: { in: ['APPROVED', 'AWAITING_WORKER'] } },
        });
        if (existingLeader) throw new AppError(409, 'LEADER_TAKEN', 'כבר קיים ראש צוות לעבודה זו');
      }
      // A pending-acceptance assignment still reserves the slot.
      if (slotId) {
        const slotTaken = await tx.shift.findFirst({ where: { slotId, joinRequestStatus: { in: ['APPROVED', 'AWAITING_WORKER'] } } });
        if (slotTaken) throw new AppError(409, 'SLOT_TAKEN', 'This slot is already assigned');
      }

      const created = await tx.shift.create({
        data: {
          workerId: worker.id,
          jobId: job.id,
          slotId: slotId ?? null,
          scheduledStart: job.plannedStart,
          scheduledEnd: job.plannedEnd,
          joinRequestStatus: 'AWAITING_WORKER',
          assignmentRole: role ?? 'REGULAR',
          attendanceStatus: 'SCHEDULED',
          hourlyWageSnapshot: worker.hourlyWage,
          dailyPaymentSnapshot: worker.dailyPaymentAmount,
          workerNameSnapshot: `${worker.firstName} ${worker.lastName}`,
        },
      });
      await logAudit(user, 'CREATE', 'Shift', created.id, null, { joinRequestStatus: 'AWAITING_WORKER', jobId: job.id, workerId: worker.id, assignmentRole: role ?? 'REGULAR' }, 'direct-assign', tx);
      return created;
    });

    // Ask the worker to accept the assignment (§12.4).
    const dk = job.date.toISOString().slice(0, 10);
    await prisma.notification.create({
      data: {
        userId: worker.userId,
        title: 'שובצת למשמרת – נדרש אישורך',
        body: `בעל/ת העסק שיבץ/ה אותך לעבודה בתאריך ${dk}. יש לאשר או לדחות מ"היומן שלי".`,
        data: { type: 'DIRECT_ASSIGNMENT', shiftId: shift.id, jobId: job.id } as any,
      },
    });

    reply.status(201);
    return { shift };
  });

  // Worker: accept or reject a direct assignment awaiting their response (spec §7).
  app.post('/:id/respond-assignment', { preHandler: [authenticate, requireAnyRole] }, async (req, reply) => {
    const user = (req as any).user;
    const { id } = req.params as { id: string };
    const { accepted } = req.body as { accepted: boolean };
    const worker = await prisma.worker.findUnique({ where: { userId: user.id } });
    if (!worker) return reply.status(403).send({ error: 'Worker profile not found' });

    const shift = await prisma.shift.findUnique({ where: { id }, include: { job: { select: { date: true } } } });
    if (!shift || shift.workerId !== worker.id) return reply.status(404).send({ error: 'Assignment not found' });
    if (shift.joinRequestStatus !== 'AWAITING_WORKER') {
      return reply.status(409).send({ error: 'This assignment is no longer awaiting your response' });
    }

    const dk = shift.job.date.toISOString().slice(0, 10);
    const owners = await prisma.user.findMany({
      where: { role: { in: [UserRole.OWNER, UserRole.ADMIN] }, isActive: true },
      select: { id: true },
    });

    if (!accepted) {
      // Reject: free the slot and let owners know (position reopens).
      await prisma.shift.delete({ where: { id } });
      if (owners.length) {
        await prisma.notification.createMany({
          data: owners.map((o) => ({
            userId: o.id,
            title: 'שיבוץ נדחה',
            body: `${worker.firstName} ${worker.lastName} דחה/תה את השיבוץ לעבודה בתאריך ${dk}. המקום נפתח מחדש.`,
            data: { type: 'ASSIGNMENT_DECLINED', jobId: shift.jobId } as any,
          })),
        });
      }
      await logAudit(user, 'REJECT', 'Shift', id, { joinRequestStatus: 'AWAITING_WORKER' }, null, 'assignment-declined');
      return { success: true, accepted: false };
    }

    // Accept: guard the date (§12.1) inside the transaction, then confirm.
    const updated = await prisma.$transaction(async (tx) => {
      await assertWorkerFreeOnDate(tx, worker.id, shift.job.date, { ignoreShiftId: id });
      const u = await tx.shift.update({ where: { id }, data: { joinRequestStatus: 'APPROVED' } });
      // Confirming this date invalidates the worker's other pending same-date requests.
      await tx.shift.updateMany({
        where: { id: { not: id }, workerId: worker.id, joinRequestStatus: 'PENDING', job: { date: shift.job.date } },
        data: { joinRequestStatus: 'REJECTED' },
      });
      await logAudit(user, 'APPROVE', 'Shift', id, { joinRequestStatus: 'AWAITING_WORKER' }, { joinRequestStatus: 'APPROVED' }, 'assignment-accepted', tx);
      return u;
    });
    if (owners.length) {
      await prisma.notification.createMany({
        data: owners.map((o) => ({
          userId: o.id,
          title: 'שיבוץ אושר על ידי העובד/ת',
          body: `${worker.firstName} ${worker.lastName} אישר/ה את השיבוץ לעבודה בתאריך ${dk}.`,
          data: { type: 'ASSIGNMENT_ACCEPTED', shiftId: id, jobId: shift.jobId } as any,
        })),
      });
    }
    return { success: true, accepted: true, shift: updated };
  });

  // Worker: cancel their own pending join request (spec §8.3). Frees the
  // same-day block, reopens the position, and notifies the owner.
  app.post('/:id/cancel-request', { preHandler: [authenticate, requireAnyRole] }, async (req, reply) => {
    const user = (req as any).user;
    const { id } = req.params as { id: string };
    const worker = await prisma.worker.findUnique({ where: { userId: user.id } });
    if (!worker) return reply.status(403).send({ error: 'Worker profile not found' });

    const shift = await prisma.shift.findUnique({ where: { id }, include: { job: { select: { date: true } } } });
    if (!shift || shift.workerId !== worker.id) return reply.status(404).send({ error: 'Request not found' });
    if (shift.joinRequestStatus !== 'PENDING') {
      return reply.status(409).send({ error: 'ניתן לבטל רק בקשה שממתינה לאישור' });
    }

    const updated = await prisma.shift.update({ where: { id }, data: { joinRequestStatus: 'CANCELLED' } });
    const dk = shift.job.date.toISOString().slice(0, 10);
    const owners = await prisma.user.findMany({
      where: { role: { in: [UserRole.OWNER, UserRole.ADMIN] }, isActive: true },
      select: { id: true },
    });
    if (owners.length) {
      await prisma.notification.createMany({
        data: owners.map((o) => ({
          userId: o.id,
          title: 'בקשת הצטרפות בוטלה',
          body: `${worker.firstName} ${worker.lastName} ביטל/ה את בקשת ההצטרפות לעבודה בתאריך ${dk}.`,
          data: { type: 'JOIN_REQUEST_CANCELLED', shiftId: id, jobId: shift.jobId } as any,
        })),
      });
    }
    await logAudit(user, 'UPDATE', 'Shift', id, { joinRequestStatus: 'PENDING' }, { joinRequestStatus: 'CANCELLED' }, 'join-request-cancelled');
    return { success: true, shift: updated };
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
    await logAudit((req as any).user, 'DELETE', 'Shift', id, { workerId: shift.workerId, jobId: shift.jobId }, null, 'admin-remove');
    return { success: true };
  });

  // Admin: change a worker's role on a job — regular / team leader / backup
  // (spec §10–§11: owner may change backup to regular at any time).
  app.post('/:id/role', { preHandler: [authenticate, requireAdmin] }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const { role } = req.body as { role?: 'REGULAR' | 'TEAM_LEADER' | 'BACKUP' };
    if (!role || !['REGULAR', 'TEAM_LEADER', 'BACKUP'].includes(role)) {
      return reply.status(400).send({ error: 'Invalid role' });
    }
    const shift = await prisma.shift.findUnique({ where: { id } });
    if (!shift) return reply.status(404).send({ error: 'Shift not found' });

    // Only one team leader per job (spec §10).
    if (role === 'TEAM_LEADER') {
      const existingLeader = await prisma.shift.findFirst({
        where: {
          jobId: shift.jobId,
          id: { not: id },
          assignmentRole: 'TEAM_LEADER',
          joinRequestStatus: { in: ['APPROVED', 'AWAITING_WORKER'] },
        },
      });
      if (existingLeader) return reply.status(409).send({ error: 'כבר קיים ראש צוות לעבודה זו' });
    }

    const updated = await prisma.shift.update({ where: { id }, data: { assignmentRole: role } });
    await logAudit((req as any).user, 'UPDATE', 'Shift', id, { assignmentRole: shift.assignmentRole }, { assignmentRole: role }, 'role-change');
    return updated;
  });

  // Admin: promote a backup into an open regular position (§13). Promotion is by
  // assignment order — the earliest approved backup (by assignment time) is chosen.
  // No worker acceptance is required; the backup is already committed to the date.
  // Promotion never fills the team-leader requirement unless the owner explicitly
  // makes the promoted (leader-eligible) worker the leader via /:id/role.
  app.post('/:jobId/promote-backup', { preHandler: [authenticate, requireAdmin] }, async (req, reply) => {
    const user = (req as any).user;
    const { jobId } = req.params as { jobId: string };

    const result = await prisma.$transaction(async (tx) => {
      await lockJob(tx, jobId);
      const job = await tx.job.findUnique({ where: { id: jobId } });
      if (!job) throw new AppError(404, 'JOB_NOT_FOUND', 'Job not found');

      const approvedNormal = await tx.shift.count({
        where: { jobId, joinRequestStatus: 'APPROVED', assignmentRole: { in: ['REGULAR', 'TEAM_LEADER'] } },
      });
      if (approvedNormal >= job.requiredWorkerCount) {
        throw new AppError(409, 'NO_OPEN_POSITION', 'אין מקום פנוי לקידום גיבוי בעבודה זו');
      }

      const backups = await tx.shift.findMany({
        where: { jobId, assignmentRole: 'BACKUP', joinRequestStatus: 'APPROVED' },
        include: { worker: { select: { userId: true, firstName: true, lastName: true } } },
      });
      const next = nextBackupToPromote(
        backups.map((b) => ({ id: b.id, assignedAt: b.createdAt.getTime() })),
      );
      if (!next) throw new AppError(409, 'NO_BACKUP', 'אין גיבוי זמין לקידום');
      const chosen = backups.find((b) => b.id === next.id)!;

      await tx.shift.update({ where: { id: chosen.id }, data: { assignmentRole: 'REGULAR' } });
      await logAudit(user, 'UPDATE', 'Shift', chosen.id, { assignmentRole: 'BACKUP' }, { assignmentRole: 'REGULAR' }, 'backup-promoted', tx);
      return { chosen, date: job.date };
    });

    const dateKey = result.date.toISOString().slice(0, 10);
    await prisma.notification.create({
      data: {
        userId: result.chosen.worker.userId,
        title: 'קודמת משיבוץ גיבוי',
        body: `שובצת כעובד/ת רגיל/ה למשמרת בתאריך ${dateKey}.`,
        data: { type: 'BACKUP_PROMOTED', shiftId: result.chosen.id, jobId } as any,
      },
    });
    return { success: true, promotedShiftId: result.chosen.id };
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

    // §13.2 drop-lock window. More than 48h before the job the worker may open a
    // normal replacement request (owner resolves at leisure). Within 48h a drop is
    // only permitted when an approved backup already exists on the job: the earliest
    // backup (by assignment time) is auto-promoted to fill the released position and
    // the dropping worker is released immediately. Auto-promotion never satisfies a
    // team-leader requirement — a promoted backup becomes REGULAR even if the
    // dropped worker was the leader; the owner is warned of the missing leader.
    const hrsUntil = hoursUntil(shift.job.plannedStart, new Date());
    if (hrsUntil <= DROP_LOCK_HOURS) {
      const droppedIsLeader = shift.assignmentRole === 'TEAM_LEADER';
      const result = await prisma.$transaction(async (tx) => {
        await lockJob(tx, shift.jobId);
        const backups = await tx.shift.findMany({
          where: { jobId: shift.jobId, assignmentRole: 'BACKUP', joinRequestStatus: 'APPROVED' },
          orderBy: { createdAt: 'asc' },
          include: { worker: { select: { id: true, userId: true, firstName: true, lastName: true, skills: true } } },
        });
        const promoted = backups[0];
        if (!promoted) {
          throw new AppError(409, 'DROP_LOCKED', 'לא ניתן לבטל פחות מ-48 שעות לפני העבודה ללא גיבוי זמין. פנה/י לבעל/ת העסק.');
        }
        // Promote the earliest backup into a regular position.
        await tx.shift.update({ where: { id: promoted.id }, data: { assignmentRole: 'REGULAR' } });
        await logAudit(user, 'UPDATE', 'Shift', promoted.id, { assignmentRole: 'BACKUP' }, { assignmentRole: 'REGULAR' }, 'backup-auto-promoted', tx);
        // Release the dropping worker (frees their date).
        await tx.shift.delete({ where: { id } });
        await logAudit(user, 'DELETE', 'Shift', id, { workerId: worker.id, jobId: shift.jobId, assignmentRole: shift.assignmentRole }, null, 'drop-within-48h', tx);
        return { promoted, droppedIsLeader };
      });

      const dateKey = shift.job.date.toISOString().slice(0, 10);
      const owners = await prisma.user.findMany({
        where: { role: { in: [UserRole.OWNER, UserRole.ADMIN] }, isActive: true },
        select: { id: true },
      });
      const leaderStillCovered = !droppedIsLeader ? true : await (async () => {
        const remainingLeader = await prisma.shift.findFirst({
          where: { jobId: shift.jobId, assignmentRole: 'TEAM_LEADER', joinRequestStatus: { in: ['APPROVED', 'AWAITING_WORKER'] } },
        });
        return !!remainingLeader;
      })();
      const notes: any[] = [
        {
          userId: result.promoted.worker.userId,
          title: 'קודמת משיבוץ גיבוי',
          body: `שובצת כעובד/ת רגיל/ה למשמרת בתאריך ${dateKey}.`,
          data: { type: 'BACKUP_PROMOTED', shiftId: result.promoted.id, jobId: shift.jobId } as any,
        },
        ...owners.map((o) => ({
          userId: o.id,
          title: droppedIsLeader && !leaderStillCovered ? 'עובד/ת עזב/ה – חסר ראש צוות' : 'גיבוי קודם/ה למשמרת',
          body: droppedIsLeader && !leaderStillCovered
            ? `${worker.firstName} ${worker.lastName} עזב/ה את המשמרת בתאריך ${dateKey}. גיבוי קודם/ה במקומ/ה אך העבודה נותרה ללא ראש צוות.`
            : `${worker.firstName} ${worker.lastName} עזב/ה את המשמרת בתאריך ${dateKey}. גיבוי קודם/ה אוטומטית במקומ/ה.`,
          data: { type: 'DROP_AUTO_PROMOTED', jobId: shift.jobId, promotedShiftId: result.promoted.id, missingLeader: droppedIsLeader && !leaderStillCovered } as any,
        })),
      ];
      await prisma.notification.createMany({ data: notes });
      reply.status(200);
      return { released: true, autoPromoted: true, promotedShiftId: result.promoted.id, missingLeader: droppedIsLeader && !leaderStillCovered };
    }

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
    await logAudit((req as any).user, 'CREATE', 'ReplacementRequest', request.id, null, { shiftId: id, requestedByWorkerId: worker.id }, 'replacement-request');

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
    const user = (req as any).user;
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
      // Reassign the shift to the chosen volunteer under the same-day guard so a
      // volunteer cannot be double-booked by a concurrent flow (§12.1, §13).
      await prisma.$transaction(async (tx) => {
        await assertWorkerFreeOnDate(tx, chosenWorker!.id, request.shift.job.date, { ignoreShiftId: request.shiftId });
        await tx.shift.update({
          where: { id: request.shiftId },
          data: {
            workerId: chosenWorker!.id,
            workerNameSnapshot: `${chosenWorker!.firstName} ${chosenWorker!.lastName}`.trim(),
            hourlyWageSnapshot: chosenWorker!.hourlyWage,
            dailyPaymentSnapshot: chosenWorker!.dailyPaymentAmount,
            replacementStatus: 'NONE',
            joinRequestStatus: 'APPROVED',
            attendanceStatus: 'SCHEDULED',
          },
        });
        await tx.replacementRequest.update({
          where: { id: requestId },
          data: { status: 'APPROVED', approvedWorkerId: chosenWorker!.id, resolvedAt: new Date() },
        });
        await tx.replacementVolunteer.deleteMany({ where: { replacementRequestId: requestId } });
        await logAudit(user, 'APPROVE', 'ReplacementRequest', requestId, { status: 'PENDING' }, { status: 'APPROVED', approvedWorkerId: chosenWorker!.id }, 'reassigned', tx);
      });
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

    await logAudit((req as any).user, approved ? 'APPROVE' : 'REJECT', 'ReplacementRequest', requestId, { status: 'PENDING' }, { status: approved ? 'APPROVED' : 'REJECTED' }, approved ? 'released' : 'rejected');
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
    await logAudit((req as any).user, 'CREATE', 'ShiftSwap', swap.id, null, { status: 'PENDING_WORKER', fromShiftId, toShiftId: toShift.id }, 'swap-proposed');
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
      await logAudit((req as any).user, 'REJECT', 'ShiftSwap', id, { status: 'PENDING_WORKER' }, { status: 'REJECTED' }, 'worker-rejected');
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
    await logAudit((req as any).user, 'APPROVE', 'ShiftSwap', id, { status: 'PENDING_WORKER' }, { status: 'PENDING_OWNER' }, 'worker-approved');
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
      await logAudit((req as any).user, 'REJECT', 'ShiftSwap', id, { status: 'PENDING_OWNER' }, { status: 'REJECTED' }, 'owner-rejected');
      return { success: true };
    }

    if (swap.fromShift.attendanceStatus !== 'SCHEDULED' || swap.toShift.attendanceStatus !== 'SCHEDULED') {
      return reply.status(409).send({ error: 'One of the shifts already started' });
    }

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

    // Execute the swap under the shared same-day guard (§12.1): each worker must be
    // free on the date they move into — ignoring the shift they are taking over and
    // this swap itself — covering unavailability, other commitments, and other
    // pending swaps deterministically. Availability + conflict checks live in the
    // guard, so no duplicated logic here.
    try {
      await prisma.$transaction(async (tx) => {
        await assertWorkerFreeOnDate(tx, swap.fromWorker.id, swap.toShift.job.date, { ignoreShiftId: swap.toShiftId, ignoreSwapId: id });
        await assertWorkerFreeOnDate(tx, swap.toWorker.id, swap.fromShift.job.date, { ignoreShiftId: swap.fromShiftId, ignoreSwapId: id });
        await tx.shift.update({
          where: { id: swap.fromShiftId },
          data: {
            workerId: swap.toWorker.id,
            workerNameSnapshot: `${swap.toWorker.firstName} ${swap.toWorker.lastName}`.trim(),
            hourlyWageSnapshot: swap.toWorker.hourlyWage,
            dailyPaymentSnapshot: swap.toWorker.dailyPaymentAmount,
          },
        });
        await tx.shift.update({
          where: { id: swap.toShiftId },
          data: {
            workerId: swap.fromWorker.id,
            workerNameSnapshot: `${swap.fromWorker.firstName} ${swap.fromWorker.lastName}`.trim(),
            hourlyWageSnapshot: swap.fromWorker.hourlyWage,
            dailyPaymentSnapshot: swap.fromWorker.dailyPaymentAmount,
          },
        });
        await tx.shiftSwap.update({ where: { id }, data: { status: 'APPROVED', resolvedAt: new Date() } });
        await logAudit((req as any).user, 'APPROVE', 'ShiftSwap', id, { status: 'PENDING_OWNER' }, { status: 'APPROVED' }, 'owner-approved', tx);
      });
    } catch (err: any) {
      if (err?.code === 'ALREADY_COMMITTED' || err?.code === 'UNAVAILABLE' || err?.code === 'PENDING_SWAP') {
        return reply.status(409).send({ error: err.code, message: err.message });
      }
      throw err;
    }

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
    await logAudit((req as any).user, 'CREATE', 'ShiftSwap', `${fromShift.id}:${toShift.id}`, null, { fromShiftId: fromShift.id, toShiftId: toShift.id, status: 'APPROVED' }, 'owner-initiated-swap');
    return { success: true };
  });
}

// Role-change domain logic (spec §10–§11) for POST /shifts/:id/role. Validates and
// mutates in ONE transaction under the per-job advisory lock so eligibility, leader
// uniqueness and total-capacity checks cannot race with concurrent assigns,
// approvals or other role changes. The shift update and audit row are written in
// the same transaction and roll back together on any rejection.
//
// TOCTOU-safe: the ONLY pre-lock read discovers the jobId to lock. Every value a
// decision depends on (assignmentRole, joinRequestStatus, worker skills, the other
// reservations) is re-read AFTER acquiring the job advisory lock AND a shift ROW
// lock, so a cooperating approval or a non-cooperating shift UPDATE that lands
// while we wait for the lock cannot leave us validating stale state. Lock order is
// always job (advisory) → shift (row), matching assignCustomer, to avoid deadlocks.
import { type Shift } from '@prisma/client';
import { decideRoleChange, MANAGER_SKILL, type DirectAssignRole } from '@workforce/shared';
import { prisma } from '../lib/prisma.js';
import { lockJob } from '../lib/commitment.js';
import { logAudit } from '../lib/audit.js';
import { AppError } from '../lib/errors.js';

const RESERVING: ('APPROVED' | 'AWAITING_WORKER')[] = ['APPROVED', 'AWAITING_WORKER'];

export async function changeShiftRole(
  client: typeof prisma,
  actor: { id?: string } | null | undefined,
  params: { shiftId: string; role: DirectAssignRole },
): Promise<Shift> {
  return client.$transaction(async (tx) => {
    // 1) Minimal preliminary lookup — ONLY to discover which job to lock. No
    //    decision is made from this read; it may be stale by the time we hold the lock.
    const pre = await tx.shift.findUnique({ where: { id: params.shiftId }, select: { jobId: true } });
    if (!pre) throw new AppError(404, 'SHIFT_NOT_FOUND', 'Shift not found');

    // 2) Serialize the job (advisory), then take a real ROW lock on the shift so a
    //    non-cooperating UPDATE cannot change a capacity-relevant field between our
    //    guarded read and commit.
    await lockJob(tx, pre.jobId);
    await tx.$queryRaw`SELECT id FROM shifts WHERE id = ${params.shiftId} FOR UPDATE`;

    // 3) Re-read EVERYTHING used for decisions AFTER the locks — never trust the
    //    pre-lock snapshot.
    const shift = await tx.shift.findUnique({
      where: { id: params.shiftId },
      include: { worker: { select: { skills: true } } },
    });
    // Deleted while we waited for the lock → fail safely, no mutation/audit.
    if (!shift) throw new AppError(404, 'SHIFT_NOT_FOUND', 'Shift not found');
    // Moved to another job while we waited → we hold the wrong job lock; never
    // validate under it. Fail safely (caller may retry with the new job).
    if (shift.jobId !== pre.jobId) {
      throw new AppError(409, 'SHIFT_MOVED', 'Shift changed jobs during the request; please retry.');
    }

    const job = await tx.job.findUnique({ where: { id: shift.jobId }, select: { requiredWorkerCount: true } });
    if (!job) throw new AppError(404, 'JOB_NOT_FOUND', 'Job not found');

    const requiresLeader =
      (await tx.jobSlot.count({ where: { jobId: shift.jobId, requiredSkill: MANAGER_SKILL } })) > 0;

    // Counts EXCLUDE the shift being changed — the target role decides its own
    // contribution. Derive non-backup by subtraction so a null role counts as
    // non-backup (legacy REGULAR default).
    const reservedLeaderOthers = await tx.shift.count({
      where: { jobId: shift.jobId, id: { not: shift.id }, assignmentRole: 'TEAM_LEADER', joinRequestStatus: { in: RESERVING } },
    });
    const totalReservedOthers = await tx.shift.count({
      where: { jobId: shift.jobId, id: { not: shift.id }, joinRequestStatus: { in: RESERVING } },
    });
    const reservedBackupOthers = await tx.shift.count({
      where: { jobId: shift.jobId, id: { not: shift.id }, assignmentRole: 'BACKUP', joinRequestStatus: { in: RESERVING } },
    });
    const reservedNonBackupOthers = Math.max(totalReservedOthers - reservedBackupOthers, 0);

    const decision = decideRoleChange({
      fromRole: (shift.assignmentRole ?? 'REGULAR') as DirectAssignRole,
      toRole: params.role,
      requiredWorkerCount: job.requiredWorkerCount,
      requiresLeader,
      reservedNonBackupOthers,
      reservedLeaderOthers,
      workerLeaderEligible: ((shift.worker?.skills as string[]) ?? []).includes(MANAGER_SKILL),
      shiftReserves: RESERVING.includes(shift.joinRequestStatus as (typeof RESERVING)[number]),
    });
    if (!decision.ok) throw new AppError(409, decision.code, decision.message);

    const updated = await tx.shift.update({ where: { id: shift.id }, data: { assignmentRole: params.role } });
    await logAudit(actor, 'UPDATE', 'Shift', shift.id, { assignmentRole: shift.assignmentRole }, { assignmentRole: params.role }, 'role-change', tx);
    return updated;
  });
}

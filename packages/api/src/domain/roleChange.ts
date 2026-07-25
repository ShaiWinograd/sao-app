// Role-change domain logic (spec §10–§11) for POST /shifts/:id/role. Validates and
// mutates in ONE transaction under the per-job advisory lock so eligibility, leader
// uniqueness and total-capacity checks cannot race with concurrent assigns,
// approvals or other role changes. The shift update and audit row are written in
// the same transaction and roll back together on any rejection.
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
    const shift = await tx.shift.findUnique({
      where: { id: params.shiftId },
      include: { worker: { select: { skills: true } } },
    });
    if (!shift) throw new AppError(404, 'SHIFT_NOT_FOUND', 'Shift not found');

    // Serialize all capacity/leader reasoning for this job.
    await lockJob(tx, shift.jobId);

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

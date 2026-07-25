// Direct-assignment capacity guard for the API (spec §12.4/§12.6/§12.7). Counts
// APPROVED + AWAITING_WORKER shifts as reservations — role/count based, NOT slot
// based — so a direct invitation cannot double-book a required position or a second
// leader even when approved workers have a null slotId. Must run inside the job
// lock so concurrent assigns/approvals serialize. Backups are unlimited.
import { Prisma } from '@prisma/client';
import { decideDirectAssignment, MANAGER_SKILL, type DirectAssignRole } from '@workforce/shared';
import { AppError } from '../lib/errors.js';

const RESERVING: ('APPROVED' | 'AWAITING_WORKER')[] = ['APPROVED', 'AWAITING_WORKER'];

export async function assertDirectAssignCapacity(
  tx: Prisma.TransactionClient,
  params: { jobId: string; requiredWorkerCount: number; role: DirectAssignRole; workerLeaderEligible: boolean },
): Promise<void> {
  const requiresLeader = (await tx.jobSlot.count({ where: { jobId: params.jobId, requiredSkill: MANAGER_SKILL } })) > 0;

  const reservedLeader = await tx.shift.count({
    where: { jobId: params.jobId, assignmentRole: 'TEAM_LEADER', joinRequestStatus: { in: RESERVING } },
  });
  const totalReserved = await tx.shift.count({
    where: { jobId: params.jobId, joinRequestStatus: { in: RESERVING } },
  });
  const reservedBackup = await tx.shift.count({
    where: { jobId: params.jobId, assignmentRole: 'BACKUP', joinRequestStatus: { in: RESERVING } },
  });
  // Total non-backup reservations (regular + leader). Derived by subtraction so a
  // null assignmentRole (legacy REGULAR default) is counted as non-backup.
  const reservedNonBackup = Math.max(totalReserved - reservedBackup, 0);

  const decision = decideDirectAssignment({
    role: params.role,
    requiredWorkerCount: params.requiredWorkerCount,
    requiresLeader,
    reservedNonBackup,
    reservedLeader,
    workerLeaderEligible: params.workerLeaderEligible,
  });
  if (!decision.ok) throw new AppError(409, decision.code, decision.message);
}

import { decideApproval, type StaffingRole } from '@workforce/shared';

export type JoinRequestPolicyResult =
  | { ok: true; joinRequestStatus: 'PENDING' | 'APPROVED'; assignmentRole: StaffingRole }
  | { ok: false; code: string; message: string };

export function resolveJoinRequestPolicy(input: {
  staffingMode: 'AUTO_APPROVE' | 'MANAGER_APPROVAL';
  requiredWorkerCount: number;
  requiresLeader: boolean;
  approvedNormalCount: number;
  approvedLeaderCount: number;
  workerLeaderEligible: boolean;
}): JoinRequestPolicyResult {
  if (input.staffingMode === 'MANAGER_APPROVAL') {
    return { ok: true, joinRequestStatus: 'PENDING', assignmentRole: 'REGULAR' };
  }

  const decision = decideApproval({
    requiredWorkerCount: input.requiredWorkerCount,
    requiresLeader: input.requiresLeader,
    approvedNormalCount: input.approvedNormalCount,
    approvedLeaderCount: input.approvedLeaderCount,
    workerLeaderEligible: input.workerLeaderEligible,
    requestedRole: 'REGULAR',
    confirmBackup: false,
  });
  if (decision.outcome === 'ASSIGN') {
    return { ok: true, joinRequestStatus: 'APPROVED', assignmentRole: decision.role };
  }
  if (decision.outcome === 'REJECT' || decision.outcome === 'NEEDS_BACKUP_CONFIRM') {
    return { ok: false, code: decision.code, message: decision.message };
  }
  return {
    ok: false,
    code: 'JOB_FULL',
    message: decision.warning ?? 'העבודה מלאה ולא ניתן להצטרף אוטומטית.',
  };
}

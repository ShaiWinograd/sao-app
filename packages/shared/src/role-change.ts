// Role-change decision (spec §10–§11). Pure decision used by the API under a
// per-job lock when an owner converts an already-assigned worker between
// REGULAR / TEAM_LEADER / BACKUP on POST /shifts/:id/role.
//
// Unlike a direct assignment (which always adds one reservation), a role change
// mutates an existing shift, so its capacity impact is the DELTA between the
// current (from) and target (to) role:
//   - REGULAR / TEAM_LEADER occupy one required non-backup position.
//   - BACKUP occupies none (backups are unlimited).
//
// Counts are expressed relative to the OTHER shifts on the job (excluding the one
// being changed), so the target role alone determines this shift's new
// contribution. PENDING/REJECTED join requests do not reserve capacity.

import type { DirectAssignRole } from './direct-assign';

export type RoleChangeInput = {
  fromRole: DirectAssignRole;
  toRole: DirectAssignRole;
  requiredWorkerCount: number;
  requiresLeader: boolean;
  /** APPROVED + AWAITING_WORKER non-backup shifts EXCLUDING the shift being changed. */
  reservedNonBackupOthers: number;
  /** APPROVED + AWAITING_WORKER TEAM_LEADER shifts EXCLUDING the shift being changed (0 or 1). */
  reservedLeaderOthers: number;
  workerLeaderEligible: boolean;
  /** Whether the shift being changed currently reserves capacity (APPROVED/AWAITING_WORKER). */
  shiftReserves: boolean;
};

export type RoleChangeDecision =
  | { ok: true }
  | {
      ok: false;
      code: 'NOT_LEADER_ELIGIBLE' | 'LEADER_TAKEN' | 'LEADER_NOT_REQUIRED' | 'JOB_FULL';
      message: string;
    };

export function decideRoleChange(input: RoleChangeInput): RoleChangeDecision {
  const targetIsNonBackup = input.toRole !== 'BACKUP';
  // This shift's post-change contribution to required capacity: 1 only when it
  // reserves (APPROVED/AWAITING_WORKER) and lands on a non-backup role.
  const contributes = input.shiftReserves && targetIsNonBackup ? 1 : 0;
  const newReservedNonBackup = input.reservedNonBackupOthers + contributes;
  const exceedsCapacity = newReservedNonBackup > input.requiredWorkerCount;

  if (input.toRole === 'TEAM_LEADER') {
    if (!input.requiresLeader) {
      return { ok: false, code: 'LEADER_NOT_REQUIRED', message: 'עבודה זו אינה דורשת ראש צוות.' };
    }
    if (!input.workerLeaderEligible) {
      return { ok: false, code: 'NOT_LEADER_ELIGIBLE', message: 'רק עובד/ת שהוסמך/ה כראש צוות יכול/ה לשמש כראש צוות.' };
    }
    if (input.reservedLeaderOthers >= 1) {
      return { ok: false, code: 'LEADER_TAKEN', message: 'כבר קיים ראש צוות לעבודה זו' };
    }
    // A leader occupies a required position — converting a backup into a leader on
    // a full job would exceed total capacity.
    if (exceedsCapacity) {
      return { ok: false, code: 'JOB_FULL', message: 'העבודה מלאה — אין מקום פנוי להסבת גיבוי לראש צוות.' };
    }
    return { ok: true };
  }

  if (input.toRole === 'REGULAR') {
    // Converting a backup into a regular consumes a required position — reject when
    // full. REGULAR→REGULAR and TEAM_LEADER→REGULAR preserve capacity (delta 0/−0).
    if (exceedsCapacity) {
      return { ok: false, code: 'JOB_FULL', message: 'כל עמדות העובדים מאוישות או שמורות' };
    }
    return { ok: true };
  }

  // BACKUP — releases any required position this shift held; always within capacity.
  return { ok: true };
}

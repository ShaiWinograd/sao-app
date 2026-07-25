// Direct-assignment capacity guard (spec §12.4, §12.6, §12.7). Pure decision used
// by the API under a per-job lock. Reservations are role/count based (NOT slot
// based), so a direct invitation cannot exceed total required capacity or add a
// second leader even when approved workers have a null slotId.
//
// Distinct invariants:
//   - `reservedNonBackup`  = APPROVED + AWAITING_WORKER non-backup (regular + leader).
//                            Total required capacity; a leader assignment counts here too.
//   - `reservedLeader`     = APPROVED + AWAITING_WORKER leaders (0 or 1). Leader uniqueness.
//   - Backups are unlimited and consume no required capacity.
// PENDING join requests are visible but do NOT reserve capacity.

export type DirectAssignRole = 'REGULAR' | 'TEAM_LEADER' | 'BACKUP';

export type DirectAssignCapacityInput = {
  role: DirectAssignRole;
  requiredWorkerCount: number;
  requiresLeader: boolean;
  /** APPROVED + AWAITING_WORKER non-backup (regular + leader) — total reserved capacity. */
  reservedNonBackup: number;
  /** APPROVED + AWAITING_WORKER TEAM_LEADER shifts (0 or 1). */
  reservedLeader: number;
  workerLeaderEligible: boolean;
};

export type DirectAssignDecision =
  | { ok: true }
  | {
      ok: false;
      code: 'NOT_LEADER_ELIGIBLE' | 'LEADER_TAKEN' | 'LEADER_NOT_REQUIRED' | 'JOB_FULL';
      message: string;
    };

export function decideDirectAssignment(input: DirectAssignCapacityInput): DirectAssignDecision {
  if (input.role === 'BACKUP') return { ok: true }; // unlimited backups, no capacity

  // Any non-backup assignment consumes one of the total required positions.
  const capacityFull = input.reservedNonBackup >= input.requiredWorkerCount;

  if (input.role === 'TEAM_LEADER') {
    if (!input.requiresLeader) {
      return { ok: false, code: 'LEADER_NOT_REQUIRED', message: 'עבודה זו אינה דורשת ראש צוות.' };
    }
    if (!input.workerLeaderEligible) {
      return { ok: false, code: 'NOT_LEADER_ELIGIBLE', message: 'רק עובדת שהוסמכה כראש צוות יכולה לשמש כראש צוות.' };
    }
    if (input.reservedLeader >= 1) {
      return { ok: false, code: 'LEADER_TAKEN', message: 'כבר קיים ראש צוות לעבודה זו' };
    }
    // A leader still occupies one of the required positions — never exceed total.
    // When capacity is full but the leader is missing, the owner must convert an
    // existing worker's role rather than add another required worker.
    if (capacityFull) {
      return { ok: false, code: 'JOB_FULL', message: 'העבודה מלאה — יש להסב עובד/ת קיים/ת לראש צוות במקום להוסיף עובד/ת.' };
    }
    return { ok: true };
  }

  // REGULAR — one of the total required non-backup positions.
  if (capacityFull) {
    return { ok: false, code: 'JOB_FULL', message: 'כל עמדות העובדים מאוישות או שמורות' };
  }
  return { ok: true };
}

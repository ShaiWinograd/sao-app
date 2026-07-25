// Direct-assignment capacity guard (spec §12.4, §12.6, §12.7). Pure decision used
// by the API under a per-job lock, counting APPROVED + AWAITING_WORKER shifts as
// reservations so a direct invitation cannot double-book a required position — even
// when approved workers have a null slotId (the reservation is role/count based,
// not slot based). Backups are unlimited and never consume a required position.

export type DirectAssignRole = 'REGULAR' | 'TEAM_LEADER' | 'BACKUP';

export type DirectAssignCapacityInput = {
  role: DirectAssignRole;
  requiredWorkerCount: number;
  requiresLeader: boolean;
  /** Approved + awaiting non-backup, non-leader shifts already reserving a position. */
  reservedRegular: number;
  /** Approved + awaiting TEAM_LEADER shifts (0 or 1). */
  reservedLeader: number;
  workerLeaderEligible: boolean;
};

export type DirectAssignDecision =
  | { ok: true }
  | { ok: false; code: 'NOT_LEADER_ELIGIBLE' | 'LEADER_TAKEN' | 'JOB_FULL'; message: string };

export function decideDirectAssignment(input: DirectAssignCapacityInput): DirectAssignDecision {
  if (input.role === 'BACKUP') return { ok: true }; // unlimited backups

  if (input.role === 'TEAM_LEADER') {
    if (!input.workerLeaderEligible) {
      return { ok: false, code: 'NOT_LEADER_ELIGIBLE', message: 'רק עובדת שהוסמכה כראש צוות יכולה לשמש כראש צוות.' };
    }
    if (input.reservedLeader >= 1) {
      return { ok: false, code: 'LEADER_TAKEN', message: 'כבר קיים ראש צוות לעבודה זו' };
    }
    return { ok: true };
  }

  // REGULAR — one regular per non-leader required position.
  const regularRequired = Math.max(input.requiredWorkerCount - (input.requiresLeader ? 1 : 0), 0);
  if (input.reservedRegular >= regularRequired) {
    return { ok: false, code: 'JOB_FULL', message: 'כל עמדות העובדים מאוישות או שמורות' };
  }
  return { ok: true };
}

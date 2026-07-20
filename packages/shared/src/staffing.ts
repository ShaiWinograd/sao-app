// Pure staffing/commitment domain rules (spec §12–§13). These functions contain
// NO database access so they can be unit-tested exhaustively and reused as the
// single source of truth by the transactional DB guards in the API. The API
// fetches the relevant rows inside a transaction (under advisory locks) and
// feeds them here; every reserving/assigning flow shares this logic.

// String-literal union that matches the Prisma `assignmentRole` field values.
// Named distinctly from the `AssignmentRole` enum in ./enums so both can be
// re-exported from the package index without collision.
export type StaffingRole = 'REGULAR' | 'TEAM_LEADER' | 'BACKUP';

export type CommitmentStatus = 'PENDING' | 'AWAITING_WORKER' | 'APPROVED' | 'REJECTED' | 'CANCELLED';

// A shift that can occupy a worker for a calendar date. Regardless of hours, the
// full date is blocked while the shift is pending, awaiting the worker, or
// approved (covers pending join, pending direct assignment, approved regular,
// approved team-leader, and backup — and a shift under a pending drop, which
// keeps the worker APPROVED until the owner resolves it).
export type CommitmentShift = { id: string; dateKey: string; joinRequestStatus: CommitmentStatus };

// A pending swap reserves each participant for the date they would land on.
export type PendingSwapTarget = { swapId: string; workerLandsOnDateKey: string };

const BLOCKING_SHIFT_STATUSES: CommitmentStatus[] = ['PENDING', 'AWAITING_WORKER', 'APPROVED'];

export type CommitmentConflict =
  | { code: 'ALREADY_COMMITTED'; shiftId: string }
  | { code: 'UNAVAILABLE' }
  | { code: 'PENDING_SWAP'; swapId: string };

export const COMMITMENT_CONFLICT_MESSAGES: Record<CommitmentConflict['code'], string> = {
  ALREADY_COMMITTED: 'כבר קיימת לעובד/ת בקשה או שיבוץ לעבודה בתאריך זה',
  UNAVAILABLE: 'העובד/ת סימנ/ה חוסר זמינות בתאריך זה',
  PENDING_SWAP: 'קיימת בקשת החלפת משמרות פתוחה לעובד/ת בתאריך זה',
};

/**
 * The single same-day commitment rule (§12.1, clarification #13). A worker may
 * hold at most one active commitment per calendar date. Returns the first
 * blocking conflict, or null when the worker is free.
 */
export function findCommitmentConflict(
  dateKey: string,
  inputs: {
    shifts: CommitmentShift[];
    isUnavailable: boolean;
    pendingSwapTargets?: PendingSwapTarget[];
    ignoreShiftId?: string;
    ignoreSwapId?: string;
  },
): CommitmentConflict | null {
  const blocking = inputs.shifts.find(
    (s) =>
      s.dateKey === dateKey &&
      s.id !== inputs.ignoreShiftId &&
      BLOCKING_SHIFT_STATUSES.includes(s.joinRequestStatus),
  );
  if (blocking) return { code: 'ALREADY_COMMITTED', shiftId: blocking.id };

  if (inputs.isUnavailable) return { code: 'UNAVAILABLE' };

  const swap = (inputs.pendingSwapTargets ?? []).find(
    (t) => t.workerLandsOnDateKey === dateKey && t.swapId !== inputs.ignoreSwapId,
  );
  if (swap) return { code: 'PENDING_SWAP', swapId: swap.swapId };

  return null;
}

// ─── Capacity / team-leader slot / backup approval decision (§12.6, §12.7) ─────

export const LEADER_SLOT_ONLY_WARNING =
  'נשאר מקום שמיועד לראש צוות. אישור העובדת לא ימלא את דרישת ראש הצוות והיא תשובץ כגיבוי.';
export const JOB_FULL_BACKUP_MESSAGE = 'העבודה מלאה. אישור העובד/ת ישבץ/ה אותה כגיבוי.';
export const EXPLICIT_BACKUP_MESSAGE = 'העובד/ת תשובץ כגיבוי (מעבר לכמות הנדרשת).';

export type ApprovalContext = {
  requiredWorkerCount: number; // includes the team-leader slot when required
  requiresLeader: boolean;
  approvedNormalCount: number; // APPROVED shifts with role REGULAR or TEAM_LEADER
  approvedLeaderCount: number; // APPROVED shifts with role TEAM_LEADER
  workerLeaderEligible: boolean;
  requestedRole: StaffingRole; // owner intent (default REGULAR)
  confirmBackup: boolean; // owner explicitly confirmed a backup assignment
};

export type ApprovalDecision =
  | { outcome: 'ASSIGN'; role: 'REGULAR' | 'TEAM_LEADER' }
  | { outcome: 'ASSIGN_BACKUP'; warning?: string }
  | { outcome: 'NEEDS_BACKUP_CONFIRM'; code: 'JOB_FULL' | 'LEADER_SLOT_ONLY' | 'BEYOND_CAPACITY'; message: string }
  | { outcome: 'REJECT'; code: 'LEADER_TAKEN' | 'NOT_LEADER_ELIGIBLE'; message: string };

/**
 * Decide the outcome of approving a worker onto a job (§12.6, §12.7 + clarifications).
 * - Required count includes the team leader; backups never count toward capacity.
 * - Backup is ALWAYS an explicit owner decision (never auto-converted): callers
 *   must re-submit with confirmBackup=true.
 * - When only the reserved leader slot remains, a non-eligible worker can only be
 *   a backup (with the exact §12.6 warning); the leader requirement stays unmet.
 */
export function decideApproval(ctx: ApprovalContext): ApprovalDecision {
  const openNormal = Math.max(0, ctx.requiredWorkerCount - ctx.approvedNormalCount);
  const leaderReserved = ctx.requiresLeader && ctx.approvedLeaderCount === 0 ? 1 : 0;
  const openForRegular = openNormal - leaderReserved;

  if (ctx.requestedRole === 'BACKUP') {
    return ctx.confirmBackup
      ? { outcome: 'ASSIGN_BACKUP' }
      : { outcome: 'NEEDS_BACKUP_CONFIRM', code: 'BEYOND_CAPACITY', message: EXPLICIT_BACKUP_MESSAGE };
  }

  if (ctx.requestedRole === 'TEAM_LEADER') {
    if (!ctx.workerLeaderEligible) {
      return { outcome: 'REJECT', code: 'NOT_LEADER_ELIGIBLE', message: 'רק עובדת שהוסמכה כראש צוות יכולה למלא את מקום ראש הצוות.' };
    }
    if (ctx.approvedLeaderCount > 0) {
      return { outcome: 'REJECT', code: 'LEADER_TAKEN', message: 'כבר קיים ראש צוות לעבודה זו.' };
    }
    if (openNormal <= 0) {
      return ctx.confirmBackup
        ? { outcome: 'ASSIGN_BACKUP' }
        : { outcome: 'NEEDS_BACKUP_CONFIRM', code: 'JOB_FULL', message: JOB_FULL_BACKUP_MESSAGE };
    }
    return { outcome: 'ASSIGN', role: 'TEAM_LEADER' };
  }

  // requestedRole === 'REGULAR' (default owner intent)
  if (openNormal <= 0) {
    return ctx.confirmBackup
      ? { outcome: 'ASSIGN_BACKUP' }
      : { outcome: 'NEEDS_BACKUP_CONFIRM', code: 'JOB_FULL', message: JOB_FULL_BACKUP_MESSAGE };
  }

  if (openForRegular <= 0 && leaderReserved === 1) {
    // Only the reserved team-leader slot remains.
    if (ctx.workerLeaderEligible) {
      // Eligible worker fills the reserved leader slot (§12.6).
      return { outcome: 'ASSIGN', role: 'TEAM_LEADER' };
    }
    // Non-eligible worker may only be assigned as backup, with the exact warning.
    return ctx.confirmBackup
      ? { outcome: 'ASSIGN_BACKUP', warning: LEADER_SLOT_ONLY_WARNING }
      : { outcome: 'NEEDS_BACKUP_CONFIRM', code: 'LEADER_SLOT_ONLY', message: LEADER_SLOT_ONLY_WARNING };
  }

  return { outcome: 'ASSIGN', role: 'REGULAR' };
}

// ─── Backup promotion ordering (§12.7, §13.2) ─────────────────────────────────

// Earliest backup assignment timestamp is promoted first.
export function orderBackupsForPromotion<T extends { id: string; assignedAt: number }>(backups: T[]): T[] {
  return [...backups].sort((a, b) => a.assignedAt - b.assignedAt || a.id.localeCompare(b.id));
}

export function nextBackupToPromote<T extends { id: string; assignedAt: number }>(backups: T[]): T | null {
  return orderBackupsForPromotion(backups)[0] ?? null;
}

// ─── Capacity reduction (§11.3, clarification #6) ─────────────────────────────

/**
 * When required capacity is reduced below the number of regular/leader
 * assignments, the owner must explicitly choose who becomes backup. Validates
 * the owner's selection; never auto-selects, deletes, or rejects assignments.
 */
export function validateCapacityReduction(input: {
  newRequiredCount: number;
  regularShiftIds: string[]; // currently APPROVED regular + team-leader shift ids
  demoteToBackupIds: string[]; // owner's chosen shifts to move to backup
}): { ok: true } | { ok: false; code: 'MUST_SELECT_BACKUPS' | 'INVALID_SELECTION'; needed: number; message: string } {
  const excess = input.regularShiftIds.length - input.newRequiredCount;
  if (excess <= 0) return { ok: true };

  const selected = new Set(input.demoteToBackupIds);
  const allValid = input.demoteToBackupIds.every((id) => input.regularShiftIds.includes(id));
  if (!allValid) {
    return { ok: false, code: 'INVALID_SELECTION', needed: excess, message: 'העובדות שנבחרו אינן משובצות לעבודה זו.' };
  }
  if (selected.size !== excess) {
    return {
      ok: false,
      code: 'MUST_SELECT_BACKUPS',
      needed: excess,
      message: `יש לבחור ${excess} עובדות שיעברו לתפקיד גיבוי כדי להקטין את כמות העובדים הנדרשת.`,
    };
  }
  return { ok: true };
}

// Hours between now and the job start, for the 48-hour drop rule (§13).
export function hoursUntil(jobStart: Date, now: Date): number {
  return (jobStart.getTime() - now.getTime()) / (1000 * 60 * 60);
}

export const DROP_LOCK_HOURS = 48;

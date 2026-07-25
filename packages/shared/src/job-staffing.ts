// Single source of truth for a job's staffing rows + counts (spec §12), derived
// from SHIFTS — never from slot bindings. A `JobSlot` only encodes that a position
// (and, for the manager slot, the team-leader requirement) exists; it must never
// decide whether a worker is assigned. An APPROVED shift with a null `slotId` is
// still an assigned worker.
//
// Role is preserved for NON-approved states too: an AWAITING_WORKER / PENDING
// TEAM_LEADER stays in the leader position (and reserves it), a pending/awaiting
// REGULAR stays with the regular workers, and a BACKUP is always identified as a
// backup regardless of status.
//
// Capacity vs shortage:
//   - `assignedWorkers` (approved non-backup) feeds `getStaffingIssueBreakdown`,
//     so the job page and dashboard shortage indicators cannot drift.
//   - `reservedRegular` (approved + awaiting regular) and `leaderShift`/`canAssignLeader`
//     drive the ASSIGN affordance so a direct invitation that already reserves a
//     position is never offered again. This matches the API capacity guard.
import { getStaffingIssueBreakdown, type StaffingIssueBreakdown } from './staffing-insights';
import { fillsRequiredSlot } from './owner-grid';

export type StaffingShift = {
  joinRequestStatus?: string | null;
  assignmentRole?: string | null;
};

export type JobStaffingInput = {
  requiredWorkerCount: number;
  requiresTeamLeader: boolean;
};

export type JobStaffing<T extends StaffingShift> = {
  /** The leader-role shift to display, if any: approved > awaiting > pending. */
  leaderShift: T | null;
  /** True only when an APPROVED leader fills the position (satisfies requirement). */
  hasApprovedLeader: boolean;
  /** Approved regular workers. */
  regulars: T[];
  /** Direct regular invitations awaiting the worker's response. */
  awaitingRegulars: T[];
  /** Worker-initiated regular join requests awaiting owner approval. */
  pendingRegulars: T[];
  /** Active backups (any non-rejected status) — never fill required capacity. */
  backups: T[];
  /** Approved non-backup workers (regular + leader) — the shortage numerator. */
  assignedWorkers: number;
  /** Approved + awaiting regular — reserved regular positions. */
  reservedRegular: number;
  /** Approved + awaiting non-backup (regular + leader) — total reserved capacity. */
  reservedNonBackup: number;
  /** Assignable open regular positions (keeps one slot for an unfilled leader). */
  emptyRegularPositions: number;
  /** Whether an "assign leader" affordance may be offered: leader required, none
   *  reserved (approved/awaiting), and a required position still free. */
  canAssignLeader: boolean;
  breakdown: StaffingIssueBreakdown;
};

function status(s: StaffingShift): string {
  return s.joinRequestStatus ?? 'APPROVED';
}
function role(s: StaffingShift): string {
  return s.assignmentRole ?? 'REGULAR';
}

/** Rejected/cancelled/removed shifts are not active staffing. */
function isActive(s: StaffingShift): boolean {
  const st = status(s);
  return st !== 'REJECTED' && st !== 'CANCELLED';
}

export function deriveJobStaffing<T extends StaffingShift>(shifts: T[], input: JobStaffingInput): JobStaffing<T> {
  const active = shifts.filter(isActive);
  const isLeader = (s: T) => role(s) === 'TEAM_LEADER';
  const isBackup = (s: T) => role(s) === 'BACKUP';
  const isRegular = (s: T) => !isLeader(s) && !isBackup(s);

  const approvedLeader = active.find((s) => status(s) === 'APPROVED' && isLeader(s)) ?? null;
  const awaitingLeader = active.find((s) => status(s) === 'AWAITING_WORKER' && isLeader(s)) ?? null;
  const pendingLeader = active.find((s) => status(s) === 'PENDING' && isLeader(s)) ?? null;
  const leaderShift = approvedLeader ?? awaitingLeader ?? pendingLeader;

  const regulars = active.filter((s) => status(s) === 'APPROVED' && isRegular(s));
  const awaitingRegulars = active.filter((s) => status(s) === 'AWAITING_WORKER' && isRegular(s));
  const pendingRegulars = active.filter((s) => status(s) === 'PENDING' && isRegular(s));
  const backups = active.filter(isBackup);

  const hasApprovedLeader = approvedLeader != null;
  // A leader reserves a required position only once APPROVED or AWAITING_WORKER —
  // a PENDING leader request is visible but does not reserve capacity.
  const leaderReserved = approvedLeader != null || awaitingLeader != null;
  // Approved non-backup workers fill required capacity (shared rule).
  const assignedWorkers = active.filter(fillsRequiredSlot).length;

  const reservedRegular = regulars.length + awaitingRegulars.length;
  // Total reserved required capacity = non-backup (regular + leader), approved + awaiting.
  const reservedNonBackup = reservedRegular + (leaderReserved ? 1 : 0);
  const remainingCapacity = Math.max(input.requiredWorkerCount - reservedNonBackup, 0);
  const leaderOpen = input.requiresTeamLeader && !leaderReserved;
  // "assign leader" is offered only when a leader is required, none is reserved,
  // AND a required position is still free. When capacity is full but the leader is
  // missing, the owner converts an existing worker's role instead.
  const canAssignLeader = leaderOpen && remainingCapacity > 0;
  // Open regular positions keep one slot reserved for an unfilled leader position.
  const emptyRegularPositions = leaderOpen ? Math.max(remainingCapacity - 1, 0) : remainingCapacity;

  const breakdown = getStaffingIssueBreakdown({
    requiredWorkers: input.requiredWorkerCount,
    assignedWorkers,
    requiresManager: input.requiresTeamLeader,
    hasAssignedManager: hasApprovedLeader,
  });

  return {
    leaderShift,
    hasApprovedLeader,
    regulars,
    awaitingRegulars,
    pendingRegulars,
    backups,
    assignedWorkers,
    reservedRegular,
    reservedNonBackup,
    emptyRegularPositions,
    canAssignLeader,
    breakdown,
  };
}

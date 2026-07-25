// Single source of truth for a job's staffing rows + counts (spec §12), derived
// from SHIFTS — never from slot bindings. A `JobSlot` only encodes that a position
// (and, for the manager slot, the team-leader requirement) exists; it must never
// decide whether an approved worker is assigned. An APPROVED shift with a null
// `slotId` is still an assigned worker.
//
// Consistency: `assignedWorkers` uses the same `fillsRequiredSlot` rule and feeds
// `getStaffingIssueBreakdown`, so the job page and the dashboard cannot drift.
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
  /** Approved TEAM_LEADER — satisfies the leader requirement. */
  leaderShift: T | null;
  /** Approved regular workers (role REGULAR or unset). */
  regulars: T[];
  /** Approved backups — never fill required capacity. */
  backups: T[];
  /** Direct assignments awaiting the worker's response (not yet approved). */
  awaiting: T[];
  /** Worker-initiated join requests awaiting owner approval. */
  pending: T[];
  /** Approved non-backup workers (regular + leader) — fills required capacity. */
  assignedWorkers: number;
  hasApprovedLeader: boolean;
  /** Open regular positions = regularRequired − approved regulars (never < 0). */
  emptyRegularPositions: number;
  /** True when a leader is required and no approved eligible leader fills it. */
  emptyLeaderPosition: boolean;
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
  const approved = active.filter((s) => status(s) === 'APPROVED');

  const leaderShift = approved.find((s) => role(s) === 'TEAM_LEADER') ?? null;
  const regulars = approved.filter((s) => role(s) !== 'TEAM_LEADER' && role(s) !== 'BACKUP');
  const backups = approved.filter((s) => role(s) === 'BACKUP');
  const awaiting = active.filter((s) => status(s) === 'AWAITING_WORKER');
  const pending = active.filter((s) => status(s) === 'PENDING');

  const hasApprovedLeader = leaderShift != null;
  // Approved non-backup workers fill required capacity (shared rule).
  const assignedWorkers = active.filter(fillsRequiredSlot).length;

  const regularRequired = Math.max(input.requiredWorkerCount - (input.requiresTeamLeader ? 1 : 0), 0);
  const emptyRegularPositions = Math.max(regularRequired - regulars.length, 0);
  const emptyLeaderPosition = input.requiresTeamLeader && !hasApprovedLeader;

  const breakdown = getStaffingIssueBreakdown({
    requiredWorkers: input.requiredWorkerCount,
    assignedWorkers,
    requiresManager: input.requiresTeamLeader,
    hasAssignedManager: hasApprovedLeader,
  });

  return {
    leaderShift,
    regulars,
    backups,
    awaiting,
    pending,
    assignedWorkers,
    hasApprovedLeader,
    emptyRegularPositions,
    emptyLeaderPosition,
    breakdown,
  };
}

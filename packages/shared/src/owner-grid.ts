/**
 * Owner Shifts-grid assignment rules (pure). A worker's row shows ACTUAL
 * assignments only — a worker-initiated PENDING join request is surfaced in
 * Requires Attention, the join-request side panel, the job staffing section and
 * the worker app ("מחכה לאישור"), but never as a card in the worker's row.
 */
export type GridAssignment = {
  joinRequestStatus?: string | null;
  assignmentRole?: string | null;
};

/**
 * Whether an assignment should render as a card in the worker's grid row.
 * PENDING (worker-initiated, not yet approved) is excluded; approved regular /
 * team-leader / backup and owner-initiated direct assignments awaiting the
 * worker's response are shown.
 */
export function rendersInWorkerRow(a: GridAssignment): boolean {
  return (a.joinRequestStatus ?? 'APPROVED') !== 'PENDING';
}

/** The subset of a job's assignments that appear in worker rows. */
export function workerRowAssignments<T extends GridAssignment>(assignments: T[]): T[] {
  return assignments.filter(rendersInWorkerRow);
}

/**
 * Only an APPROVED, non-backup assignment fills a required staffing slot — a
 * pending request must never count as approved staffing.
 */
export function fillsRequiredSlot(a: GridAssignment): boolean {
  return (a.joinRequestStatus ?? 'APPROVED') === 'APPROVED' && (a.assignmentRole ?? null) !== 'BACKUP';
}

export type AssignmentBadge = { label: string; className: string };

/**
 * The worker ASSIGNMENT status badge — describes the worker's own state on a
 * job (never the job status), so a worker row is never labelled with the
 * ambiguous job-status "אושר".
 */
export function assignmentBadge(a: GridAssignment): AssignmentBadge {
  const status = a.joinRequestStatus ?? 'APPROVED';
  const role = a.assignmentRole ?? null;
  if (status === 'PENDING') return { label: 'ממתינה לאישור', className: 'border-amber-300 bg-amber-100 text-amber-800' };
  if (status === 'AWAITING_WORKER') return { label: 'ממתינה לתשובת העובד/ת', className: 'border-sky-300 bg-sky-100 text-sky-700' };
  if (role === 'TEAM_LEADER') return { label: 'ראש צוות', className: 'border-emerald-300 bg-emerald-100 text-emerald-700' };
  if (role === 'BACKUP') return { label: 'גיבוי', className: 'border-purple-300 bg-purple-100 text-purple-700' };
  return { label: 'משובצת', className: 'border-emerald-300 bg-emerald-100 text-emerald-700' };
}

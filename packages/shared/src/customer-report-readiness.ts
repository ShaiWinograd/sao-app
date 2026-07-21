// Customer-report readiness (spec §18.1).
//
// A case is ready for a customer report only when it is still ACTIVE, has at
// least one Completed job, has nothing still in flight (no RESERVATION/APPROVED
// jobs), all its completed jobs have resolved attendance, and no finalized report
// already exists. Missing end-of-job forms do NOT block readiness (spec §18.1).
// ARCHIVED (cancelled) jobs are ignored — they neither block nor count.
//
// Readiness is DERIVED from jobs + attendance + report state (never stored as a
// separate manually maintained status), so it cannot go stale silently.

export type ReadinessJob = {
  // JobStatus: RESERVATION | APPROVED | COMPLETED | ARCHIVED
  status: string;
  // True when the job has any shift still awaiting owner attendance review.
  hasUnresolvedAttendance: boolean;
  // True when the job is already bound to a finalized report chain (reportedAt set).
  reported?: boolean;
};

export function isCaseReadyForReport(input: {
  caseStatus: string;
  hasFinalizedReport: boolean;
  jobs: ReadinessJob[];
}): boolean {
  if (input.caseStatus !== 'ACTIVE') return false;
  if (input.hasFinalizedReport) return false;

  const relevant = input.jobs.filter((j) => j.status !== 'ARCHIVED');
  if (relevant.length === 0) return false;

  // Nothing may still be in flight — every non-archived job must be Completed.
  if (relevant.some((j) => j.status !== 'COMPLETED')) return false;

  // Readiness is based on the ELIGIBLE reportable set, not merely on the presence
  // of any historical Completed job: there must be ≥1 completed, UNREPORTED job.
  // Guards the empty-set cases (all archived / all already reported / jobs moved
  // out / nothing left to include).
  const eligible = relevant.filter((j) => j.status === 'COMPLETED' && !j.reported);
  if (eligible.length === 0) return false;

  // Attendance for every eligible job must be resolved (forms are NOT checked).
  if (eligible.some((j) => j.hasUnresolvedAttendance)) return false;

  return true;
}

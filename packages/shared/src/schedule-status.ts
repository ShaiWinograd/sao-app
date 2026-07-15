// Derives the "approved project" scheduling status from what was planned vs.
// what has actually been scheduled as jobs. Used to auto-advance a case through
// APPROVED_NO_DATES → PARTIALLY_SCHEDULED → READY_FOR_EXECUTION after a quote is
// approved. Pure function so it can be unit-tested and reused on both tiers.

export type ApprovedScheduleStatus =
  | 'APPROVED_NO_DATES'
  | 'PARTIALLY_SCHEDULED'
  | 'READY_FOR_EXECUTION';

export function computeApprovedScheduleStatus(
  plannedServiceTypes: readonly string[],
  scheduledJobTypes: readonly string[],
): ApprovedScheduleStatus {
  const scheduled = new Set(scheduledJobTypes);
  if (scheduled.size === 0) return 'APPROVED_NO_DATES';

  const planned = new Set(plannedServiceTypes);
  // No planned components to compare against — any scheduled work is enough.
  if (planned.size === 0) return 'READY_FOR_EXECUTION';

  const allPlannedScheduled = [...planned].every((type) => scheduled.has(type));
  return allPlannedScheduled ? 'READY_FOR_EXECUTION' : 'PARTIALLY_SCHEDULED';
}

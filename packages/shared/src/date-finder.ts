// Candidate-date finder (business_app_ux_spec §6, "מציאת תאריך פנוי").
// Ranks calendar dates by how well the required staffing can be covered,
// using workers' already-booked dates as the source of availability.

export type DateFinderWorker = {
  id: string;
  isActive: boolean;
  isManager: boolean;
  bookedDates: string[];
};

export type DateFinderQuery = {
  startDate: string;
  endDate: string;
  requiredWorkers: number;
  requiresManager?: boolean;
  // 0 = Sunday … 6 = Saturday. Omitted / empty = all weekdays allowed.
  allowedWeekdays?: number[];
};

export type CandidateDate = {
  date: string;
  availableWorkers: number;
  availableManagers: number;
  suitable: boolean;
};

// Safety cap so a wide range never produces an unbounded scan.
const MAX_DAYS = 120;

function toDateKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function findCandidateDates(
  query: DateFinderQuery,
  workers: DateFinderWorker[],
): CandidateDate[] {
  const start = new Date(`${query.startDate}T00:00:00.000Z`);
  const end = new Date(`${query.endDate}T00:00:00.000Z`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end < start) {
    return [];
  }

  const activeWorkers = workers.filter((worker) => worker.isActive);
  const allowedWeekdays =
    query.allowedWeekdays && query.allowedWeekdays.length > 0 ? new Set(query.allowedWeekdays) : null;

  const candidates: CandidateDate[] = [];
  const cursor = new Date(start);
  let days = 0;

  while (cursor <= end && days < MAX_DAYS) {
    const dateKey = toDateKey(cursor);
    const weekday = cursor.getUTCDay();

    if (!allowedWeekdays || allowedWeekdays.has(weekday)) {
      let availableWorkers = 0;
      let availableManagers = 0;
      for (const worker of activeWorkers) {
        if (worker.bookedDates.includes(dateKey)) continue;
        availableWorkers += 1;
        if (worker.isManager) availableManagers += 1;
      }
      const suitable =
        availableWorkers >= query.requiredWorkers &&
        (!query.requiresManager || availableManagers >= 1);
      candidates.push({ date: dateKey, availableWorkers, availableManagers, suitable });
    }

    cursor.setUTCDate(cursor.getUTCDate() + 1);
    days += 1;
  }

  return candidates.sort((a, b) => {
    if (a.suitable !== b.suitable) return a.suitable ? -1 : 1;
    if (b.availableWorkers !== a.availableWorkers) return b.availableWorkers - a.availableWorkers;
    return a.date.localeCompare(b.date);
  });
}

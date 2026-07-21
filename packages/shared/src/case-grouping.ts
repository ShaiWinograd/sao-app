// Customer-case grouping rule (spec §18.12, §10.1).
//
// A newly created job may join an existing ACTIVE case for the same customer only
// when the new job's DATE falls within CASE_REOPEN_DAYS of that case's current
// job-date range:
//
//     newJobDate >= earliestJobDate - window   AND   newJobDate <= latestJobDate + window
//
// The window is measured against Job.date (the scheduled service date) only — it
// never expands because of edits, attendance corrections, report views, generic
// case updates, or later completion timestamps. The range is derived from the
// case's job dates (rolling: it grows as eligible jobs are added). A case CLOSED
// by a finalized customer report is never eligible again (handled by the caller,
// which only passes ACTIVE, non-closed candidates).

export const CASE_REOPEN_DAYS_DEFAULT = 60;

const MS_PER_DAY = 24 * 60 * 60 * 1000;

export type CaseDateRange = {
  earliestJobDate: Date;
  latestJobDate: Date;
};

export type GroupingCandidate = CaseDateRange & {
  caseId: string;
};

export type GroupingDecision = {
  // The case the new job should join, or null when a new case must be created.
  chosenCaseId: string | null;
  // All cases that matched the window (for anomaly detection / logging).
  eligibleCaseIds: string[];
  // True when more than one case matched — a data anomaly worth investigating.
  anomaly: boolean;
};

function toMs(d: Date): number {
  return d instanceof Date ? d.getTime() : new Date(d).getTime();
}

/** Build a case's date range from its job dates, or null when it has no jobs. */
export function caseRangeFromJobDates(jobDates: Array<Date | string>): CaseDateRange | null {
  const times = jobDates.map((d) => toMs(new Date(d)));
  if (times.length === 0) return null;
  return {
    earliestJobDate: new Date(Math.min(...times)),
    latestJobDate: new Date(Math.max(...times)),
  };
}

/** Whether a new job date falls inside a case's grouping window. Inclusive bounds. */
export function isJobDateInCaseWindow(
  newJobDate: Date | string,
  range: CaseDateRange,
  windowDays: number = CASE_REOPEN_DAYS_DEFAULT,
): boolean {
  const t = toMs(new Date(newJobDate));
  const windowMs = windowDays * MS_PER_DAY;
  return t >= toMs(range.earliestJobDate) - windowMs && t <= toMs(range.latestJobDate) + windowMs;
}

/**
 * Distance (in ms) from the new job date to a case's date range: 0 when the date
 * is inside the range, otherwise the gap to the nearest endpoint. Used to pick the
 * closest case when (anomalously) more than one is eligible.
 */
function rangeDistanceMs(newJobDate: Date | string, range: CaseDateRange): number {
  const t = toMs(new Date(newJobDate));
  const lo = toMs(range.earliestJobDate);
  const hi = toMs(range.latestJobDate);
  if (t < lo) return lo - t;
  if (t > hi) return t - hi;
  return 0;
}

/**
 * Decide which existing case (if any) a new job joins.
 *
 * Candidates MUST already be filtered to the same customer and to ACTIVE,
 * non-closed cases. Selection when multiple match: the case whose date range is
 * closest to the new job date; ties broken by the most recent latestJobDate. The
 * caller should log `anomaly` and never silently merge cases.
 */
export function selectCaseForJob(
  newJobDate: Date | string,
  candidates: GroupingCandidate[],
  windowDays: number = CASE_REOPEN_DAYS_DEFAULT,
): GroupingDecision {
  const eligible = candidates.filter((c) => isJobDateInCaseWindow(newJobDate, c, windowDays));
  if (eligible.length === 0) {
    return { chosenCaseId: null, eligibleCaseIds: [], anomaly: false };
  }

  const chosen = [...eligible].sort((a, b) => {
    const da = rangeDistanceMs(newJobDate, a);
    const db = rangeDistanceMs(newJobDate, b);
    if (da !== db) return da - db; // closest range first
    return toMs(b.latestJobDate) - toMs(a.latestJobDate); // then most recent latest job
  })[0];

  return {
    chosenCaseId: chosen.caseId,
    eligibleCaseIds: eligible.map((c) => c.caseId),
    anomaly: eligible.length > 1,
  };
}

/** Validate a CASE_REOPEN_DAYS configuration value; falls back to the default. */
export function resolveCaseReopenDays(raw: unknown): number {
  const n = Number(raw);
  if (!Number.isInteger(n) || n <= 0) return CASE_REOPEN_DAYS_DEFAULT;
  return n;
}

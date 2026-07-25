// Priority-1 "Requires Attention" job derivations.
// Source of truth: space_order_product_refactor_spec.md §7.3 (items 1–2), §7.4,
// §22.1 ("timestamps stored in UTC and rendered in the business timezone").
//
// Two operational tasks are computed purely from job status + date:
//   1. "Today still in Reservation"  — a job scheduled for TODAY that the owner
//      has not yet approved (status RESERVATION).
//   2. "Past not Completed"          — a job whose date has already passed and
//      that is still open (status RESERVATION or APPROVED).
//
// Both are DERIVED items: there is no done/snooze state and no mutation endpoint.
// They disappear on the next fetch once the job's status/date no longer matches.
//
// TIMEZONE SAFETY (spec §22): "today" and each job's calendar day are evaluated in
// the business timezone — never against an implicit UTC-midnight boundary. Job
// dates are stored as the calendar day at UTC midnight, so the business-timezone
// day of that instant is the job's intended service day.

import { BUSINESS_TIME_ZONE } from './attendance-sweep';

export type AttentionJobStatus = 'RESERVATION' | 'APPROVED' | 'COMPLETED' | 'ARCHIVED';

/** Minimal job shape needed to classify + render a Requires-Attention row. */
export type AttentionJobInput = {
  jobId: string;
  /** Job service date (ISO). Stored as the calendar day at UTC midnight. */
  date: string;
  status: AttentionJobStatus;
  /** Planned start (ISO) — used to order today's jobs by start time. */
  plannedStart: string;
  /** Display name (customer, or general-reservation label). */
  customerName: string;
  jobType?: string | null;
};

export type AttentionJob = AttentionJobInput & {
  /** Business-timezone calendar day key (YYYY-MM-DD) of the job. */
  dateKey: string;
};

export type AttentionJobGroups = {
  todayInReservation: AttentionJob[];
  pastNotCompleted: AttentionJob[];
};

/** Calendar date key (YYYY-MM-DD) for an instant, in the business timezone. */
export function businessDateKey(instant: Date, timeZone: string = BUSINESS_TIME_ZONE): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(instant);
}

/**
 * Format a job's service date for display, in the business timezone (§22.1). Job
 * dates are stored at UTC midnight of their calendar day, so formatting WITHOUT an
 * explicit timeZone would show the wrong day for viewers whose system timezone is
 * behind UTC. Always pass the business timezone so the rendered day matches the
 * job's intended calendar date regardless of the browser's timezone.
 */
export function formatBusinessDate(
  date: Date | string,
  options: Intl.DateTimeFormatOptions = { day: '2-digit', month: '2-digit' },
  locale = 'he-IL',
  timeZone: string = BUSINESS_TIME_ZONE,
): string {
  return new Intl.DateTimeFormat(locale, { ...options, timeZone }).format(new Date(date));
}

/**
 * UTC instant at the start of the business-timezone day AFTER `now`. Used as an
 * exclusive upper bound for the DB pre-filter (`Job.date < tomorrowStart`) so the
 * query returns only today + past active jobs. Because job dates are stored at UTC
 * midnight of their calendar day, this bound is exact for the business day.
 */
export function businessTomorrowStartUtc(now: Date, timeZone: string = BUSINESS_TIME_ZONE): Date {
  const [y, m, d] = businessDateKey(now, timeZone).split('-').map(Number);
  return new Date(Date.UTC(y, (m as number) - 1, (d as number) + 1, 0, 0, 0, 0));
}

/**
 * Split candidate jobs into the two priority-1 attention groups, ordered per §7.4:
 *   - pastNotCompleted: overdue, OLDEST FIRST (by date, then start time);
 *   - todayInReservation: ordered by START TIME.
 *
 * Candidates should already exclude COMPLETED/ARCHIVED at the source, but this
 * function re-applies the status rule defensively so it is safe with any input.
 */
export function classifyAttentionJobs(
  jobs: AttentionJobInput[],
  now: Date,
  timeZone: string = BUSINESS_TIME_ZONE,
): AttentionJobGroups {
  const todayKey = businessDateKey(now, timeZone);
  const enriched: AttentionJob[] = jobs.map((j) => ({
    ...j,
    dateKey: businessDateKey(new Date(j.date), timeZone),
  }));

  const todayInReservation = enriched
    .filter((j) => j.dateKey === todayKey && j.status === 'RESERVATION')
    .sort((a, b) => a.plannedStart.localeCompare(b.plannedStart));

  const pastNotCompleted = enriched
    .filter((j) => j.dateKey < todayKey && (j.status === 'RESERVATION' || j.status === 'APPROVED'))
    .sort((a, b) => a.dateKey.localeCompare(b.dateKey) || a.plannedStart.localeCompare(b.plannedStart));

  return { todayInReservation, pastNotCompleted };
}

// Pure, DB-free time-based attendance & end-form rules for the sweep
// (spec §16.2 missing clock-in, §16.4 leaving-area auto clock-out, §17.3 end-form
// reminders/overdue). All functions take an explicit `now` so they are unit-tested
// with a controllable clock — never real waiting or setTimeout. Timers themselves
// are persisted in the database; these functions only decide eligibility.

export const MISSING_CLOCK_IN_GRACE_MINUTES = 15;
export const AREA_EXIT_GRACE_MINUTES = 15;
export const FORM_REMINDER_INTERVAL_HOURS = 3;
export const BUSINESS_TIME_ZONE = 'Asia/Jerusalem';

const MINUTE_MS = 60_000;
const HOUR_MS = 3_600_000;

// ─── §16.2 missing clock-in ───────────────────────────────────────────────────

export function missingClockInDeadline(scheduledStart: Date): Date {
  return new Date(scheduledStart.getTime() + MISSING_CLOCK_IN_GRACE_MINUTES * MINUTE_MS);
}

/** True once we are at/after 15 minutes past the scheduled start (inclusive boundary). */
export function isMissingClockInDue(scheduledStart: Date, now: Date): boolean {
  return now.getTime() >= missingClockInDeadline(scheduledStart).getTime();
}

// ─── §16.4 leaving-area auto clock-out ────────────────────────────────────────

export function areaExitDeadline(exitAt: Date): Date {
  return new Date(exitAt.getTime() + AREA_EXIT_GRACE_MINUTES * MINUTE_MS);
}

/** True once the 15-minute grace after the recorded exit has elapsed (inclusive). */
export function isAreaExitDue(exitAt: Date, now: Date): boolean {
  return now.getTime() >= areaExitDeadline(exitAt).getTime();
}

// ─── §17.3 end-form reminders / overdue ───────────────────────────────────────

/** Next reminder time = (lastReminderAt ?? clockOutAt) + 3h. */
export function nextFormReminderAt(clockOutAt: Date, lastReminderAt: Date | null): Date {
  const base = lastReminderAt ?? clockOutAt;
  return new Date(base.getTime() + FORM_REMINDER_INTERVAL_HOURS * HOUR_MS);
}

/**
 * A reminder is due when we've reached the next 3-hour mark and the deadline has
 * not yet passed. At most one reminder is emitted per sweep — after sending, the
 * caller sets lastReminderAt=now, so a delayed/retried sweep never bursts multiple
 * reminders for missed intervals (spec §17.3 catch-up rule).
 */
export function isFormReminderDue(input: {
  clockOutAt: Date;
  lastReminderAt: Date | null;
  deadline: Date;
  now: Date;
}): boolean {
  const { clockOutAt, lastReminderAt, deadline, now } = input;
  if (now.getTime() >= deadline.getTime()) return false; // past deadline → overdue, stop reminding
  return now.getTime() >= nextFormReminderAt(clockOutAt, lastReminderAt).getTime();
}

/** True once the form deadline has passed. */
export function isFormOverdue(deadline: Date, now: Date): boolean {
  return now.getTime() >= deadline.getTime();
}

/**
 * End-of-form deadline = end of the day AFTER clock-out, evaluated in the business
 * timezone and returned as a UTC instant (spec §17.3 "editable until the end of the
 * following day"). DST-safe via a two-step offset refinement.
 */
export function endOfNextDayDeadline(clockOutAt: Date, timeZone: string = BUSINESS_TIME_ZONE): Date {
  const [y, m, d] = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  })
    .format(clockOutAt)
    .split('-')
    .map(Number);
  // Wall-clock 23:59:59.999 on the next local day, as if it were UTC.
  const wallEndAsUtc = Date.UTC(y, m - 1, (d as number) + 1, 23, 59, 59, 999);
  const off1 = tzOffsetMs(clockOutAt, timeZone);
  const off2 = tzOffsetMs(new Date(wallEndAsUtc - off1), timeZone);
  return new Date(wallEndAsUtc - off2);
}

function tzOffsetMs(instant: Date, timeZone: string): number {
  const local = new Date(instant.toLocaleString('en-US', { timeZone }));
  const utc = new Date(instant.toLocaleString('en-US', { timeZone: 'UTC' }));
  return local.getTime() - utc.getTime();
}

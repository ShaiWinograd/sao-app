import { describe, expect, it } from 'vitest';
import {
  missingClockInDeadline,
  isMissingClockInDue,
  areaExitDeadline,
  isAreaExitDue,
  nextFormReminderAt,
  isFormReminderDue,
  isFormOverdue,
  endOfNextDayDeadline,
  MISSING_CLOCK_IN_GRACE_MINUTES,
} from './attendance-sweep';

const at = (iso: string) => new Date(iso);

describe('missing clock-in (§16.2)', () => {
  const start = at('2026-08-01T08:00:00.000Z');

  it('deadline is scheduledStart + 15m', () => {
    expect(missingClockInDeadline(start).toISOString()).toBe('2026-08-01T08:15:00.000Z');
    expect(MISSING_CLOCK_IN_GRACE_MINUTES).toBe(15);
  });

  it('is not due one second before the +15m boundary', () => {
    expect(isMissingClockInDue(start, at('2026-08-01T08:14:59.000Z'))).toBe(false);
  });

  it('is due exactly at the +15m boundary (inclusive)', () => {
    expect(isMissingClockInDue(start, at('2026-08-01T08:15:00.000Z'))).toBe(true);
  });

  it('is due after the boundary (catch-up after downtime)', () => {
    expect(isMissingClockInDue(start, at('2026-08-01T08:35:00.000Z'))).toBe(true);
  });
});

describe('leaving-area auto clock-out (§16.4)', () => {
  const exit = at('2026-08-01T10:00:00.000Z');

  it('deadline is exit + 15m', () => {
    expect(areaExitDeadline(exit).toISOString()).toBe('2026-08-01T10:15:00.000Z');
  });

  it('not due before the deadline (return window)', () => {
    expect(isAreaExitDue(exit, at('2026-08-01T10:14:59.000Z'))).toBe(false);
  });

  it('due at/after the deadline', () => {
    expect(isAreaExitDue(exit, at('2026-08-01T10:15:00.000Z'))).toBe(true);
    expect(isAreaExitDue(exit, at('2026-08-01T10:40:00.000Z'))).toBe(true);
  });
});

describe('end-form reminders (§17.3)', () => {
  const clockOut = at('2026-08-01T12:00:00.000Z');
  const deadline = at('2026-08-02T20:59:59.000Z');

  it('first reminder is due 3h after clock-out when none sent yet', () => {
    expect(nextFormReminderAt(clockOut, null).toISOString()).toBe('2026-08-01T15:00:00.000Z');
    expect(isFormReminderDue({ clockOutAt: clockOut, lastReminderAt: null, deadline, now: at('2026-08-01T14:59:00.000Z') })).toBe(false);
    expect(isFormReminderDue({ clockOutAt: clockOut, lastReminderAt: null, deadline, now: at('2026-08-01T15:00:00.000Z') })).toBe(true);
  });

  it('next reminder is 3h after the last one', () => {
    const last = at('2026-08-01T15:00:00.000Z');
    expect(isFormReminderDue({ clockOutAt: clockOut, lastReminderAt: last, deadline, now: at('2026-08-01T17:59:00.000Z') })).toBe(false);
    expect(isFormReminderDue({ clockOutAt: clockOut, lastReminderAt: last, deadline, now: at('2026-08-01T18:00:00.000Z') })).toBe(true);
  });

  it('sends at most one catch-up reminder even long after the last (no burst)', () => {
    // 12h since last reminder — still just "due once"; caller advances lastReminderAt.
    const last = at('2026-08-01T15:00:00.000Z');
    expect(isFormReminderDue({ clockOutAt: clockOut, lastReminderAt: last, deadline, now: at('2026-08-02T03:00:00.000Z') })).toBe(true);
  });

  it('stops reminding once the deadline has passed', () => {
    expect(isFormReminderDue({ clockOutAt: clockOut, lastReminderAt: null, deadline, now: at('2026-08-03T00:00:00.000Z') })).toBe(false);
  });
});

describe('form overdue (§17.3)', () => {
  const deadline = at('2026-08-02T20:59:59.000Z');
  it('not overdue before deadline, overdue at/after', () => {
    expect(isFormOverdue(deadline, at('2026-08-02T20:00:00.000Z'))).toBe(false);
    expect(isFormOverdue(deadline, at('2026-08-02T21:00:00.000Z'))).toBe(true);
  });
});

describe('endOfNextDayDeadline (business timezone)', () => {
  it('is end of the following local day in Asia/Jerusalem (summer, UTC+3)', () => {
    // Clock out 2026-08-01 12:00Z → local Aug 1 → deadline end of Aug 2 local.
    // Aug 2 23:59:59.999 local (UTC+3) == Aug 2 20:59:59.999Z.
    const d = endOfNextDayDeadline(at('2026-08-01T12:00:00.000Z'));
    expect(d.toISOString()).toBe('2026-08-02T20:59:59.999Z');
  });

  it('is end of the following local day in Asia/Jerusalem (winter, UTC+2)', () => {
    // Clock out 2026-01-10 12:00Z → deadline end of Jan 11 local (UTC+2) == Jan 11 21:59:59.999Z.
    const d = endOfNextDayDeadline(at('2026-01-10T12:00:00.000Z'));
    expect(d.toISOString()).toBe('2026-01-11T21:59:59.999Z');
  });

  it('handles a late-evening UTC clock-out that is already next local day', () => {
    // 2026-08-01 22:00Z == Aug 2 01:00 local → local day Aug 2 → deadline end of Aug 3 local.
    const d = endOfNextDayDeadline(at('2026-08-01T22:00:00.000Z'));
    expect(d.toISOString()).toBe('2026-08-03T20:59:59.999Z');
  });
});

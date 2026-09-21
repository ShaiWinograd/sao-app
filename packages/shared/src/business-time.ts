import { BUSINESS_TIME_ZONE } from './attendance-sweep';

type TimeValue = Date | string | null | undefined;

function validDate(value: TimeValue): Date | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

/**
 * Job schedule fields preserve the entered business wall clock in their UTC
 * components. Format them in UTC so 09:00 remains 09:00 on every device.
 */
export function formatJobTime(value: TimeValue, locale = 'he-IL'): string {
  const date = validDate(value);
  return date
    ? date.toLocaleTimeString(locale, {
        hour: '2-digit',
        minute: '2-digit',
        hourCycle: 'h23',
        timeZone: 'UTC',
      })
    : '';
}

/** Real event timestamps, such as clock-in/out, render in the business timezone. */
export function formatBusinessTime(value: TimeValue, locale = 'he-IL'): string {
  const date = validDate(value);
  return date
    ? date.toLocaleTimeString(locale, {
        hour: '2-digit',
        minute: '2-digit',
        hourCycle: 'h23',
        timeZone: BUSINESS_TIME_ZONE,
      })
    : '';
}

import { describe, expect, it } from 'vitest';
import { formatBusinessTime, formatJobTime } from './business-time';

describe('business time formatting', () => {
  it('keeps an entered job wall clock unchanged', () => {
    expect(formatJobTime('2026-09-21T09:00:00.000Z', 'en-GB')).toBe('09:00');
    expect(formatJobTime('2026-09-21T14:00:00.000Z', 'en-GB')).toBe('14:00');
  });

  it('renders real timestamps in the Jerusalem timezone', () => {
    expect(formatBusinessTime('2026-09-21T09:00:00.000Z', 'en-GB')).toBe('12:00');
  });
});

import { describe, expect, it } from 'vitest';
import { israeliNonWorkingDayName } from './israeli-calendar';

describe('Israeli non-working days', () => {
  it('marks Saturdays', () => {
    expect(israeliNonWorkingDayName(new Date(2026, 8, 26))).toBe('שבת');
  });

  it('marks major holidays that are not Saturdays', () => {
    expect(israeliNonWorkingDayName(new Date(2026, 8, 21))).toBe('יום כיפור');
    expect(israeliNonWorkingDayName(new Date(2027, 3, 22))).toBe('פסח');
  });

  it('keeps regular working days available', () => {
    expect(israeliNonWorkingDayName(new Date(2026, 8, 22))).toBeNull();
  });
});

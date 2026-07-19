import { describe, expect, it } from 'vitest';
import {
  addressRequiresReapproval,
  scheduleRequiresReapproval,
  requiresReapproval,
} from './reapproval';

describe('addressRequiresReapproval', () => {
  it('does not require reapproval when only a city was known before', () => {
    expect(addressRequiresReapproval('תל אביב', 'הרצל 10, תל אביב')).toBe(false);
  });

  it('does not require reapproval when a building number is added', () => {
    expect(addressRequiresReapproval('הרצל, תל אביב', 'הרצל 10, תל אביב')).toBe(false);
  });

  it('does not require reapproval when apartment/floor detail is appended', () => {
    expect(addressRequiresReapproval('הרצל 10, תל אביב', 'הרצל 10, תל אביב דירה 4 קומה 2')).toBe(false);
  });

  it('requires reapproval when the city changes', () => {
    expect(addressRequiresReapproval('הרצל 10, תל אביב', 'הרצל 10, חיפה')).toBe(true);
  });

  it('requires reapproval when the street changes', () => {
    expect(addressRequiresReapproval('הרצל 10, תל אביב', 'דיזנגוף 5, תל אביב')).toBe(true);
  });

  it('ignores whitespace and case differences', () => {
    expect(addressRequiresReapproval('  Herzl 10, Tel Aviv ', 'herzl 10,  tel aviv')).toBe(false);
  });

  it('does not require reapproval when there was no prior address', () => {
    expect(addressRequiresReapproval(null, 'הרצל 10, תל אביב')).toBe(false);
  });
});

describe('scheduleRequiresReapproval', () => {
  const start = '2026-08-01T08:00:00.000Z';
  const end = '2026-08-01T16:00:00.000Z';

  it('does not require reapproval for a shift under 3 hours', () => {
    expect(
      scheduleRequiresReapproval(start, end, '2026-08-01T10:00:00.000Z', '2026-08-01T18:00:00.000Z'),
    ).toBe(false);
  });

  it('requires reapproval for a shift of exactly 3 hours', () => {
    expect(
      scheduleRequiresReapproval(start, end, '2026-08-01T11:00:00.000Z', '2026-08-01T19:00:00.000Z'),
    ).toBe(true);
  });

  it('requires reapproval when the date changes', () => {
    expect(
      scheduleRequiresReapproval(start, end, '2026-08-05T08:00:00.000Z', '2026-08-05T16:00:00.000Z'),
    ).toBe(true);
  });
});

describe('requiresReapproval', () => {
  it('combines address and schedule rules', () => {
    expect(
      requiresReapproval({
        oldAddress: 'הרצל 10, תל אביב',
        newAddress: 'הרצל 10, תל אביב דירה 4',
        oldStart: '2026-08-01T08:00:00.000Z',
        oldEnd: '2026-08-01T16:00:00.000Z',
        newStart: '2026-08-01T09:00:00.000Z',
        newEnd: '2026-08-01T17:00:00.000Z',
      }),
    ).toBe(false);
  });
});

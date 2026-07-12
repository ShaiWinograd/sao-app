import { describe, expect, it } from 'vitest';
import {
  calculateEndShiftSubmissionWindow,
  mapHebrewEndShiftStatusToApi,
  requiresManagerNoteForEndShift,
} from './end-shift';

describe('calculateEndShiftSubmissionWindow', () => {
  it('returns active window details for recent clock-out', () => {
    const now = new Date('2026-07-12T10:00:00.000Z');
    const result = calculateEndShiftSubmissionWindow('2026-07-12T08:45:00.000Z', now);

    expect(result).not.toBeNull();
    expect(result?.elapsedMinutes).toBe(75);
    expect(result?.remainingMinutes).toBe(45);
    expect(result?.isExpired).toBe(false);
  });

  it('marks window expired when more than two hours elapsed', () => {
    const now = new Date('2026-07-12T10:31:00.000Z');
    const result = calculateEndShiftSubmissionWindow('2026-07-12T08:30:00.000Z', now);

    expect(result?.elapsedMinutes).toBe(121);
    expect(result?.remainingMinutes).toBe(-1);
    expect(result?.isExpired).toBe(true);
  });

  it('returns null for invalid date input', () => {
    expect(calculateEndShiftSubmissionWindow('not-a-date')).toBeNull();
  });
});

describe('requiresManagerNoteForEndShift', () => {
  it('requires note for partial completion and failure completion', () => {
    expect(requiresManagerNoteForEndShift('PARTIALLY_COMPLETED')).toBe(true);
    expect(requiresManagerNoteForEndShift('NOT_COMPLETED')).toBe(true);
  });

  it('does not require note for completed shifts', () => {
    expect(requiresManagerNoteForEndShift('COMPLETED')).toBe(false);
  });
});

describe('mapHebrewEndShiftStatusToApi', () => {
  it('maps Hebrew status options to API enum', () => {
    expect(mapHebrewEndShiftStatusToApi('הושלם')).toBe('COMPLETED');
    expect(mapHebrewEndShiftStatusToApi('הושלם חלקית')).toBe('PARTIALLY_COMPLETED');
    expect(mapHebrewEndShiftStatusToApi('חסר מידע')).toBe('NOT_COMPLETED');
  });
});

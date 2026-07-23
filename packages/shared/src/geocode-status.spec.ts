import { describe, expect, it } from 'vitest';
import {
  GEOCODE_STATUSES,
  geocodeMonitoringActive,
  geocodeMonitoringState,
  geocodeMonitoringStateLabel,
  geocodeStatusLabel,
  type GeocodeStatus,
} from './geocode-status';

describe('geocodeMonitoringActive (§16.4 safety invariant)', () => {
  it('activates the 500 m rule ONLY for a validated RESOLVED status', () => {
    expect(geocodeMonitoringActive('RESOLVED')).toBe(true);
  });

  it('never activates for any non-RESOLVED status', () => {
    for (const s of ['NOT_REQUESTED', 'NEEDS_REVIEW', 'FAILED'] as GeocodeStatus[]) {
      expect(geocodeMonitoringActive(s)).toBe(false);
    }
  });

  it('never activates for a missing/unknown status or bare coordinates without a status', () => {
    expect(geocodeMonitoringActive(null)).toBe(false);
    expect(geocodeMonitoringActive(undefined)).toBe(false);
    expect(geocodeMonitoringActive('')).toBe(false);
    expect(geocodeMonitoringActive('resolved')).toBe(false); // case-sensitive; only the exact enum value
    expect(geocodeMonitoringActive('CITY_CENTROID')).toBe(false);
  });
});

describe('geocodeMonitoringState', () => {
  it('maps RESOLVED→ACTIVE, NEEDS_REVIEW→NEEDS_REVIEW, everything else→UNAVAILABLE', () => {
    expect(geocodeMonitoringState('RESOLVED')).toBe('ACTIVE');
    expect(geocodeMonitoringState('NEEDS_REVIEW')).toBe('NEEDS_REVIEW');
    expect(geocodeMonitoringState('NOT_REQUESTED')).toBe('UNAVAILABLE');
    expect(geocodeMonitoringState('FAILED')).toBe('UNAVAILABLE');
    expect(geocodeMonitoringState(null)).toBe('UNAVAILABLE');
  });
});

describe('Hebrew labels', () => {
  it('gives a clear owner-facing label per raw status', () => {
    expect(geocodeStatusLabel('RESOLVED')).toBe('מיקום אומת');
    expect(geocodeStatusLabel('NEEDS_REVIEW')).toBe('כתובת דורשת בדיקה');
    expect(geocodeStatusLabel('FAILED')).toBe('איתור מיקום נכשל');
    expect(geocodeStatusLabel('NOT_REQUESTED')).toBe('טרם אותר מיקום');
    expect(geocodeStatusLabel(null)).toBe('טרם אותר מיקום'); // default is the inactive state
  });

  it('labels the derived monitoring state for the owner', () => {
    expect(geocodeMonitoringStateLabel('RESOLVED')).toBe('ניטור מיקום פעיל');
    expect(geocodeMonitoringStateLabel('NEEDS_REVIEW')).toBe('כתובת דורשת בדיקה');
    expect(geocodeMonitoringStateLabel('NOT_REQUESTED')).toBe('ניטור מיקום לא זמין');
    expect(geocodeMonitoringStateLabel('FAILED')).toBe('ניטור מיקום לא זמין');
  });

  it('never surfaces a raw enum code in any label', () => {
    for (const s of GEOCODE_STATUSES) {
      expect(geocodeStatusLabel(s)).not.toMatch(/[A-Z_]{3,}/);
      expect(geocodeMonitoringStateLabel(s)).not.toMatch(/[A-Z_]{3,}/);
    }
  });
});

describe('GEOCODE_STATUSES', () => {
  it('lists exactly the four Prisma enum values, NOT_REQUESTED first (the default)', () => {
    expect(GEOCODE_STATUSES).toEqual(['NOT_REQUESTED', 'RESOLVED', 'NEEDS_REVIEW', 'FAILED']);
  });
});

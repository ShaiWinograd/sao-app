import { describe, expect, it } from 'vitest';
import {
  GEOCODE_STATUSES,
  addressMonitoringCoords,
  evaluateGeofence,
  geocodeMonitoringActive,
  geocodeMonitoringState,
  geocodeMonitoringStateLabel,
  geocodeReasonExplanation,
  geocodeStatusLabel,
  isAddressMonitoringActive,
  isRetryableGeocodeReason,
  toWorkerJobMonitoring,
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

describe('addressMonitoringCoords (central §16.4 coordinate gate)', () => {
  const RESOLVED = (over: Record<string, unknown> = {}) => ({ geocodeStatus: 'RESOLVED', latitude: 32.06, longitude: 34.77, ...over });

  it('returns coordinates only for RESOLVED with valid, in-range lat/lon', () => {
    expect(addressMonitoringCoords(RESOLVED())).toEqual({ latitude: 32.06, longitude: 34.77 });
    expect(isAddressMonitoringActive(RESOLVED())).toBe(true);
  });

  it('treats 0/0 as valid coordinates (never rejected for being falsy)', () => {
    expect(addressMonitoringCoords(RESOLVED({ latitude: 0, longitude: 0 }))).toEqual({ latitude: 0, longitude: 0 });
  });

  it('returns null for every non-RESOLVED status even if stray coordinates exist', () => {
    for (const st of ['NOT_REQUESTED', 'NEEDS_REVIEW', 'FAILED', null, undefined, 'resolved']) {
      expect(addressMonitoringCoords(RESOLVED({ geocodeStatus: st }))).toBeNull();
      expect(isAddressMonitoringActive(RESOLVED({ geocodeStatus: st }))).toBe(false);
    }
  });

  it('returns null for missing, non-numeric, non-finite, or out-of-range coordinates', () => {
    expect(addressMonitoringCoords(RESOLVED({ latitude: null }))).toBeNull();
    expect(addressMonitoringCoords(RESOLVED({ longitude: undefined }))).toBeNull();
    expect(addressMonitoringCoords(RESOLVED({ latitude: '32.06' }))).toBeNull();
    expect(addressMonitoringCoords(RESOLVED({ latitude: Number.NaN }))).toBeNull();
    expect(addressMonitoringCoords(RESOLVED({ longitude: Infinity }))).toBeNull();
    expect(addressMonitoringCoords(RESOLVED({ latitude: 91 }))).toBeNull();
    expect(addressMonitoringCoords(RESOLVED({ latitude: -90.5 }))).toBeNull();
    expect(addressMonitoringCoords(RESOLVED({ longitude: 181 }))).toBeNull();
    expect(addressMonitoringCoords(RESOLVED({ longitude: -200 }))).toBeNull();
  });

  it('returns null for a null/undefined address', () => {
    expect(addressMonitoringCoords(null)).toBeNull();
    expect(addressMonitoringCoords(undefined)).toBeNull();
  });
});

describe('toWorkerJobMonitoring (worker/mobile contract)', () => {
  it('exposes jobCoords only when monitoring is active (RESOLVED + valid coords)', () => {
    expect(toWorkerJobMonitoring({ geocodeStatus: 'RESOLVED', latitude: 32.06, longitude: 34.77 })).toEqual({
      monitoringActive: true,
      jobCoords: { latitude: 32.06, longitude: 34.77 },
    });
  });

  it('omits coordinates (jobCoords null, monitoringActive false) for any inactive address', () => {
    for (const a of [
      { geocodeStatus: 'NEEDS_REVIEW', latitude: 32.06, longitude: 34.77 },
      { geocodeStatus: 'FAILED', latitude: 32.06, longitude: 34.77 },
      { geocodeStatus: 'NOT_REQUESTED', latitude: 32.06, longitude: 34.77 },
      { geocodeStatus: 'RESOLVED', latitude: null, longitude: null },
      { geocodeStatus: 'RESOLVED', latitude: 999, longitude: 34.77 },
      null,
    ]) {
      expect(toWorkerJobMonitoring(a as any)).toEqual({ monitoringActive: false, jobCoords: null });
    }
  });
});

describe('evaluateGeofence (attendance distance/gate)', () => {
  const RESOLVED = { geocodeStatus: 'RESOLVED', latitude: 32.0, longitude: 34.8 };

  it('judges distance only for a validated RESOLVED address + worker reading', () => {
    const near = evaluateGeofence({ address: RESOLVED, workerLatitude: 32.0005, workerLongitude: 34.8, allowedRadiusMeters: 500 });
    expect(near.locationKnown).toBe(true);
    expect(near.withinRadius).toBe(true);
    expect(near.distanceMeters).toBeGreaterThan(0);

    const far = evaluateGeofence({ address: RESOLVED, workerLatitude: 32.1, workerLongitude: 34.8, allowedRadiusMeters: 500 });
    expect(far.locationKnown).toBe(true);
    expect(far.withinRadius).toBe(false);
  });

  it('never judges distance for a non-RESOLVED address (locationKnown=false, withinRadius=true)', () => {
    for (const st of ['NOT_REQUESTED', 'NEEDS_REVIEW', 'FAILED']) {
      const g = evaluateGeofence({ address: { geocodeStatus: st, latitude: 32.0, longitude: 34.8 }, workerLatitude: 32.0, workerLongitude: 34.8, allowedRadiusMeters: 500 });
      expect(g).toEqual({ locationKnown: false, distanceMeters: null, withinRadius: true });
    }
  });

  it('is unknown (not out-of-range) when the worker reading is missing/denied', () => {
    const g = evaluateGeofence({ address: RESOLVED, workerLatitude: null, workerLongitude: null, allowedRadiusMeters: 500 });
    expect(g).toEqual({ locationKnown: false, distanceMeters: null, withinRadius: true });
  });

  it('handles a 0/0 worker reading against a 0/0 RESOLVED centre as known', () => {
    const g = evaluateGeofence({ address: { geocodeStatus: 'RESOLVED', latitude: 0, longitude: 0 }, workerLatitude: 0, workerLongitude: 0, allowedRadiusMeters: 500 });
    expect(g.locationKnown).toBe(true);
    expect(g.distanceMeters).toBe(0);
    expect(g.withinRadius).toBe(true);
  });
});

describe('isRetryableGeocodeReason', () => {
  it('is retryable only for a transient provider outage', () => {
    expect(isRetryableGeocodeReason('PROVIDER_UNAVAILABLE')).toBe(true);
  });
  it('is not retryable for results that need the owner to correct the address', () => {
    for (const r of ['NO_MATCH', 'CITY_MISMATCH', 'AMBIGUOUS', 'NOT_HOUSE_LEVEL', 'CENTROID_RESULT', 'LOW_CONFIDENCE', 'INVALID_QUERY', null]) {
      expect(isRetryableGeocodeReason(r)).toBe(false);
    }
  });
});

describe('geocodeReasonExplanation', () => {
  it('gives a plain, actionable Hebrew sentence per reason', () => {
    expect(geocodeReasonExplanation('AMBIGUOUS')).toContain('כמה כתובות');
    expect(geocodeReasonExplanation('CITY_MISMATCH')).toContain('עיר אחרת');
    expect(geocodeReasonExplanation('NOT_HOUSE_LEVEL')).toContain('מספר בית');
    expect(geocodeReasonExplanation('NO_MATCH')).toContain('לא נמצאה');
    expect(geocodeReasonExplanation('PROVIDER_UNAVAILABLE')).toContain('לנסות שוב');
  });
  it('returns no explanation for a successful or absent reason', () => {
    expect(geocodeReasonExplanation('RESOLVED_EXACT')).toBe('');
    expect(geocodeReasonExplanation(null)).toBe('');
    expect(geocodeReasonExplanation(undefined)).toBe('');
  });
  it('never exposes a raw reason code, confidence score, or technical error', () => {
    for (const r of ['AMBIGUOUS', 'CITY_MISMATCH', 'NOT_HOUSE_LEVEL', 'CENTROID_RESULT', 'LOW_CONFIDENCE', 'NO_MATCH', 'PROVIDER_UNAVAILABLE', 'PROVIDER_ERROR', 'INVALID_QUERY', 'CONFIG_ERROR', 'PROVIDER_NOT_CONFIGURED']) {
      const text = geocodeReasonExplanation(r);
      expect(text).not.toMatch(/[A-Z_]{3,}/); // no raw codes
      expect(text).not.toMatch(/0\.\d|confidence|score/i); // no confidence
    }
  });
});

// Geocoding status model (PBI #217).
//
// An address's `geocodeStatus` records how much we trust its coordinates. The
// SAFETY INVARIANT for the §16.4 attendance flow is centralised here: ONLY
// `RESOLVED` may activate the 500 m rule. Every other value — and any
// coordinates that lack a validated status — leaves location monitoring
// INACTIVE (clock-in always remains possible; attendance falls back to
// owner review). This module is pure/presentational and, in PR-1, is not yet
// wired into runtime geofence behavior; later PRs must gate on
// `geocodeMonitoringActive`.

import { distanceInMeters } from './utils';

/** Mirrors the Prisma `GeocodeStatus` enum. Append-only — never remove a value. */
export type GeocodeStatus = 'NOT_REQUESTED' | 'RESOLVED' | 'NEEDS_REVIEW' | 'FAILED';

export const GEOCODE_STATUSES: readonly GeocodeStatus[] = [
  'NOT_REQUESTED',
  'RESOLVED',
  'NEEDS_REVIEW',
  'FAILED',
] as const;

/**
 * The single source of truth for "may this address activate the §16.4 500 m
 * attendance rule?". True ONLY for a server-validated `RESOLVED` result. A
 * missing/unknown status, `NOT_REQUESTED`, `NEEDS_REVIEW`, `FAILED`, or bare
 * coordinates without a validated status all return false, so monitoring stays
 * inactive. Never widen this predicate.
 */
export function geocodeMonitoringActive(status: GeocodeStatus | string | null | undefined): boolean {
  return status === 'RESOLVED';
}

/** A validated monitoring centre — a job address's coordinates safe to geofence. */
export type MonitoringCoords = { latitude: number; longitude: number };

/**
 * THE central coordinate gate (PBI #217, PR-5). Returns the job address's
 * coordinates ONLY when they may drive the §16.4 500 m rule / leaving-area
 * watcher, i.e. when ALL hold:
 *   - `geocodeStatus` is exactly `RESOLVED`;
 *   - latitude & longitude are finite numbers (0 is valid — never treated as falsy);
 *   - latitude ∈ [-90, 90] and longitude ∈ [-180, 180].
 * Any other status, or missing/invalid/out-of-range coordinates, returns null so
 * monitoring stays inactive. This is PERMANENT safety infrastructure: every
 * runtime coordinate consumer must go through it and must NEVER infer monitoring
 * eligibility from coordinates alone. Never widen this gate.
 */
export function addressMonitoringCoords(
  address: { geocodeStatus?: string | null; latitude?: number | null; longitude?: number | null } | null | undefined,
): MonitoringCoords | null {
  if (!address || address.geocodeStatus !== 'RESOLVED') return null;
  const { latitude, longitude } = address;
  if (typeof latitude !== 'number' || typeof longitude !== 'number') return null;
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
  if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) return null;
  return { latitude, longitude };
}

/** True when the address may actively drive location monitoring (see the gate). */
export function isAddressMonitoringActive(
  address: { geocodeStatus?: string | null; latitude?: number | null; longitude?: number | null } | null | undefined,
): boolean {
  return addressMonitoringCoords(address) !== null;
}

/**
 * Worker/mobile monitoring contract (PBI #217, PR-5). The API exposes job
 * coordinates to workers ONLY when monitoring is active; otherwise `jobCoords`
 * is null and `monitoringActive` is false. The client must NOT infer eligibility
 * from coordinates — it must read `monitoringActive`.
 */
export function toWorkerJobMonitoring(
  address: { geocodeStatus?: string | null; latitude?: number | null; longitude?: number | null } | null | undefined,
): { monitoringActive: boolean; jobCoords: MonitoringCoords | null } {
  const jobCoords = addressMonitoringCoords(address);
  return { monitoringActive: jobCoords !== null, jobCoords };
}

/** Result of judging a worker's location against a job's monitoring centre. */
export interface GeofenceEvaluation {
  /** True only when there is a validated RESOLVED centre AND a worker reading. */
  locationKnown: boolean;
  distanceMeters: number | null;
  /** True when unknown (cannot judge → never treated as out-of-range). */
  withinRadius: boolean;
}

/**
 * Judge a worker's reported position against a job address's monitoring centre
 * (PBI #217, PR-5). The centre is taken through `addressMonitoringCoords`, so the
 * 500 m rule is applied ONLY for a validated RESOLVED address. When the centre or
 * the worker reading is missing/invalid, `locationKnown` is false and the caller
 * must still allow the action (flag for owner review, never block).
 */
export function evaluateGeofence(args: {
  address: { geocodeStatus?: string | null; latitude?: number | null; longitude?: number | null } | null | undefined;
  workerLatitude?: number | null;
  workerLongitude?: number | null;
  allowedRadiusMeters: number;
}): GeofenceEvaluation {
  const centre = addressMonitoringCoords(args.address);
  const wLat = args.workerLatitude;
  const wLon = args.workerLongitude;
  if (!centre || typeof wLat !== 'number' || typeof wLon !== 'number' || !Number.isFinite(wLat) || !Number.isFinite(wLon)) {
    return { locationKnown: false, distanceMeters: null, withinRadius: true };
  }
  const distanceMeters = distanceInMeters(wLat, wLon, centre.latitude, centre.longitude);
  return { locationKnown: true, distanceMeters, withinRadius: distanceMeters <= args.allowedRadiusMeters };
}

/** Owner-facing monitoring state derived from the raw status. */
export type GeocodeMonitoringState = 'ACTIVE' | 'NEEDS_REVIEW' | 'UNAVAILABLE';

/**
 * Collapse a raw status into the owner-facing monitoring state. Only `RESOLVED`
 * is ACTIVE; `NEEDS_REVIEW` asks the owner to check the address; everything else
 * (including the `NOT_REQUESTED` default and `FAILED`) is UNAVAILABLE.
 */
export function geocodeMonitoringState(status: GeocodeStatus | string | null | undefined): GeocodeMonitoringState {
  if (status === 'RESOLVED') return 'ACTIVE';
  if (status === 'NEEDS_REVIEW') return 'NEEDS_REVIEW';
  return 'UNAVAILABLE';
}

/** Clear, owner-facing Hebrew label for a raw geocoding status. */
export function geocodeStatusLabel(status: GeocodeStatus | string | null | undefined): string {
  switch (status) {
    case 'RESOLVED':
      return 'מיקום אומת';
    case 'NEEDS_REVIEW':
      return 'כתובת דורשת בדיקה';
    case 'FAILED':
      return 'איתור מיקום נכשל';
    case 'NOT_REQUESTED':
    default:
      return 'טרם אותר מיקום';
  }
}

/** Owner-facing Hebrew label for the derived monitoring state. */
export function geocodeMonitoringStateLabel(status: GeocodeStatus | string | null | undefined): string {
  switch (geocodeMonitoringState(status)) {
    case 'ACTIVE':
      return 'ניטור מיקום פעיל';
    case 'NEEDS_REVIEW':
      return 'כתובת דורשת בדיקה';
    case 'UNAVAILABLE':
    default:
      return 'ניטור מיקום לא זמין';
  }
}

// ─── Owner-facing reason explanations (PBI #217, PR-4) ────────────────────────
// Turn an internal geocodeReason code into a plain, actionable Hebrew sentence.
// NEVER expose the raw code, provider confidence, or a technical error string.

/**
 * True when the failure is transient (a retry may succeed as-is). False for
 * results that need the owner to CORRECT the address (no match, wrong city,
 * ambiguous, not house-level, …).
 */
export function isRetryableGeocodeReason(reason: string | null | undefined): boolean {
  return reason === 'PROVIDER_UNAVAILABLE';
}

/**
 * Plain, owner-facing Hebrew explanation for a geocode reason. Returns '' for a
 * successful/absent reason (no explanation needed).
 */
export function geocodeReasonExplanation(reason: string | null | undefined): string {
  switch (reason) {
    case 'AMBIGUOUS':
      return 'נמצאו כמה כתובות אפשריות. יש לבחור את הכתובת המדויקת או לתקן אותה.';
    case 'CITY_MISMATCH':
      return 'הכתובת שאותרה נמצאת בעיר אחרת מזו שהוזנה. כדאי לתקן את הכתובת.';
    case 'NOT_HOUSE_LEVEL':
      return 'לא אותר מספר בית מדויק. יש להוסיף רחוב ומספר בית.';
    case 'CENTROID_RESULT':
      return 'אותר מרכז עיר או אזור בלבד, לא כתובת מדויקת. יש להזין רחוב ומספר בית.';
    case 'LOW_CONFIDENCE':
      return 'ההתאמה חלקית. כדאי לוודא שהכתובת נכונה.';
    case 'NO_MATCH':
      return 'לא נמצאה כתובת מתאימה. יש לתקן את הכתובת ולנסות שוב.';
    case 'PROVIDER_UNAVAILABLE':
      return 'שירות איתור הכתובות אינו זמין כרגע. אפשר לנסות שוב עוד רגע.';
    case 'PROVIDER_ERROR':
      return 'אירעה תקלה באיתור הכתובת. כדאי לנסות שוב או לתקן את הכתובת.';
    case 'INVALID_QUERY':
      return 'הכתובת חסרה או אינה תקינה. יש להזין כתובת מלאה.';
    case 'CONFIG_ERROR':
    case 'PROVIDER_NOT_CONFIGURED':
      return 'איתור הכתובות אינו מופעל כרגע.';
    case 'RESOLVED_EXACT':
    default:
      return '';
  }
}

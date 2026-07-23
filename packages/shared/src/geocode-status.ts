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

// Pure attendance leaving-area monitoring logic (spec §16.3/§16.4).
//
// DB- and React-Native-free so it can be unit-tested with a controllable clock and
// synthetic readings — no real GPS, timers, or waiting. The hook that wires this to
// expo-location + the API (useAttendanceMonitor) contains no decision logic itself.
import { distanceInMeters } from '@workforce/shared';

/** 15-minute check cadence while clocked in (§16.3). */
export const MONITOR_INTERVAL_MS = 15 * 60_000;
export const DEFAULT_RADIUS_METERS = 500;
/** Discard fixes whose reported accuracy is worse than this (noisy GPS). */
export const MAX_ACCURACY_METERS = 100;
/** Discard fixes older than this (stale/cached). */
export const MAX_READING_AGE_MS = 5 * 60_000;
/** Consecutive confirmations required before acting (debounces a single noisy fix). */
export const EXIT_CONFIRMATIONS = 2;
export const RETURN_CONFIRMATIONS = 1;

export type Coords = { latitude: number; longitude: number };
export type Reading = { latitude: number; longitude: number; accuracy?: number | null; timestamp: number };

export type MonitorPhase = 'inside' | 'pendingExit';
export type MonitorState = {
  phase: MonitorPhase;
  consecutiveOutside: number;
  consecutiveInside: number;
  /** Server-authoritative auto-clock-out deadline (epoch ms) while pendingExit. */
  serverExitDeadline: number | null;
};

export type ReadingClass = 'inside' | 'outside' | 'ignore';
export type MonitorAction = 'NONE' | 'SEND_EXIT' | 'SEND_RETURN';

export function shouldMonitor(attendanceStatus: string): boolean {
  // Only during an active clocked-in attendance session — never before clock-in or
  // after clock-out / auto-clock-out / did-not-work / completion.
  return attendanceStatus === 'CLOCKED_IN';
}

/**
 * Whether the leaving-area watcher can run at all. When it can't (no foreground
 * permission or the job has no geocoded coordinates) attendance still works
 * normally and simply relies on the owner-review flow.
 */
export function canMonitor(input: { hasForegroundPermission: boolean; jobCoords: Coords | null }): boolean {
  return input.hasForegroundPermission && input.jobCoords != null;
}

export function initialMonitorState(pending?: { serverExitDeadline: number | null }): MonitorState {
  const deadline = pending?.serverExitDeadline ?? null;
  return {
    phase: deadline != null ? 'pendingExit' : 'inside',
    consecutiveOutside: 0,
    consecutiveInside: 0,
    serverExitDeadline: deadline,
  };
}

/** Classify a reading against the geofence, ignoring noisy/stale/uncertain fixes. */
export function classifyReading(reading: Reading, job: Coords, radiusMeters: number, now: number): ReadingClass {
  if (reading.accuracy != null && reading.accuracy > MAX_ACCURACY_METERS) return 'ignore';
  if (now - reading.timestamp > MAX_READING_AGE_MS) return 'ignore';
  const d = distanceInMeters(reading.latitude, reading.longitude, job.latitude, job.longitude);
  // Hysteresis band sized by the reading's own accuracy so a borderline fix never
  // flips the state.
  const margin = Math.min(reading.accuracy ?? 0, MAX_ACCURACY_METERS);
  if (d > radiusMeters + margin) return 'outside';
  if (d < radiusMeters - margin) return 'inside';
  return 'ignore';
}

/**
 * Feed one reading into the state machine. Returns the next state and at most one
 * action for the caller to perform (SEND_EXIT / SEND_RETURN). A confirmed exit
 * transitions to `pendingExit` immediately (optimistically, deadline unknown) so it
 * is emitted exactly once until the worker returns.
 */
export function reduceReading(
  state: MonitorState,
  reading: Reading,
  job: Coords,
  radiusMeters: number,
  now: number,
): { state: MonitorState; action: MonitorAction } {
  const cls = classifyReading(reading, job, radiusMeters, now);
  if (cls === 'ignore') return { state, action: 'NONE' };

  if (state.phase === 'inside') {
    if (cls === 'outside') {
      const consecutiveOutside = state.consecutiveOutside + 1;
      if (consecutiveOutside >= EXIT_CONFIRMATIONS) {
        return {
          state: { phase: 'pendingExit', consecutiveOutside: 0, consecutiveInside: 0, serverExitDeadline: null },
          action: 'SEND_EXIT',
        };
      }
      return { state: { ...state, consecutiveOutside, consecutiveInside: 0 }, action: 'NONE' };
    }
    return { state: { ...state, consecutiveOutside: 0, consecutiveInside: 0 }, action: 'NONE' };
  }

  // pendingExit
  if (cls === 'inside') {
    const consecutiveInside = state.consecutiveInside + 1;
    if (consecutiveInside >= RETURN_CONFIRMATIONS) {
      return {
        state: { phase: 'inside', consecutiveOutside: 0, consecutiveInside: 0, serverExitDeadline: null },
        action: 'SEND_RETURN',
      };
    }
    return { state: { ...state, consecutiveInside }, action: 'NONE' };
  }
  return { state: { ...state, consecutiveInside: 0 }, action: 'NONE' };
}

/** After the server confirmed the exit and returned its deadline, adopt it. */
export function applyServerExit(state: MonitorState, serverExitDeadline: number): MonitorState {
  return { ...state, phase: 'pendingExit', serverExitDeadline, consecutiveOutside: 0, consecutiveInside: 0 };
}

export function countdownRemainingMs(serverExitDeadline: number | null, now: number): number {
  if (serverExitDeadline == null) return 0;
  return Math.max(0, serverExitDeadline - now);
}

export function isCountdownExpired(serverExitDeadline: number | null, now: number): boolean {
  return serverExitDeadline != null && now >= serverExitDeadline;
}

/**
 * Derive the authoritative monitor state from a freshly-fetched server shift. Used
 * on app start, on foreground, and after a manual clock-out that may have raced the
 * server sweep: if the server says the session ended (clocked/auto-clocked out,
 * did-not-work, etc.) monitoring stops; otherwise a persisted `areaExitDeadline`
 * restores the pending-exit countdown.
 */
export function reconcileFromServer(shift: {
  attendanceStatus: string;
  areaExitDeadline?: string | Date | null;
}): { monitor: boolean; state: MonitorState | null } {
  if (!shouldMonitor(shift.attendanceStatus)) return { monitor: false, state: null };
  const deadline = shift.areaExitDeadline ? new Date(shift.areaExitDeadline).getTime() : null;
  return { monitor: true, state: initialMonitorState({ serverExitDeadline: deadline }) };
}

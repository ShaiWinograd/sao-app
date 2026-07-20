import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import * as Location from 'expo-location';
import { api } from '../lib/api';
import {
  shouldMonitor,
  initialMonitorState,
  reduceReading,
  applyServerExit,
  reconcileFromServer,
  countdownRemainingMs,
  MONITOR_INTERVAL_MS,
  DEFAULT_RADIUS_METERS,
  type Coords,
  type MonitorState,
} from '../lib/attendanceMonitor';
import { registerAreaGeofence, unregisterAreaGeofence, takePendingBackgroundExit } from '../lib/backgroundGeofence';

type Args = {
  shiftId: string;
  attendanceStatus: string;
  areaExitDeadline?: string | null;
  jobCoords: Coords | null;
  radiusMeters?: number;
  refetch: () => void | Promise<unknown>;
};

/**
 * Drives the §16.3/§16.4 leaving-area watcher for a single active shift. All
 * decision logic lives in the pure lib/attendanceMonitor; this hook only wires it
 * to expo-location, the API, and the app lifecycle.
 *
 * Guarantees:
 *  - monitoring runs ONLY while attendanceStatus === 'CLOCKED_IN', foreground
 *    permission is granted, and the job has coordinates; it stops immediately
 *    otherwise (clock-out, did-not-work, completion, logout, unmount).
 *  - foreground: reliable 15-minute checks; confirmed exit → /area-exit once,
 *    return → /area-return; pending-exit countdown from the SERVER deadline.
 *  - background: best-effort OS geofencing that records an exit; flushed to the
 *    server on next foreground (see lib/backgroundGeofence).
 *  - on foreground it reconciles against the authoritative server state.
 */
export function useAttendanceMonitor({ shiftId, attendanceStatus, areaExitDeadline, jobCoords, radiusMeters = DEFAULT_RADIUS_METERS, refetch }: Args) {
  const [state, setState] = useState<MonitorState>(() =>
    initialMonitorState({ serverExitDeadline: areaExitDeadline ? Date.parse(areaExitDeadline) : null }),
  );
  const [hasForegroundPermission, setHasForegroundPermission] = useState(false);
  const stateRef = useRef(state);
  stateRef.current = state;

  const active = shouldMonitor(attendanceStatus);
  const monitoring = active && hasForegroundPermission && jobCoords != null;

  // Adopt the authoritative server state whenever the shift changes (restart,
  // foreground reconcile, or a manual clock-out that raced the server sweep).
  useEffect(() => {
    const r = reconcileFromServer({ attendanceStatus, areaExitDeadline: areaExitDeadline ?? null });
    setState(r.state ?? initialMonitorState());
  }, [attendanceStatus, areaExitDeadline]);

  // Request minimal foreground permission when a session is active; register a
  // best-effort background geofence. Never blocks anything if denied.
  useEffect(() => {
    let cancelled = false;
    if (!active) {
      setHasForegroundPermission(false);
      void unregisterAreaGeofence();
      return;
    }
    (async () => {
      const current = await Location.getForegroundPermissionsAsync();
      let granted = current.status === 'granted';
      if (!granted && current.canAskAgain) {
        const req = await Location.requestForegroundPermissionsAsync();
        granted = req.status === 'granted';
      }
      if (cancelled) return;
      setHasForegroundPermission(granted);
      if (granted && jobCoords) void registerAreaGeofence(shiftId, jobCoords, radiusMeters);
    })();
    return () => {
      cancelled = true;
      void unregisterAreaGeofence();
    };
  }, [active, shiftId, jobCoords?.latitude, jobCoords?.longitude, radiusMeters]);

  const runCheck = useCallback(async () => {
    if (!monitoring || !jobCoords) return;
    let reading;
    try {
      const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      reading = { latitude: loc.coords.latitude, longitude: loc.coords.longitude, accuracy: loc.coords.accuracy, timestamp: loc.timestamp };
    } catch {
      return; // no fix this cycle — try again next cadence
    }
    // Periodic during-work check (context only; never a route history).
    void api.post('/attendance/location-check', { shiftId, latitude: reading.latitude, longitude: reading.longitude }).catch(() => {});

    const { state: next, action } = reduceReading(stateRef.current, reading, jobCoords, radiusMeters, Date.now());
    setState(next);
    if (action === 'SEND_EXIT') {
      try {
        const res = await api.post('/attendance/area-exit', { shiftId });
        const dl = res.data?.areaExitDeadline ? new Date(res.data.areaExitDeadline).getTime() : Date.now() + 15 * 60_000;
        setState((s) => applyServerExit(s, dl));
      } catch {
        // /area-exit is idempotent server-side; a later check/foreground reconcile recovers.
      }
    } else if (action === 'SEND_RETURN') {
      void api.post('/attendance/area-return', { shiftId }).catch(() => {});
    }
  }, [monitoring, jobCoords, radiusMeters, shiftId]);

  // 15-minute cadence while monitoring (foreground).
  useEffect(() => {
    if (!monitoring) return;
    void runCheck();
    const iv = setInterval(() => void runCheck(), MONITOR_INTERVAL_MS);
    return () => clearInterval(iv);
  }, [monitoring, runCheck]);

  // On foreground: flush any background-recorded exit, then reconcile with server.
  useEffect(() => {
    const sub = AppState.addEventListener('change', async (s) => {
      if (s !== 'active' || !active) return;
      const bg = await takePendingBackgroundExit(shiftId);
      if (bg) await api.post('/attendance/area-exit', { shiftId }).catch(() => {});
      await refetch();
      await runCheck();
    });
    return () => sub.remove();
  }, [active, shiftId, refetch, runCheck]);

  // Tick the countdown display once per second while a pending exit is open.
  const [nowTick, setNowTick] = useState(() => Date.now());
  useEffect(() => {
    if (state.phase !== 'pendingExit') return;
    const iv = setInterval(() => setNowTick(Date.now()), 1000);
    return () => clearInterval(iv);
  }, [state.phase]);

  return {
    pendingExit: state.phase === 'pendingExit',
    remainingMs: countdownRemainingMs(state.serverExitDeadline, nowTick),
    deadline: state.serverExitDeadline,
    monitoring,
  };
}

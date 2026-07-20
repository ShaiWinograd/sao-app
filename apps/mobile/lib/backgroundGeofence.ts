import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';
import * as SecureStore from 'expo-secure-store';

// Best-effort OS geofencing for the leaving-area flow (§16.4).
//
// IMPORTANT LIMITATION: the app's API client authenticates with a short-lived
// Clerk session token that is only available while the app tree is mounted, so a
// headless background task CANNOT reliably call the API. Therefore the background
// geofence task only RECORDS an exit locally; the app flushes it to /area-exit on
// the next foreground (and the every-15-minute foreground check also detects it).
// True silent background auto-reporting is not guaranteed on Expo + Clerk — see
// docs/attendance-sweep.md. The server sweep still enforces the 15-minute timing
// once the exit is reported.

const GEOFENCE_TASK = 'attendance-area-geofence';
const pendingKey = (shiftId: string) => `bg_area_exit_${shiftId}`;

// Defined at module scope so the OS can invoke it after a cold start (this module
// is imported from the app root layout).
TaskManager.defineTask(GEOFENCE_TASK, async ({ data, error }: any) => {
  if (error || !data) return;
  const { eventType, region } = data as { eventType: Location.GeofencingEventType; region?: { identifier?: string } };
  if (eventType === Location.GeofencingEventType.Exit && region?.identifier) {
    try {
      await SecureStore.setItemAsync(pendingKey(region.identifier), String(Date.now()));
    } catch {
      /* recording is best-effort */
    }
  } else if (eventType === Location.GeofencingEventType.Enter && region?.identifier) {
    try {
      await SecureStore.deleteItemAsync(pendingKey(region.identifier));
    } catch {
      /* best-effort */
    }
  }
});

/**
 * Register the job region for background exit/enter events. Requests the ADDITIONAL
 * background-location permission only here (foreground works without it). Returns
 * false when background isn't available — the caller then relies on foreground
 * monitoring + the server sweep.
 */
export async function registerAreaGeofence(
  shiftId: string,
  coords: { latitude: number; longitude: number },
  radiusMeters: number,
): Promise<boolean> {
  try {
    const current = await Location.getBackgroundPermissionsAsync();
    let granted = current.status === 'granted';
    if (!granted && current.canAskAgain) {
      const req = await Location.requestBackgroundPermissionsAsync();
      granted = req.status === 'granted';
    }
    if (!granted) return false;
    // Replace any prior region.
    await unregisterAreaGeofence();
    await Location.startGeofencingAsync(GEOFENCE_TASK, [
      { identifier: shiftId, latitude: coords.latitude, longitude: coords.longitude, radius: radiusMeters, notifyOnEnter: true, notifyOnExit: true },
    ]);
    return true;
  } catch {
    return false;
  }
}

export async function unregisterAreaGeofence(): Promise<void> {
  try {
    if (await Location.hasStartedGeofencingAsync(GEOFENCE_TASK)) {
      await Location.stopGeofencingAsync(GEOFENCE_TASK);
    }
  } catch {
    /* best-effort */
  }
}

/** Consume a background-recorded exit (if any) so the app can flush it once. */
export async function takePendingBackgroundExit(shiftId: string): Promise<boolean> {
  try {
    const v = await SecureStore.getItemAsync(pendingKey(shiftId));
    if (v) {
      await SecureStore.deleteItemAsync(pendingKey(shiftId));
      return true;
    }
  } catch {
    /* best-effort */
  }
  return false;
}

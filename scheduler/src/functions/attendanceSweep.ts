import { app, InvocationContext, Timer } from '@azure/functions';

// Attendance sweep trigger (spec §16.2/§16.4/§17.3).
//
// Fires every minute and calls the API's protected internal sweep endpoint. The
// business rules live entirely behind that endpoint; this function is a thin,
// observable, retrying caller. It is deployed to its own Function App so the
// schedule can be enabled/disabled/redeployed without touching the API (see
// docs/attendance-sweep.md).
//
// Required app settings:
//   SWEEP_API_URL         e.g. https://<api-host>/api/v1/internal/sweeps/attendance
//   INTERNAL_SWEEP_SECRET the shared secret also set on the API
export async function attendanceSweep(_timer: Timer, context: InvocationContext): Promise<void> {
  const url = process.env.SWEEP_API_URL;
  const secret = process.env.INTERNAL_SWEEP_SECRET;
  if (!url || !secret) {
    context.error('attendanceSweep: SWEEP_API_URL / INTERNAL_SWEEP_SECRET not configured; skipping');
    return; // misconfiguration is not a per-run failure to retry
  }

  const started = Date.now();
  let res: Response;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-internal-secret': secret },
      body: JSON.stringify({}),
    });
  } catch (err) {
    // Network/timeout — throw so the host retry policy + failure alerting kick in.
    context.error(`attendanceSweep: request failed: ${String(err)}`);
    throw err;
  }

  const text = await res.text();
  const durationMs = Date.now() - started;

  if (!res.ok) {
    // The endpoint returns non-2xx only on a systemic failure — surface it so the
    // run is marked failed and retried (observable in Function logs / App Insights).
    context.error(`attendanceSweep: sweep returned ${res.status} in ${durationMs}ms: ${text}`);
    throw new Error(`attendance sweep failed with ${res.status}`);
  }

  context.log(`attendanceSweep: ok in ${durationMs}ms: ${text}`);
}

app.timer('attendanceSweep', {
  // NCRONTAB: every minute at second 0. Times are UTC by default.
  schedule: '0 */1 * * * *',
  runOnStartup: false,
  handler: attendanceSweep,
});

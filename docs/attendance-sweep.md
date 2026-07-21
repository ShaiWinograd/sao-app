# Attendance sweep — scheduling foundation (§16.2 / §16.4 / §17.3)

Time-based attendance actions (missing clock-in proposals, leaving-area auto
clock-out, end-form reminders/overdue) are driven by a **protected, idempotent
sweep endpoint** called by an **external Azure Timer Function** — never an
in-process timer (restarts/deploys/recycling would silently skip work) and never
lazy/on-read only (actions must occur even when nobody opens the app).

## Components

- **API endpoint** `POST /api/v1/internal/sweeps/attendance`
  - Auth: header `x-internal-secret` must equal the API app setting
    `INTERNAL_SWEEP_SECRET`. Not reachable from Clerk owner/worker sessions.
  - Body: `{ "dryRun": true }` (non-production only) counts candidates without
    writing. A `now` override is also accepted outside production for tests.
  - Returns a structured summary: `runId`, start/finish/duration, per-operation
    `{ scanned, processed, skipped, failed, errors }`, and totals. Responds
    non-2xx only on a **systemic** failure (an operation threw outright); an
    individual already-resolved/stale record is skipped, not failed.
  - Rules live in `packages/api/src/domain/attendanceSweep.ts` (reusable services);
    the endpoint only orchestrates them. Pure timing rules are in
    `packages/shared/src/attendance-sweep.ts`.
- **Scheduler** `scheduler/` — an Azure Functions (Node v4) Timer trigger firing
  every minute (`0 */1 * * * *`, UTC). Deployed to its **own Function App**, so it
  can be enabled/disabled/redeployed without touching the API. Retries via
  `host.json` (`fixedDelay`, 3×). Reminder cadence (every 3h) is derived from the
  stored `formLastReminderAt` — one timer, not one-per-form.

## Configuration

API app settings:

| Setting | Value |
| --- | --- |
| `INTERNAL_SWEEP_SECRET` | strong random secret (shared with the scheduler) |

Scheduler (Function App) app settings:

| Setting | Value |
| --- | --- |
| `SWEEP_API_URL` | `https://<api-host>/api/v1/internal/sweeps/attendance` |
| `INTERNAL_SWEEP_SECRET` | same secret as the API |

## First-time deploy (deploy-safe rollout)

Land the endpoint + domain logic **before** enabling the schedule:

1. Deploy the API with `INTERNAL_SWEEP_SECRET` set (endpoint live, no scheduler yet).
2. Invoke manually in **dry-run** against a non-production environment and check
   the candidate counts:
   ```bash
   curl -sS -X POST "$SWEEP_API_URL" \
     -H "x-internal-secret: $INTERNAL_SWEEP_SECRET" \
     -H 'content-type: application/json' \
     -d '{"dryRun":true}' | jq .
   ```
3. Validate the `scanned`/`processed` numbers look right.
4. Invoke once **normally** (`-d '{}'`) against test data and confirm the summary
   and that duplicates are not created on a second call.
5. Create + deploy the Function App, then **enable** the schedule.
6. Monitor run summaries, errors, duplicate prevention, and notification volume in
   the Function App logs / Application Insights.

### Create + deploy the Function App

```bash
# One-time: a dedicated StorageV2 account + a Flex Consumption Function App.
# Node 20 is end-of-life — use Node 22 (Functions v4). Flex is always Linux.
az storage account create \
  --name saoschedstore01 --resource-group workforce-rg \
  --location israelcentral --sku Standard_LRS --kind StorageV2 \
  --min-tls-version TLS1_2 --allow-blob-public-access false

az functionapp create \
  --resource-group workforce-rg \
  --name spaceorder-attendance-scheduler \
  --flexconsumption-location israelcentral \
  --runtime node --runtime-version 22 \
  --storage-account saoschedstore01 --instance-memory 512

az functionapp config appsettings set \
  --resource-group workforce-rg --name spaceorder-attendance-scheduler \
  --settings \
    SWEEP_API_URL="https://<api-host>/api/v1/internal/sweeps/attendance" \
    INTERNAL_SWEEP_SECRET="<same-secret-as-api>"

# Build + publish from the scheduler/ folder.
# Flex runs from the package with NO remote build, so the runtime deps must be in
# the package: build to dist, prune to prod-only deps (keeps @azure/functions),
# then publish the prebuilt output. See scheduler/.funcignore.
cd scheduler
npm ci && npm run build && npm prune --omit=dev
func azure functionapp publish spaceorder-attendance-scheduler --javascript --no-build
```

## Disable / re-enable quickly (no API redeploy)

Disabling the scheduler never requires redeploying the API.

- **Disable a single function** (keeps the app running):
  ```bash
  az functionapp config appsettings set \
    --resource-group workforce-rg --name spaceorder-attendance-scheduler \
    --settings AzureWebJobs.attendanceSweep.Disabled=true
  ```
- **Re-enable**:
  ```bash
  az functionapp config appsettings set \
    --resource-group workforce-rg --name spaceorder-attendance-scheduler \
    --settings AzureWebJobs.attendanceSweep.Disabled=false
  ```
- **Kill switch for the whole scheduler** (stop/start the Function App):
  ```bash
  az functionapp stop  --resource-group workforce-rg --name spaceorder-attendance-scheduler
  az functionapp start --resource-group workforce-rg --name spaceorder-attendance-scheduler
  ```
- **Emergency stop from the API side**: unset `INTERNAL_SWEEP_SECRET` on the API —
  every sweep call then returns `503` (the API keeps serving normal traffic).

## Idempotency & catch-up

Every operation re-reads and re-checks each record inside its own transaction and
only writes via a state-guarded conditional update, so overlapping runs, retries,
and downtime are safe:

- a missing-clock-in proposal that became eligible during downtime is still created
  on the next run (once);
- an area-exit deadline that passed during downtime uses the **recorded exit time**,
  not the later run time;
- form reminders send at most **one** catch-up per run (no burst for missed
  3-hour intervals) and advance `formLastReminderAt`;
- overdue transitions exactly once.

## Mobile leaving-area watcher (§16.4)

The worker app detects leaving the 500 m radius and calls `POST /attendance/area-exit`
/ `area-return`; the sweep then enforces the 15-minute auto-clock-out from the
**recorded exit time**. Decision logic is pure and unit-tested
(`apps/mobile/lib/attendanceMonitor.ts`); the hook `useAttendanceMonitor` wires it
to `expo-location` and the API.

**Prerequisite:** the geofence needs the job address's `latitude`/`longitude`
(added to `Address`). Until an address is geocoded these are `null`, the watcher
stays inactive, and attendance relies on the manual + owner-review flow (the app
never blocks). Populating coordinates (geocoding) is a separate step.

**Guarantee matrix:**

| Context | Behavior |
| --- | --- |
| **Foreground (app open, clocked in)** | Reliable. 15-minute location checks; a confirmed exit (debounced against noisy/stale GPS) calls `area-exit` once and shows the prompt + a countdown driven by the **server** deadline; returning calls `area-return`; manual clock-out from the prompt is supported. |
| **Backgrounded** | Best-effort only. OS geofencing (`startGeofencingAsync`) can wake a headless task, but the API client's short-lived Clerk token is only available while the app tree is mounted, so the background task **records the exit locally** and the app **flushes it to `area-exit` on the next foreground**. Reliable silent background reporting is **not** guaranteed on Expo + Clerk. |
| **App killed / device off** | No client detection. If the exit was never reported, no auto-clock-out occurs; the owner still resolves attendance via review/manual completion. |

**Permissions:** foreground location is requested when a session becomes active;
background location is requested only when registering the geofence. Denial of
either never blocks clock-in — attendance falls back to owner review.

**Privacy:** only the minimum radius-state events are sent (`location-check`,
`area-exit`, `area-return`); no continuous coordinate trail is stored or displayed,
and no analytics contain precise coordinates.

**Not validated on device in this change** — the foreground path is covered by unit
tests; background geofencing reliability must be verified on the actual iOS/Android
build targets (step 8 of the rollout) before relying on it.

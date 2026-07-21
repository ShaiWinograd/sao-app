# Attendance — Real-Device Validation Checklist (§16.4 geofence + §16/§17 attendance)

Execute on real iOS and Android builds once test builds and suitable test addresses
(with valid coordinates) are available. The scheduler is live; these tests validate
the **mobile** watcher + attendance flows end-to-end.

## Guarantees under test (do not overclaim)
- **Foreground (app open, clocked in):** reliable — 15-min location checks, debounced
  exit → single `area-exit`, server-deadline countdown, `area-return`, manual clock-out.
- **Backgrounded:** best-effort — OS geofencing may wake a headless task, but the
  Clerk token is only available while the app tree is mounted, so background records
  the exit locally and flushes on next foreground. Not guaranteed on Expo + Clerk.
- **App killed / device off:** no client detection; owner resolves via review/manual completion.

## Evidence & privacy rules
- Capture API/audit evidence: shift `attendanceStatus`, `actualStart/End`, `requiresReview`,
  `areaExitAt`/`areaExitDeadline`, `formStatus`, relevant `AuditLog` rows, worker notifications.
- **Do not store screenshots containing precise coordinates** unless necessary.
- **Redact** personal customer and worker information (names, phones, exact addresses) in evidence.
- No worker-location history/analytics is introduced; only radius-state events (`area-exit`/`area-return`) are sent.

## Run metadata (fill per run)

| Field | Value |
| --- | --- |
| Platform | iOS / Android |
| Device model | |
| OS version | |
| App build / version | |
| Location permission state | While-Using / Always / Denied |
| Job used (redacted id) | |
| Job has coordinates? | Yes / No |
| Date/time (local + UTC) | |
| Tester | |

## Scenario results (one row per scenario, per platform)

| # | Scenario | Expected result | Actual result | API/audit evidence | Pass/Fail | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| A | Normal location flow | Clock-in inside 500 m with permission succeeds; monitoring starts **only after** Clock-in; **no** owner-review flag from location | | | | |
| B | Permission fallback | Location permission **denied**; Clock-in still succeeds; monitoring stays inactive; owner-review indication created where expected | | | | |
| C | Foreground exit & return | Leave 500 m while app active → exit prompt after confirmation/noise rules; **server deadline** shown; return before 15 min → `area-return` clears countdown; **no Clock-out created** | | | | |
| D | Foreground auto Clock-out | Leave radius, do not return → auto Clock-out after 15 min; stored Clock-out time == **recorded exit time**; owner review required; worker notification received | | | | |
| E | Manual Clock-out during countdown | Leave radius → clock out manually from prompt; countdown + monitoring stop; **no later duplicate** auto Clock-out | | | | |
| F | Background reconciliation | Clock in, background app; leave & return under strongest supported background mode; reopen → server/local state reconciles; **record whether detection was silent or only after foregrounding** | | | | |
| G | App restart | Clock in; force-close/restart; reopen → active attendance restored from server; monitoring resumes only if appropriate; any pending exit state restored/reconciled | | | | |
| H | App-killed limitation | UI + docs **do not promise** detection while app terminated; record observed platform behavior without treating best-effort as guaranteed | | | | |
| I | No-coordinate job | Job without lat/lon → watcher does **not** start; Clock-in succeeds; owner **amber warning** visible; attendance uses manual-review fallback | | | | |
| J | Completion interactions | Clock-out stops monitoring; did-not-work stops/prevents monitoring; assignment removal or job completion leaves **no active watcher** | | | | |

## Sign-off
- [ ] iOS: all applicable scenarios pass (or deviations documented)
- [ ] Android: all applicable scenarios pass (or deviations documented)
- [ ] Background behavior (F/H) recorded honestly per platform (no overclaiming)
- [ ] Evidence redacted; no precise-coordinate screenshots retained unnecessarily

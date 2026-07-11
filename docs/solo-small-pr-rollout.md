# Solo Small-PR Rollout Plan (Prod-Safe + Mom Playtest Today)

Date: 2026-07-11

## Goal

Ship continuously in tiny PRs, keep production stable, and share a production link by end of day for real-world feedback.

## Operating Model (Solo)

- PR size target: one focused change, usually 100-300 lines net.
- Deploy strategy: merge to main only after local and CI verification.
- Risk control: avoid schema-breaking + major UX refactors in the same PR.
- Acceptance rule: every PR must be deployable and reversible.

## Mandatory Quality Gate Per PR

Run before opening/merging each PR:

1. npm run typecheck
2. npm run test
3. npm run e2e

Shortcut command added:

- npm run verify:pr

CI already enforces typecheck, unit tests, and build; e2e runs when E2E_BASE_URL is configured.

## EOD Today: Mom Playtest Readiness

## Step 1 - Freeze scope for today

Only include changes that improve reliability/usability immediately.
Do not start quotation lifecycle or large state-machine migrations today.

## Step 2 - Ship 2 to 3 low-risk PRs

PR A (stability):
- Fix obvious runtime errors and edge-case guards on top web flows.
- Keep behavior identical where possible.
- Add/adjust tests for touched logic.

PR B (playtest UX):
- Ensure sign-in/sign-up and key navigation are easy to reach.
- Add clear in-app feedback entry point (temporary link/button).
- Keep copy simple for first-time non-technical users.

PR C (observability):
- Improve logging/alerts for failed API calls in key pages.
- Add empty/loading/error states where missing.

## Step 3 - Final verification before sharing link

1. Deploy production from main.
2. Run Playwright smoke against production URL:
   - E2E_BASE_URL=https://<prod-url> npm run -w @workforce/web e2e
3. Manually test core happy path in production:
   - sign-in
   - dashboard opens
   - projects list opens
   - jobs list opens
   - workers/customers pages open

## Step 4 - Send link + feedback template

Send your mom:
- Production URL
- 5-minute mission list:
  1. Sign in
  2. Open dashboard
  3. Open projects
  4. Open jobs
  5. Report anything confusing/broken
- Bug template:
  - What you clicked
  - What you expected
  - What happened instead
  - Screenshot (if possible)

## Small-PR Backlog Order (After EOD)

1. Strengthen web smoke coverage for top navigation and dashboard reachability.
2. Add lightweight in-app feedback capture surface.
3. Harden mobile shift flow (clock-out -> form reminder).
4. Add project-card next-action consistency improvements.
5. Start quotation foundation behind feature flag (schema + API only).

## PR Template for This Mode

Title format:
- fix(area): concise outcome
- feat(area): concise outcome

PR description skeleton:

- Why: one problem this PR solves.
- What changed: short bullet list.
- Safety: scope boundaries and non-goals.
- Verification: output of npm run verify:pr + any manual checks.
- Rollback: exactly what to revert if needed.

## Non-Goals (for now)

- Large cross-cutting refactors.
- Multi-week epic branches.
- Unverified UI overhauls.
- Data model + UI + workflow rewrites in one PR.

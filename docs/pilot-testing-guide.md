# Web Pilot Testing Guide

This guide validates the production web pilot with owner and worker accounts while keeping repeatable checks automated wherever practical.

## Testing strategy

| Layer                            | Automated?            | What it proves                                                             |
| -------------------------------- | --------------------- | -------------------------------------------------------------------------- |
| Typecheck and unit tests         | Yes, on every PR      | Type safety and business-rule regressions                                  |
| Mocked browser tests             | Yes, on every PR      | Responsive UI, navigation, forms, and deterministic interactions           |
| Deployed smoke tests             | Yes, after deployment | Production web/API reachability and public routing                         |
| Real Clerk owner/worker workflow | Manual for this pilot | Authentication, production data, role metadata, and cross-account behavior |
| Browser or device notifications  | Manual                | Device permissions and delivery; browser push is not implemented           |

Real-account automation should use dedicated non-human Clerk test users and encrypted CI secrets. Do not automate with the owner’s personal account.

## Automated checks

Run from the repository root:

```bash
npm ci
npm run build --workspace @workforce/shared
npm run typecheck
npm run test
npm run e2e
```

After deployment, run the external smoke suite:

```bash
E2E_BASE_URL=https://spaceorder-web-app-poc2.azurewebsites.net \
  npm run e2e --workspace @workforce/web
```

The deployed suite intentionally tests unauthenticated reachability only. Authenticated production testing remains manual until dedicated Clerk test identities are configured.

## Manual production acceptance

Use two isolated browser sessions:

- Owner account: normal browser session.
- Worker account: another browser or private session.

Create two clearly named jobs at least seven days in the future. Use a test customer, one required worker, no team leader, and notes `PILOT-E2E-A` and `PILOT-E2E-B`.

| #   | Account         | Action                                                                  | Expected result                                                             |
| --- | --------------- | ----------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| 1   | Owner           | Open the dashboard on a phone                                           | Full-width content; navigation is available through the hamburger drawer    |
| 2   | Owner           | Create job A with status `APPROVED`                                     | Job opens successfully and appears in the calendar                          |
| 3   | Worker          | Open Notifications and the shift board                                  | New-job notification and job A are visible                                  |
| 4   | Worker          | Request to join job A                                                   | Card changes to waiting for owner approval                                  |
| 5   | Owner           | Approve the join request from job A                                     | Worker appears as approved                                                  |
| 6   | Worker          | Refresh Notifications and My shifts                                     | Approval notification and confirmed assignment are visible                  |
| 7   | Worker          | Request to leave or replace the shift                                   | Request remains pending; worker stays assigned                              |
| 8   | Owner           | Reject the request                                                      | Worker remains assigned and receives the decision                           |
| 9   | Worker          | Submit the request again                                                | A new pending request is shown                                              |
| 10  | Owner           | Approve the request                                                     | Worker is removed and the position becomes available                        |
| 11  | Owner           | Directly assign the worker to job A                                     | Worker sees an assignment awaiting acceptance                               |
| 12  | Worker          | Accept the assignment                                                   | Assignment becomes confirmed                                                |
| 13  | Owner           | Create job B and assign the owner’s worker profile                      | Owner can switch to worker view and accept job B                            |
| 14  | Worker          | Propose swapping job A with the owner’s job B                           | Owner receives the proposal in worker view                                  |
| 15  | Owner as worker | Accept the proposed swap                                                | Swap moves to owner approval                                                |
| 16  | Owner           | Switch back to owner view and approve the swap                          | The two assignments are exchanged                                           |
| 17  | Both            | Check dashboard, jobs, job details, shifts, and notifications on phones | No clipped controls, unreadable columns, or page-level horizontal scrolling |
| 18  | Owner           | Archive both test jobs                                                  | Test data no longer appears as active work                                  |

## Recording failures

Stop at the first failed step and record:

- Step number and account role
- Page URL
- Expected and actual behavior
- Screenshot
- Approximate time
- Whether retrying or refreshing changed the result

Do not use real customer details, payment data, or real shifts during pilot validation.

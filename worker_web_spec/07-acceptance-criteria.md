# 7. Acceptance Criteria

## Discovery

- Every published job is visible to every worker.
- Exact address, customer name, job type, notes, and assigned workers are visible.
- Pay is not visible on job discovery or job details.
- Customer phone is visible only to assigned team leader.

## Joining and assignment

- Approved job on a date blocks joining all other jobs that date.
- Pending requests do not block additional requests.
- Other pending same-date requests auto-reject after one approval.
- First-requested mode assigns immediately.
- Approval mode requires owner approval and worker acceptance.
- Direct assignment requires active acceptance.
- Pending assignment auto-rejects if shift fills first.

## Team leader

- One spot may be reserved for team leader.
- First eligible team leader takes that role.
- Other eligible team leaders may join as regular workers.
- Team-leader replacement validation is enforced unless owner overrides.

## Drop and swap

- Dropping accepted shift requires owner approval.
- Dropping is blocked inside 48 hours.
- Swaps remain available inside 48 hours.
- General replacement requests notify all workers.
- Multiple volunteers may respond.
- Owner sees volunteering order.
- Original worker remains assigned until approval.
- Two-way swaps require both workers and owner approval.

## Calendar and job details

- Assigned shifts appear in month, week, and list views.
- Worker role is clear.
- Assigned worker names are visible.
- Conflicting jobs remain visible but cannot be joined.

## Availability

- Worker can block future date, range, or recurring weekday.
- Worker can edit or delete availability.
- Assigned dates cannot be blocked.
- Owner cannot assign unavailable workers.

## Clock-in and clock-out

- Location attempts start about 30 minutes before shift.
- Clock-in reminders repeat every 10 minutes within 500 metres.
- Worker can clock in up to 10 minutes early.
- Clock-in remains manual.
- Missing clock-in after 15 minutes creates a proposed record.
- Leaving 500 metres triggers clock-out prompt.
- Ignoring for 15 minutes creates automatic clock-out using exit time.
- Returning within 15 minutes cancels automatic clock-out.

## Forms

- Every worker receives an individual end-of-shift form.
- Worker may edit until end of next day.
- Reminders repeat every 3 hours.
- Missing form becomes overdue and notifies owner.
- Event is added to owner-only worker log.

## Reports

- Owner manually publishes reports.
- Worker may comment on specific jobs.
- Worker may report missing shifts.
- Worker may approve or request edits.
- Correction returns full report to unapproved state.
- New versions require new approval.
- Approved reports are immutable.
- PDF download is available.

## Profile and account

- Worker can edit personal data, password, and availability.
- Worker cannot edit pay or bank information.
- Rates are read-only.
- Phone plus password and SMS recovery are used when Clerk supports them.

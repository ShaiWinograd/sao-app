# Owner ↔ Worker Integration Specification

## 1. Purpose

This specification connects the Owner/Admin experience and the Worker experience.

The complete lifecycle is:

```text
Owner creates project
→ Owner creates and publishes jobs
→ Workers see jobs
→ Workers request or accept assignment
→ Owner reviews assignments
→ Workers perform work
→ Attendance and forms are submitted
→ Owner reviews actual work
→ Owner publishes monthly report
→ Worker reviews and approves
→ Owner records payment
```

## 2. Shared entities

The owner and worker applications use the same:

- Customer
- Project
- Job / shift
- Assignment
- Attendance record
- End-of-shift form
- Monthly report
- Notification and audit event

## 3. Ownership

### Owner controls

- Projects and customers
- Jobs and publication
- Customer pricing
- Worker rates
- Team-leader eligibility
- Approval mode
- Final attendance approval
- Monthly reports
- Payment status

### Worker controls

- Join requests
- Assignment acceptance or rejection
- Availability
- Drop, replacement, and swap requests
- Clock-in/out actions
- Attendance corrections
- End-of-shift forms
- Monthly-report comments and approval
- Allowed profile fields

## 4. Project and job publication

### Owner creates a project

Workers see nothing yet.

### Owner creates jobs

Draft jobs remain hidden.

### Owner publishes a job

Workers:

- See it under `עבודות פתוחות`
- Receive an in-app notification
- See customer name, exact address, type, date, hours, team, requirements, and worker-facing notes
- Never see customer pricing

Notification:

```text
פורסמה עבודה חדשה

אריזה – משפחת כהן
12.8.2026 | 09:00–14:00

[צפייה בעבודה]
```

## 5. Joining and assignment

### Approval-required project

```text
Worker requests to join
→ Owner approves or rejects
→ Worker receives assignment request
→ Worker accepts or rejects
→ Assignment becomes confirmed
```

Owner sees request order and staffing impact.

### First-requested mode

```text
Worker clicks join
→ Worker immediately fills a valid available spot
```

No extra confirmation is required.

### Same-date conflict

Once a worker is confirmed for one job:

- They cannot join another job on that date.
- Other pending requests for that date are auto-rejected.
- Conflicting jobs remain visible.

### Shift fills before acceptance

The assignment is auto-rejected and the worker is notified.

## 6. Team leader

If the owner reserves a ראש צוות position:

- Only eligible workers may fill it.
- The first eligible worker filling that position becomes ראש צוות.
- Other eligible workers may join regular positions as עובדת.

The team leader sees:

- Customer phone
- Expanded project instructions
- Full team list
- Team-leader form
- Issue-report action

## 7. Direct assignment

Owner assigns worker:

- Worker receives notification.
- Assignment waits for active acceptance.
- Owner sees pending acceptance.

Worker accepts:

- Staffing and calendar update.

Worker rejects:

- Position reopens.
- Owner is notified.
- Owner-only worker log is updated.

## 8. Availability

Worker may block:

- One future date
- A future date range
- A recurring weekday

Owner result:

- Worker is unavailable in scheduling views.
- Owner cannot assign them.
- Reason is visible.

Assigned dates cannot be blocked; worker is directed to drop or swap.

## 9. Shift drop

More than 48 hours before shift:

```text
Worker requests drop
→ Owner reviews
→ Worker remains assigned
→ Owner approves or rejects
```

Within 48 hours:

- Drop is blocked.
- Replacement and swap remain available.

## 10. Replacement

### General request

```text
Worker requests replacement
→ All workers are notified
→ Multiple workers volunteer
→ Owner sees volunteering order
→ Owner chooses one
→ Assignment changes
```

Original worker remains assigned until approval.

### Specific request

```text
Worker selects a specific worker
→ Selected worker accepts
→ Owner approves
→ Assignment changes
```

If the original worker is ראש צוות, team-leader coverage must remain valid unless owner explicitly overrides.

## 11. Two-way swap

```text
Worker A proposes swap
→ Worker B approves
→ Owner reviews
→ Owner approves
→ Both assignments update atomically
```

Both workers' calendars and roles update.

## 12. Calendar synchronization

When owner changes a job:

- Assigned workers are notified.
- Worker calendars update immediately.

Recommended material changes requiring reacceptance:

- Date change
- Start-time change greater than 60 minutes
- Major address change
- Cancellation followed by replacement job

When owner cancels:

- Job is marked cancelled.
- It leaves upcoming calendar.
- Workers are notified.
- Attendance and forms are disabled.

## 13. Clock-in

Location checks begin around 30 minutes before the shift.

Inside 500 metres:

- Worker gets a reminder every 10 minutes.
- Clock-in remains manual.
- Earliest clock-in is 10 minutes before start.

If 15 minutes late without clock-in:

- System creates a proposed clock-in.
- Worker approves or edits it.
- Owner approves final attendance.

Owner sees real-time attendance state and late warnings.

## 14. Clock-out

Manual clock-out updates owner attendance immediately.

If worker leaves the 500-metre area:

1. Worker gets `לסיים את המשמרת?`
2. If ignored for 15 minutes, auto clock-out uses the area-exit time.
3. If worker returns in time, the auto action is cancelled.

Owner sees auto-clock notes and review state.

## 15. Attendance correction

Worker may request:

- Clock-in correction
- Clock-out correction
- Missing entry

Owner approves or rejects.

Approved values update:

- Worker shift history
- Job actual hours
- Monthly-report source data

## 16. End-of-shift forms

Owner enables forms during job creation.

After clock-out:

- Worker gets the form.
- Reminders repeat every 3 hours.
- Worker may edit until end of next day.

When submitted:

- Owner sees it in job and project.
- Missing-form alert clears.

When overdue:

- Owner is notified.
- Worker log receives an event.
- Worker still may submit late.

## 17. Shift history

Worker history is built from:

- Confirmed assignment
- Job details
- Approved attendance
- Form state
- Monthly-report association

Owner attendance changes update the worker's history.

Workers see only their own attendance, not coworkers' attendance or owner-only logs.

## 18. Monthly reports

### Owner creates report

Draft uses:

- Approved attendance
- Hourly rate
- Fixed daily payment
- Manual additions
- Manual deductions

Worker sees nothing while draft.

### Owner publishes

Worker:

- Receives notification
- Sees report under `מחכה לאישורך`
- Reviews a frozen version

### Worker approves

Owner sees:

- Worker approval
- Timestamp
- Report ready for payment

### Worker requests correction

Worker may:

- Comment on a specific job
- Report a missing shift
- Add a general note

Owner receives task and creates a new version.

Previous versions remain in history.

### Owner marks paid

Worker sees paid status and may download the report PDF.

## 19. Notification matrix

### Owner/System → Worker

- Job published
- Join approved or rejected
- Direct assignment
- Job changed or cancelled
- Drop decision
- Replacement request
- Swap request or decision
- Clock-in reminder
- Proposed clock-in
- Clock-out prompt
- Form due or overdue
- Report published
- New report version
- Report paid

### Worker → Owner

- Join request
- Assignment accepted or rejected
- Drop request
- Replacement volunteer
- Swap accepted
- Clock-in/out
- Missing attendance
- Attendance correction
- Form submitted or overdue
- Report approved
- Report correction requested

## 20. Shared states

### Assignment

```text
OPEN
REQUESTED
OWNER_APPROVED
WORKER_ACCEPTED
WORKER_REJECTED
OWNER_REJECTED
WAITLISTED
AUTO_REJECTED
CANCELLED
```

### Swap

```text
DRAFT
WAITING_FOR_WORKER
WAITING_FOR_VOLUNTEERS
WAITING_FOR_OWNER
APPROVED
REJECTED
CANCELLED
EXPIRED
```

### Attendance

```text
NOT_STARTED
CLOCKED_IN
CLOCKED_OUT
MISSING_CLOCK_IN
MISSING_CLOCK_OUT
CORRECTION_REQUESTED
WAITING_FOR_OWNER
APPROVED
REJECTED
AUTO_CLOCK_OUT
```

### Form

```text
PENDING
DRAFT
SUBMITTED
EDITED
OVERDUE
REOPENED
CLOSED
```

### Monthly report

```text
DRAFT
PUBLISHED
WAITING_FOR_WORKER
CORRECTION_REQUESTED
REVISED
WORKER_APPROVED
PAID
```

## 21. Owner dashboard tasks

Owner sees actionable items for:

- Join requests
- Pending worker acceptance
- Drop requests
- Replacement volunteers
- Swap approvals
- Missing clock-ins/outs
- Attendance corrections
- Missing or overdue forms
- Report correction requests
- Approved reports ready for payment

## 22. Worker dashboard tasks

Worker sees:

- New jobs
- Assignment awaiting acceptance
- Job changes
- Upcoming shift
- Clock-in reminder
- Missing form
- Swap request
- Report awaiting approval
- New report version
- Paid report

## 23. Audit requirements

Every cross-role action stores:

- Event type
- Timestamp
- Actor
- Worker
- Job/project/report
- Previous state
- New state
- Optional reason
- Source application

Owner sees full audit history.

Worker sees only relevant activity.

## 24. Conflict handling

### Worker confirmed for another job

Other requests on that date auto-reject.

### Job becomes full

Pending acceptance may auto-reject.

### Team-leader gap

Drop/swap cannot finalize unless coverage remains or owner overrides.

### Attendance changes after report publication

Show owner warning:

```text
שעות הנוכחות השתנו לאחר פרסום הדוח
```

A new report version is required.

## 25. Acceptance scenarios

### A. Published job

1. Owner creates project and job.
2. Owner publishes.
3. All workers see job.
4. Worker requests join.
5. Owner approves.
6. Worker accepts.
7. Both views show confirmed assignment.

### B. First-requested mode

1. Owner disables approval.
2. Worker joins.
3. Spot fills immediately.
4. Both staffing views update.

### C. Direct assignment

1. Owner assigns worker.
2. Worker accepts.
3. Calendar and staffing update.

### D. Drop request

1. Worker requests drop.
2. Owner approves.
3. Worker is removed.
4. Position reopens.

### E. Replacement

1. Worker asks all workers.
2. Several volunteer.
3. Owner selects one.
4. Assignment and calendar update.

### F. Attendance and form

1. Worker clocks in/out.
2. Owner sees attendance.
3. Worker submits form.
4. Owner sees actual hours and form.

### G. Report

1. Owner publishes report.
2. Worker requests correction.
3. Owner publishes new version.
4. Worker approves.
5. Owner marks paid.

## 26. Integration principle

Every owner action affecting a worker must create:

1. Shared-state update
2. Worker UI update
3. Notification when action is required
4. Audit event

Every worker action affecting operations or payment must create:

1. Owner task
2. Shared-state update
3. Notification when owner action is required
4. Audit event

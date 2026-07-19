# Flexible Reservation, Project, Workforce, Attendance, and Reporting Specification

## 1. Purpose

This specification defines the operational model for managing customers, projects, workforce reservations, jobs, worker assignments, attendance, and reporting.

The owner does not follow one fixed customer-sales process inside the app. Customer discussions, quotations, deposits, and commercial negotiations currently happen outside the system.

The application should focus on:

- Reserving worker capacity
- Publishing jobs to workers
- Managing worker assignment
- Connecting jobs to customers and projects
- Updating jobs as customer details become clearer
- Tracking attendance
- Managing worker forms
- Producing customer reports
- Producing monthly worker reports

The system must avoid rigid automation that would prevent the owner from making manual operational decisions.

---

## 2. Core Product Principle

A job may initially be created only to reserve workers for a possible future customer engagement.

At creation time, the owner may know only:

- A tentative customer name
- A date
- A city or partial address
- Standard working hours
- Required worker count
- Whether a team leader is required
- A tentative job type

The job may later:

- Remain connected to the same customer
- Be connected to a different customer
- Be connected to a different project
- Change address
- Change hours
- Change job type
- Return from approved status to reservation status
- Be reused after the original customer opportunity is no longer relevant
- Be permanently deleted only when there is no attendance data

The same job record should survive these changes whenever possible.

---

## 3. Main Entities

### 3.1 Customer

A real customer record.

Fields:

- Full name
- Phone number
- Email address
- Address
- Notes
- Created date
- Updated date

#### Duplicate suggestion

When creating or selecting a customer, search existing customers by:

- Name
- Phone
- Email

If any field matches an existing customer, show the matching customer as a suggestion.

The system must never merge customers automatically.

The owner may:

- Select the suggested existing customer
- Ignore the suggestion and create a new customer

### 3.2 General Reservation Customer

Create one permanent system customer:

```text
General Reservation
```

Hebrew display name:

```text
שריון כללי
```

Rules:

- Cannot be deleted
- Used when the owner wants to reserve workforce before a real customer exists
- May have multiple projects and jobs
- Can later be replaced by a real customer
- Customer replacement must be recorded in the job and project activity history

### 3.3 Project

A project groups one or more jobs belonging to the same customer engagement.

Examples:

- One packing day
- Several organizing days
- Packing and unpacking jobs for the same move

A job may temporarily exist without a project while linked to `General Reservation`.

Before a job can move to `Approved`, it must be linked to:

- A real customer
- A real project

Project fields:

- Project ID
- Customer ID
- Project name
- Project type
- Status
- Notes
- Linked jobs
- Created date
- Updated date

### 3.4 Job

The operational shift visible to workers.

A job may begin as a workforce reservation and later become a confirmed customer job.

Required fields at creation:

- Customer:
  - Existing customer
  - New customer
  - General Reservation
- Job date
- City or address
- Start and end time
- Job type
- Required worker count
- Team-leader requirement
- Owner-visible status

Supported job types:

- Packing
- Unpacking
- Organizing

### 3.5 Worker Assignment

Connects a worker to a job.

Assignment roles:

- Regular worker
- Team leader
- Backup worker

A team leader counts as one of the required worker positions.

Example:

```text
Required workers: 4
1 team leader + 3 regular workers
```

### 3.6 Attendance Record

Stores:

- Worker
- Job
- Scheduled start
- Scheduled end
- Clock-in
- Clock-out
- Approved clock-in
- Approved clock-out
- Approved duration
- Correction status
- Auto-clock metadata
- Owner review state

### 3.7 End-of-Shift Form

Stores:

- Worker
- Job
- Form template
- Submission status
- Submission time
- Responses
- Edit history
- Overdue state

### 3.8 Customer Report

Generated after the project jobs are completed.

### 3.9 Worker Monthly Report

Generated monthly for each worker.

---

## 4. Job Status Model

Owner-visible job statuses:

```text
RESERVATION
APPROVED
COMPLETED
ARCHIVED
```

Hebrew labels:

- RESERVATION → שריון
- APPROVED → אושר
- COMPLETED → בוצע

A permanently removed job is not treated as a normal operational status.

### 4.1 Reservation

Default status for every newly created job unless the owner explicitly chooses `Approved`.

Purpose:

- Reserve worker capacity
- Allow workers to join
- Keep operational flexibility
- Support jobs whose customer details are incomplete

Workers do not see that the job is only a reservation.

### 4.2 Approved

The owner manually changes the job to `Approved`.

Requirements:

- Real customer assigned
- Real project assigned

Changing to `Approved` does not require worker reapproval unless the address or hours changed according to the rules below.

Workers do not receive a status-change notification. They simply see any newly available details.

### 4.3 Completed

A job may move automatically to `Completed` when:

- All regular workers who worked the job have clocked out
- No attendance correction is pending
- No unresolved clock-in or clock-out issue exists for regular workers

The following do not block completion:

- Missing end-of-shift forms
- Backup workers who did not work
- Removed workers

An automatic clock-out awaiting owner review should block completion until resolved.

---

## 5. Project Status Calculation

Project status is derived automatically from linked job statuses.

- All jobs are reservations → `Reservation`
- At least one job is approved and others are reservations → `Partially Approved`
- All jobs are approved → `Approved`
- At least one job is completed and at least one is still active or future → `In Progress`
- All linked jobs are completed → `Completed`
- No linked jobs remain → delete the project, only if no preserved data requires it

---

## 6. Job Creation Flow

### 6.1 New job form

The owner provides:

- Customer selection
- Job type
- Date
- Address or city
- Standard time template
- Required worker count
- Team-leader requirement
- Initial status:
  - Reservation
  - Approved

Default:

```text
Reservation
```

### 6.2 Customer selection UX

Provide:

- Search existing customer
- Create new customer
- Select General Reservation

While typing name, phone, or email:

- Show matching existing customers
- Never auto-select
- Never auto-merge

### 6.3 Automatic publication

Every newly created job is published to workers immediately.

There is no draft state in the first version.

---

## 7. Worker Visibility

Workers see:

- Customer display name
- Full available address
- Date
- Start and end time
- Job type
- Required worker count
- Assigned workers
- Team leader, if assigned
- Worker-facing notes
- Their assignment role

Workers do not see:

- Reservation vs approved status
- Customer pricing
- Owner-only notes
- Internal customer discussions
- Internal activity logs
- Other workers' pay
- Other workers' phone numbers

The team leader may additionally see, when available:

- Customer phone
- Expanded instructions
- Team-leader form
- Issue-report action

---

## 8. Worker Join and Same-Day Blocking

### 8.1 Immediate same-day blocking

When a worker requests to join a job:

- They become blocked from requesting any other job on the same calendar date
- This applies before owner approval
- They still see other jobs on that date
- Those jobs show that joining is unavailable

### 8.2 Blocking ends when

- Owner rejects the request
- Worker cancels the pending request
- Assignment is removed
- Job is permanently deleted
- Worker rejects a required reassignment confirmation

### 8.3 Pending request cancellation

Workers may cancel their own join request while it is pending.

The owner is notified and the same-day block is removed.

---

## 9. Assignment Approval

Per project, the owner may configure whether join requests require approval.

Default:

```text
Approval required
```

### 9.1 Approval required

```text
Worker requests to join
→ Owner approves or rejects
→ Worker becomes assigned if approved
```

For reservation jobs, the initial join request represents the worker's commitment to that date.

### 9.2 First-requested mode

When owner approval is disabled:

- First valid worker to request a position is assigned immediately
- No additional confirmation is required
- Team-leader allocation rules still apply

---

## 10. Team-Leader Allocation

If a job requires a team leader:

- One required position is reserved for a team leader
- The team leader is included in total required worker count
- The first eligible team leader assigned to that position becomes team leader
- Other team-leader-eligible workers may join as regular workers

When workers are moved to another job:

- Team-leader role is preserved only if the target job does not already have a team leader
- Otherwise the worker becomes regular or backup

---

## 11. Backup Workers

The owner may approve more workers than required.

Extra workers are explicitly marked:

```text
Backup
```

Rules:

- Backup workers are blocked from other jobs on the same date
- They may attend
- They may clock in and out normally
- If they worked, include the job in their monthly report
- No explicit conversion to regular worker is required before attendance
- Owner may change backup to regular at any time
- Reapproval is needed only if address or hours changed according to the rules below

---

## 12. Moving Workers Between Jobs

The owner may manually move workers between jobs on the same date.

Use cases:

- Original customer did not proceed
- Another customer needs workers
- General Reservation becomes a real job
- One reservation is reused for another customer

### 12.1 Transfer behavior

The owner selects:

- Source job
- Target job
- Workers to move
- Optional role changes

A bulk `Move Team` flow is recommended.

### 12.2 Worker notification and reapproval

When moved:

- Worker receives an update
- Fresh approval is required only when:
  - City changes
  - Street changes
  - Total schedule change is at least 3 hours

Job type changes do not require approval.

Customer-name changes alone do not require approval.

### 12.3 Pending reapproval

When reapproval is required:

- Worker remains reserved and blocked on that date
- Assignment becomes `Change Approval Required`
- Worker may approve or reject
- At 19:00, worker receives one consolidated reminder with all jobs awaiting approval
- Worker remains counted as occupied until approval or rejection

Workers must review each job individually. Do not provide `Approve All`.

### 12.4 Rejection

If worker rejects:

- Remove them from the job
- Release same-day blocking
- Notify owner
- Reopen the position

---

## 13. Address and Schedule Change Rules

### 13.1 Address changes requiring reapproval

Require reapproval only when:

- City changes
- Street changes

Do not require reapproval when:

- Full address is added after only a city was known
- Building number is added
- Apartment, floor, entrance, or access details are added
- Customer changes without a location change

### 13.2 Time changes requiring reapproval

Require reapproval only when the schedule changes by at least 3 hours.

Changes under 3 hours:

- Do not require reapproval
- Send a normal update notification

---

## 14. Reusing Reservation Jobs

A reservation job may change identity without being split.

Allowed changes:

- Customer
- Project
- Job type
- Address
- Time
- Worker count
- Team-leader requirement
- Notes

The owner may change the job at any time, including after it was previously approved.

If the original customer no longer proceeds:

- Move the job back to `Reservation`
- Optionally assign `General Reservation`
- Keep workers assigned
- Reuse later for another customer

Workers do not see internal status changes.

They are notified only when visible details change or when the job is permanently removed.

---

## 15. Permanent Removal and Archiving

There is no normal `Cancelled` operational status.

If a customer opportunity is no longer relevant:

- Return job to `Reservation`
- Optionally connect it to `General Reservation`
- Keep workers reserved

### 15.1 Permanent deletion

When permanently deleting a job:

- Notify assigned workers
- Release their same-day blocking
- Remove the job from future worker calendars
- Preserve deletion history
- Allow an optional cancellation-reason dropdown
- Allow no reason

Suggested reasons:

- Customer cancelled
- Customer did not respond
- Date changed
- Work no longer needed
- Created by mistake
- Other
- No reason

### 15.2 Attendance protection

Do not allow permanent deletion if the job has:

- Clock-in records
- Clock-out records
- Approved attendance
- Pending attendance corrections
- Worker report references

Such jobs may only be archived.

---

## 16. Activity Log

The owner must see a complete job history.

Events include:

- Job created
- Status changed
- Customer changed
- Project changed
- Address changed
- Hours changed
- Job type changed
- Worker requested to join
- Worker request approved or rejected
- Worker moved
- Team leader changed
- Backup assigned
- Job returned to reservation
- Job archived
- Job deleted
- Cancellation reason
- Attendance changes
- Form submissions
- Reports generated

Workers do not see this owner-only activity log.

---

## 17. Capacity Warning

Do not block the owner from creating a job when capacity may be insufficient.

Show a warning modal:

```text
There may not be enough available workers for this date.

You can continue creating the job.
```

No detailed capacity calculation is required in the first version.

Workers with pending join requests count as occupied for same-day blocking.

---

## 18. Owner Shift Screen

Keep the current shift-management layout.

Every job card includes an owner-only status badge:

- Reservation
- Approved
- Completed

Group jobs by status.

Within each group, sort by nearest date first.

Quick filters:

- All
- Reservations
- Approved
- Completed
- Missing workers
- Requires attention

Existing shortage indicators remain in the current shortage bar.

---

## 19. Worker Daily Approval Reminder

At 19:00 each day, send one consolidated in-app notification to each worker with changed assignments awaiting approval.

Include:

- Number of jobs waiting
- Date
- Customer
- Address
- Hours
- What changed

Workers must respond to each job individually.

Repeat daily until all are approved or rejected.

---

## 20. Clock-In and Clock-Out

### 20.1 Clock-in

- Worker clocks in manually
- Existing location reminder behavior remains
- Worker may clock in up to 10 minutes early
- Missing clock-in may create a proposed attendance record for approval

### 20.2 Clock-out

- Worker clocks out manually
- Automatic clock-out may use the previously defined location rules
- Pending attendance issues block job completion

### 20.3 Backup workers

Backup workers may clock in and out normally.

If they have valid attendance:

- Treat them as having worked
- Include them in worker reports
- Include their hours in customer actual-hours totals

---

## 21. End-of-Shift Forms

Every worker initially receives an individual end-of-shift form.

Rules:

- Available after clock-out
- Editable until end of next day
- Reminder every 3 hours until submitted
- Missing forms become overdue
- Owner is notified
- Missing forms do not block job completion

---

## 22. Worker Shift History

Workers need a past-shift history showing:

- Date
- Customer
- Job type
- Address
- Role
- Scheduled hours
- Approved clock-in
- Approved clock-out
- Approved duration
- Form state
- Monthly report association

Workers may see only their own attendance.

---

## 23. Customer Report

After all project jobs are completed, the owner may generate a customer report.

### 23.1 Preview

Show a preview page before download.

### 23.2 Included data

- Customer
- Project
- Job dates
- Job types
- Worker count per job
- Total actual worker-hours
- Manual additions
- Discounts
- Final amount

Do not show hours per individual worker.

### 23.3 Pricing modes

#### Hourly pricing

```text
Total actual worker-hours × customer hourly rate
```

#### Global amount

Owner enters a fixed final amount.

When global amount is selected:

- Show total actual worker-hours
- Do not show hourly rate
- Show the global amount

### 23.4 Output

Support:

- Preview
- PDF download

---

## 24. Worker Monthly Report

The first version supports monthly reports only.

The report should resemble a work diary.

For each day/job show:

- Date
- Customer
- Job type
- Worker role
- Clock-in
- Clock-out
- Approved hours
- Hourly rate
- Fixed daily payment
- Total for the day

Worker rate is fixed in their profile and does not change based on team-leader role.

### 24.1 Daily fixed payment

Add the fixed daily payment once for every date on which the worker actually worked.

The system does not support two jobs for one worker on the same date.

### 24.2 Backup workers

If a backup worker clocked in and worked:

- Include the job
- Calculate hourly pay
- Add fixed daily payment

### 24.3 Worker review

Owner manually publishes the report.

Worker may:

- Approve
- Comment on a specific job
- Report a missing shift
- Add general comments
- Request correction
- Download PDF

If correction is requested:

- Report becomes unapproved
- Owner creates a new version
- Previous version remains
- Worker must approve the new version

Approved versions are immutable.

---

## 25. Deletion Rules

### Job deletion

Allowed only when no attendance or report data exists.

### Project deletion

Delete automatically only when:

- All linked jobs were fully deleted
- No preserved data requires the project

Otherwise archive the project.

---

## 26. Notifications

### Worker notifications

- New job published
- Join request approved or rejected
- Assignment changed
- Change requires approval
- Daily pending-approval reminder
- Job permanently deleted
- Clock-in reminder
- Clock-out prompt
- Missing form
- Monthly report published
- New report version
- Report marked paid

### Owner notifications

- Worker requested to join
- Worker cancelled pending request
- Worker approved or rejected changed assignment
- Missing attendance
- Attendance correction
- Missing form
- Monthly report correction request
- Monthly report approved

---

## 27. Recommended States

### Job

```text
RESERVATION
APPROVED
COMPLETED
ARCHIVED
```

### Assignment

```text
REQUESTED
APPROVED
BACKUP
CHANGE_APPROVAL_REQUIRED
CHANGE_APPROVED
CHANGE_REJECTED
REMOVED
```

### Attendance

```text
NOT_STARTED
CLOCKED_IN
CLOCKED_OUT
CORRECTION_REQUIRED
CORRECTION_PENDING
APPROVED
```

### Worker report

```text
DRAFT
PUBLISHED
CORRECTION_REQUESTED
REVISED
WORKER_APPROVED
PAID
```

---

## 28. Key Acceptance Scenarios

### Scenario A — Reservation for a potential customer

1. Owner creates customer or selects `General Reservation`.
2. Owner creates a packing job for January 10.
3. Job starts as `Reservation`.
4. Job publishes automatically.
5. Workers request to join.
6. Requests block those workers from other jobs on that date.
7. Owner approves workers.
8. Job remains a reservation internally.

### Scenario B — Reservation becomes approved

1. Owner connects job to a real customer and project.
2. Owner adds full address and details.
3. Owner changes status to `Approved`.
4. Workers remain assigned.
5. Workers do not see the status change.
6. Full details become visible.

### Scenario C — Reservation reused for another customer

1. Original customer does not proceed.
2. Owner changes job back to `Reservation`.
3. Owner assigns `General Reservation`.
4. Workers remain assigned.
5. New customer later needs the date.
6. Owner updates customer, project, and job details.
7. If city/street or schedule changes by at least 3 hours, workers must reapprove.
8. Otherwise workers receive a normal update.

### Scenario D — Worker moved between jobs

1. Owner selects workers from one job.
2. Owner moves them to another job on the same date.
3. Roles are recalculated.
4. Existing team leader remains if target already has one.
5. Workers receive an update.
6. Reapproval occurs only for qualifying address/time changes.

### Scenario E — Backup worker works

1. Worker is marked backup.
2. Worker remains blocked that date.
3. Worker attends.
4. Worker clocks in and out.
5. Attendance is approved.
6. Job appears in monthly report.
7. Hourly and fixed daily pay are included.

### Scenario F — Job completion

1. All regular workers clock out.
2. No attendance corrections remain.
3. Job moves automatically to `Completed`.
4. Missing forms appear separately and do not block completion.

### Scenario G — Customer report

1. All project jobs complete.
2. Owner opens customer-report wizard.
3. System shows total actual worker-hours.
4. Owner selects hourly rate or global amount.
5. Owner previews report.
6. Owner downloads PDF.

### Scenario H — Worker monthly report

1. Owner generates monthly report.
2. System lists worked jobs as a diary.
3. Worker requests correction on one job.
4. Owner publishes a revised version.
5. Worker approves.
6. Owner records payment.

---

## 29. Implementation Priorities

### Phase 1

- Customer suggestion and General Reservation
- Flexible job creation
- Reservation/Approved/Completed statuses
- Automatic publication
- Same-day blocking at request time
- Team-leader and backup roles
- Worker movement between jobs
- Change reapproval rules
- Owner status grouping and filters
- Activity log

### Phase 2

- Attendance and automatic completion
- Worker forms
- Worker shift history
- Customer-report wizard
- Monthly worker reports
- PDF generation
- Report approval/versioning

---

## 30. Final Product Rule

The app must preserve operational flexibility.

It should help the owner:

- Reserve people early
- Change customer and project connections
- Reuse jobs
- Move workers
- Track what changed
- Produce accurate reports

It should not force the owner into a rigid customer-sales workflow or automatically cancel, approve, release, or modify jobs based on assumptions.

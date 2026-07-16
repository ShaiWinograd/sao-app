# 2. Job Discovery, Assignment, and Calendar

## Published jobs

Every worker receives an in-app notification whenever a new job is published.

Every published job remains visible to every worker, even when the worker cannot join it.

## Open-job card

Show:

- Job type
- Customer name
- Exact address
- Date
- Start and end time
- Required and assigned worker counts
- Whether a team leader is required
- Whether the team-leader position is filled
- Assigned worker names
- Worker-visible notes
- Join state
- Blocking reason, when applicable

Do not show pay.

## Join eligibility

A worker cannot join when:

- Already approved for another job on the same calendar date
- Marked unavailable on that date
- Job is full and no waiting-list option applies
- Job is cancelled or unpublished

A pending request for another job on the same date does not block requesting this job.

Once one request is approved:

- All other pending requests from that worker for that date are automatically rejected.
- The worker cannot join any other job on that date.

## Project-level approval modes

### Owner approval required

Default.

```text
Worker requests to join
→ Owner approves or rejects
→ Worker receives notification
→ Worker actively accepts or rejects
```

### First requested, first to join

When owner approval is disabled:

```text
Worker clicks join
→ Available position is assigned immediately
```

No extra confirmation is required.

## Reserved team-leader position

If a shift requires a team leader:

- Regular workers cannot fill the reserved team-leader position.
- The first eligible team leader takes that position.
- If regular spots are full and only the team-leader spot remains, regular workers may join a waiting list.

## Shift full before acceptance

If an assignment was approved but the shift fills before the worker accepts:

- Assignment is automatically rejected.
- Worker receives a notification.
- Event is not treated as a worker rejection.

## Direct assignment

When the owner directly assigns a worker:

- Worker receives a notification.
- Worker must actively accept or reject.
- Assignment remains pending without a fixed timeout in version one.
- It auto-rejects if the shift fills first.

## Calendar

Support:

- Month view
- Week view
- List view

Each assigned shift shows:

- Job type
- Customer name
- Exact address
- Date and hours
- Worker role
- `ראש צוות` badge when applicable
- Assigned worker names
- Shift state
- Attendance state
- Form state

## Job details

Show:

- Customer name
- Exact address
- Date and hours
- Job type
- Assigned workers
- Worker role
- Project and job instructions
- Owner-added worker notes
- Required forms
- Attendance state
- Drop or swap actions
- Navigation action

Conflicting visible jobs should show:

```text
לא ניתן להצטרף – כבר שובצת לעבודה אחרת בתאריך זה
```

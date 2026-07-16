# 3. Shift Drop, Swap, and Availability

## Rejecting before acceptance

A worker may reject a pending direct assignment.

The owner is notified and an owner-only worker-log entry is created.

## Dropping an accepted shift

### More than 48 hours before shift start

Worker may submit:

```text
בקשה לרדת מהמשמרת
```

Owner approval is required.

Until approval:

- Worker remains assigned.
- Position is not treated as empty.

### Inside 48 hours

Dropping is blocked.

Only these actions remain:

- Request a replacement
- Request a two-way shift swap

Message:

```text
לא ניתן לרדת מהמשמרת פחות מ-48 שעות לפני תחילתה.
אפשר לבקש החלפה עם עובדת אחרת.
```

## General replacement request

```text
Original worker requests replacement
→ All workers are notified
→ Multiple workers may volunteer
→ Owner sees volunteering order
→ Owner selects one worker
→ Owner approves
→ Assignment changes
```

Until owner approval, the original worker remains assigned.

Owner sees:

- Volunteer order
- Team-leader eligibility
- Availability conflicts
- Same-date assignments
- Worker-log indicators

## Specific replacement request

```text
Original worker selects another worker
→ Selected worker accepts or rejects
→ Owner approves or rejects
→ Assignment changes
```

## Two-way swap

```text
Worker A proposes swap with Worker B
→ Worker B approves
→ Owner receives final approval request
→ Owner approves
→ Both assignments change
```

Both workers must approve before owner review.

## Team-leader validation

If the original worker is the assigned team leader, replacement requires one of:

- Replacement is team-leader eligible
- Another assigned worker is team-leader eligible and can be promoted
- Owner explicitly overrides the requirement

Before approval, show resulting role allocation and warnings.

## Owner-created swap

Owner may directly swap two workers assigned to different shifts on the same date.

The system must validate:

- Team-leader coverage
- Worker availability
- Same-date conflicts
- Resulting staffing counts

## Availability

Workers may block:

- One future date
- A future date range
- A recurring weekday every week

Optional reason examples:

- בחופש
- בחו״ל
- לא זמינה

Workers may edit or remove availability.

Past dates cannot be blocked.

If already assigned on a selected date:

- Blocking is prevented.
- Worker is directed to drop or swap flow.

Owner behavior:

- Cannot assign unavailable worker
- Sees unavailable state and reason
- Worker cannot join jobs on unavailable dates

Recurring unavailability supports:

- Start date
- Optional end date
- Weekday
- Reason
- Pause
- Edit
- Delete

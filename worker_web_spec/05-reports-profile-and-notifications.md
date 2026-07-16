# 5. Reports, Profile, Notifications, and Worker Log

## Worker-visible pay data

Show as read-only:

- Hourly rate
- Fixed daily payment

Do not show:

- Bonuses
- Referral compensation
- Bank details
- Other workers' pay

Approximate current-month payment is postponed and excluded from version one.

## Monthly reports

Owner manually publishes each report.

Lifecycle:

```text
טיוטה
→ נשלח לעובדת
→ מחכה לאישור
→ בקשת תיקון
→ גרסה חדשה
→ אושר על ידי העובדת
→ שולם
```

Each job line includes:

- Date
- Customer/project
- Job type
- Worker role
- Scheduled hours
- Approved actual hours
- Hourly amount
- Fixed daily amount
- Manual additions
- Manual deductions
- Line total
- Notes

Worker may:

- Approve report
- Request edits
- Comment on a specific job
- Mark missing shifts
- Add general comment
- Download PDF

When edits are requested:

- Full report becomes unapproved.
- Owner is notified.
- Owner creates a new version.
- Previous versions remain visible.
- New version requires approval again.

Approved versions are immutable.

## Profile

Worker may edit:

- Full name
- Phone
- Email
- Address
- Profile photo
- Password
- Availability

Worker may not edit:

- Hourly rate
- Fixed daily payment
- Bank information
- Team-leader eligibility
- Worker status

## Authentication

Preferred:

- Phone number plus password
- SMS password recovery

Implementation depends on Clerk support.

Changing login phone number requires verification before replacing the current identifier.

## In-app notifications

Required events:

- New published job
- Join request approved or rejected
- Direct assignment
- Assignment auto-rejected because shift filled
- Shift reminder
- Clock-in reminder
- Proposed automatic clock-in
- Clock-out prompt
- Specific swap request
- General replacement request
- Swap approved or rejected
- Drop approved or rejected
- Job changed or cancelled
- End-of-shift form reminder
- Form overdue
- Monthly report published
- Report correction response
- New report version
- Payment marked complete, if exposed

Each notification includes:

- Type
- Short message
- Related item
- Timestamp
- Read state
- Direct action

## Owner-only worker log

Log events:

- Assignment rejected
- Shift drop requested
- Drop approved or rejected
- Swap requested
- Swap accepted or rejected
- Missing clock-in
- Missing clock-out
- Proposed automatic clock-in
- Automatic clock-out
- Attendance correction request
- Missing form
- Overdue form
- Monthly-report correction request

The log is factual and event-based.

No automatic reliability score is required.

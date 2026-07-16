# 4. Clock-In, Clock-Out, Location, and Forms

## Web limitation

The intended behavior is defined now, but web cannot guarantee reliable background location when the browser is closed.

Reliable background tracking and push notifications belong to the later mobile app.

## Location collection window

Start attempting location collection approximately 30 minutes before shift start for assigned workers.

Purpose:

- Detect entry into 500-metre radius
- Trigger clock-in reminders
- Support proposed attendance records
- Detect possible departure

## Clock-in

Clock-in is always manual.

Worker may clock in up to 10 minutes before shift start.

When worker is within 500 metres:

- Send an in-app clock-in reminder.
- Repeat every 10 minutes until clock-in.

## Missing clock-in after shift start

If 15 minutes have passed after shift start without clock-in:

- Create a proposed automatic clock-in.
- Ask worker to approve or correct it.
- Require owner approval.
- Mark attendance as requiring review.

No explanation is required from worker.

## Location checks during shift

While clocked in:

- Attempt a location check every 15 minutes.
- Store only data required for attendance workflow.
- Expose missing or failed checks to owner as context.

## Clock-out

Clock-out is normally manual.

When worker moves more than 500 metres away:

1. Show:

```text
יצאת מאזור העבודה. לסיים את המשמרת?
```

2. If ignored for 15 minutes:
   - Create automatic clock-out.
   - Use the time the worker left the 500-metre area.
   - Add owner-visible automatic clock-out notes.

3. If worker returns within 15 minutes:
   - Cancel the pending automatic clock-out.

Owner-visible note includes:

- Area-exit time
- Prompt time
- Automatic action time
- Whether worker returned
- Location confidence

Late arrival and early departure warnings are primarily shown to owner.

## Attendance correction

Worker may request edits to:

- Clock-in time
- Clock-out time
- Missing attendance entry

No explanation is required.

Owner approval is required.

## End-of-shift forms

Initial rule: every assigned worker receives an individual form.

After clock-out:

- Prompt worker to complete form.
- Clock-out still succeeds if form is not completed immediately.
- Shift remains marked as missing required form.

Worker may complete or edit form until the end of the next calendar day.

Until submitted:

- Send in-app reminder every 3 hours.

After deadline:

- Mark form overdue.
- Notify owner.
- Add owner-only worker-log entry.
- Keep form available for late completion.

After deadline, submitted form becomes read-only unless owner reopens it.

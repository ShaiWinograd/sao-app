# 8. Attendance, Forms, and Messages

# Attendance

## Attendance overview

For each assigned worker show:

- Expected start
- Actual clock-in
- Expected end
- Actual clock-out
- Approved duration
- Location state
- Correction state

## Attendance states

- Not started
- Clocked in
- Clocked out
- Missing clock-in
- Missing clock-out
- Correction requested
- Awaiting approval
- Approved
- Rejected
- Manually entered

## Review screen

Show issues first.

Example:

```text
דורש אישור

יוסי כהן
שעת יציאה חסרה

העובד ביקש לעדכן ל-14:25

[אישור] [דחייה] [עריכה]
```

## Completion rule

A job cannot be operationally complete while required attendance issues remain.

When work ended but issues remain:

```text
העבודה הסתיימה, אך יש חריגות נוכחות שדורשות טיפול.
```

Primary action:

```text
טיפול בחריגות
```

# Customer forms

## Form locations

Forms appear in:

- Project forms and messages tab
- Project alerts
- Related job page

## Form card states

Before sending:

```text
טופס ציוד לאריזה

סטטוס:
טרם נשלח

מתוכנן לשליחה:
27.7.2026

[תצוגה מקדימה]
[עריכה]
[שליחה עכשיו]
```

After sending:

```text
נשלח ב-27.7.2026 דרך WhatsApp
הלקוח טרם מילא

[שליחת תזכורת]
```

After submission:

```text
התקבל ב-28.7.2026

[צפייה בתשובות]
```

## Actions

- Preview
- Edit dynamic values
- Send now
- Reschedule
- Resend
- Send reminder
- View response
- Mark not required
- Attach external response

## Packing-supplies form timing

Send:

- Seven days before the first packing job, after quotation approval
- Immediately after approval when seven or fewer days remain
- Only once a packing date exists

If the packing date changes, recalculate the send date.

Do not resend automatically if already sent.

# Messages

## Timeline

Show:

- Quotation sent
- Form sent
- Form reminder
- Move reminder
- Date change
- Completion message
- Payment reminder

## Message card

Show:

- Message type
- Recipient
- Channel
- Scheduled or sent time
- Delivery state
- Template version

Actions:

- Preview
- Edit before sending
- Send now
- Cancel scheduled message
- Resend
- Copy text

## Automation visibility

Automated actions must be visible.

Example:

```text
תזכורת לקראת מעבר הדירה

מתוכננת לשליחה:
1.8.2026 בשעה 10:00
```

# Worker mobile flow

## Navigation

- העבודה הבאה
- עבודות פתוחות
- העבודות שלי
- פרופיל

## Clock-in flow

1. Open next job.
2. Press `כניסה לעבודה`.
3. Validate location.
4. Confirm time.
5. Show success.
6. Display active-job screen.

## Active job

Show:

- Clock-in time
- Elapsed time
- Job details
- Customer contact
- Manager contact
- Clock-out action

## Clock-out flow

1. Press `סיום עבודה`.
2. Confirm clock-out.
3. Complete required form.
4. Add optional note.
5. Add optional photo.
6. Submit.

Clock-out and end-of-job form should feel like one guided flow.

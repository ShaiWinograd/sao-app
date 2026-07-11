# 2. Navigation and Dashboard

## Main navigation

### Desktop

Use a fixed right-side navigation menu:

- בית
- פרויקטים
- יומן עבודות
- עובדים
- לקוחות
- דוחות
- הגדרות

### Mobile administrator view

Use bottom navigation:

- בית
- פרויקטים
- יומן
- עובדים
- עוד

The `עוד` menu contains:

- לקוחות
- דוחות
- הגדרות

Do not create top-level navigation items for:

- Quotations
- Forms
- Attendance
- Messages
- Customer payments

These belong inside projects and appear as dashboard tasks.

# Dashboard

## Purpose

The dashboard answers:

> What needs attention today?

It should prioritize actionable work over decorative statistics.

## Header

Show:

- Current date
- Greeting
- Number of jobs today
- Number of workers expected today
- Number of urgent issues

Primary action:

```text
יצירת פרויקט חדש
```

Secondary action:

```text
יצירת עבודה מהירה
```

## דורש טיפול

This section appears first when urgent items exist.

Possible items:

- Quotation awaiting approval
- Approved project without dates
- Partially scheduled project
- Job missing workers
- Job missing a manager
- Customer form overdue
- Missing clock-in or clock-out
- Attendance correction awaiting approval
- Missing required worker form
- Completed project awaiting final review
- Project awaiting billing
- Overdue customer payment

Each task row includes:

- Project name
- Clear issue
- Related date
- Severity
- Direct action button

Example:

```text
מעבר דירה – משפחת כהן

חסרים 2 עובדים לעבודת האריזה ביום 3.8

[פתיחת העבודה]
```

## העבודות של היום

Each card shows:

- Time
- Project/customer
- Job type
- Address
- Worker coverage
- Manager status
- Attendance status
- Primary action

## השבוע הקרוב

Group jobs by day.

Show:

- Job count
- Worker shortages
- Manager shortages
- Forms or messages due

## Workflow sections

The dashboard should include:

- מחכה לאישור הצעת מחיר
- מאושר – מחכה לקביעת תאריכים
- מאושר – תזמון חלקי
- עבודות לא מאוישות
- חסר מנהל עבודה
- טפסי לקוח ממתינים
- חריגות נוכחות
- מחכה לחיוב
- מחכה לתשלום מהלקוח

Each section initially shows up to five items and a `הצגת הכל` action.

## Dashboard UX rules

- Every issue must link directly to the place where it can be resolved.
- Red is reserved for urgent or blocking issues.
- Informational cards should not look like warnings.
- Empty urgent state:

```text
אין כרגע דברים דחופים שדורשים טיפול
```

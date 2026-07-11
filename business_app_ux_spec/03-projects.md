# 3. Projects

## Projects page

The default projects view is a kanban pipeline divided into three tabs.

## Tab: מכירה ותכנון

Columns:

- ליד חדש
- בהכנת הצעת מחיר
- מחכה לאישור
- משוריין

## Tab: ביצוע

Columns:

- מאושר – ללא תאריכים
- תזמון חלקי
- מאושר לביצוע
- בביצוע
- מחכה להשלמות

## Tab: תשלום וסגירה

Columns:

- מחכה לחיוב
- מחכה לתשלום
- שולם

## Project card

Each card shows:

- Project name
- Customer
- Project type
- Expected month or next job date
- Planned-service summary
- Quotation status
- Scheduling progress
- Alert badge
- Recommended next action

Example:

```text
מעבר דירה – משפחת כהן – אוגוסט 2026

אריזה: 2 ימים
פריקה: יום אחד

הצעת מחיר: אושרה
תזמון: 2 מתוך 3 ימים נקבעו

דורש טיפול:
חסר תאריך לפריקה
```

## Project card actions

- Open project
- Contact customer
- Change status
- Add workday
- Create quotation
- View next action

## Drag and drop

Drag-and-drop may update status but must not bypass business rules.

Examples:

- Cannot complete a project while attendance issues remain.
- Cannot mark ready when required planned work is unscheduled.
- Cannot mark paid without a payment record.

Provide an alternative explicit status-change action.

## List view

Provide a sortable list view with:

- Project
- Customer
- Type
- Status
- Expected date
- Next job
- Quotation state
- Scheduling state
- Next action

## Search and filters

Support:

- Customer name
- Project name
- Phone number
- Project type
- Status
- Expected month
- Next job date
- Quotation state
- Scheduling state
- Payment state
- Owner
- Requires attention

Remember the user's last selected view and filters.

# Project detail page

## Header

Show:

- Project name
- Customer name
- Project type
- Status badge
- Expected period
- Main address
- Phone
- WhatsApp action
- Email action

Primary action depends on project state.

| State | Primary action |
|---|---|
| Lead | הכנת הצעת מחיר |
| Quotation draft | תצוגה מקדימה ושליחה |
| Waiting for approval | תיעוד אישור |
| Approved without dates | קביעת עבודות |
| Partially scheduled | השלמת תזמון |
| Ready | בדיקת מוכנות |
| In progress | צפייה בביצוע |
| Attendance issues | טיפול בחריגות |
| Work complete | בדיקת סיכום וחיוב |
| Waiting for payment | סימון תשלום |

## Progress stepper

```text
פרטים
→ הצעת מחיר
→ אישור
→ תזמון
→ ביצוע
→ סיכום
→ תשלום
```

Step states:

- Complete
- Current
- Requires attention
- Blocked
- Not started

## Tabs

- סקירה
- הצעת מחיר
- עבודות
- טפסים והודעות
- שעות ותמחור
- פעילות

## Overview tab

Show prominently:

- Recommended next action
- Project state
- Quotation state and amount
- Planned services
- Scheduling progress
- Next job
- Staffing state
- Forms state
- Attendance state
- Estimated total
- Actual total
- Payment state

## Planned scope

Planned work remains visible before jobs exist.

Example:

```text
אריזה

משוער:
2 ימי עבודה
4 עובדים בכל יום
5 שעות ביום
40 שעות עבודה

תזמון:
יום אחד נקבע
יום אחד נותר לתזמן
```

For moving projects, show separate packing and unpacking cards.

## Activity tab

Show chronological history:

- Project created
- Quotation created, sent, viewed, or approved
- Job added or changed
- Form sent
- Message sent
- Attendance changed
- Pricing finalized
- Billing recorded
- Payment recorded

Each entry includes:

- Date and time
- Actor
- Action
- Related object
- Previous and new status where relevant

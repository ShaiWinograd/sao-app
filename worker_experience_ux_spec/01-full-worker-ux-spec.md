# Worker Web Experience — Full UX Specification

## 1. Product Goal

The worker experience should make it easy for workers to:

- Discover new jobs
- Join or reject assignments
- Understand exactly where and when they are working
- See who else is on the shift
- Know whether they are assigned as ראש צוות or עובדת
- Manage availability
- Request drops, replacements, and swaps
- Clock in and out
- Complete end-of-shift forms
- Review attendance history
- Review and approve monthly reports
- Manage personal account details

The experience should feel:

- Clear
- Calm
- Modern
- Friendly
- Mobile-ready
- Easy for non-technical users
- Visually consistent with the owner/admin app

The worker web app should use the same component system as the owner app, but with a muted purple visual theme.

---

# 2. Core UX Principles

## 2.1 One clear next action

Every screen should highlight the most important action.

Examples:

- אישור או דחיית שיבוץ
- הצטרפות לעבודה
- כניסה לעבודה
- מילוי טופס סיום
- אישור דוח חודשי
- טיפול בבקשת החלפה

## 2.2 Simple language

Use clear Hebrew business language.

Prefer:

- עבודה
- משמרת
- הצטרפות
- החלפה
- ירידה ממשמרת
- דיווח שעות
- דוח חודשי

Avoid technical terms such as:

- Assignment entity
- Workflow
- Attendance object
- Pending state machine

## 2.3 Progressive disclosure

Common actions should appear immediately.

Advanced or less frequent options should appear under:

```text
אפשרויות נוספות
```

Examples:

- Requesting a specific replacement
- Two-way swap
- Attendance correction
- Viewing report version history

## 2.4 Wizard-based complex flows

Use short guided wizards for:

- Joining a job when extra confirmation is needed
- Requesting a drop
- Requesting a replacement
- Requesting a two-way swap
- Editing availability
- Reviewing a monthly report
- Correcting attendance
- Completing end-of-shift forms

## 2.5 Strong state visibility

Workers should always understand:

- Am I assigned?
- Am I waiting for approval?
- Do I still need to accept?
- Am I ראש צוות?
- Can I drop this shift?
- Is a swap pending?
- Is my clock-in approved?
- Is my monthly report waiting for me?

## 2.6 Privacy by design

Workers may see:

- Customer name
- Exact address
- Job type
- Shift instructions
- Assigned workers
- Their own attendance
- Their own pay rates
- Their own reports

Workers may not see:

- Customer pricing
- Other workers' pay
- Other workers' phone numbers
- Internal owner notes
- Owner-only worker logs
- Customer phone number unless they are the assigned ראש צוות

---

# 3. Visual Design Direction

## 3.1 Theme

Use the same design language as the owner app:

- White cards
- Warm purple-tinted background
- Rounded corners
- Soft borders
- Minimal shadows
- Large readable Hebrew typography
- Clear semantic badges

## 3.2 Purple theme

Recommended tokens:

```css
--color-primary-700: #5E4A78;
--color-primary-600: #735B91;
--color-primary-500: #8A72A8;
--color-primary-100: #EEE8F4;
--color-primary-050: #F7F3FA;

--color-background: #F6F2F8;
--color-surface: #FFFFFF;
--color-border: #E6DFEA;
--color-text-primary: #262626;
--color-text-secondary: #6F6F6F;
```

## 3.3 Semantic colors

Keep semantic colors distinct:

- Green: approved, completed, paid
- Amber: waiting, partial, pending
- Red: blocked, overdue, rejected
- Blue: informational
- Purple: brand, navigation, selection, primary actions

## 3.4 Typography

Preferred font:

```css
font-family: "Assistant", "Heebo", Arial, sans-serif;
```

---

# 4. Information Architecture

## 4.1 Main navigation

Desktop right-side navigation:

- בית
- עבודות פתוחות
- היומן שלי
- היסטוריית עבודות
- הדוחות שלי
- הזמינות שלי
- הפרופיל שלי

Secondary:

- התראות
- עזרה
- התנתקות

## 4.2 Dashboard structure

The worker dashboard should answer:

> What do I need to do now?

Order:

1. Next action
2. Next shift
3. Pending assignments
4. Open jobs
5. Swap/replacement requests
6. Missing forms
7. Monthly report awaiting review
8. Recent notifications

---

# 5. Worker Dashboard

## 5.1 Header

Example:

```text
בוקר טוב, דנה

יש לך עבודה אחת השבוע ו-2 דברים שדורשים טיפול
```

## 5.2 Primary next-action card

Show only one dominant action.

Examples:

```text
הפעולה הבאה

לאשר את השיבוץ לעבודה ביום 12.8

[פתיחת השיבוץ]
```

```text
הפעולה הבאה

למלא טופס סיום עבודה מאתמול

[מילוי הטופס]
```

## 5.3 Next shift card

Show:

- Job type
- Customer
- Date
- Time
- Exact address
- Role
- Team
- Readiness state
- Navigation button
- Open details button

Example:

```text
העבודה הבאה שלך

אריזה – משפחת כהן
12.8.2026 | 09:00–14:00
רמת השרון

התפקיד שלך: ראש צוות
4 עובדות במשמרת

[פתיחת העבודה]
```

## 5.4 Requires attention

Possible cards:

- Assignment waiting for acceptance
- Swap request waiting for response
- Missing clock-in
- Missing clock-out
- Form due
- Report awaiting approval
- Attendance correction awaiting owner response

Each card should include one direct action.

---

# 6. Open Jobs Experience

## 6.1 Open jobs list

Every published job is visible.

Each card shows:

- Job type
- Customer
- Exact address
- Date
- Time
- Assigned workers
- Required workers
- Team-leader requirement
- Team-leader spot state
- Worker-specific eligibility
- Join action

## 6.2 Join states

Possible states:

- ניתן להצטרף
- בקשה נשלחה
- מחכה לאישור
- אושרה – מחכה לאישורך
- הצטרפת
- רשימת המתנה
- לא ניתן להצטרף
- נדחה
- נדחה אוטומטית

## 6.3 Conflict handling

If the worker is already approved for another job on the same date:

```text
לא ניתן להצטרף

כבר שובצת לעבודה אחרת בתאריך זה.
```

The job remains visible.

## 6.4 First-requested mode

When owner approval is disabled:

- Clicking `הצטרפות` fills an available spot immediately.
- No extra confirmation screen is required.
- If the worker is team-leader eligible and the reserved spot is available, they take it automatically.

## 6.5 Approval-required mode

Flow:

```text
הצטרפות
→ בקשה נשלחה
→ אישור מנהלת
→ אישור עובדת
→ שובצת
```

## 6.6 Join wizard

Use a compact 2-step wizard only when approval is required.

### Step 1 — Review

Show:

- Date
- Time
- Address
- Customer
- Role availability
- Assigned workers

### Step 2 — Submit

Primary action:

```text
שליחת בקשת הצטרפות
```

---

# 7. Direct Assignment Experience

## 7.1 Assignment notification

When directly assigned:

```text
שובצת לעבודה חדשה

אריזה – משפחת כהן
12.8.2026 | 09:00–14:00

[אישור] [דחייה]
```

## 7.2 Acceptance behavior

The worker must actively accept.

If the shift fills before acceptance:

- Assignment is auto-rejected.
- Worker sees:

```text
השיבוץ בוטל אוטומטית כי העבודה כבר התמלאה
```

## 7.3 Rejection wizard

Use a single confirmation step:

```text
לדחות את השיבוץ?
```

Optional note may be allowed, but not required.

---

# 8. Worker Calendar

## 8.1 Views

Support:

- Month
- Week
- List

## 8.2 Shift card

Show:

- Job type
- Customer
- Date and time
- Address
- Worker role
- Team-leader badge
- Attendance state
- Form state

## 8.3 Past shifts

Past shifts remain visible.

Show:

- Completed
- Clock-in and clock-out
- Pending attendance issue
- Missing form
- Report association

## 8.4 Calendar filters

- Upcoming
- Past
- ראש צוות
- Requires action
- Completed

---

# 9. Job Detail Page

## 9.1 Header

Show:

- Job type
- Customer
- Date
- Time
- Exact address
- Worker role
- Shift state

## 9.2 Main actions by state

| State | Primary action |
|---|---|
| Pending assignment | אישור שיבוץ |
| Upcoming | ניווט |
| Within clock-in window | כניסה לעבודה |
| Active | סיום עבודה |
| Completed, form missing | מילוי טופס |
| Attendance issue | בקשת תיקון |
| Swap pending | צפייה בבקשת החלפה |

## 9.3 Information sections

### פרטי העבודה

- Customer name
- Exact address
- Job type
- Date and hours
- Instructions
- Notes

### הצוות

- Assigned workers
- Worker role
- Team leader
- No worker phone numbers

### נוכחות

- Scheduled hours
- Clock-in
- Clock-out
- Approved hours
- Correction state

### טפסים

- Required forms
- Submission state
- Edit availability

### החלפות

- Drop
- Replacement
- Swap

## 9.4 Team-leader section

When worker is ראש צוות, show:

- Customer phone
- Full project instructions
- Team list
- Report issue action
- Team-leader form

---

# 10. Availability Experience

## 10.1 Availability page

Show:

- Calendar
- Existing unavailable dates
- Recurring weekly blocks
- Add availability action

## 10.2 Availability wizard

### Step 1 — Type

Choose:

- יום אחד
- טווח תאריכים
- יום קבוע בכל שבוע

### Step 2 — Dates

Select future date(s).

### Step 3 — Reason

Optional short reason:

- בחופש
- בחו״ל
- לא זמינה
- אחר

### Step 4 — Review

Show summary and save.

## 10.3 Assigned-date blocking

If worker is already assigned:

```text
כבר שובצת לעבודה בתאריך זה

כדי להסיר את עצמך, יש להגיש בקשת ירידה או החלפה.
```

Actions:

- פתיחת העבודה
- בקשת החלפה

---

# 11. Drop and Replacement Experience

## 11.1 More than 48 hours before shift

Available actions:

- בקשה לרדת מהמשמרת
- בקשת מחליפה
- החלפה דו-צדדית

## 11.2 Within 48 hours

Drop is blocked.

Show:

```text
לא ניתן לרדת מהמשמרת פחות מ-48 שעות לפני תחילתה

אפשר לבקש מחליפה או החלפה.
```

## 11.3 Drop wizard

### Step 1 — Summary

Show shift details.

### Step 2 — Confirmation

Explain:

- Worker remains assigned until owner approval.
- The owner will be notified.

Primary action:

```text
שליחת בקשת ירידה
```

## 11.4 General replacement wizard

### Step 1 — Choose request type

- בקשה מכל העובדות
- בקשה מעובדת מסוימת

### Step 2 — Review team-leader impact

If worker is ראש צוות, show whether replacement must also be eligible.

### Step 3 — Submit

General request notifies all workers.

## 11.5 Volunteer experience

Workers see:

```text
דרושה מחליפה

אריזה – משפחת כהן
12.8.2026 | 09:00–14:00

[אני יכולה להחליף]
```

Multiple volunteers may respond.

## 11.6 Owner approval state

Original worker remains assigned until owner chooses replacement.

---

# 12. Two-Way Swap Experience

## 12.1 Swap wizard

### Step 1 — Select target worker/shift

Show eligible shifts only.

### Step 2 — Compare

Display side-by-side:

- Current shift
- Proposed shift
- Role impact
- Team-leader requirement
- Date conflict
- Hours

### Step 3 — Send request

Target worker receives notification.

### Step 4 — Owner approval

After both workers approve, owner receives final request.

## 12.2 Swap states

- מחכה לתשובת העובדת
- מחכה לאישור המנהלת
- אושר
- נדחה
- בוטל

---

# 13. Clock-In Experience

## 13.1 Pre-shift state

Location collection begins about 30 minutes before start.

When within 500 metres:

- Show in-app reminder.
- Repeat every 10 minutes until clock-in.

## 13.2 Clock-in action

Worker may clock in up to 10 minutes early.

Primary action:

```text
כניסה לעבודה
```

Confirmation sheet shows:

- Current time
- Shift
- Location state

## 13.3 Late clock-in flow

If 15 minutes after shift start no clock-in exists:

- Create proposed automatic clock-in.
- Ask worker to approve or correct.
- Send to owner for approval.

Wizard:

### Step 1 — Proposed time

Show suggested time.

### Step 2 — Approve or edit

Actions:

- אישור
- תיקון שעה

---

# 14. Active Shift Experience

## 14.1 Active shift page

Show:

- Clock-in time
- Elapsed time
- Job details
- Customer
- Address
- Role
- Team
- Important notes
- End shift button

## 14.2 Location state

Show subtle status:

- מיקום זוהה
- בדיקת מיקום נכשלה
- אין הרשאת מיקום

Do not make this visually dominant unless action is required.

---

# 15. Clock-Out Experience

## 15.1 Manual clock-out

Primary action:

```text
סיום עבודה
```

Show confirmation:

- Current time
- Worked duration
- Continue to end-of-shift form

## 15.2 Leaving area

When worker is more than 500 metres away:

```text
יצאת מאזור העבודה

לסיים את המשמרת?
```

Actions:

- כן, לסיים
- עדיין לא

If ignored for 15 minutes:

- Auto clock-out uses area-exit time.
- Worker sees status.
- Owner sees auto-clock note.

If worker returns before 15 minutes:

- Pending auto clock-out is cancelled.

---

# 16. End-of-Shift Form

## 16.1 Form wizard

Use a guided form.

### Step 1 — Shift summary

- Date
- Customer
- Role
- Clock-in/out

### Step 2 — Questions

Dynamic by job type.

### Step 3 — Notes/photos

Optional note and photo.

### Step 4 — Review and submit

## 16.2 Edit window

Workers may edit until the end of the next calendar day.

## 16.3 Reminder behavior

- Every 3 hours until submitted
- After deadline:
  - Mark overdue
  - Notify owner
  - Keep form open for late submission

---

# 17. Shift History

## 17.1 Page structure

Filters:

- Month
- Year
- Job type
- Customer
- Role
- Attendance state
- Form state
- Report state

## 17.2 Summary

Show:

- Number of shifts
- Approved hours
- Number as ראש צוות
- Pending attendance corrections
- Missing forms

## 17.3 Shift card

Show:

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
- Report association

## 17.4 Shift detail

Show:

- General details
- Team
- Attendance
- Correction history
- Form responses
- Monthly report link

Workers may not see attendance of others.

---

# 18. Monthly Reports

## 18.1 Reports page

Tabs:

- מחכה לאישורך
- אושרו
- שולם
- היסטוריה

## 18.2 Report review wizard

### Step 1 — Summary

Show:

- Month
- Shift count
- Approved hours
- Hourly rate
- Fixed daily amount
- Additions
- Deductions
- Final total

### Step 2 — Review shifts

Each line shows:

- Date
- Customer
- Job type
- Role
- Approved hours
- Hourly amount
- Fixed daily amount
- Notes

Each line has:

```text
יש בעיה בשורה הזו
```

### Step 3 — Missing shifts

Question:

```text
האם חסרה עבודה בדוח?
```

Actions:

- לא
- כן, להוסיף הערה

### Step 4 — Final action

- אישור הדוח
- בקשת תיקון

## 18.3 Correction flow

Worker may:

- Comment on specific jobs
- Report missing shifts
- Add general note

The report returns to unapproved state.

Owner publishes a new version.

Worker must approve again.

## 18.4 PDF

Each published version supports:

```text
הורדת PDF
```

---

# 19. Worker Profile

## 19.1 Sections

- פרטים אישיים
- פרטי העסקה
- חשבון ואבטחה
- הזמינות שלי
- היסטוריית דוחות

## 19.2 Editable

- Name
- Phone
- Email
- Address
- Photo
- Password
- Availability

## 19.3 Read-only

- Hourly rate
- Fixed daily payment
- Team-leader eligibility
- Employment status

## 19.4 Authentication

Preferred:

- Phone number + password
- SMS password recovery

Implementation depends on Clerk.

---

# 20. Notifications Center

## 20.1 Notification categories

- עבודות חדשות
- שיבוצים
- החלפות
- נוכחות
- טפסים
- דוחות

## 20.2 Notification card

Show:

- Icon
- Short title
- Context
- Time
- Unread state
- Direct action

## 20.3 Required events

- New published job
- Assignment approved/rejected
- Direct assignment
- Swap request
- Replacement request
- Drop decision
- Job change
- Job cancellation
- Clock-in reminder
- Clock-out prompt
- Missing form
- Report published
- Correction response
- New report version

---

# 21. Empty States

## No open jobs

```text
אין כרגע עבודות פתוחות

נעדכן אותך כשיפורסמו עבודות חדשות.
```

## No upcoming shifts

```text
אין לך עבודות קרובות

אפשר לבדוק עבודות פתוחות ולהגיש בקשת הצטרפות.
```

## No reports

```text
עדיין אין דוחות חודשיים
```

## No history

```text
עדיין אין עבודות קודמות להצגה
```

---

# 22. Confirmation and Warning Patterns

## Success

```text
בקשת ההצטרפות נשלחה
```

## Warning

```text
הבקשה נשלחה, אך עדיין לא שובצת לעבודה
```

## Blocking

```text
לא ניתן להצטרף לעבודה זו

כבר שובצת לעבודה אחרת בתאריך זה.
```

## Destructive

Explain consequences before:

- Rejecting assignment
- Dropping shift
- Cancelling swap
- Removing availability rule

---

# 23. Responsive Web Behavior

## Desktop

Use:

- Right navigation
- Two-column dashboard
- Split job detail layout
- Month/week calendar
- Side panel for next actions

## Tablet

Use:

- Collapsible navigation
- Two-column cards
- Horizontal calendar scroll

## Narrow web/mobile browser

Even before native mobile implementation:

- One-column cards
- Bottom action bar
- Full-width buttons
- Wizard steps
- No wide tables
- Cards instead of report tables

---

# 24. Reusable Components

Recommended components:

- `WorkerAppShell`
- `WorkerSidebar`
- `WorkerDashboardHeader`
- `NextActionCard`
- `ShiftCard`
- `OpenJobCard`
- `AssignmentCard`
- `RoleBadge`
- `TeamList`
- `JoinWizard`
- `DropWizard`
- `ReplacementWizard`
- `SwapWizard`
- `AvailabilityWizard`
- `ClockInCard`
- `ClockOutPrompt`
- `AttendanceCorrectionWizard`
- `EndShiftFormWizard`
- `ShiftHistoryCard`
- `MonthlyReportReviewWizard`
- `NotificationCard`
- `EmptyState`
- `StatusBadge`
- `ConfirmationDialog`

All components must support RTL by default.

---

# 25. Recommended Implementation Order

1. Worker shell and navigation
2. Dashboard
3. Open jobs
4. Assignment acceptance
5. Calendar
6. Job details
7. Availability
8. Drop and replacement flows
9. Swap flow
10. Clock-in/out
11. End-of-shift forms
12. Shift history
13. Monthly reports
14. Profile
15. Notifications center

---

# 26. UX Acceptance Criteria

## Clarity

- Every page has one clear primary action.
- Workers always understand their current assignment state.
- Role is clearly shown on every shift.
- Conflicting jobs remain visible but explain why joining is blocked.

## Ease of use

- Complex actions use wizards.
- Important information is visible without opening extra menus.
- Forms are split into short steps.
- Error messages explain what to do next.

## Visual quality

- Purple-tinted background is used consistently.
- Cards remain white.
- Status colors remain semantic.
- The experience matches the owner app visually.
- The interface remains calm and uncluttered.

## Functional completeness

- Workers can discover, join, accept, reject, drop, replace, and swap.
- Workers can manage availability.
- Workers can clock in/out and correct attendance.
- Workers can complete and edit forms.
- Workers can review past shifts.
- Workers can review and approve monthly reports.
- Workers can manage personal account details.

# UI Visual Design Specification — Space & Order Business Management App

## 1. Visual Direction

The interface should feel:

- Calm
- Warm
- Organized
- Trustworthy
- Professional
- Easy to scan
- Human rather than corporate

The interface should not feel:

- Dense
- Financial
- Technical
- Spreadsheet-like
- Overly colorful
- Visually heavy

The design should combine:

- Warm neutral backgrounds
- Muted green as the primary accent
- Rounded cards
- Soft borders
- Minimal shadows
- Large, readable Hebrew typography
- Clear status badges
- Strong next-action blocks

The overall personality should sit between:

- A modern service-business tool
- A clean project-management app
- A friendly home-services brand

---

# 2. Brand and Color System

## 2.1 Primary palette

| Token | Value | Usage |
|---|---|---|
| `--color-primary-700` | `#4E695C` | Hover and pressed primary actions |
| `--color-primary-600` | `#5F7D6E` | Primary buttons, active navigation, key highlights |
| `--color-primary-500` | `#719180` | Secondary green accents |
| `--color-primary-100` | `#EAF0EC` | Light selected states, next-action cards |
| `--color-primary-050` | `#F4F7F5` | Very light green backgrounds |

## 2.2 Neutral palette

| Token | Value | Usage |
|---|---|---|
| `--color-background` | `#F7F6F2` | Main app background |
| `--color-surface` | `#FFFFFF` | Cards, forms, panels |
| `--color-surface-muted` | `#FBFAF7` | Secondary panels |
| `--color-text-primary` | `#262626` | Main text |
| `--color-text-secondary` | `#6F6F6F` | Supporting text |
| `--color-text-muted` | `#96938E` | Metadata and disabled text |
| `--color-border` | `#E7E3DC` | Card and input borders |
| `--color-border-strong` | `#D8D3CA` | Selected or emphasized borders |

## 2.3 Supporting accent

Muted terracotta may be used sparingly:

| Token | Value | Usage |
|---|---|---|
| `--color-accent-600` | `#B66F52` | Optional highlights |
| `--color-accent-100` | `#F7ECE7` | Soft accent backgrounds |

Do not use terracotta as a second primary color.

## 2.4 Semantic colors

| State | Main | Background | Usage |
|---|---|---|---|
| Success | `#4F7A5A` | `#EAF3EC` | Approved, completed, paid |
| Warning | `#B47A26` | `#FFF4E2` | Waiting, partial scheduling |
| Error | `#B85656` | `#FBECEC` | Blocking issue, overdue |
| Info | `#5F7B9A` | `#EBF1F6` | Scheduled, informational |
| Neutral | `#737373` | `#F0F0EE` | Draft, inactive, cancelled |

Every semantic state must include text or an icon. Do not rely on color alone.

---

# 3. Typography

## 3.1 Font family

Preferred:

```css
font-family: "Assistant", "Heebo", Arial, sans-serif;
```

Use `Assistant` as the default when available.

## 3.2 Type scale

| Style | Size | Weight | Line height |
|---|---:|---:|---:|
| Page title | 30 px | 700 | 1.25 |
| Section title | 22 px | 700 | 1.3 |
| Card title | 18 px | 600 | 1.35 |
| Body large | 17 px | 400 | 1.55 |
| Body | 15–16 px | 400 | 1.5 |
| Label | 14–15 px | 600 | 1.35 |
| Metadata | 13–14 px | 400 | 1.4 |
| Badge | 12–13 px | 600 | 1.2 |

## 3.3 Typography rules

- Avoid using more than three font weights on one screen.
- Use semibold for labels and card headings.
- Use bold only for page titles and strong actions.
- Keep body copy readable and not overly compressed.
- Preserve correct RTL behavior for mixed Hebrew, dates, phone numbers, and currency.

---

# 4. Spacing and Layout System

## 4.1 Spacing scale

Use an 8 px base grid.

| Token | Value |
|---|---:|
| `space-1` | 4 px |
| `space-2` | 8 px |
| `space-3` | 12 px |
| `space-4` | 16 px |
| `space-5` | 20 px |
| `space-6` | 24 px |
| `space-8` | 32 px |
| `space-10` | 40 px |
| `space-12` | 48 px |

## 4.2 Page layout

Desktop:

- Right navigation: 232–248 px
- Main content max width: 1440 px
- Page horizontal padding: 32 px
- Section gap: 24–32 px
- Card grid gap: 16–24 px

Tablet:

- Collapsible navigation
- Page padding: 24 px
- Two-column layouts where possible

Mobile:

- Page padding: 16 px
- Single-column cards
- Sticky primary action when useful
- Minimum touch target: 44 × 44 px

---

# 5. Shape and Elevation

## 5.1 Border radius

| Component | Radius |
|---|---:|
| Standard card | 16 px |
| Compact card | 12 px |
| Input | 10 px |
| Button | 10–12 px |
| Badge | 999 px |
| Modal | 18 px |
| Mobile sheet | 20 px top corners |

## 5.2 Shadows

Use subtle shadows only.

Standard card:

```css
box-shadow: 0 2px 8px rgba(38, 38, 38, 0.05);
```

Raised overlay:

```css
box-shadow: 0 12px 32px rgba(38, 38, 38, 0.12);
```

Most cards should rely on border plus very light shadow.

---

# 6. Main App Shell

## 6.1 Desktop shell

Use:

- Light right-side navigation
- Warm neutral page background
- White content cards
- Top header with search, notifications, WhatsApp shortcut, and profile

Navigation should remain visually light.

Avoid dark sidebars.

## 6.2 Sidebar

Structure:

```text
Space & Order

בית
פרויקטים
יומן עבודות
עובדים
לקוחות
דוחות

הגדרות
```

Active item:

- Light green background
- Primary-green icon
- Semibold text
- Rounded 10–12 px container

Inactive items:

- Transparent background
- Neutral icon and text
- Green hover state

## 6.3 Top bar

Desktop top bar may include:

- Global search
- Notification icon
- WhatsApp shortcut
- User avatar
- Optional quick-create action

Keep the top bar secondary to the page content.

---

# 7. Buttons

## 7.1 Primary button

Style:

- Filled primary green
- White text
- 44–48 px height
- 10–12 px radius
- Semibold label

Example:

```text
יצירת פרויקט
```

## 7.2 Secondary button

Style:

- White background
- Soft border
- Primary or dark text
- Minimal shadow

Example:

```text
תצוגה מקדימה
```

## 7.3 Tertiary button

Style:

- Transparent
- Text only
- No border

Example:

```text
ביטול
```

## 7.4 Destructive action

Style:

- Red text or red outline
- Never the default primary action
- Requires confirmation for destructive changes

## 7.5 Button hierarchy rule

Each page or modal should have:

- One primary action
- Up to two secondary actions
- Remaining actions under an overflow menu

---

# 8. Status Badges

Badges should be compact, rounded, and text-based.

Examples:

- מאושר
- תזמון חלקי
- מחכה לאישור
- חסר מנהל
- פורסמה
- שולם

Badge anatomy:

- Optional icon
- Text
- Soft semantic background
- Dark semantic text

Do not use fully saturated backgrounds.

---

# 9. Cards

## 9.1 Standard card

Style:

- White background
- 16 px radius
- 1 px soft border
- 20–24 px padding
- Subtle shadow

## 9.2 Project card

Structure:

1. Status badge
2. Project title
3. Customer or expected period
4. Planned scope
5. Progress or issue
6. Recommended next action
7. One main action

Example:

```text
מעבר דירה – משפחת כהן
אוגוסט 2026

אריזה: 2 ימים
פריקה: יום אחד

הצעת מחיר אושרה
2 מתוך 3 ימים נקבעו

חסר תאריך לפריקה

[פתיחת הפרויקט]
```

Avoid placing many inline icons or actions on the card.

## 9.3 Action card

Use a light semantic background.

Example:

```text
הפעולה הבאה

לקבוע תאריך לעבודת הפריקה

עבודת האריזה נקבעה ל-3.8,
אך לפריקה עדיין אין תאריך.

[קביעת תאריך]
```

Recommended background:

```css
background: var(--color-primary-050);
border: 1px solid var(--color-primary-100);
```

---

# 10. Dashboard UI

## 10.1 Header area

Example:

```text
בוקר טוב, רונית

יש היום 2 עבודות ו-3 דברים שדורשים טיפול
```

Use:

- Large greeting
- Short operational summary
- Primary action: יצירת פרויקט חדש

## 10.2 Summary cards

Use three or four compact cards:

- עבודות היום
- מחכה לאישור
- דורש טיפול
- מחכה לתשלום

Cards should show:

- Large count
- Short label
- Optional small icon
- Soft semantic border or background

## 10.3 דורש טיפול

Use full-width horizontal cards.

Structure:

- Semantic icon
- Project name
- Short issue
- Date or context
- Direct action

Avoid displaying long descriptions.

## 10.4 Today’s jobs

Use a clean list or two-column card layout.

Each item shows:

- Time
- Job type
- Customer
- Worker coverage
- Manager status
- Open action

---

# 11. Project Detail UI

## 11.1 Header block

Show:

- Project title
- Status badge
- Customer
- Expected month
- Address
- WhatsApp
- Phone
- Overflow menu

Optional project illustration or thumbnail may appear on desktop only.

## 11.2 Progress stepper

Steps:

```text
פרטים
הצעת מחיר
אישור
תזמון
ביצוע
סיכום
תשלום
```

Visual states:

- Completed: checkmark and green line
- Current: filled green circle
- Pending: gray outline
- Blocked: warning icon

## 11.3 Tabs

Use text tabs with an underline:

- סקירה
- הצעת מחיר
- עבודות
- טפסים והודעות
- שעות ותמחור
- פעילות

Do not use pill tabs for the main project navigation.

## 11.4 Overview layout

Desktop:

- Main column: next action, work scope, jobs
- Secondary column: project summary, customer, pricing

Mobile:

- Single column
- Next action first
- Summary cards beneath

---

# 12. Project Creation Wizard UI

## 12.1 Header

Show:

```text
שלב 2 מתוך 7
איזה שירות הלקוח צריך?
```

Include:

- Progress indicator
- Clear step title
- Optional one-line explanation

## 12.2 Service cards

Use four large selectable cards:

- אריזה
- פריקה
- סידור
- מעבר דירה

Each card includes:

- Simple line icon or warm illustration
- Service title
- One-line explanation

Selected state:

- Green border
- Light green background
- Checkmark in corner

## 12.3 Wizard controls

Bottom area:

- חזרה
- הבא

On mobile, keep controls sticky.

## 12.4 Review step

Use grouped summary cards for:

- Customer
- Service type
- Timing
- Work estimate
- Forms
- Pricing

---

# 13. Forms and Inputs

## 13.1 Input style

- Label above field
- 44–48 px minimum height
- White background
- 1 px border
- 10 px radius
- Clear focus ring
- Helper or error text below

## 13.2 Required fields

Use text such as:

```text
חובה
```

Avoid only using an asterisk.

## 13.3 Form sections

Break long forms into cards or sections:

```text
פרטי הלקוח
פרטי הפרויקט
היקף העבודה
טפסים והודעות
תמחור
```

## 13.4 Advanced options

Use collapsible disclosure:

```text
אפשרויות נוספות
```

Do not show rare fields by default.

---

# 14. Calendar UI

## 14.1 Calendar appearance

Use a light grid with minimal borders.

Avoid filling the calendar with saturated colors.

## 14.2 Job blocks

Use white or very light backgrounds with a narrow colored side strip.

Example:

```text
09:00–14:00
אריזה – משפחת כהן
3 מתוך 4 עובדים
חסר מנהל
```

## 14.3 Suggested job-type accents

| Job type | Accent |
|---|---|
| Packing | Muted sand |
| Unpacking | Muted green |
| Organizing | Muted blue-gray |

Status remains shown with text.

## 14.4 Calendar filters

Use compact dropdown filters and filter chips.

Avoid large permanent filter panels.

---

# 15. Job and Staffing UI

## 15.1 Job header

Show:

- Job type
- Customer
- Date and time
- Address
- Project status
- Job status
- Main contextual action

## 15.2 Staffing slots

Display roles as slots rather than a plain table.

Example:

```text
מנהל עבודה

[Avatar] דנה לוי
מאושרת
```

```text
עובדים

[Avatar] יוסי כהן
[Avatar] נועה לוי
[+] מקום פנוי
[+] מקום פנוי
```

Empty slots should use:

- Dashed or soft border
- Plus icon
- Label מקום פנוי

## 15.3 Readiness card

Use a checklist card:

```text
מוכנות לעבודה

✓ הפרויקט אושר
✓ הכתובת אושרה
✓ שובץ מנהל
! חסר עובד אחד
✓ הטופס התקבל
```

---

# 16. Tables

Use tables only for:

- Reports
- Worker payments
- Hours comparison
- Large customer or worker lists

Table style:

- White surface
- Sticky header
- Minimal vertical lines
- Soft horizontal separators
- 48–56 px row height
- Hover state
- Right-aligned Hebrew text
- Proper alignment for numbers and currency

On mobile, convert rows to stacked cards.

---

# 17. Mobile UI

## 17.1 Bottom navigation

Items:

- בית
- פרויקטים
- יומן
- דוחות
- עוד

Use a central floating create button only if quick creation is a frequent action.

## 17.2 Mobile dashboard

Order:

1. Greeting
2. Summary cards
3. דורש טיפול
4. עבודות היום
5. Upcoming work
6. Payment tasks

## 17.3 Mobile project page

Order:

1. Project title and status
2. Next action
3. Progress summary
4. Tabs or segmented section navigation
5. Jobs
6. Forms
7. Pricing

## 17.4 Mobile interactions

- Use full-width buttons
- Use bottom sheets for quick actions
- Avoid horizontal tables
- Use swipe only as an optional enhancement
- Do not hide essential actions behind gestures

---

# 18. Icons and Illustrations

## 18.1 Icons

Use one consistent outline icon library.

Suggested categories:

- Home
- Project
- Calendar
- Workers
- Customer
- Quotation
- Clock
- Form
- Payment
- Warning
- WhatsApp
- Phone

## 18.2 Illustrations

Use illustrations sparingly.

Suitable places:

- Empty states
- Service-selection wizard
- Optional project header thumbnail
- Onboarding

Avoid decorative illustrations inside dense operational views.

---

# 19. Motion and Feedback

## 19.1 Motion

Use subtle motion only:

- 150–200 ms hover and state transitions
- 200–250 ms modal and drawer transitions
- Small success check animation
- Gentle loading skeletons

Avoid large page animations.

## 19.2 Toasts

Examples:

```text
הפרויקט נשמר בהצלחה
```

```text
הצעת המחיר נשלחה
```

```text
השינוי נשמר, אך עדיין חסר תאריך לפריקה
```

Toasts should not replace inline validation.

---

# 20. Reusable Component Inventory

The implementation should create reusable components for:

- `AppShell`
- `SidebarNavigation`
- `MobileBottomNavigation`
- `PageHeader`
- `PrimaryActionButton`
- `SecondaryButton`
- `StatusBadge`
- `SummaryMetricCard`
- `AttentionItemCard`
- `ProjectCard`
- `NextActionCard`
- `ProgressStepper`
- `Tabs`
- `ServiceSelectionCard`
- `FormSection`
- `Field`
- `DatePrecisionSelector`
- `JobCard`
- `StaffingSlot`
- `ReadinessChecklist`
- `FormStatusCard`
- `MessageStatusCard`
- `EmptyState`
- `ConfirmationDialog`
- `BottomSheet`
- `DataTable`
- `MobileDataCard`

Each component should support RTL by default.

---

# 21. Visual Acceptance Criteria

## Global

- The interface uses warm neutral backgrounds and white cards.
- Muted green is the main accent.
- The UI does not resemble an accounting or ERP system.
- Main actions are visually clear.
- Status is never communicated by color alone.
- Hebrew text remains readable and correctly aligned.

## Dashboard

- Urgent tasks are visually prioritized.
- Summary cards are compact.
- The dashboard does not feel crowded.
- Every attention item has a direct action.

## Projects

- Cards clearly show project type, status, progress, and next action.
- The project page has one visually dominant next-action card.
- Planned, scheduled, and actual work are visually separated.

## Forms

- Forms are divided into logical sections.
- Labels appear above fields.
- Advanced options are hidden by default.
- Errors appear directly below the relevant field.

## Calendar

- Job blocks remain readable.
- Job type and status are both visible.
- The calendar does not depend on saturated colors.

## Mobile

- All primary actions are reachable with one hand.
- Tables convert to cards.
- Touch targets are at least 44 px.
- Navigation remains simple and consistent.

---

# 22. Recommended First UI Screens

Create these first:

1. Desktop dashboard
2. Mobile dashboard
3. Projects pipeline
4. Project detail overview
5. New-project wizard service-selection step
6. Scheduling screen
7. Calendar week view
8. Job staffing page
9. Attendance review screen
10. Worker mobile next-job screen

These screens establish the visual language for the rest of the app.

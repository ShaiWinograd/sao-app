# 11. Responsive Design, Accessibility, and UX Patterns

# Hebrew and RTL

Requirements:

- Hebrew-first interface
- RTL page layout
- Right-aligned navigation
- RTL form alignment
- Israeli date formatting
- Local phone formatting
- Currency displayed as ₪
- Natural business Hebrew rather than technical language

Preferred user-facing terms:

- פרויקט
- עבודה
- יום עבודה
- הצעת מחיר
- שירות מתוכנן
- שעות בפועל
- מחכה ללקוח
- דורש טיפול

Avoid exposing technical terms such as:

- Entity
- Workflow
- Automation
- PlannedServiceComponent

# Responsive behavior

## Desktop

Prioritize:

- Full right navigation
- Multi-column kanban
- Split project layouts
- Month/week calendar
- Tables for reports

## Tablet

Use:

- Collapsible navigation
- Two-column layouts
- Horizontal kanban scrolling
- Simplified calendar

## Mobile administrator

Prioritize:

- Dashboard
- Project details
- Today's jobs
- Worker assignment
- Attendance approvals
- Customer contact actions

Convert complex tables into stacked cards.

# Accessibility

- Text labels for icons
- Strong contrast
- Keyboard navigation
- Large touch targets
- Field-linked errors
- No color-only status communication
- Browser zoom support
- Readable font sizes
- Correct RTL behavior for mixed Hebrew, numbers, and dates

# Empty states

## No projects

```text
עדיין אין פרויקטים

צרי את הפרויקט הראשון כדי להתחיל לנהל לקוחות, הצעות מחיר ועבודות במקום אחד.

[יצירת פרויקט]
```

## No scheduled jobs

```text
עדיין לא נקבעו עבודות לפרויקט

אפשר לשלוח ולאשר הצעת מחיר גם לפני שהתאריכים ידועים.

[קביעת עבודות]
```

## No quotation

```text
עדיין לא הוכנה הצעת מחיר

הצעת המחיר תתבסס על היקף העבודה המשוער של הפרויקט.

[הכנת הצעת מחיר]
```

# Feedback patterns

## Success

```text
הפרויקט נשמר בהצלחה
```

## Warning

Allowed but unusual:

```text
עבודת הפריקה נקבעה לאותו יום של עבודת האריזה.

אפשר להמשיך, אך מומלץ לוודא שזה מכוון.
```

## Blocking validation

```text
לא ניתן לסמן את הפרויקט כעבודה שהסתיימה.

עדיין קיימת בקשת תיקון נוכחות שמחכה לאישור.
```

## Destructive confirmation

Required for:

- Cancelling project
- Cancelling job
- Deleting draft quotation
- Removing worker
- Moving scope to another project

Explain the result, not only “Are you sure?”

# Status badges

## Project

- ליד חדש
- מחכה לאישור
- משוריין
- מאושר
- תזמון חלקי
- בביצוע
- מחכה להשלמות
- מחכה לחיוב
- מחכה לתשלום
- שולם
- בוטל

## Job

- טיוטה
- פורסמה
- חסרים עובדים
- חסר מנהל
- מאוישת
- בביצוע
- מחכה לבדיקת נוכחות
- הושלמה
- בוטלה

## Form

- טרם נשלח
- מתוזמן
- נשלח
- נפתח
- התקבל
- דורש בדיקה
- בוטל

Every badge must contain text and must not rely only on color.

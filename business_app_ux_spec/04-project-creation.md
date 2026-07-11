# 4. Project Creation

## New project wizard

Use a multi-step wizard rather than one long form.

## Step 1 — Customer

Title:

```text
למי הפרויקט?
```

Options:

- Search existing customer
- Create new customer

New-customer fields:

- Full name
- Phone
- Email
- Main address
- Preferred contact method
- Notes

When selecting an existing customer, show:

- Contact details
- Recent projects
- Active projects

Warn about possible duplicate active projects.

## Step 2 — Service type

Title:

```text
איזה שירות הלקוח צריך?
```

Use large selection cards:

- אריזה
- פריקה
- סידור
- מעבר דירה

Selecting `מעבר דירה` creates planned components for:

- Packing
- Unpacking

Do not add organizing.

## Step 3 — Timing

Title:

```text
מה כבר ידוע לגבי התאריכים?
```

Options:

- כל התאריכים ידועים
- חלק מהתאריכים ידועים
- עדיין לא נקבעו תאריכים

Timing precision options:

- Exact date
- Multiple exact dates
- Date range
- Expected month
- Expected year
- Unknown

For moving projects, packing and unpacking may have different timing precision.

Example:

```text
אריזה: תאריך ידוע
פריקה: עדיין לא נקבע
```

## Step 4 — Work estimate

For each service show:

- Estimated workdays
- Workers per day
- Hours per day
- Estimated worker-hours
- Manager requirement
- Notes

Example:

```text
אריזה

מספר ימי עבודה משוער: 2
עובדים בכל יום: 4
שעות ביום: 5

סה״כ משוער:
40 שעות עבודה
```

Advanced mode supports different estimates for each planned day.

## Step 5 — Forms and requirements

Fields:

- Manager required
- Reserved manager positions
- Packing-supplies form
- Worker end-of-job form
- Manager end-of-job form
- Customer preparation form
- Internal notes
- Worker-facing notes

Worker end-of-job form is enabled by default.

## Step 6 — Pricing

Possible models:

- Hourly customer rate
- Fixed project amount
- Fixed daily amount
- Separate service rates
- Extra fees
- Discounts
- Supplies
- Notes

Show the estimated total dynamically.

## Step 7 — Review and finish

Show:

- Customer
- Project type
- Expected timing
- Planned services
- Estimated hours
- Manager requirements
- Forms
- Estimated price

Finish actions:

- שמירה והכנת הצעת מחיר
- שמירה וקביעת עבודות
- שמירה כליד
- שמירה וחזרה מאוחר יותר

The recommended primary action depends on entered data.

# Quick job creation

Use when at least one work date is already known.

Flow:

1. Select or create customer.
2. Select project or create a new one.
3. Select job type.
4. Select date and time.
5. Set worker count.
6. Set manager requirement.
7. Configure forms.
8. Save draft or publish.

After saving a packing job in a new project, offer:

```text
האם תרצי לקבוע גם עבודת פריקה?
```

Actions:

- כן, לקבוע פריקה
- להוסיף יום אריזה נוסף
- לא עכשיו

Do not offer organizing as a connected moving service.

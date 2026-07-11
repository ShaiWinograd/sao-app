# 1. Product Foundations

## Product goal

The app should help the business owner manage the complete customer journey from first inquiry through payment.

The main entity is the **project**, not the calendar job.

A project may be created when:

- The customer is known.
- The expected service is known.
- The expected month or date range may be known.
- Exact work dates are not yet known.
- A quotation still needs to be prepared or approved.

## Supported project types

### אריזה

One or more packing workdays.

### פריקה

One or more unpacking workdays.

An unpacking project does not require a packing job because another company or the customer may have handled the packing.

### סידור

Standalone home-organization work.

Organizing is not combined with unpacking because unpacking already includes arranging the unpacked belongings.

### מעבר דירה

A project containing at least:

- One packing service component or job
- One unpacking service component or job

A move may contain several packing and unpacking days.

## Unsupported combinations

The normal UX must not create:

- אריזה וסידור
- פריקה וסידור
- מעבר דירה with a separate organizing component

If organizing work is required separately, create a separate organizing project for the same customer.

## Core UX principles

### Action-oriented

Every project should show one recommended next action.

Examples:

- הפעולה הבאה: לשלוח הצעת מחיר
- הפעולה הבאה: לתעד את אישור הלקוח
- הפעולה הבאה: לקבוע תאריך לפריקה
- הפעולה הבאה: לאשר תיקון שעות

### Project-centered

All customer-engagement information should be available from the project page:

- Customer
- Quotation
- Planned work
- Scheduled jobs
- Workers
- Attendance
- Forms
- Messages
- Pricing
- Payment
- Activity history

### Progressive disclosure

Common fields and actions appear first.

Rare options appear under:

```text
אפשרויות נוספות
```

### Strong defaults

Suggested defaults:

- Job duration: five hours
- Default hours: 09:00–14:00
- Worker end-of-job form: enabled
- Standard quotation terms
- Standard customer messages
- WhatsApp as preferred communication channel
- Manager requirements based on configurable business rules

### No duplicate data entry

- Customer details populate projects.
- Project details populate jobs.
- Planned work converts into scheduled jobs.
- Approved attendance calculates actual hours.
- Actual hours feed pricing and worker payment reports.

## User roles

### Administrator

Can manage:

- Customers
- Projects
- Quotations
- Jobs
- Workers
- Forms
- Attendance
- Pricing
- Payment tracking
- Reports
- Templates
- Settings

### Worker

Can:

- View available and assigned jobs
- Request to join
- View instructions and address
- Clock in and out
- Submit forms
- Request attendance corrections
- View own work history

Cannot see:

- Customer pricing
- Quotations
- Other workers' wages
- Payment status
- Internal customer notes
- Business reports

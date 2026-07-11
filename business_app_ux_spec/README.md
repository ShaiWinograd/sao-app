# Business Management App — UX Specification

This folder contains the UX specification for the Hebrew business-management app.

The application is project-centered:

```text
Customer inquiry
→ Project
→ Quotation
→ Approval
→ Scheduling
→ Worker assignment
→ Job execution
→ Attendance review
→ Final calculation
→ Customer payment
```

## Recommended implementation order

1. `01-product-foundations.md`
2. `02-navigation-and-dashboard.md`
3. `03-projects.md`
4. `04-project-creation.md`
5. `05-quotations.md`
6. `06-scheduling-and-calendar.md`
7. `07-jobs-and-staffing.md`
8. `08-attendance-and-forms.md`
9. `09-customers-and-workers.md`
10. `10-pricing-payment-and-reports.md`
11. `11-responsive-accessibility-and-patterns.md`
12. `12-acceptance-criteria.md`

## Core business rules

- A project may exist without any scheduled jobs.
- A quotation may be created and approved before dates are known.
- Every job must belong to exactly one project.
- Supported project types are:
  - אריזה
  - פריקה
  - סידור
  - מעבר דירה
- מעבר דירה contains packing and unpacking.
- Organizing is a standalone service and should not be combined with unpacking.
- Planned, scheduled, and actual work must remain separate.
- The app does not manage business expenses, invoices, or tax documents.
- Billing is performed in an external system, but billing and payment status are tracked in this app.

## Language

The administrator and worker interfaces are Hebrew-first and RTL.

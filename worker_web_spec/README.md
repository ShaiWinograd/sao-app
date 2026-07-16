# Worker Web Experience — Specification

This package defines the worker-facing web application for Space & Order.

## Files

1. `01-foundations-and-navigation.md`
2. `02-job-discovery-assignment-and-calendar.md`
3. `03-drop-swap-and-availability.md`
4. `04-clock-in-out-location-and-forms.md`
5. `05-reports-profile-and-notifications.md`
6. `06-open-decisions.md`
7. `07-acceptance-criteria.md`

## Core rules

- Every published job is visible to every worker.
- A worker cannot join another job on a date where they are already approved for a job.
- Job pay is never shown in job discovery or job details.
- Customer phone is visible only to the assigned team leader.
- Direct assignments require worker acceptance.
- Dropping an accepted shift requires owner approval.
- Inside 48 hours before a shift, dropping is blocked and only swap flows are available.
- Monthly reports are manually published by the owner and approved by the worker before payment.
- The first version is web-only. Reliable background location and push notifications are future mobile capabilities.

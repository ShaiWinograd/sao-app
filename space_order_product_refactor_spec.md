> **DOCUMENT AUTHORITY:** This specification supersedes all earlier owner, worker, project-first, quotation-first, draft/publish, waitlist, cancelled-state, and payment-tracking specifications wherever they conflict.

# Space & Order — Product Refactor and Pre-Launch Migration Specification


**Version 1.0 · July 2026**


> This specification supersedes all earlier specifications wherever they conflict.



---


# 1. Executive Summary

## 1.1 Primary goals

- Create and edit jobs quickly from the Home / Shifts view.

- Make staffing state, shortages, pending requests, and worker availability immediately understandable.

- Provide a reliable same-day blocking model for worker requests and assignments.

- Implement attendance with practical location checks without storing location history.

- Generate customer PDFs from completed project groups and monthly worker PDFs from approved attendance.

- Keep the owner workflow simple on mobile while retaining a strong desktop weekly grid.

- Preserve auditability without adding unnecessary accounting, invoicing, or payment-management scope.

## 1.2 Explicit non-goals for Version 1

- Customer invoices, quotation workflows, deposits, partial payments, payment status, or debt tracking.

- Worker payment tracking or a “paid” status.

- Customer report delivery through email or WhatsApp; PDF generation only.

- Historical job creation, jobs in past dates, phone-calendar integration, photo uploads, or partial-day availability.

- General admin role activation; the data model may support it later, but Version 1 exposes Owner and Worker only.

- Automatic first-come approval, waitlists, draft/unpublish workflows, or a Cancelled job state.

- Location route storage, continuous location history, or detailed map playback.

# 2. Authority, Scope, and Implementation Strategy

## 2.1 Source-of-truth rules

- This document is the authoritative product and migration specification.

- Where current code conflicts with this document, change the code unless an explicit INSPECT item says otherwise.

- Do not preserve a legacy flow solely because it was partially implemented.

- Unknown implementation details must be inspected in code, database schema, API validation, and UI before modification.

- No real production data exists; destructive schema changes are acceptable after confirming that only test data is present.

## 2.2 Recommended delivery strategy

1. Inspect the repository and map existing screens, routes, entities, APIs, authentication, database schema, and reusable UI components.

1. Freeze the target domain model described in this document.

1. Refactor the schema and APIs around Job, Assignment, Attendance, Availability, Customer, internal Project, and report versions.

1. Rebuild the owner Home / Shifts experience and Quick Create flow.

1. Implement staffing and worker request rules.

1. Implement attendance and completion rules.

1. Implement customer and worker reports.

1. Remove or hide obsolete Project-first, quotation, draft/publish, waitlist, cancelled, and payment UI.

1. Complete mobile UX and accessibility review.

1. Run end-to-end acceptance tests before production launch.

> **INSPECTION GATE:** Before deleting or reusing any existing feature, identify whether it is functional, partial, mocked, or unused. Record the result in an implementation checklist.

# 3. Product Language and Terminology

| English domain term | Required Hebrew UI term | Notes |

| --- | --- | --- |

| Job | עבודה | Primary operational entity |

| Worker | עובדת | All worker-facing copy uses feminine grammar |

| Team leader | ראש צוות | Worker capability and assignment role |

| Backup | גיבוי | Assignment role, not worker capability |

| Reservation | שריון | Owner-only job status |

| Approved | אושר | Owner-only job status |

| Completed | בוצע | Owner-only job status |

| Join request | בקשת הצטרפות | Worker-initiated |

| Drop request | בקשת ירידה | Approved worker asks to leave |

| Replacement request | בקשת מחליפה | Find a replacement |

| Swap | החלפה | Two workers exchange jobs |

| Requires Attention | דורש טיפול | Only actionable owner tasks |

# 4. Roles, Authentication, and Authorization

## 4.1 Roles

| Role | Version 1 behavior |

| --- | --- |

| Owner | Exactly one business owner. Full access to operations, customers, workers, attendance, salary settings, customer reports, worker reports, audit, and user management. The Owner may also be linked to a Worker record and may be team-leader eligible. |

| Worker | Access to worker-facing jobs, requests, availability, calendar, attendance, forms, notifications, and own published monthly reports. |

| Future Admin | Not exposed in Version 1. Architecture must not hard-code all management access to the Owner email or user ID. Future permissions may include job and staffing management, but customer reports, worker reports, and salary remain Owner-only unless explicitly changed later. |

## 4.2 Authentication

## 4.3 Worker invitation lifecycle

- Owner creates a worker with full name, phone, and email.

- The system sends an invitation immediately; creating a worker without an invitation is not supported.

- Statuses are Invited, Active, and Archived.

- Invitations can be resent; no separate Expired status is required.

- After account completion the worker becomes Active.

## 4.4 Archiving

- Archiving immediately blocks login, closes active sessions, stops notifications, and removes the worker from the main worker list and all staffing choices.

- Archiving is blocked while the worker has unresolved future assignments or invitations.

- Historical jobs, attendance, forms, and reports remain intact.

- Archived workers cannot log in to retrieve reports; the Owner can provide PDFs on request.

- Workers with history are never deleted in production.

## 4.5 Permission matrix

| Capability | Owner | Worker | Future Admin default |

| --- | --- | --- | --- |

| Manage jobs and staffing | Yes | No | Potentially later |

| Manage customers | Yes | No | Potentially later |

| Manage worker profiles | Yes | Own allowed fields only | Potentially later |

| Manage salary | Yes | No | No |

| View customer reports | Yes | No | No |

| View worker reports | All | Own published reports | No |

| Manage attendance | Yes | Own clock and correction requests | Potentially later |

| Audit log | Full | No | Potentially scoped later |

# 5. Target Information Architecture

## 5.1 Owner navigation

- Home / Shifts — primary operational screen.

- Customers.

- Workers.

- Work Calendar — secondary monthly overview.

- Reports — customer and monthly worker reports only.

- Settings / More — audit log and configuration.

## 5.2 Worker mobile navigation

| Bottom navigation | Content |

| --- | --- |

| בית | Urgent action, next job, pending responses, new jobs, missing form, report awaiting approval. |

| עבודות | One chronological list of all future jobs. |

| היומן שלי | Personal month calendar and selected-day items only. |

| עוד | Availability, reports, notifications, profile, logout. |

# 6. Owner Home / Shifts Experience

| Field | Specification |

| --- | --- |

| CHANGE TYPE | MODIFY / REPLACE |

| CURRENT BEHAVIOR | The existing Home already contains a weekly worker-by-date grid, date controls, job cards, availability cells, and an open-gaps row. |

| TARGET | Keep and polish the grid as the main operational surface. Add Quick Create, owner-only status badges, actionable Requires Attention, filters, mobile behavior, and staffing interactions. |

| UI LOCATION | Owner Home. Desktop weekly grid; mobile optimized view. |

| DATA IMPACT | Requires job, assignment, availability, and attention-query APIs. |

| MIGRATION / IMPLEMENTATION | Reuse existing grid components where sound. Remove any dependency on entering Projects first. |

| DO NOT | Do not replace the Home with a separate analytics dashboard. Do not make Jobs or Projects the primary operational entry point. |

| ACCEPTANCE | Owner can understand the current week, create a job, open/edit a job, see staffing and status, and handle urgent actions without navigating away. |

## 6.1 Grid behavior

- Dates are columns and workers are rows. Cards are displayed by worker and date; time ordering is not important.

- An empty future cell opens Quick Create with the date prefilled.

- Past cells cannot create jobs.

- Clicking an existing card opens job details/editing.

- A dedicated primary “יצירת עבודה” button remains available.

- Job cards display owner-only status: שריון, אושר, or בוצע.

- Open staffing shortages remain visible in the existing shortage row and do not automatically become Requires Attention tasks.

- Missing team leader is shown as a clear badge on the job; no separate shortage row is required.

- Desktop editing uses a wide side panel; mobile uses a full-screen sheet/page.

- Rare actions live under an overflow menu.

## 6.2 Date range and filters

- Default to the current week on every entry.

- Support today, day, week, month, custom range, previous, and next controls.

- Initial filters: status, job type, worker, and shortages only.

- Do not persist the last date range across sessions.

# 7. Requires Attention and Notifications

## 7.1 Requires Attention principle

## 7.2 Presentation

- Desktop: compact count strip above the grid, with up to three highest-priority cards and a side panel for the full list.

- Mobile: compact card at the top of Home; tap opens a full-screen task list.

- Simple safe actions may be performed inline; complex decisions open job or entity details.

- Items disappear automatically when resolved. There is no snooze or manual “done” button.

- If an action becomes irrelevant after its date, remove it or replace it with the appropriate overdue task.

## 7.3 Included actionable items

- Today job still in Reservation.

- Past job not Completed.

- Pending join, drop, replacement, or swap request.

- Direct assignment waiting for worker response when intervention is needed.

- Material job change awaiting worker approval.

- Missing clock-in or clock-out requiring resolution.

- Attendance correction or location exception requiring review.

- Internal project ready for customer report.

- Worker report correction request or missing-job claim.

## 7.4 Priority

1. Today and overdue operational items.

1. Attendance issues blocking completion or reports.

1. Worker requests awaiting owner decisions.

1. Assignment and material-change approvals.

1. Customer and worker report tasks.

## 7.5 Notifications

- Version 1 notifications are in-app only.

- Keep a basic notification history for 60 days.

- Notification opens the relevant entity or action.

- All active workers receive a notification for every new job, regardless of availability or same-day conflicts. The job UI explains whether they may join.

- Small changes that do not require approval generally do not notify, except customer change and role changes as specified later.

- Material changes send an immediate notification and a 19:00 reminder if unanswered.

- Deleted jobs notify assigned or pending workers with job type, customer, date, and clear confirmation that the date was released. No internal deletion reason is shown.

# 8. Job Domain Model and Lifecycle

## 8.1 Job types

- Packing / אריזה

- Unpacking / פריקה

- Organising / סידור

## 8.2 Job statuses

| Status | Meaning | Worker visibility |

| --- | --- | --- |

| Reservation / שריון | Owner has reserved a real date and published the job, but business confirmation is not final. | Hidden; worker sees the same future job experience. |

| Approved / אושר | Business-confirmed job. | Hidden. |

| Completed / בוצע | Attendance outcome is resolved and the job is complete. | Worker sees historical outcome through personal calendar/history, not owner status label. |

- New jobs may be Reservation or Approved. Completed is unavailable at creation.

- Reservation to Approved requires no confirmation.

- Approved to Reservation requires confirmation.

- There is no Draft, Publish, Unpublish, or Cancelled status.

- General Reservation cannot be Completed until it has a real customer and valid reporting context; implementation must validate this.

## 8.3 Job identity and fields

| Field | Rule |

| --- | --- |

| Title | Automatic: [job type] — [customer full name], or General Reservation equivalent. |

| Customer | Existing customer, new customer, or explicit General Reservation. |

| Contact | Always the customer; no alternate contact in Version 1. |

| Date | Required, future or today only at creation. No estimated-date flag. |

| Start/end | Required. Default 09:00–14:00. |

| City | Required, including General Reservation. |

| Street and house number | Optional. |

| Access and parking details | Optional. |

| Required worker count | Required numeric stepper; minimum 1; no exposed business maximum. |

| Team leader required | Visible toggle, default on. Leader is included in required count. |

| End form enabled | Visible toggle, default off. |

| Worker notes | Single worker-visible field. |

| Internal notes | Owner-only, under advanced options. |

| Status | Visible, default Reservation; Approved optional. |

## 8.4 Time editing

- Default duration is five hours.

- Changing start time automatically shifts end time while preserving the currently configured duration.

- If the owner manually changed duration, subsequent start changes preserve that duration.

## 8.5 Quick Create order

1. General Reservation or customer.

1. Existing-customer suggestion or new-customer fields.

1. Job type.

1. Date.

1. Start and end time.

1. City, address, access details.

1. Required worker count.

1. Team leader requirement.

1. Status.

1. End-form toggle.

1. Worker notes.

1. Internal notes under advanced options.

1. Save.

## 8.6 Save behavior

- New jobs are automatically visible to workers; no draft or publish step.

- Capacity risk produces an inline warning and save confirmation but never blocks creation.

- Backup workers are not selected during creation.

- After save, close the panel and remain in Shifts view; display the new job immediately.

- No duplicate/copy-job action is required.

# 9. Customer Selection and Customer Records

## 9.1 Quick-create customer matching

- New-customer minimum is first name and phone. Last name is optional; email is optional for customers.

- Matching suggestions trigger from any entered field: name, phone, or email.

- Never auto-select or auto-merge. Owner explicitly chooses an existing customer or creates a new one.

- General Reservation is a separate explicit option.

## 9.2 Customer list

- Show full name, phone, city, last job date, job count, active internal group indicator, and quick call/WhatsApp actions.

- No payment balances or customer payment status.

## 9.3 Customer page

## 9.4 Addresses and snapshots

- A customer may store multiple addresses.

- A job may select a saved address, add a new saved address, or use a one-time address.

- Every job stores its own customer-contact and address snapshot.

- Changing the customer profile does not silently change existing jobs. Offer an explicit option to update future jobs.

## 9.5 Merge and deletion

- Provide Merge with another customer under More options. Move jobs, projects, reports, addresses, and history; retain audit trail.

- Customers are not archived or deleted in normal production flows.

- Test-data deletion exists only in development/test environments.

# 10. Internal Project Model

| Field | Specification |

| --- | --- |

| CHANGE TYPE | REPLACE |

| CURRENT BEHAVIOR | Current concept is Project-first: owner actively creates a project and then creates jobs inside it. |

| TARGET | Project becomes a lightweight internal grouping entity. Job creation never requires project selection. Projects support customer reports, total actual worker-hours, history, and prevention of duplicate reporting. |

| UI LOCATION | Hidden from Quick Create and primary navigation. Reachable from customer/job/report only when useful. |

| DATA IMPACT | Job must reference an internal project or equivalent grouping key; project stores customer, grouping dates, reporting status, rate/mode, report linkage. |

| MIGRATION / IMPLEMENTATION | Implement automatic project resolution/creation. Inspect whether projectId is currently required in schema/API and refactor accordingly. |

| DO NOT | Do not require the owner to create, name, or choose a project during normal job creation. Do not restore quotation-first workflow. |

| ACCEPTANCE | Creating a job automatically links it to the correct open project or creates one without extra owner steps. |

## 10.1 Grouping rules

- Jobs for the same customer within 60 days belong to the same open project.

- Implementation must use a deterministic grouping rule based on nearest existing job/project date range and must add tests for boundary days 59, 60, and 61.

- General Reservation jobs link to an internal General Reservation project.

- When customer changes from General Reservation to a real customer, automatically resolve an eligible open project within 60 days or create a new one.

- After a final customer report is generated, any later job creates a new project even within 60 days.

- Moving a job between projects is an advanced owner action under More options and is audited.

## 10.2 Project completion

- Projects do not auto-close merely because jobs are completed.

- When all included jobs are Completed and attendance is resolved, internal state becomes Ready for customer report.

- Generating the final report closes the project automatically in Version 1.

- Project status is not shown on Home; Home shows job status only.

# 11. Job Editing, Change Approval, and Deletion

## 11.1 Editable fields

## 11.2 Notification and reapproval matrix

| Change | Notify worker | Require worker approval |

| --- | --- | --- |

| Job type | No | No |

| Customer only | Yes | No |

| Add house number/access detail | No | No |

| City change | Yes | Yes |

| Street change | Yes | Yes |

| Start or end changes by at least 3 hours | Yes | Yes |

| Time change under 3 hours | No | No |

| Team-leader role changed | Yes | No unless assignment itself is new |

| Date change | Yes | Yes; see conflict handling |

- While awaiting approval, the worker remains assigned and the full date remains blocked.

- If the worker rejects, remove her from the job and release the day.

- Send immediate notification and a 19:00 reminder while unanswered.

- Changing a date automatically removes workers unavailable or already blocked on the new date. Show owner a summary and update shortage state. Remaining workers require approval for the new date.

## 11.3 Required-count changes

- Increasing count updates shortage display and notifies all active workers of the open capacity.

- Decreasing count requires the owner to choose who becomes Backup; do not silently remove workers.

## 11.4 Date and attendance locks

- Cannot create a job in the past.

- No historical-job creation flow.

- Once any attendance exists, the job date cannot be changed.

- Once any clock-in exists, the job cannot be deleted or archived and remains permanent for history and reports.

## 11.5 Delete before attendance

- Allowed only when no attendance exists.

- Confirmation shows number of workers or requests being released.

- Optional internal cancellation reason may be captured.

- Affected workers receive an in-app cancellation notification and their day is released.

- Do not create a Cancelled job state.

# 12. Staffing, Requests, Assignments, and Backups

## 12.1 Full-date blocking

## 12.2 Worker join request

- Worker taps Join and the request is submitted immediately with no confirmation.

- The date blocks immediately, even while pending.

- Owner and worker see request order, requester names, and timestamps.

- All join requests require owner approval in Version 1.

- Owner approval assigns the worker immediately; there is no second worker acceptance.

- Owner rejection releases the day; no rejection reason is required.

- Worker may cancel a pending request; the day releases immediately and owner gets an informational notification.

## 12.3 Capacity and full jobs

- Jobs accept requests only while a normal slot is available.

- Once the job is full, new requests cannot be submitted.

- Existing extra pending requests remain pending until owner rejects them or explicitly approves them as Backup.

- A full job remains visible to workers and may be opened, but has no Join action.

- There is no waitlist state.

## 12.4 Direct assignment

- Owner may directly invite a worker who did not request to join.

- The worker must accept or reject.

- The pending invitation blocks her entire date.

- It has no automatic expiry, but appears in Requires Attention as the date approaches.

- A different-date move is treated as a new direct assignment and requires acceptance.

## 12.5 Moving workers and requests

- Owner may move an approved worker between jobs on the same date without prior acceptance. Notify the worker; she may later use normal drop/replacement rules.

- Owner may move a pending join request between jobs on the same date. Preserve original request timestamp/order and audit the transfer time.

- Different-date moves require worker acceptance and normal new-date availability checks.

## 12.6 Team leader

- Team-leader requirement defaults on and reserves one slot within total required count.

- Only team-leader-eligible workers may fill that normal slot.

- If only the leader slot remains, approving a regular worker requires confirmation and assigns her as Backup; the leader requirement remains unmet.

- For a one-worker job requiring a leader, the sole normal slot must be filled by an eligible leader.

- Removing the leader requirement converts the current leader to a regular worker and notifies her.

- There is no backup-team-leader role.

- Team-leader eligibility can be added but not removed in Version 1.

## 12.7 Backup

- Backup is an assignment role, not a worker capability.

- Unlimited backups are allowed.

- Backup card looks normal with a clear גיבוי badge and subtle distinction; do not grey it out as disabled.

- Backup is a full commitment and must remain available to attend.

- Owner promotion from Backup to regular normally requires no new acceptance; notify the worker.

- Promotion order uses backup assignment timestamp.

# 13. Drop, Replacement, and Swap

## 13.1 More than 48 hours before start

- Worker submits a drop request.

- She remains assigned and the day remains blocked until owner approves.

- Owner may approve or reject.

## 13.2 Within 48 hours

- Ordinary drop is unavailable unless a backup exists.

- Backup may remove herself within 48 hours.

- If at least one backup exists, a regular worker may drop; the earliest backup is automatically promoted and notified.

- Team-leader drop may be approved without replacement; show a missing-leader warning but do not block.

## 13.3 Open replacement

- Eligible active workers receive a replacement opportunity.

- Eligible means active, unassigned that date, not unavailable, and not blocked by another pending same-day request.

- Multiple workers may volunteer; owner chooses.

## 13.4 Specific replacement and swap

- Specific replacement: original worker selects a worker; selected worker accepts/rejects; owner approves.

- Two-way swap: Worker A proposes; Worker B accepts; owner approves.

- Owner may directly swap same-day workers without prior approval and must notify them.

- Different-date owner swap requires each worker to accept.

# 14. Worker Jobs Screen

| Field | Specification |

| --- | --- |

| CHANGE TYPE | ADD / REPLACE |

| CURRENT BEHAVIOR | Earlier concepts split open jobs and personal jobs into multiple screens or complex tabs. |

| TARGET | Provide one simple chronological list of all future jobs. |

| UI LOCATION | Worker mobile: עבודות. |

| DATA IMPACT | Requires worker-specific eligibility/status projection per job. |

| MIGRATION / IMPLEMENTATION | Reuse job-card components but reduce detail and actions. |

| DO NOT | Do not use complex tabs for upcoming/past/action states. Do not hide full or blocked jobs. |

| ACCEPTANCE | Worker can scan all future jobs, understand her state, and act where eligible. |

## 14.1 Controls and ordering

- Default chronological order, nearest first.

- Three simple filters: הכל, אפשר להצטרף, העבודות שלי.

- Advanced filters behind one icon, initially job type and city.

- Past jobs do not appear here; they appear in My Calendar/history.

## 14.2 Card content

- Date and weekday, job type, customer full name, city only, hours, assigned count, leader badge, up to three assigned names then “+N”.

- Opening the job shows full address, access information, worker notes, full team, role, and relevant actions.

- Status is one of Join, Waiting for approval, Assigned, Backup, Full, or Cannot join with a short reason.

- Workers never see Reservation or Approved.

## 14.3 Eligibility explanations

- Already assigned that date.

- Pending request or direct assignment on another job that date.

- Marked unavailable.

- Job full.

- Request previously rejected and not reopened by owner.

# 15. Worker Home, Calendar, and Availability

## 15.1 Worker Home order

1. One urgent action, if any.

1. Next assigned job.

1. Pending assignment or request responses.

1. New jobs.

1. Missing end form.

1. Monthly report awaiting approval.

## 15.2 My Calendar

- Compact month calendar above a list for the selected date.

- Show only the worker’s own states: assigned job, Backup, pending join request, pending direct invitation, and unavailable day.

- Use distinct visual markers for עבודה, גיבוי, ממתינה, and לא זמינה.

- No future-range limit.

- Do not show all system jobs in the personal calendar.

## 15.3 Availability

- Full-day only; no partial hours.

- Support single date, date range, and recurring weekday.

- Recurring rule may have no end date and can be cancelled simply.

- Show rules in a clear list.

- Cannot create a rule that conflicts with an assignment, pending join request, or pending direct assignment; direct the worker to resolve the conflict.

- Owner cannot override unavailability.

- Unavailable worker is excluded from staffing pickers and shown as unavailable in the owner’s broader worker view.

## 15.4 Reminders

- Send one in-app reminder on the evening before an approved job.

- Backup reminder explicitly says the worker is assigned as Backup.

- No morning reminder.

- Do not remind a worker about a still-pending join request near the job; surface it to the owner instead.

- Phone-calendar export is out of scope.

# 16. Attendance and Location

## 16.1 Clock-in

- Clock-in becomes available 10 minutes before start.

- Outside 500m: allow clock-in, mark for owner review.

- No location permission: allow clock-in, mark for owner review.

- A normal manual in-range clock-in is final automatically unless the worker adds a note asking for review.

## 16.2 Missing clock-in

- At 15 minutes after start with no clock-in, create a proposed attendance entry.

- Worker confirms or corrects the proposed time.

- Owner reviews and approves before it becomes final.

## 16.3 During-work checks

- Attempt a location check every 15 minutes only after clock-in.

- Use the result only as context for exceptions.

- Do not store or expose a route or detailed location history.

- Store only the minimum derived state needed for audit, such as in-range/out-of-range timestamp and source, subject to privacy review.

## 16.4 Leaving the area

- When the worker leaves 500m, prompt whether to end the job.

- If ignored for 15 minutes, create automatic clock-out at the detected exit time and mark for review.

- If the worker returns within 15 minutes, cancel the pending auto clock-out.

## 16.5 Clock-out and correction

- Normal manual clock-out is final automatically unless the worker adds a review note.

- Automatic, out-of-range, missing-permission, contradictory, or corrected attendance requires owner review.

- Owner may add manual attendance for a worker who did not clock.

- Owner may mark an assigned worker “Did not work”.

- Attendance records are never physically deleted; incorrect records are Cancelled and linked to replacements in the audit log.

## 16.6 Attendance calculation

- Every regular worker and team leader must end with either valid clock-in/out or explicit Did not work.

- Backup does not need attendance if she did not work.

- A backup who clocks in becomes a worked participant and is included in all calculations.

- Client worker-hours and worker compensation use approved attendance only.

# 17. Job Completion and End Forms

## 17.1 Automatic completion

- A job becomes Completed automatically only after every expected regular worker and team leader has a resolved outcome: approved clock-in/out or Did not work.

- No pending attendance exception or correction may remain.

- Missing end forms do not block completion.

## 17.2 Manual completion

- Owner may manually mark Completed.

- If workers lack attendance outcomes, require a short resolution screen for each: Worked or Did not work.

- Worked requires entering or confirming times.

## 17.3 End form

- Enabled per job, default off.

- Every worker who actually worked receives an individual form, including a backup who worked.

- Team leader uses the same form in Version 1.

- Offer immediately after clock-out with Fill now and Later choices.

- Editable until the end of the following day.

- Send reminders every three hours until completed or deadline.

- After deadline mark overdue but allow late completion.

- No photo uploads.

- Missing form appears in job details, worker profile, and informational notifications, not Requires Attention unless an owner action is truly necessary.

# 18. Customer Reports

## 18.1 Readiness

- All project jobs intended for the report are Completed.

- All attendance is resolved.

- No final report has already closed the project.

- Missing end forms do not block generation.

## 18.2 Entry points

- Requires Attention.

- Last job in the project.

- Customer page.

## 18.3 Report editor

- Single-page editor, not a long wizard.

- Show job summary, approved worker-hours, billing method, manual additions, final total, preview, and PDF generation.

- Require Preview before generating final PDF.

## 18.4 Billing methods

| Method | Calculation and display |

| --- | --- |

| Hourly | Total approved worker-hours × one customer hourly rate stored for the project. Show aggregate worker-hours, not individual worker names/hours. |

| Global amount | Owner enters one total. Still show actual worker-hours, but do not show an hourly rate. |

- Fixed daily worker compensation never affects customer billing automatically.

- Additions are manual description + amount rows.

- Discounts are out of scope.

- No customer names of workers, individual attendance, worker pay, or salary rates appear in the PDF.

## 18.5 Excluding jobs

- Owner may exclude a job before generating the report.

- Show a clear warning that the job will remain unreported.

- Excluded job must not be marked as reported and must remain eligible for a later report or reassignment to another project.

- Prevent duplicate reporting through immutable report-job linkage.

## 18.6 Finalization and versions

- Generate PDF only; no in-app email or WhatsApp sending.

- Generating the final PDF closes the project immediately in Version 1.

- Correction creates a new version; previous versions remain available.

- Corrected versions must not double-count jobs.

- No sent, invoice, payment, partial-payment, or paid states.

# 19. Monthly Worker Reports

## 19.1 Draft generation

- On the first day of each month, automatically create one draft for every worker who actually worked in the previous month.

- No draft for workers with zero worked attendance.

- Draft is owner-only until published.

## 19.2 Calculation

- Use completed work, approved attendance, and effective salary configuration for each job date.

- Hourly rate and fixed daily amount are stored in worker salary history with effective dates.

- Fixed daily amount is applied once per calendar day worked.

- Team-leader role does not automatically change salary.

- Backup appears only if she worked.

- No manual additions, deductions, bonuses, referral compensation, or payment status in Version 1.

## 19.3 Worker-visible report line

- Date.

- Customer name.

- Job type.

- Role.

- Approved clock-in and clock-out.

- Approved hours.

- One total amount for the day.

## 19.4 Publication and review

- Owner publishes a frozen version; worker receives in-app notification.

- Worker may approve the report or report issues.

- Any issue keeps the whole report unapproved. There is no partial approval.

- Issue categories: incorrect times, incorrect hours, incorrect amount, did not work, other; optional comment.

- Missing-job claim fields: date, customer if known, job type if known, and note.

- Correction request moves report to correction state. Owner edits, creates a new version, and worker reviews again.

## 19.5 Attendance change after publication

- Warn the owner.

- Keep published version immutable in history.

- Automatically create an unpublished corrected draft version.

- Do not publish automatically.

## 19.6 PDF and payment boundary

- Owner and worker can download every published version as PDF.

- No Paid status, payment date, payment method, or amount-paid tracking.

# 20. Worker and Customer Management Screens

## 20.1 Worker list and profile

- Main list: name, phone, active/invited state, leader eligibility, next job, monthly job count, open attendance exceptions, missing forms.

- Salary appears only in worker profile.

- Profile sections: personal details, active state, leader eligibility, salary history, availability, future jobs, job history, attendance issues, missing forms, monthly reports, and event history.

- Archived workers appear only in an archive view.

## 20.2 Salary changes

- On salary edit, ask the effective date: today, start of month, or custom date.

- Calculations use the salary effective on the job date.

- Published reports remain immutable; affected changes create a new draft version.

## 20.3 Leader eligibility

- Owner may grant leader eligibility.

- Removing eligibility is not supported in Version 1.

## 20.4 Customer page and list

# 21. Audit Log

## 21.1 Required events

- Job create/edit/status/customer/address/date/time changes.

- Join request create/cancel/approve/reject/transfer.

- Direct assignment and worker response.

- Assignment role changes, removal, drop, replacement, and swap.

- Attendance create/edit/cancel/correction/approval.

- Salary changes and effective dates.

- Worker invitation, activation, and archive.

- Customer merge.

- Internal project reassignment.

- Report version create, publish, correct, and PDF generation.

## 21.2 Event payload

- Entity type and ID.

- Action type.

- Actor user ID and role.

- Timestamp.

- Previous and new values.

- Reason where required.

- Correlation/request ID when available.

## 21.3 Owner UI

- Read-only central Audit screen under Settings/More.

- Filter by date, entity type, and actor; search by customer, worker, or job.

- Open the related entity directly.

- Also show scoped history inside job, customer, and worker pages.

- Audit events cannot be edited or deleted.

# 22. Data Model Requirements

> **NAMING:** Exact table/class names may follow repository conventions. The semantic boundaries below are mandatory.

| Entity | Required concepts |

| --- | --- |

| User | Clerk identity, role/permissions, status, worker link where applicable. |

| Worker | Profile, invitation/active/archive status, leader eligibility, salary history. |

| WorkerSalaryVersion | Hourly rate, fixed daily amount, effective-from date, created-by, audit reference. |

| Customer | Name, phone, email optional, addresses, notes; no active/payment fields. |

| CustomerAddress | City required, address line, access details, saved/one-time semantics. |

| Job | Customer or General Reservation, project link, type, date, times, address/contact snapshot, status, required count, leader requirement, notes, form flag. |

| Project | Internal customer group, open/ready/closed state, date range, billing method/rate, report linkage. |

| Assignment | Job-worker relation, role regular/leader/backup, state, source, request order timestamps, approval metadata. |

| AvailabilityRule | Single date/range/recurring weekday, full-day, optional end. |

| Attendance | Job-worker record, clock times, source, final/review state, worked/did-not-work, note. |

| AttendanceEvent | Immutable clock, location-derived, correction, approval, and cancellation events. |

| EndForm | Job-worker form, status, due date, answers, timestamps. |

| Notification | Recipient, type, entity link, read state, created/expiry timestamps. |

| AttentionItem | Prefer computed/query-derived state; persist only where workflow needs durable ownership/state. |

| CustomerReportVersion | Project, included jobs, excluded jobs, billing snapshot, additions, totals, PDF, version. |

| WorkerReportVersion | Worker, month, report lines, totals, status, issues, PDF, version. |

| AuditEvent | Immutable actor/entity/action/before/after/reason/timestamp. |

## 22.1 Constraints and invariants

- One Owner account.

- One normal assignment per worker per calendar date; pending request/direct assignment also blocks date.

- A job belongs to exactly one internal project at a time.

- A job may be included in at most one logical customer report; corrections are versions of that report.

- Attendance is unique per job-worker participation, with immutable event history.

- No hard delete for business entities with history in production.

- All timestamps stored in UTC and rendered in the business timezone; job date semantics use the configured local timezone.

# 23. API and Service Behavior

## 23.1 Transactional requirements

- Join request creation and date blocking must be atomic.

- Owner approval and assignment role/capacity update must be atomic.

- Backup promotion and regular-worker drop inside 48 hours must be atomic.

- Job date change, conflict removal, and reapproval-state creation must be one transaction or compensating workflow.

- Report finalization and job-report linkage must be atomic to prevent duplicate billing.

- Worker report version creation must snapshot all source lines and totals.

## 23.2 Idempotency

- Scheduled monthly draft generation is idempotent per worker and month.

- Notification jobs and 19:00 reminders are idempotent.

- Automatic completion, proposed clock-in, and auto clock-out are idempotent.

- PDF regeneration of the same immutable report version must not create a new logical version unless content changes.

## 23.3 Validation

- Enforce full-date blocking server-side, not only in UI.

- Enforce leader-slot rules and backup confirmation server-side.

- Enforce no past job creation and date lock after attendance.

- Enforce archive restrictions with future assignments.

- Enforce owner-only report and salary access.

- Enforce report uniqueness and project-close behavior.

# 24. Scheduled Jobs and Background Processing

| Schedule / trigger | Action |

| --- | --- |

| Every day or event-driven | Maintain Requires Attention projections and remove resolved/irrelevant items. |

| 19:00 local time | Remind workers about unanswered material changes; idempotent once per change/day. |

| Evening before job | Send approved-job or backup reminder. |

| 15 minutes after start | Create missing clock-in proposal if needed. |

| Every 15 minutes while clocked in | Attempt location status check where browser/platform capabilities allow. |

| 15 minutes after detected exit | Create reviewable automatic clock-out if worker has not returned/responded. |

| Every 3 hours after clock-out while form pending | End-form reminder until due date. |

| First day of month | Generate previous-month worker-report drafts. |

| After attendance/job changes | Re-evaluate job completion, project report readiness, and impacted report drafts. |

# 25. UX and Accessibility Requirements

- Owner is phone-first but desktop weekly grid must remain excellent.

- All primary actions must be reachable with one hand on mobile and have clear Hebrew labels.

- Do not rely on color alone for status; use badges, icons, and text.

- Confirm destructive or role-changing actions with specific consequences.

- Inline validation should appear next to the field and preserve entered data.

- Disabled worker/job actions must explain why.

- Use concise cards; move history and rare actions behind More options.

- Support keyboard navigation, visible focus, semantic labels, and screen-reader-friendly state text.

- Use right-to-left layout throughout Hebrew UI, including PDFs.

# 26. Migration and Refactor Work Packages

## 26.1 Repository inspection

- Inventory routes and screens: Home, Jobs, Projects, Customers, Workers, Calendar, Reports, Settings.

- Inventory entities and schema constraints, especially projectId, job status, assignment states, attendance, location, reports, quotations, and payments.

- Identify mocked versus connected data.

- Identify reusable UI, authentication, PDF, notification, and scheduling infrastructure.

- Document findings before schema changes.

## 26.2 KEEP

- App shell and Hebrew RTL setup if sound.

- Existing weekly Shifts grid and date controls if reusable.

- Customer/worker form components where compatible.

- Authentication/infrastructure and database foundations if sound.

- Reusable card, side-panel, mobile sheet, PDF, notification, and audit components.

## 26.3 MODIFY

- Home grid cards, status, filters, quick creation, mobile behavior.

- Customers and workers screens to target fields and lifecycle.

- Calendar to personal worker states and secondary owner overview.

- Reports area to only customer and monthly worker reports.

## 26.4 REPLACE

- Project-first job creation with job-first Quick Create.

- Legacy assignment approval chain with the rules in Sections 12–13.

- Any legacy pending-request nonblocking logic with full-date blocking.

- Any detailed location tracking with minimal exception-based state.

- Any mutable report model with immutable versions.

## 26.5 REMOVE / HIDE

- Project from primary navigation and Quick Create.

- Quotations, deposits, customer payments, invoice status, partial payments.

- Draft/publish/unpublish flow.

- Waitlist and auto first-come approval.

- Cancelled job state.

- Worker paid status and manual additions/deductions.

- Historical job creation and phone calendar integration.

- Production test-data deletion controls.

## 26.6 ADD

- Requires Attention and notification center.

- Backup role and leader-slot enforcement.

- Drop/replacement/swap workflows.

- Availability rules and full-date blocking.

- Attendance review/correction and minimal location exception handling.

- End forms.

- Internal automatic project grouping.

- Customer and worker report versioning and PDF generation.

- Central Audit screen.

# 27. Acceptance Test Matrix

| Area | Critical acceptance scenarios |

| --- | --- |

| Quick Create | Create Reservation and Approved jobs from button and future cell; customer match; General Reservation; city required; default 09:00–14:00; duration preserved; auto-project; auto-visible; remains on grid. |

| Requests | Join blocks date immediately; order/timestamps visible; owner approval assigns without second acceptance; rejection/cancel releases; full job blocks new request; extra existing requests remain pending. |

| Leader/Backup | Leader slot included in count; regular approval into leader-only capacity becomes Backup with confirmation; unlimited backups; promotion order; one-worker leader job. |

| Date conflicts | Direct invite blocks date; new-date move requires acceptance; date edit removes unavailable/conflicting workers; attendance locks date. |

| Drop/swap | Over-48 owner approval; within-48 backup rules; automatic earliest-backup promotion; open replacement; specific replacement; two-way swap; leader warning. |

| Availability | Single/range/recurring; full-day only; no owner override; conflict prevents save; no-end recurring cancellation. |

| Attendance | 10-minute early; outside radius and no permission allowed but reviewed; 15-minute proposal; location checks no route; exit prompt/auto-out/return cancellation; Did not work; backup worked. |

| Completion/forms | All expected outcomes required; missing form does not block; manual completion resolves workers; form reminders and deadline; no photos. |

| Customer report | Readiness, entry points, hourly/global, aggregate hours, additions, exclude job warning, preview, PDF, project close, corrected version, no payment states. |

| Worker report | First-day drafts, salary effective date, daily fixed once, worker-visible totals only, publish, issue categories, full-report unapproved, auto corrected draft, PDFs. |

| Security | Worker cannot access owner reports/salary/internal notes; archived worker blocked; future admin not active; dev-only deletion. |

| Audit | Every critical mutation creates immutable before/after event and appears centrally and in entity history. |

| Mobile/RTL | Owner and worker flows work at small widths; correct RTL; no clipped cards/modals/PDF text; actions accessible and states text-labelled. |

# 28. Definition of Done

- All acceptance scenarios pass in automated tests where practical and documented manual QA otherwise.

- No obsolete Project-first, quotation, payment, waitlist, draft/publish, Cancelled, or worker-paid UI remains accessible in production.

- Owner can run a complete scenario from customer/job creation through staffing, attendance, completion, customer PDF, and worker monthly PDF.

- Worker can join, manage availability, respond, clock, complete form, and approve report entirely on mobile.

- Authorization is enforced server-side.

- All business-critical mutations are auditable.

- No detailed location route is stored.

- All Hebrew UI and PDFs render correctly in RTL on supported desktop and mobile browsers.

- Implementation documentation records inspected legacy components, retained code, removed code, schema changes, and deployment steps.

# Appendix A — Open Implementation Decisions That Must Be Resolved in Code Review

- Exact database technology, migration tooling, and transaction boundaries.

- Whether current Job requires projectId and how to introduce automatic resolution with the least churn.

- Exact deterministic 60-day grouping algorithm and timezone boundary handling.

- Browser/platform feasibility of background 15-minute location checks; implement best-effort checks without claiming guarantees that web platforms cannot provide.

- Clerk authentication method and current pricing at implementation time.

- PDF library and Hebrew/RTL font strategy; do not bundle or redistribute font files unless licensing permits.

- Notification scheduler and idempotency infrastructure.

- Whether Requires Attention is computed, materialized, or hybrid.

- Existing partial quotation/payment code: remove from production routes and schema if safely unused, or retain inaccessible tables temporarily with a documented cleanup task.

# Appendix B — Required Change-Block Template for Implementation Tickets

| Field | Required content |

| --- | --- |

| CHANGE TYPE | KEEP, MODIFY, REPLACE, REMOVE, or ADD. |

| CURRENT BEHAVIOR | Observed behavior after code inspection; explicitly say mocked, partial, or absent. |

| TARGET | Exact behavior required by this specification. |

| UI LOCATION | Owner/worker screen and responsive presentation. |

| DATA IMPACT | Entities, fields, constraints, report snapshots, and audit events. |

| MIGRATION / IMPLEMENTATION | Schema/API/UI steps and legacy cleanup. |

| DO NOT | Conflicting behaviors that must not remain. |

| ACCEPTANCE | Testable end state with edge cases. |
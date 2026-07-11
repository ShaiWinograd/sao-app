# 12. UX Acceptance Criteria

# Project-first creation

- A project can be created without jobs.
- A project can use an expected month instead of exact dates.
- A quotation can be created without jobs.
- A quotation can be approved without jobs.
- Jobs can be scheduled later without recreating the project.

# Job-first creation

- A job can be created quickly when a date is known.
- The job is always connected to a project.
- Creating a packing job offers connected unpacking.
- Organizing is not offered as part of a moving project.

# Supported service rules

- Packing-only projects are supported.
- Unpacking-only projects are supported.
- Organizing-only projects are supported.
- Packing plus unpacking becomes a moving project.
- Unpacking and organizing cannot be combined in the normal flow.
- Organizing work connected to the same customer is created as a separate project.

# Partial scheduling

- A moving project may have packing scheduled and unpacking unscheduled.
- Remaining planned work is clearly visible.
- The project moves to `מאושר – תזמון חלקי`.
- Partial scheduling can be saved without blocking.

# Project page

- The complete customer engagement is visible from one project page.
- Planned work remains visible before dates exist.
- Scheduled jobs appear next to planned but unscheduled work.
- Estimated, scheduled, and actual work are displayed separately.
- One recommended next action is always visible.

# Dashboard

- Urgent issues appear before general summaries.
- Every issue includes a direct resolution action.
- Quotation, scheduling, staffing, attendance, billing, and payment issues are separated.
- The dashboard does not contain business-expense or invoice-management sections.

# Quotations

- Date precision is clear.
- Approved quotation versions are immutable.
- Revised scope creates a new version or addendum.
- Approval records reference a specific quotation version.
- Sending and approval history is visible.

# Scheduling

- Multiple days can be scheduled in one flow.
- Unpacking after packing is validated.
- Same-day exceptions require confirmation.
- Worker availability can be checked before creating the job.
- The calendar does not rely only on color for state.

# Staffing

- Manager positions are visually separate.
- Worker and manager shortages appear as separate issues.
- The user can immediately understand whether a job is ready.
- Pending requests and waiting-list workers are visible.

# Attendance

- Missing attendance records appear first during review.
- A job cannot complete while required attendance issues remain.
- Approved attendance feeds actual hours.
- Worker correction requests can be approved, rejected, or edited.

# Forms and messages

- Automatic sends are visible.
- The user can preview, edit, reschedule, disable, or send immediately.
- Packing-supplies forms wait until a packing date exists.
- Forms and messages remain attached to the project history.

# Pricing and payment

- Estimated, scheduled, and actual hours remain separate.
- Final pricing is based on approved actual hours.
- Billing is recorded as completed in an external system.
- Customer payment can be marked received.
- Partial-payment support is available when enabled.

# Worker mobile experience

- Workers see only their relevant job information.
- Workers cannot see customer pricing or other workers' wages.
- Clock-in validates location.
- Clock-out and end-of-job form are a single guided flow.

# Core conceptual acceptance rule

The UX must always distinguish:

1. What was agreed with the customer
2. What was scheduled
3. What actually happened

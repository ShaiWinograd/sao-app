# Project, Quotation, and Job-Creation Flows

## 1. Scope

The app does not need sections for:

* Business expenses
* Invoices
* Tax documents
* Accounting management

These are managed in a separate system.

The app is responsible for:

* Customer management
* Leads and future projects
* Quotations
* Project approval
* Job and shift scheduling
* Worker assignment
* Customer forms
* Worker end-of-job forms
* Actual-hours calculation
* Customer payment tracking
* Worker payment reports
* Project lifecycle management

---

# 2. Core Structural Change

## 2.1 The project must become the main business entity

Currently, a project is created as a result of creating a job.

This is not sufficient because a customer may approve a quotation before any work dates have been selected.

For example:

> מעבר דירה – שי וינוגרד – ינואר 2027

At this stage:

* The customer is known.
* The general service is known.
* The expected month may be known.
* A quotation can be prepared and approved.
* The exact packing and unpacking dates may still be unknown.
* No jobs should yet appear on the calendar.

Therefore, the project must exist independently from jobs.

## 2.2 Entity hierarchy

The intended hierarchy is:

```text
Customer
└── Project
    ├── Quotation
    ├── Customer forms
    ├── Jobs
    │   ├── Worker assignments
    │   ├── Attendance
    │   └── End-of-job forms
    ├── Project documents
    ├── Pricing summary
    └── Payment status
```

## 2.3 Definitions

### Customer

The person or household receiving the service.

A customer may have more than one project over time.

### Project

The full customer engagement.

A project may contain:

* No jobs yet
* One job
* Several jobs
* Several job types
* Several jobs of the same type
* Jobs on different dates
* Jobs whose dates have not yet been selected

### Job

A specific scheduled work event.

A job must normally have:

* Date
* Start time
* Expected end time or expected duration
* Job type
* Required number of workers
* Customer/project
* Work location
* Worker requirements
* Publication status

Examples:

* Packing on August 3, 09:00–14:00
* Packing on August 4, 09:00–14:00
* Unpacking on August 5, 09:00–14:00
* Organizing on August 12, 10:00–15:00

### Quotation

The commercial proposal sent to the customer for approval.

A quotation belongs to a project, not to an individual job.

It may contain:

* Estimated job types
* Estimated worker count
* Estimated hours
* Estimated total worker-hours
* Rates
* Fixed fees
* Optional services
* Supplies
* Discounts
* Notes
* Estimated or exact dates

A quotation may be created even when the project has no scheduled jobs.

---

# 3. Supported Project-Creation Entry Points

The app must support two main entry points.

## 3.1 Project-first flow

This is the preferred flow when dates are not yet known.

Example:

1. A customer contacts the business.
2. The business discusses the expected work.
3. The business creates a project.
4. The business creates and sends a quotation.
5. The customer approves the quotation.
6. Dates are selected later.
7. Jobs are added to the existing project.
8. Workers are assigned and the jobs are performed.

## 3.2 Job-first flow

This is a convenience flow for cases where at least one date is already known.

Example:

1. A customer contacts the business.
2. Packing is scheduled for August 3.
3. The business creates the packing job directly.
4. During job creation, the business either:

   * Selects an existing project, or
   * Creates a new project automatically.
5. The app offers to add related jobs.
6. The quotation is generated from the resulting project.

The job-first flow must still create or connect to a project. A job must never exist without a project.

---

# 4. New Project Creation

## 4.1 Required fields

When creating a project, the user must provide:

* Customer

  * Select an existing customer, or
  * Create a new customer
* Project display name
* General service scope
* Service address, when known
* Project owner
* Lead source, optional
* Initial project status
* Estimated timing

## 4.2 Project display name

The app should automatically suggest a name using:

```text
[Project classification] – [Customer name] – [expected month/year]
```

Examples:

* מעבר דירה – שי וינוגרד – ינואר 2027
* אריזה – משפחת כהן – אוגוסט 2026
* סידור בית – נועה לוי – ספטמבר 2026

The name must remain editable.

When exact dates are unknown, the user may select:

* Exact date
* Date range
* Expected month
* Expected quarter
* Date not yet known

## 4.3 Initial project statuses

A newly created project may start in one of the following states:

### ליד חדש

The customer has contacted the business, but the scope has not yet been finalized.

### בהכנת הצעת מחיר

The scope is sufficiently understood and a quotation is being prepared.

### מחכה לאישור הצעת מחיר

A quotation has been sent and customer approval is pending.

### משוריין

The customer has indicated serious intent and capacity may be provisionally reserved, but final approval or details are still missing.

### מאושר לביצוע

The customer has approved the quotation and the project may proceed.

A project may be approved even when no exact job dates have been selected.

---

# 5. Project Scope Definition

When creating or editing a project, the user must define the expected work scope.

The user can add one or more planned service components.

Each component has:

* Job type
* Estimated number of workdays
* Estimated workers per day
* Estimated hours per day
* Estimated total worker-hours
* Exact dates, estimated dates, or no dates
* Manager requirement
* Pricing information
* Customer forms
* Worker end-of-job form requirement
* Notes

Supported job types:

* Packing — אריזה
* Unpacking — פריקה
* Organizing — סידור

The scope is initially an estimate. It does not automatically create calendar jobs unless the user explicitly chooses to create jobs.

---

# 6. Project Classifications

The project classification should be automatically suggested based on its planned or scheduled job types.

The user may override the suggested classification when necessary.

## 6.1 Packing only

Condition:

```text
At least one packing component or job
AND no unpacking component or job
AND no organizing component or job
```

Suggested classification:

```text
אריזה
```

## 6.2 Unpacking only

Condition:

```text
At least one unpacking component or job
AND no packing component or job
AND no organizing component or job
```

Suggested classification:

```text
פריקה
```

## 6.3 Organizing only

Condition:

```text
At least one organizing component or job
AND no packing component or job
AND no unpacking component or job
```

Suggested classification:

```text
סידור
```

## 6.4 Packing and unpacking

Condition:

```text
At least one packing component or job
AND at least one unpacking component or job
```

Suggested classification:

```text
מעבר דירה
```

This classification applies even when:

* There are multiple packing days.
* There are multiple unpacking days.
* Organizing is also included.
* Some dates are not yet known.

## 6.5 Packing and organizing without unpacking

Condition:

```text
At least one packing component or job
AND at least one organizing component or job
AND no unpacking component or job
```

Suggested classification:

```text
אריזה וסידור
```

## 6.6 Unpacking and organizing without packing

Condition:

```text
At least one unpacking component or job
AND at least one organizing component or job
AND no packing component or job
```

Suggested classification:

```text
פריקה וסידור
```

## 6.7 Packing, unpacking, and organizing

Condition:

```text
At least one packing component or job
AND at least one unpacking component or job
AND at least one organizing component or job
```

Suggested classification:

```text
מעבר דירה
```

The quotation and project summary should still display all three service types.

## 6.8 Custom project

The user may select a custom classification for an unusual engagement.

Suggested label:

```text
פרויקט מותאם אישית
```

The individual job types must still be stored separately.

---

# 7. Supported Service Combinations and Flows

## 7.1 Packing-only project

Example:

* Two packing days
* No unpacking
* No organizing

Flow:

1. Create the project.
2. Add one or more packing estimates.
3. Create a quotation.
4. Send it to the customer.
5. Receive approval.
6. Select one or more packing dates.
7. Create packing jobs.
8. Send any required packing-supplies form.
9. Perform all packing jobs.
10. Collect worker forms.
11. Calculate actual hours.
12. Complete the project.
13. Move it to payment tracking.

After a packing job is created, the app should offer:

* Add another packing day
* Add unpacking
* Add organizing
* Finish scheduling

The app must not assume that every packing job requires unpacking.

## 7.2 Unpacking-only project

Example:

* The customer was packed by another company.
* The business is hired only for unpacking.

Flow:

1. Create the project.
2. Add one or more unpacking estimates.
3. Create and approve the quotation.
4. Select unpacking dates.
5. Create one or more unpacking jobs.
6. Perform the jobs.
7. Collect worker forms.
8. Calculate actual hours.
9. Complete the project.
10. Move it to payment tracking.

The app must not require an earlier packing job.

## 7.3 Organizing-only project

Example:

* Whole-home organization
* Kitchen organization
* Post-renovation organization
* A multi-day home organization project

Flow:

1. Create the project.
2. Define the organizing scope.
3. Estimate workers, hours, and workdays.
4. Create and send the quotation.
5. Receive approval.
6. Select one or more organizing dates.
7. Create organizing jobs.
8. Perform all jobs.
9. Collect end-of-job forms.
10. Calculate actual hours.
11. Complete the project.
12. Move it to payment tracking.

After creating an organizing job, the app should offer:

* Add another organizing day
* Add packing
* Add unpacking
* Finish scheduling

## 7.4 Packing followed by unpacking

This is the standard moving flow.

Example:

* Packing on August 3
* Unpacking on August 5

Validation:

```text
The unpacking date must be after the final related packing date.
```

If multiple packing dates exist, the first unpacking date must be later than the last packing date.

The app may allow a same-day exception only through an explicit override:

```text
Allow same-day packing and unpacking
```

When used, the user must provide a reason.

After creating a packing job, the app should offer:

```text
Create connected unpacking job
```

When selected:

* The same project must be used.
* Customer details must already be filled.
* Address information should be copied where applicable.
* The user selects the unpacking address if it differs from the packing address.
* The user selects the date and hours.
* The date is validated.
* The user defines worker count.
* The user defines whether a manager is required.

## 7.5 Packing followed by organizing

Example:

* The business packs selected rooms.
* After a renovation or internal move, the business organizes the space.
* No unpacking service is formally included.

Validation:

* The organizing date should normally be after the packing date.
* The user may override this rule because organizing may concern a different room or location.

The app should show a warning rather than a hard error:

```text
The organizing job is scheduled before packing is complete. Confirm that this is intentional.
```

## 7.6 Unpacking followed by organizing

Example:

* Unpacking is performed first.
* A later organizing day is added for detailed placement and storage solutions.

Validation:

* Organizing should normally be on or after the first unpacking date.
* It may occur on the same day.
* It may occur before unpacking only with confirmation.

## 7.7 Packing, unpacking, and organizing

Example:

* August 3: Packing
* August 5: Unpacking
* August 8: Organizing

Flow:

1. Create the moving project.
2. Add packing, unpacking, and organizing estimates.
3. Create one quotation containing all services.
4. Receive customer approval.
5. Create the jobs when dates are known.
6. Validate packing/unpacking order.
7. Warn about unusual organizing order.
8. Perform all jobs.
9. Complete the project only after every job is operationally complete.

The project classification is:

```text
מעבר דירה
```

The displayed service scope is:

```text
אריזה, פריקה וסידור
```

## 7.8 Multiple jobs of the same type

A project may contain:

* Several packing days
* Several unpacking days
* Several organizing days
* Different worker counts each day
* Different working hours each day
* Different locations each day

Examples:

```text
August 1 – Packing – 3 workers
August 2 – Packing – 4 workers
August 5 – Unpacking – 5 workers
August 6 – Unpacking – 3 workers
```

Each job must be separately editable and separately staffed.

The quotation may summarize them or show them as separate lines.

## 7.9 Additional job added after quotation approval

A customer may approve a quotation and later request another workday.

The app must ask:

```text
Does this new job require a quotation update?
```

Options:

### No quotation update required

Use when:

* The work is already covered by an hourly quotation.
* The quotation explicitly allows actual-hours billing.
* The added date does not materially change the agreed scope.

The job is added to the existing approved project.

### Update the existing quotation

Use when:

* The scope changed before work began.
* The customer must approve the revised estimate.

The quotation version increases, and the project may return to:

```text
מחכה לאישור הצעת מחיר
```

The existing approved version must remain in the history.

### Create an addition to the quotation

Use when:

* The original work has already started.
* The new work should be treated as an approved addition.

Create a quotation addendum linked to the same project.

## 7.10 Job removed after quotation approval

When removing a job from an approved project, ask whether to:

* Remove the job only
* Update the quotation
* Create a quotation correction
* Cancel the entire project

The removed job must remain visible in project history with:

* Previous date
* Previous type
* Cancellation reason
* Who cancelled it
* Cancellation time
* Whether customer approval was affected

---

# 8. Quotation-First Flow with Unknown Dates

This flow must be fully supported.

## 8.1 Example

A customer contacts the business in July 2026 about a move expected in January 2027.

The business estimates:

* Four packing workers for five hours
* Five unpacking workers for five hours
* Exact dates not yet selected

## 8.2 Flow

1. Create or select the customer.
2. Create a new project.
3. Select the expected scope:

   * Packing
   * Unpacking
4. The app classifies the project as:

   * מעבר דירה
5. Set timing as:

   * January 2027
   * Exact dates not yet known
6. Add the estimates:

   * Packing: 4 workers × 5 hours = 20 estimated worker-hours
   * Unpacking: 5 workers × 5 hours = 25 estimated worker-hours
7. Set manager requirements.
8. Enable the packing-supplies form.
9. Keep worker end-of-job forms enabled.
10. Generate a quotation.
11. Preview the quotation.
12. Send the quotation by WhatsApp or email.
13. Move the project to:

* מחכה לאישור הצעת מחיר

14. When customer approval is recorded, move the project to:

* מאושר לביצוע

15. The project now appears under:

* מאושר אך טרם נקבעו כל התאריכים

16. When dates are later agreed, open the project and select:

* תזמון עבודות

17. Create the packing and unpacking jobs.
18. Validate the job order.
19. Publish the jobs when ready.

## 8.3 Dashboard requirement

The dashboard must clearly separate:

* Quotation sent, awaiting approval
* Quotation approved, no jobs scheduled
* Quotation approved, partially scheduled
* Quotation approved, fully scheduled

Suggested dashboard sections:

```text
מחכה לאישור הצעת מחיר
```

```text
מאושר – מחכה לקביעת תאריכים
```

```text
מאושר – תזמון חלקי
```

```text
עבודות קרובות
```

---

# 9. Partial Scheduling

A project may be only partially scheduled.

Example:

* Packing date selected
* Unpacking date not yet known

The project must remain valid.

The system should track each planned service component as one of:

* Not scheduled
* Partially scheduled
* Fully scheduled
* Removed from scope

Example:

```text
Packing: fully scheduled
Unpacking: not scheduled
Organizing: not applicable
```

The project should appear in:

```text
מאושר – תזמון חלקי
```

The app must show a warning when approaching the expected project period and required jobs are still unscheduled.

---

# 10. Converting Planned Scope into Jobs

From the project page, each planned service component should have:

```text
Create job
```

or:

```text
Schedule workdays
```

When selected, the app should support:

* One job
* Several jobs
* Copying a job
* Splitting estimated work across several dates

Example:

The quotation estimates:

```text
Packing: 40 worker-hours
```

The user may schedule:

* Day 1: 4 workers × 5 hours
* Day 2: 4 workers × 5 hours

The system should show:

```text
Estimated: 40 worker-hours
Scheduled: 40 worker-hours
Difference: 0
```

Another valid schedule may be:

* Day 1: 3 workers × 5 hours
* Day 2: 4 workers × 5 hours

The system should show:

```text
Estimated: 40 worker-hours
Scheduled: 35 worker-hours
Difference: -5
```

This is a warning, not necessarily an error.

---

# 11. Job Creation Fields

Every job should include:

## Basic details

* Project
* Customer
* Job type
* Date
* Start time
* Expected end time
* Expected duration
* Required worker count
* Address
* Contact person
* Customer phone number
* Internal notes
* Worker-facing notes

## Staffing rules

* Is a manager mandatory?
* Number of manager-reserved positions
* Allowed worker groups
* Auto-approval or manager approval for join requests
* Maximum workers
* Waiting list behavior

By default, if a manager is mandatory:

* At least one position is reserved for an eligible manager.
* The job cannot be considered fully staffed without a manager.
* The reserved manager position cannot be filled by a regular worker.

## Forms

* Customer form required
* Form template
* Form scheduling rule
* Worker end-of-job form required
* Manager end-of-job form required
* Additional project-specific form

Worker end-of-job forms should be enabled by default for all job types.

## Publication

A job may be:

* Draft
* Published to workers
* Fully staffed
* In progress
* Awaiting attendance corrections
* Completed
* Cancelled

---

# 12. Job-First Moving Scenario

The previously implemented flow should continue to work, with the following revised behavior.

## 12.1 Scenario

The customer requests help with moving.

The expected work is:

* Packing: 4 workers, 09:00–14:00
* Unpacking: 5 workers, 09:00–14:00

Dates:

* Packing: August 3
* Unpacking: August 5

## 12.2 Flow

1. The user creates a new job on August 3.
2. The user creates or selects the customer.
3. The user selects:

   * Packing
4. The user sets:

   * Four workers
   * 09:00–14:00
   * Manager mandatory
5. The user enables the packing-supplies form.
6. Worker end-of-job forms are enabled by default.
7. When saving, the app creates a new project or asks the user to select an existing project.
8. The app offers:

   * Create connected unpacking job
   * Add another packing day
   * Add organizing job
   * Finish
9. The user selects:

   * Create connected unpacking job
10. The customer and project details are filled automatically.
11. The user selects August 5.
12. The system validates that August 5 is after the final packing date.
13. The user sets five workers and marks a manager as mandatory.
14. The job is saved.
15. The app opens or links to the project.
16. The project is classified as:

* מעבר דירה

17. The project page offers:

* Preview quotation

18. The quotation contains both jobs.
19. The user sends it by WhatsApp or email.
20. The project moves to:

* מחכה לאישור הצעת מחיר

21. Optionally, it may be marked:

* משוריין

22. When approval is received, the user records the approval.
23. The project moves to:

* מאושר לביצוע

24. All linked jobs display the updated project-status badge.

---

# 13. Quotation Management

## 13.1 Quotation generation

The app should generate a quotation from:

* Project information
* Planned service components
* Existing jobs
* Pricing settings
* Customer details
* Custom notes
* Terms and conditions

## 13.2 Quotation preview

The user must be able to preview the quotation before sending it.

The preview must clearly distinguish:

* Exact scheduled dates
* Estimated dates
* Expected month only
* Dates still to be determined

Examples:

```text
מועד משוער: ינואר 2027
```

```text
המועדים המדויקים יתואמו בהמשך ובהתאם לזמינות.
```

## 13.3 Quotation sending

Supported methods:

* WhatsApp
* Email
* Download/share manually
* Mark as sent manually

The app should record:

* When it was sent
* Which channel was used
* Recipient
* Quotation version
* Who sent it

## 13.4 Quotation approval

Approval methods:

* Customer approves through a link
* Customer signs digitally
* User records verbal approval
* User records WhatsApp approval
* User uploads an approved document

The approval record should contain:

* Date
* Approval method
* Approved version
* Notes
* Attachment or screenshot, optional
* User who recorded the approval

## 13.5 Quotation versions

Every material edit after sending should create a new quotation version.

Previous versions must remain available.

Possible statuses:

* Draft
* Sent
* Viewed
* Approved
* Rejected
* Expired
* Replaced by newer version

---

# 14. Project Status Model

The project workflow should use explicit statuses.

## 14.1 Pre-approval statuses

### ליד חדש

Initial inquiry.

### בהכנת הצעת מחיר

Scope is being estimated.

### מחכה לאישור הצעת מחיר

Quotation sent, customer approval pending.

### משוריין

The customer or business has provisionally reserved capacity.

This status does not necessarily mean the quotation is approved.

## 14.2 Approved and planning statuses

### מאושר – מחכה לקביעת תאריכים

Quotation approved, but no jobs have been scheduled.

### מאושר – תזמון חלקי

Some required jobs are scheduled, but at least one planned component remains unscheduled.

### מאושר לביצוע

All currently required jobs are sufficiently scheduled and the project is ready.

## 14.3 Execution statuses

### בביצוע

At least one job has started and not all jobs are complete.

### ממתין להשלמות נוכחות

All planned job dates have passed, but at least one job has:

* Missing clock-in
* Missing clock-out
* Pending attendance correction
* Pending admin approval
* Worker who has not exited the job
* Unresolved attendance anomaly

### עבודה הסתיימה

All operational work is complete and attendance is resolved.

## 14.4 Payment statuses

### מחכה לחיוב

The actual amount has been calculated, but the user has not yet marked the customer as billed in the external accounting system.

### מחכה לתשלום מהלקוח

The customer was billed externally, but payment has not yet been received.

### שולם

Payment was received.

### נסגר

The project is fully completed and no further action is required.

## 14.5 Other statuses

### מוקפא

The project is temporarily paused.

### בוטל

The project was cancelled.

---

# 15. Project Status Automation

## 15.1 Approval automation

When the approved quotation is recorded:

* Set the project to מאושר – מחכה לקביעת תאריכים if no jobs exist.
* Set the project to מאושר – תזמון חלקי if only part of the scope is scheduled.
* Set the project to מאושר לביצוע if all required work is scheduled.
* Update linked job badges.

## 15.2 Start automation

When the first worker clocks into the first active job:

```text
Project → בביצוע
```

## 15.3 Completion automation

The project may automatically move to עבודה הסתיימה only when:

* Every non-cancelled job is complete.
* Every assigned worker has a resolved clock-in.
* Every assigned worker has a resolved clock-out.
* No attendance correction is pending.
* No admin approval request is pending.
* No required worker form is missing, unless explicitly waived.
* No required manager form is missing, unless explicitly waived.

When job dates have passed but attendance is unresolved:

```text
Project → ממתין להשלמות נוכחות
```

## 15.4 Post-completion automation

When the project reaches עבודה הסתיימה:

1. Calculate actual worker-hours.
2. Calculate the actual customer amount.
3. Calculate worker payments.
4. Attach completed forms.
5. Create the final project summary.
6. Send or prepare the completion WhatsApp message.
7. Move the project to:

   * מחכה לחיוב

After the user records that an invoice or payment request was created externally:

```text
Project → מחכה לתשלום מהלקוח
```

After payment is recorded:

```text
Project → שולם
```

---

# 16. Customer Forms

## 16.1 Form ownership

Customer forms belong to the project.

A form may also be associated with a particular job.

Examples:

* Packing-supplies form
* Customer-preparation checklist
* Access and parking details
* New-home room details
* Organizing preferences

## 16.2 Packing-supplies form

When enabled, the form should be sent:

```text
After quotation approval
AND no earlier than one week before the relevant packing job
```

Rules:

### More than seven days remain

Send seven days before the first relevant packing job.

### Seven days or fewer remain at approval

Send immediately after approval.

### No packing date exists yet

Do not send the form.

Once the first packing date is scheduled, calculate the send date.

### Packing date changes

Recalculate the form send date.

Do not send the same form twice unless:

* The user explicitly resends it.
* A new form version is created.
* The previous form was invalidated.

## 16.3 Form preview

The project page must allow the user to:

* Preview the form
* Edit dynamic values
* Send it
* Resend it
* See submission status
* See the customer response
* Attach the response to the project

---

# 17. Customer Messages and Automations

## 17.1 Moving reminder

When the project classification is מעבר דירה, send a reminder two days before the first active job.

The message should contain:

* Important reminders
* Preparation instructions
* Encouraging wording
* Contact details

The final template will be supplied later.

Conditions:

* The quotation is approved.
* The project is not cancelled or paused.
* At least one job exists.
* The message has not already been sent for the current schedule.

If the first job date changes after the message has been sent, notify the user and allow a revised message.

## 17.2 Completion message

When the project reaches עבודה הסתיימה, prepare or send a customer message containing:

* Confirmation that the work is complete
* Friendly congratulations
* Actual work summary
* Bottom-line amount, when appropriate
* Next payment or billing step

The user should be able to configure whether this message is:

* Sent automatically
* Created as a draft for approval
* Disabled

Because actual pricing may require review, the safer default is:

```text
Create a draft for approval
```

---

# 18. Dashboard Requirements

The dashboard should show actionable business items, not accounting sections.

Required sections:

## מחכה לאישור הצעת מחיר

Projects with a sent quotation that has not been approved.

## הצעות מחיר בהכנה

Projects whose quotations are still drafts.

## מאושר – מחכה לקביעת תאריכים

Approved projects with no scheduled jobs.

## מאושר – תזמון חלקי

Approved projects where only part of the expected work has been scheduled.

## עבודות לא מאוישות

Jobs that do not yet have enough approved workers.

## חסר מנהל עבודה

Jobs requiring a manager but without an approved manager assignment.

## טפסי לקוח ממתינים

Customer forms that:

* Need to be sent
* Were sent but not completed
* Require review

## חריגות נוכחות

Jobs with:

* Missing clock-in
* Missing clock-out
* Pending correction request
* Location anomaly
* Pending admin decision

## מחכה לחיוב

Completed projects whose actual amount is ready but has not yet been billed externally.

## מחכה לתשלום מהלקוח

Projects billed externally but not yet paid.

## תשלומי עובדים לבדיקה

Completed jobs where worker payments require review.

---

# 19. Pricing Calculation

The project must display both estimated and actual pricing.

## 19.1 Estimated pricing

Based on the quotation:

```text
Estimated worker-hours =
sum of estimated workers × estimated hours
```

Example:

```text
Packing:
4 workers × 5 hours = 20 worker-hours

Unpacking:
5 workers × 5 hours = 25 worker-hours

Total:
45 estimated worker-hours
```

## 19.2 Scheduled pricing

Based on scheduled jobs:

```text
Scheduled worker-hours =
sum of required workers × scheduled job duration
```

## 19.3 Actual pricing

Based on approved attendance:

```text
Actual worker-hours =
sum of approved worker attendance durations
```

The customer price should use the project's customer pricing rules.

Worker pay should use each worker's individual pay rules:

* Hourly wage
* Fixed daily payment
* Optional bonus
* Customer-referral compensation
* Other approved additions

## 19.4 Review requirement

The final amount must not be treated as final while:

* Attendance corrections are pending.
* Required jobs are incomplete.
* A manager has not approved required forms.
* The user has marked the pricing as needing manual review.

---

# 20. Decision Points the UI Must Support

## During project creation

* New or existing customer?
* Exact dates known?
* Expected month only?
* Which service types are expected?
* How many workdays are estimated?
* Are rates hourly, fixed, or mixed?
* Is customer approval required before scheduling?
* Should capacity be provisionally reserved?

## During quotation creation

* Build from planned estimates or scheduled jobs?
* Include exact dates or estimated timing?
* Include each day separately or summarize by service type?
* Does the quotation permit actual-hours billing?
* Is a deposit required?
* Are supplies included?
* Are optional services included?

## During job creation

* Connect to an existing project or create a new project?
* Add another job of the same type?
* Add packing?
* Add unpacking?
* Add organizing?
* Manager required?
* Worker forms required?
* Customer form required?
* Publish now or save as draft?

## During approval

* Was the quotation approved?
* Which version was approved?
* How was approval received?
* Are dates known?
* Is the project fully or partially scheduled?

## When project scope changes

* Is quotation approval still valid?
* Revise quotation?
* Create quotation addendum?
* No quotation change needed?
* Should previously scheduled jobs remain?

## At job completion

* Are all attendance records resolved?
* Are all required forms submitted?
* Should missing forms be waived?
* Is actual pricing ready?
* Does the final amount require review?

## At project completion

* Create completion message automatically or as a draft?
* Has the customer been billed externally?
* Has payment been received?
* Is the project ready to close?

---

# 21. Important Validation Rules

## Project and job relationship

* Every job must belong to exactly one project.
* A project may contain zero or more jobs.
* A quotation must belong to exactly one project.
* A project may contain several quotation versions.

## Date validation

* Unpacking should occur after the final related packing job.
* Same-day packing and unpacking require explicit override.
* Organizing order should produce warnings rather than hard blocking.
* Jobs cannot be scheduled after a project is cancelled.
* Jobs may be scheduled before quotation approval only when explicitly allowed.

## Customer validation

* Customer contact details are required before sending a quotation.
* A valid WhatsApp-capable number is required for WhatsApp sending.
* A valid email address is required for email sending.

## Approval validation

* Approval must reference a specific quotation version.
* Editing an approved quotation must not silently overwrite the approved version.
* Material scope changes should trigger a new version or addendum.

## Completion validation

* A project cannot automatically complete while attendance issues remain.
* Cancelled jobs do not block completion.
* Draft jobs should block completion only when they represent required planned work.
* Optional unscheduled components should not block completion once explicitly removed or marked unnecessary.

---

# 22. Data Model Additions

## Project

Suggested fields:

```text
id
customerId
displayName
classification
serviceTypes[]
status
expectedStartDate
expectedEndDate
expectedMonth
datePrecision
primaryAddress
secondaryAddress
ownerUserId
leadSource
quotationStatus
approvedQuotationVersionId
schedulingStatus
paymentStatus
createdAt
updatedAt
cancelledAt
cancellationReason
```

## PlannedServiceComponent

```text
id
projectId
jobType
estimatedDays
estimatedWorkersPerDay
estimatedHoursPerDay
estimatedWorkerHours
managerRequired
reservedManagerPositions
customerFormTemplateIds[]
workerFormRequired
pricingConfiguration
schedulingStatus
notes
```

## Job

```text
id
projectId
plannedServiceComponentId
jobType
date
startTime
endTime
expectedDuration
requiredWorkers
managerRequired
reservedManagerPositions
address
status
publicationStatus
customerFormSettings
workerFormSettings
createdAt
updatedAt
```

## Quotation

```text
id
projectId
version
status
basedOn
lineItems[]
estimatedTotal
validUntil
sentAt
sentChannel
approvedAt
approvalMethod
approvalEvidence
replacedByQuotationId
createdAt
updatedAt
```

## ProjectAutomation

```text
id
projectId
automationType
scheduledFor
status
sentAt
cancelledAt
relatedJobId
relatedFormId
templateVersion
```

---

# 23. Migration from Existing Job-First Implementation

Existing data must not be discarded.

For each existing job without a project:

1. Create a project.
2. Connect the job to it.
3. Use the job customer as the project customer.
4. Infer project classification from the connected job types.
5. Infer expected dates from job dates.
6. Mark the project as scheduled.
7. Preserve all existing job information.

For several jobs belonging to the same customer engagement:

* Allow the user to merge them into one project.
* Do not merge automatically based only on customer identity.
* Suggest likely merges based on:

  * Same customer
  * Nearby dates
  * Packing followed by unpacking
  * Same address or related addresses
  * Existing connection metadata

---

# 24. Acceptance Scenarios

The implementation should be tested against at least the following cases.

## Scenario A: Quotation before dates

* Create moving project.
* Add packing and unpacking estimates.
* Do not create jobs.
* Send quotation.
* Approve quotation.
* Verify project appears under approved but waiting for dates.
* Add jobs later.
* Verify quotation and project remain connected.

## Scenario B: Job-first packing and unpacking

* Create packing job.
* Create customer.
* Create connected unpacking job.
* Verify date order.
* Verify project is created.
* Verify classification is מעבר דירה.
* Generate quotation.
* Approve it.
* Verify job badges update.

## Scenario C: Packing only

* Create one packing job.
* Decline the connected-unpacking suggestion.
* Verify project classification remains אריזה.
* Complete the job.
* Verify project can complete without an unpacking job.

## Scenario D: Unpacking only

* Create unpacking project with no packing job.
* Verify no packing requirement is enforced.
* Complete normally.

## Scenario E: Organizing only, several days

* Create organizing project.
* Schedule three organizing days.
* Use different worker counts.
* Complete all jobs.
* Verify project completes only after the final job.

## Scenario F: Packing, unpacking, and organizing

* Create all three service types.
* Verify classification is מעבר דירה.
* Verify service summary lists all three.
* Verify organizing may be scheduled after unpacking.

## Scenario G: Partial scheduling

* Approve packing and unpacking quotation.
* Schedule packing only.
* Verify status is מאושר – תזמון חלקי.
* Schedule unpacking.
* Verify status becomes מאושר לביצוע.

## Scenario H: Additional approved work

* Complete initial scheduling.
* Add another organizing job.
* Choose quotation addendum.
* Verify original quotation remains approved.
* Verify addendum is tracked separately.

## Scenario I: Attendance issue

* Complete all job dates.
* Leave one worker's clock-out unresolved.
* Verify project moves to ממתין להשלמות נוכחות.
* Approve the correction.
* Verify the project moves to עבודה הסתיימה.

## Scenario J: Customer payment tracking

* Complete project.
* Verify it appears under מחכה לחיוב.
* Mark billed externally.
* Verify it appears under מחכה לתשלום מהלקוח.
* Mark paid.
* Verify status becomes שולם.

---

# 25. Main Product Principle

The system must distinguish between three separate concepts:

```text
What the customer is expected to receive
```

This is represented by the project scope and quotation.

```text
When the work is scheduled
```

This is represented by jobs.

```text
What actually happened
```

This is represented by attendance, forms, and approved actual hours.

A quotation must not require calendar jobs.

A calendar job must always belong to a project.

A project must remain usable before dates are known, while dates are partially known, during execution, after completion, and until payment is received.


## Correction to Project Classifications and Service Combinations

Remove the following project classifications entirely:

* Packing and organizing without unpacking
* Unpacking and organizing without packing
* Unpacking and organizing as separate services within the same project

The app should not suggest or create classifications such as:

* אריזה וסידור
* פריקה וסידור

### Service meaning

The supported job types remain:

* Packing — אריזה
* Unpacking — פריקה
* Organizing — סידור

However, unpacking already includes an organizing aspect. Therefore:

* A customer who needs help unpacking and arranging their belongings should receive an **unpacking job**.
* Organizing should be used for standalone home organization work that is not part of an unpacking service.
* Organizing should not normally be added to a moving project that already contains unpacking.

---

## Revised Project Classifications

### Packing only

Condition:

```text
At least one packing component or job
AND no unpacking component or job
```

Classification:

```text
אריזה
```

A packing-only project may contain one or more packing jobs.

---

### Unpacking only

Condition:

```text
At least one unpacking component or job
AND no packing component or job
```

Classification:

```text
פריקה
```

An unpacking-only project may contain one or more unpacking jobs.

It does not require an earlier packing job, because the customer may have been packed by another company or independently.

---

### Organizing only

Condition:

```text
At least one organizing component or job
AND no packing component or job
AND no unpacking component or job
```

Classification:

```text
סידור
```

An organizing project is a standalone organization service and is not connected to moving-related unpacking.

It may contain one or more organizing jobs.

---

### Packing and unpacking

Condition:

```text
At least one packing component or job
AND at least one unpacking component or job
```

Classification:

```text
מעבר דירה
```

This remains true when:

* There are several packing days.
* There are several unpacking days.
* Worker counts differ between days.
* Some dates are not yet known.

A moving project should contain packing and unpacking jobs only.

Organizing should not be added as a third service type because the unpacking service already includes arranging and organizing the unpacked belongings.

---

## Revised Supported Combinations

The supported project combinations are:

1. Packing only
2. Unpacking only
3. Organizing only
4. Packing and unpacking — classified as מעבר דירה

No other automatic service combinations should be supported.

---

## Job-Creation Suggestions

### After creating a packing job

The app should offer:

* Add another packing day
* Create connected unpacking job
* Finish scheduling

It should not offer to add an organizing job.

### After creating an unpacking job

The app should offer:

* Add another unpacking day
* Finish scheduling

When the unpacking job belongs to an unpacking-only project, the app may also offer:

* Add packing job before this job

This option is useful when the user initially created the unpacking job but later realizes that packing is also included in the customer agreement.

It should not offer to add an organizing job.

### After creating an organizing job

The app should offer:

* Add another organizing day
* Finish scheduling

It should not offer packing or unpacking as automatically connected jobs.

If the customer later requests moving services, those should normally be created as a separate project.

---

## Validation Rules

### Organizing and unpacking conflict

A project should not contain both organizing and unpacking service components.

If the user attempts to add organizing to a project that already contains unpacking, show:

```text
The unpacking service already includes organizing the unpacked belongings.

Should this work be added as another unpacking day, or created as a separate organizing project?
```

Options:

* Add another unpacking job
* Create a separate organizing project
* Cancel

### Adding unpacking to an organizing project

If the user attempts to add unpacking to an organizing project, show:

```text
Unpacking and standalone organizing are managed as different project types.

Create a separate moving or unpacking project for this customer?
```

Options:

* Create separate unpacking project
* Create separate moving project
* Cancel

### Adding packing to an organizing project

Packing should not automatically be added to an organizing project.

The app should suggest creating a separate packing or moving project.

### Existing invalid combination

If existing data already contains both organizing and unpacking jobs in the same project, do not delete or automatically modify it.

Mark the project for review and allow the user to:

* Convert organizing jobs into unpacking jobs
* Move organizing jobs into a separate project
* Keep the existing structure as a legacy exception

---

## Revised Acceptance Scenarios

### Organizing-only project

* Create an organizing project.
* Schedule several organizing days.
* Verify only organizing jobs can be added through the normal connected-job flow.
* Verify the project classification remains סידור.

### Packing and unpacking project

* Create a packing job.
* Add a connected unpacking job.
* Verify the project classification becomes מעבר דירה.
* Verify the app does not suggest adding organizing.

### Attempt to combine unpacking and organizing

* Create an unpacking project.
* Attempt to add an organizing job.
* Verify the app blocks the normal addition.
* Verify it offers either another unpacking job or a separate organizing project.

### Existing mixed project migration

* Load an existing project containing unpacking and organizing.
* Verify it is marked for review.
* Move the organizing job into a separate project.
* Verify customer details are retained in both projects.

# SpaceOrderApp Spec-to-Code Implementation Plan

Date: 2026-07-11

Execution mode update:
- This plan is executed as larger, themed PR batches (not sprint-based), so work can continue without waiting for every tiny PR to merge.
- Each batch PR runs one full validation gate (typecheck, unit tests, Playwright smoke) before merge.
- Sequence/dependencies remain the same; delivery cadence is incremental by theme.

## Specs Reviewed

- spec.md
- UI_VISUAL_DESIGN_SPEC.md
- business_app_ux_spec/README.md
- business_app_ux_spec/01-product-foundations.md
- business_app_ux_spec/02-navigation-and-dashboard.md
- business_app_ux_spec/03-projects.md
- business_app_ux_spec/04-project-creation.md
- business_app_ux_spec/05-quotations.md
- business_app_ux_spec/06-scheduling-and-calendar.md
- business_app_ux_spec/07-jobs-and-staffing.md
- business_app_ux_spec/08-attendance-and-forms.md
- business_app_ux_spec/09-customers-and-workers.md
- business_app_ux_spec/10-pricing-payment-and-reports.md
- business_app_ux_spec/11-responsive-accessibility-and-patterns.md
- business_app_ux_spec/12-acceptance-criteria.md

## Current Coverage Snapshot

Implemented strongly:
- Core entities and operations for customers, workers, projects (CustomerCase), jobs, shifts, attendance, forms, invoices, reports.
- Worker join/shift request and replacement mechanics.
- Mobile worker tabs and baseline flows (open jobs, shifts, notifications, profile).

Partial:
- Dashboard actionable sections exist but are not yet aligned to full status/state model in specs.
- Project lifecycle exists but with a reduced state machine.
- Mobile clock in/out exists, but guided end-to-end flow and required form coupling are incomplete.
- Visual and responsive system is partially implemented, not fully aligned to visual spec tokens/components.

Missing/major gaps:
- Quotation domain model, API, UI, approval/versioning, and history.
- Planned service components separated from scheduled jobs.
- Full project status/state machine from specs.
- Full project kanban by lifecycle phases.
- Calendar planning views and worker availability finder.
- Communication timeline and automation visibility model.

## Requirement-to-Code Gap Matrix

### 1) Project model and lifecycle
Status: Partial

Evidence:
- packages/database/prisma/schema.prisma (CaseStatus enum currently reduced)
- apps/web/src/app/cases/page.tsx (status labels mapped to reduced set)

Gaps:
- Add explicit lifecycle states required by spec (quotation, partial scheduling, billing/payment states).
- Enforce state transitions with business rules, not UI-only drag/drop updates.

### 2) Project creation and service combinations
Status: Partial

Evidence:
- apps/web/src/app/cases/page.tsx
- apps/web/src/app/jobs/page.tsx (packing -> unpacking date ordering validation)

Gaps:
- Introduce planned components independent from calendar jobs.
- Enforce unsupported combinations consistently across create/edit flows.
- Add wizard precision for timing (exact/range/estimated month/unknown).

### 3) Quotations
Status: Missing

Evidence:
- No quotation model in packages/database/prisma/schema.prisma
- No quotation routes in packages/api/src/routes

Gaps:
- Add quotation entity and versioning model.
- Add quotation generation/preview/sending/approval APIs.
- Add UI for quote lifecycle and approved-history integrity.

### 4) Scheduling and calendar
Status: Partial

Evidence:
- apps/web/src/app/jobs/page.tsx (job creation and validation)
- apps/web/src/app/dashboard/page.tsx (date-range and schedule summaries)

Gaps:
- Full calendar UI modes (month/week/day).
- Worker availability search and ranked suggestions.
- Dedicated partial-scheduling indicators tied to lifecycle states.

### 5) Jobs, staffing, readiness, publication
Status: Partial

Evidence:
- packages/database/prisma/schema.prisma (Job, JobSlot, Shift)
- apps/web/src/app/jobs/page.tsx

Gaps:
- Planned vs scheduled view in project context.
- Readiness checklist gate before publish.
- Role-specific slot UX (manager vs worker) with clear unmet requirements.

### 6) Attendance, forms, messages, worker mobile flow
Status: Partial

Evidence:
- apps/web/src/app/attendance/page.tsx
- apps/web/src/app/forms/page.tsx
- apps/mobile/app/(worker)/shifts.tsx

Gaps:
- Guided clock-out + required form as one mobile flow.
- Customer-facing form timing automation and visible schedule state.
- Persistent communication timeline and automation logs.

### 7) Customers and workers
Status: Mostly implemented

Evidence:
- apps/web/src/app/customers/page.tsx
- apps/web/src/app/workers/page.tsx

Gaps:
- Worker availability and conflict visualization depth.
- Complete communication and payment context from customer detail timeline.

### 8) Pricing, payment, reports
Status: Partial

Evidence:
- apps/web/src/app/invoices/page.tsx
- apps/web/src/app/reports/page.tsx
- apps/web/src/app/payroll/page.tsx

Gaps:
- Project-level estimated vs scheduled vs actual comparison table.
- Final review hard gate before billing closure.
- Payment-alert views integrated into dashboard urgency model.

### 9) Navigation, dashboard, and project board
Status: Partial

Evidence:
- apps/web/src/app/dashboard/page.tsx
- apps/web/src/app/cases/page.tsx

Gaps:
- Full board tabs and columns by lifecycle phase.
- Uniform next-action per project card.
- Ensure every urgent issue deep-links directly to resolve location.

### 10) Visual design, responsive behavior, accessibility
Status: Partial

Evidence:
- apps/web/src/app/globals.css
- page implementations under apps/web/src/app

Gaps:
- Implement complete design tokens from visual spec.
- Standardize typography, spacing, elevation, and semantic statuses.
- Responsive refinements for tablet/mobile admin and strict accessibility pass.

## Dependency-Driven Implementation Plan

## Phase 0 - Baseline and Guardrails (1 week)

Goals:
- Lock scope and prepare safe migration path.

Tasks:
- Create ADR for state model and quotation/planned-work architecture.
- Add feature flags for new workflow states and quote UI.
- Add migration checklist and seeded test data for lifecycle cases.

Deliverables:
- Approved architecture notes.
- Rollout flags in web/api.

## Phase 1 - Data and API Foundations (2 weeks)

Goals:
- Introduce missing core domain models and APIs first.

Tasks:
- Prisma:
  - Add Quotation + QuotationVersion + approval metadata.
  - Add PlannedServiceComponent linked to project.
  - Expand CaseStatus to full workflow states.
  - Add Message/AutomationLog entities.
- API:
  - Add /quotations routes for draft/preview/send/approve/version.
  - Add /cases/:id/planned-services routes.
  - Add state-transition endpoints with server-side rule checks.

Deliverables:
- DB migrations + route tests passing.

## Phase 2 - Project and Quotation UX Core (2 weeks)

Goals:
- Make project-first + quotation-first fully usable.

Tasks:
- Project creation wizard updates for scope/timing precision.
- Quotation tab with preview, send, approve, and version history.
- Project detail tabs: overview, quotations, jobs, forms/messages, pricing/activity.

Deliverables:
- End-to-end: create project, produce quote, record approval, keep history.

## Phase 3 - Lifecycle Board and Dashboard Actions (2 weeks)

Goals:
- Operational control via lifecycle-accurate views.

Tasks:
- Cases board with lifecycle tabs/columns.
- Dashboard urgency model aligned to spec-driven states.
- Add per-card next-action and deep-links.
- Enforce transition/business rules from server.

Deliverables:
- Admin can manage work using board + urgent queue only.

## Phase 4 - Scheduling Intelligence and Calendar (2 weeks)

Goals:
- Move from list scheduling to planning-grade scheduling.

Tasks:
- Month/week/day calendar pages.
- Worker availability finder (query + ranking + reservation).
- Partial-scheduling UX and alerts tied to project state.

Deliverables:
- Calendar planning and staffing decisions without external tools.

## Phase 5 - Staffing Readiness and Mobile Worker Completion (2 weeks)

Goals:
- Close execution gaps for publish and on-the-day operations.

Tasks:
- Readiness checklist gate before publication.
- Improve slot UX (manager requirement visibility and fill status).
- Mobile guided flow:
  - Start shift -> geovalidation -> active shift view.
  - End shift -> required form -> completion confirmation.

Deliverables:
- Publish gates prevent invalid jobs.
- Worker app supports complete shift lifecycle.

## Phase 6 - Communication Timeline and Automation (1.5 weeks)

Goals:
- Make customer communication observable and auditable.

Tasks:
- Project communication timeline (quotes/forms/reminders/payments).
- Scheduled automation visibility and rescheduling logic.
- Packing-supplies timing automation and rule controls.

Deliverables:
- Message history and automation state visible per project.

## Phase 7 - Visual System, Responsive, Accessibility (2 weeks)

Goals:
- Conform to visual design spec and accessibility rules.

Tasks:
- Introduce design tokens for color/type/spacing/elevation.
- Refactor core UI primitives and status badges.
- Responsive fixes across dashboard/project/board/calendar pages.
- Accessibility checks: keyboard, contrast, touch target sizes, RTL edge cases.

Deliverables:
- UI system aligned to visual spec acceptance criteria.

## Phase 8 - Hardening, Acceptance, and Rollout (1 week)

Goals:
- Validate all acceptance criteria and deploy safely.

Tasks:
- Add integration/e2e suites for:
  - quotation lifecycle and versioning
  - lifecycle transitions
  - partial scheduling and readiness gate
  - mobile shift + form completion flow
- Regression run and data migration verification.
- Staged rollout by feature flag.

Deliverables:
- Acceptance report mapped to business_app_ux_spec/12-acceptance-criteria.md.

## Suggested Workstreams (Parallelization)

- Stream A: Data/API core (phases 1-3)
- Stream B: Web UX lifecycle and board (phases 2-4)
- Stream C: Mobile worker flows (phase 5)
- Stream D: Messaging + automation (phase 6)
- Stream E: Design system + accessibility (phase 7)

## Immediate Next 10 Tickets

1. Add quotation schema models and migration.
2. Add planned service component schema and migration.
3. Expand CaseStatus and transition validator service.
4. Implement quotation routes and tests.
5. Implement planned service routes and tests.
6. Build project detail quotation tab with preview/send/approve.
7. Build project creation wizard step for planned components.
8. Build lifecycle board tab skeleton and column data APIs.
9. Implement dashboard urgent-item query service with deep-link contract.
10. Build mobile clock-out plus required-form guided flow.

## Risks and Mitigations

- Risk: Data migration complexity for existing cases.
  - Mitigation: Backfill script and one-time transition mapping with audit logs.

- Risk: UI churn from lifecycle and design-system changes.
  - Mitigation: Feature flags, incremental page rollout, shared component migration strategy.

- Risk: Calendar/availability query performance.
  - Mitigation: Precompute availability windows and add targeted indexes.

## Done Definition

A phase is complete only when:
- API contracts and validation rules are tested.
- UI behavior matches spec acceptance criteria.
- Audit trail for state changes is retained.
- No regression in existing attendance, payroll, invoicing, and worker scheduling flows.

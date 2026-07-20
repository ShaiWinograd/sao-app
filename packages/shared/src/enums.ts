// ─── Role ────────────────────────────────────────────────────────────────────

export enum UserRole {
  OWNER = 'OWNER',
  ADMIN = 'ADMIN',
  WORKER = 'WORKER',
}

export enum AdminPermission {
  OPERATIONS = 'OPERATIONS',
  FINANCE = 'FINANCE',
}

// ─── Case ────────────────────────────────────────────────────────────────────

export enum CaseStatus {
  DRAFT = 'DRAFT',
  ACTIVE = 'ACTIVE',
  READY_FOR_REVIEW = 'READY_FOR_REVIEW',
  COMPLETED = 'COMPLETED',
  CANCELLED = 'CANCELLED',
  // Full lifecycle states (spec: sale/planning → execution → payment/closure)
  LEAD = 'LEAD',
  QUOTATION_DRAFT = 'QUOTATION_DRAFT',
  AWAITING_APPROVAL = 'AWAITING_APPROVAL',
  RESERVED = 'RESERVED',
  APPROVED_NO_DATES = 'APPROVED_NO_DATES',
  PARTIALLY_SCHEDULED = 'PARTIALLY_SCHEDULED',
  READY_FOR_EXECUTION = 'READY_FOR_EXECUTION',
  IN_PROGRESS = 'IN_PROGRESS',
  AWAITING_COMPLETION = 'AWAITING_COMPLETION',
  AWAITING_BILLING = 'AWAITING_BILLING',
  AWAITING_PAYMENT = 'AWAITING_PAYMENT',
  PAID = 'PAID',
}

// ─── Job ─────────────────────────────────────────────────────────────────────

export enum JobType {
  PACKING = 'PACKING',
  UNPACKING = 'UNPACKING',
  HOME_ORGANIZATION = 'HOME_ORGANIZATION',
}

// Owner-visible job lifecycle (spec §4). RESERVATION → APPROVED → COMPLETED,
// with ARCHIVED for retired jobs. Workers never see this status.
export enum JobStatus {
  RESERVATION = 'RESERVATION',
  APPROVED = 'APPROVED',
  COMPLETED = 'COMPLETED',
  ARCHIVED = 'ARCHIVED',
}

export enum StaffingMode {
  AUTO_APPROVE = 'AUTO_APPROVE',
  MANAGER_APPROVAL = 'MANAGER_APPROVAL',
}

// ─── Worker Role / Skill ─────────────────────────────────────────────────────

export enum WorkerSkill {
  SHIFT_LEADER = 'SHIFT_LEADER',
  PACKING_SPECIALIST = 'PACKING_SPECIALIST',
  UNPACKING_SPECIALIST = 'UNPACKING_SPECIALIST',
  ORGANIZATION_SPECIALIST = 'ORGANIZATION_SPECIALIST',
  DRIVER = 'DRIVER',
  GENERAL_WORKER = 'GENERAL_WORKER',
}

// ─── Shift / Attendance ───────────────────────────────────────────────────────

export enum JoinRequestStatus {
  PENDING = 'PENDING',
  APPROVED = 'APPROVED',
  REJECTED = 'REJECTED',
  CANCELLED = 'CANCELLED',
}

// A worker's role on a job (spec §3.5). TEAM_LEADER counts toward the required
// worker count (§10); BACKUP is an extra worker beyond the requirement (§11).
export enum AssignmentRole {
  REGULAR = 'REGULAR',
  TEAM_LEADER = 'TEAM_LEADER',
  BACKUP = 'BACKUP',
}

export enum AttendanceStatus {
  SCHEDULED = 'SCHEDULED',
  CLOCKED_IN = 'CLOCKED_IN',
  CLOCKED_OUT = 'CLOCKED_OUT',
  NO_SHOW = 'NO_SHOW',
  CORRECTED = 'CORRECTED',
  AUTO_CLOCKED_OUT = 'AUTO_CLOCKED_OUT',
}

export enum AttendanceMethod {
  NORMAL = 'NORMAL',
  ADMIN_CORRECTED = 'ADMIN_CORRECTED',
  MANUALLY_ADDED = 'MANUALLY_ADDED',
  AUTO_CLOCK_OUT = 'AUTO_CLOCK_OUT',
}

export enum ReplacementStatus {
  NONE = 'NONE',
  PENDING = 'PENDING',
  APPROVED = 'APPROVED',
  REJECTED = 'REJECTED',
}

// ─── Billing ───────────────────────────────────────────────────────────────

export enum BillingModel {
  HOURLY = 'HOURLY',
  FIXED = 'FIXED',
  CUSTOM = 'CUSTOM',
}

export enum PaymentMethod {
  BANK_TRANSFER = 'BANK_TRANSFER',
  CASH = 'CASH',
  BIT = 'BIT',
  CHECK = 'CHECK',
  OTHER = 'OTHER',
}

// ─── Address Label ───────────────────────────────────────────────────────────

export enum AddressLabel {
  OLD_APARTMENT = 'OLD_APARTMENT',
  NEW_APARTMENT = 'NEW_APARTMENT',
  STORAGE = 'STORAGE',
  OFFICE = 'OFFICE',
  OTHER = 'OTHER',
}

// ─── Form ────────────────────────────────────────────────────────────────────

export enum FormQuestionType {
  YES_NO = 'YES_NO',
  MULTIPLE_CHOICE = 'MULTIPLE_CHOICE',
  CHECKBOX = 'CHECKBOX',
  NUMBER = 'NUMBER',
  SHORT_TEXT = 'SHORT_TEXT',
  LONG_TEXT = 'LONG_TEXT',
  PHOTO_UPLOAD = 'PHOTO_UPLOAD',
  DATE = 'DATE',
  SIGNATURE = 'SIGNATURE',
}

export enum FormQuestionVisibility {
  WORKER = 'WORKER',
  ADMIN = 'ADMIN',
  OWNER = 'OWNER',
}

export enum FormSubmissionStatus {
  NOT_SUBMITTED = 'NOT_SUBMITTED',
  SUBMITTED = 'SUBMITTED',
  WAIVED = 'WAIVED',
}

export enum CompletionStatus {
  COMPLETED = 'COMPLETED',
  PARTIALLY_COMPLETED = 'PARTIALLY_COMPLETED',
  NOT_COMPLETED = 'NOT_COMPLETED',
}

// ─── Audit Log ───────────────────────────────────────────────────────────────

export enum AuditAction {
  CREATE = 'CREATE',
  UPDATE = 'UPDATE',
  DELETE = 'DELETE',
  APPROVE = 'APPROVE',
  REJECT = 'REJECT',
  CLOCK_IN = 'CLOCK_IN',
  CLOCK_OUT = 'CLOCK_OUT',
  AUTO_CLOCK_OUT = 'AUTO_CLOCK_OUT',
  CORRECTION = 'CORRECTION',
  MONTH_CLOSE = 'MONTH_CLOSE',
  MONTH_REOPEN = 'MONTH_REOPEN',
  PERMISSION_CHANGE = 'PERMISSION_CHANGE',
}

// ─── Expense Category ────────────────────────────────────────────────────────

export enum ExpenseCategory {
  SOFTWARE = 'SOFTWARE',
  MARKETING = 'MARKETING',
  INSURANCE = 'INSURANCE',
  ACCOUNTANT = 'ACCOUNTANT',
  OFFICE = 'OFFICE',
  EQUIPMENT = 'EQUIPMENT',
  VEHICLE = 'VEHICLE',
  PARKING = 'PARKING',
  SUPPLIES = 'SUPPLIES',
  OTHER = 'OTHER',
}


// ─── Reporting Basis ─────────────────────────────────────────────────────────

export enum ReportingBasis {
  ACCRUAL = 'ACCRUAL',
  CASH = 'CASH',
}

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
}

// ─── Job ─────────────────────────────────────────────────────────────────────

export enum JobType {
  PACKING = 'PACKING',
  UNPACKING = 'UNPACKING',
  HOME_ORGANIZATION = 'HOME_ORGANIZATION',
}

export enum JobStatus {
  DRAFT = 'DRAFT',
  PUBLISHED = 'PUBLISHED',
  IN_PROGRESS = 'IN_PROGRESS',
  COMPLETED = 'COMPLETED',
  CANCELLED = 'CANCELLED',
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
  WAITLISTED = 'WAITLISTED',
  CANCELLED = 'CANCELLED',
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

// ─── Invoice / Payment ───────────────────────────────────────────────────────

export enum InvoiceStatus {
  NOT_INVOICED = 'NOT_INVOICED',
  DRAFT = 'DRAFT',
  SENT = 'SENT',
  PARTIALLY_PAID = 'PARTIALLY_PAID',
  PAID = 'PAID',
  OVERDUE = 'OVERDUE',
  CANCELLED = 'CANCELLED',
}

export enum BillingModel {
  HOURLY = 'HOURLY',
  FIXED = 'FIXED',
  CUSTOM = 'CUSTOM',
}

export enum WorkerPaymentStatus {
  NOT_PREPARED = 'NOT_PREPARED',
  READY_FOR_PAYMENT = 'READY_FOR_PAYMENT',
  PARTIALLY_PAID = 'PARTIALLY_PAID',
  PAID = 'PAID',
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

// ─── Worker Adjustment ───────────────────────────────────────────────────────

export enum AdjustmentCategory {
  CUSTOMER_REFERRAL = 'CUSTOMER_REFERRAL',
  SHIFT_LEADER_BONUS = 'SHIFT_LEADER_BONUS',
  SPECIAL_ASSIGNMENT_BONUS = 'SPECIAL_ASSIGNMENT_BONUS',
  TRAVEL_REIMBURSEMENT = 'TRAVEL_REIMBURSEMENT',
  EXTRA_RESPONSIBILITY = 'EXTRA_RESPONSIBILITY',
  CORRECTION = 'CORRECTION',
  DEDUCTION = 'DEDUCTION',
}

// ─── Reporting Basis ─────────────────────────────────────────────────────────

export enum ReportingBasis {
  ACCRUAL = 'ACCRUAL',
  CASH = 'CASH',
}

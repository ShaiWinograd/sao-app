import { z } from 'zod';

// ─── Customer ─────────────────────────────────────────────────────────────────

export const CustomerSchema = z.object({
  firstName: z.string().min(1),
  lastName: z.string().optional().default(''),
  phone: z.string().min(9),
  email: z.string().email(),
  preferredContact: z.enum(['PHONE', 'EMAIL', 'WHATSAPP']).optional(),
  notes: z.string().optional(),
  parkingInstructions: z.string().optional(),
  accessInstructions: z.string().optional(),
  elevatorInfo: z.string().optional(),
  petInfo: z.string().optional(),
  specialRequests: z.string().optional(),
  internalNotes: z.string().optional(),
});

export const CreateCustomerSchema = CustomerSchema;
export const UpdateCustomerSchema = CustomerSchema.partial();

// ─── Address ─────────────────────────────────────────────────────────────────

export const AddressSchema = z.object({
  customerId: z.string(),
  fullAddress: z.string().min(1),
  apartmentDetails: z.string().optional(),
  label: z.enum(['OLD_APARTMENT', 'NEW_APARTMENT', 'STORAGE', 'OFFICE', 'OTHER']),
  accessNotes: z.string().optional(),
  parkingNotes: z.string().optional(),
  elevatorNotes: z.string().optional(),
});

export const CreateAddressSchema = AddressSchema;
export const UpdateAddressSchema = AddressSchema.partial().omit({ customerId: true });

// ─── Customer Case ────────────────────────────────────────────────────────────

export const CaseStatusSchema = z.enum([
  'DRAFT',
  'ACTIVE',
  'READY_FOR_REVIEW',
  'COMPLETED',
  'CANCELLED',
  'LEAD',
  'QUOTATION_DRAFT',
  'AWAITING_APPROVAL',
  'RESERVED',
  'APPROVED_NO_DATES',
  'PARTIALLY_SCHEDULED',
  'READY_FOR_EXECUTION',
  'IN_PROGRESS',
  'AWAITING_COMPLETION',
  'AWAITING_BILLING',
  'AWAITING_PAYMENT',
  'PAID',
]);

export const CustomerCaseSchema = z.object({
  customerId: z.string(),
  name: z.string().min(1),
  status: CaseStatusSchema.optional(),
  startDate: z.string().optional(),
  assignedAdminId: z.string().optional(),
  internalNotes: z.string().optional(),
});

export const CreateCaseSchema = CustomerCaseSchema;
export const UpdateCaseSchema = CustomerCaseSchema.partial().omit({ customerId: true });


// ─── Quotation ───────────────────────────────────────────────────────────────

export const QuotationDatePrecisionSchema = z.enum([
  'EXACT',
  'PARTIAL',
  'EXPECTED_MONTH',
  'DATE_RANGE',
  'TO_BE_DETERMINED',
]);

export const QuotationSendChannelSchema = z.enum(['WHATSAPP', 'EMAIL', 'MANUAL']);

export const QuotationApprovalMethodSchema = z.enum([
  'DIGITAL',
  'SIGNED_DOCUMENT',
  'WHATSAPP',
  'EMAIL',
  'VERBAL',
  'MANUAL',
]);

export const QuotationLineItemSchema = z.object({
  description: z.string().min(1),
  detail: z.string().optional(),
  hours: z.string().optional(),
  price: z.number().optional(),
});

export const QuotationDetailsSchema = z.object({
  scopeOfWork: z.string().optional(),
  projectStartDate: z.string().optional(),
  projectEndDate: z.string().optional(),
  lineItems: z.array(QuotationLineItemSchema).optional(),
  depositAmount: z.number().optional(),
  depositDueDate: z.string().optional(),
  notes: z.string().optional(),
});
export type QuotationLineItem = z.infer<typeof QuotationLineItemSchema>;
export type QuotationDetails = z.infer<typeof QuotationDetailsSchema>;

export const CreateQuotationSchema = z.object({
  caseId: z.string(),
  estimatedTotal: z.number().nonnegative(),
  includedServices: z.array(z.string().min(1)).min(1),
  datePrecision: QuotationDatePrecisionSchema.optional(),
  timingNote: z.string().optional(),
  validUntil: z.string().optional(),
  notes: z.string().optional(),
  details: QuotationDetailsSchema.optional(),
});

export const UpdateQuotationVersionSchema = z
  .object({
    estimatedTotal: z.number().nonnegative(),
    includedServices: z.array(z.string().min(1)).min(1),
    datePrecision: QuotationDatePrecisionSchema,
    timingNote: z.string(),
    validUntil: z.string(),
    notes: z.string(),
    details: QuotationDetailsSchema,
  })
  .partial();

export const CreateQuotationVersionSchema = z.object({
  estimatedTotal: z.number().nonnegative(),
  includedServices: z.array(z.string().min(1)).min(1),
  datePrecision: QuotationDatePrecisionSchema.optional(),
  timingNote: z.string().optional(),
  validUntil: z.string().optional(),
  notes: z.string().optional(),
  details: QuotationDetailsSchema.optional(),
  isAddendum: z.boolean().optional(),
});

export const SendQuotationSchema = z.object({
  channel: QuotationSendChannelSchema,
  recipient: z.string().min(1),
});

export const RecordQuotationApprovalSchema = z.object({
  approvalMethod: QuotationApprovalMethodSchema,
  approvedAt: z.string().optional(),
  approvalNotes: z.string().optional(),
  approvalAttachmentUrl: z.string().url().optional(),
});

// ─── Planned Service Component ───────────────────────────────────────────────

export const ServiceTypeSchema = z.enum(['PACKING', 'UNPACKING', 'HOME_ORGANIZATION']);

export const ServiceTimingPrecisionSchema = z.enum([
  'EXACT_DATE',
  'MULTIPLE_EXACT_DATES',
  'DATE_RANGE',
  'EXPECTED_MONTH',
  'EXPECTED_YEAR',
  'UNKNOWN',
]);

export const CreatePlannedServiceSchema = z.object({
  serviceType: ServiceTypeSchema,
  timingPrecision: ServiceTimingPrecisionSchema.optional(),
  timingNote: z.string().optional(),
  estimatedWorkdays: z.number().int().min(0).optional(),
  workersPerDay: z.number().int().min(0).optional(),
  hoursPerDay: z.number().min(0).optional(),
  requiresManager: z.boolean().optional(),
  reservedManagerPositions: z.number().int().min(0).optional(),
  notes: z.string().optional(),
  sortOrder: z.number().int().min(0).optional(),
});

export const UpdatePlannedServiceSchema = CreatePlannedServiceSchema.partial();

// Create planned components from a high-level wizard service selection.
export const CreatePlannedServicesFromSelectionSchema = z.object({
  selection: z.enum(['PACKING', 'UNPACKING', 'ORGANIZATION', 'MOVING']),
});

// ─── Job ─────────────────────────────────────────────────────────────────────

export const JobSchema = z.object({
  caseId: z.string(),
  customerId: z.string(),
  addressId: z.string(),
  jobType: z.enum(['PACKING', 'UNPACKING', 'HOME_ORGANIZATION']),
  date: z.string(),
  plannedStart: z.string(),
  plannedEnd: z.string(),
  requiredWorkerCount: z.number().int().min(1),
  staffingMode: z.enum(['AUTO_APPROVE', 'MANAGER_APPROVAL']),
  workerSlots: z
    .array(
      z.object({
        requiredSkill: z
          .enum([
            'SHIFT_LEADER',
            'PACKING_SPECIALIST',
            'UNPACKING_SPECIALIST',
            'ORGANIZATION_SPECIALIST',
            'DRIVER',
            'GENERAL_WORKER',
          ])
          .optional(),
        label: z.string().optional(),
      })
    )
    .optional(),
  jobNotes: z.string().optional(),
  workerVisibleNotes: z.string().optional(),
  billingModel: z.enum(['HOURLY', 'FIXED', 'CUSTOM']).optional(),
  billingRate: z.number().optional(),
  enableWaitlist: z.boolean().optional(),
  locationRadiusMeters: z.number().optional(),
  formTemplateId: z.string().optional(),
});

export const CreateJobSchema = JobSchema;
export const UpdateJobSchema = JobSchema.partial().omit({ caseId: true, customerId: true });

// ─── Shift / Join Request ─────────────────────────────────────────────────────

export const JoinRequestSchema = z.object({
  jobId: z.string(),
  workerId: z.string(),
  slotId: z.string().optional(),
  message: z.string().optional(),
});

export const ApproveJoinRequestSchema = z.object({
  shiftId: z.string(),
  approved: z.boolean(),
  reason: z.string().optional(),
});

export const CreateWorkerAvailabilitySchema = z
  .object({
    type: z.enum(['DATE', 'RANGE', 'WEEKLY']),
    startDate: z.string().optional(),
    endDate: z.string().optional(),
    weekday: z.number().int().min(0).max(6).optional(),
    reason: z.string().max(200).optional(),
  })
  .refine(
    (v) =>
      v.type === 'DATE'
        ? Boolean(v.startDate)
        : v.type === 'RANGE'
          ? Boolean(v.startDate && v.endDate)
          : v.weekday !== undefined,
    { message: 'Missing fields for the selected availability type' },
  );

// ─── Attendance ───────────────────────────────────────────────────────────────

export const ClockInSchema = z.object({
  shiftId: z.string(),
  latitude: z.number(),
  longitude: z.number(),
  timestamp: z.string(),
});

export const ClockOutSchema = z.object({
  shiftId: z.string(),
  latitude: z.number(),
  longitude: z.number(),
  timestamp: z.string(),
});

export const AttendanceCorrectionSchema = z.object({
  shiftId: z.string(),
  clockIn: z.string().optional(),
  clockOut: z.string().optional(),
  reason: z.string(),
  internalNote: z.string().optional(),
});

// ─── Replacement Request ──────────────────────────────────────────────────────

export const ReplacementRequestSchema = z.object({
  shiftId: z.string(),
  reason: z.string(),
  suggestedWorkerId: z.string().optional(),
});

export const ApproveReplacementSchema = z.object({
  replacementRequestId: z.string(),
  action: z.enum(['APPROVE_SUGGESTED', 'CHOOSE_WORKER', 'REOPEN', 'REJECT']),
  replacementWorkerId: z.string().optional(),
  reason: z.string().optional(),
});

// Worker asks to leave / be replaced on their own shift (owner approves later).
export const WorkerReplacementRequestSchema = z.object({
  reason: z.string().min(1).max(300),
  suggestedWorkerId: z.string().optional(),
});

// Owner/admin invites a team member (non-worker) with an explicit role.
export const TeamInviteSchema = z.object({
  email: z.string().email(),
  role: z.enum(['OWNER', 'ADMIN']),
});

// Worker signs off on (or disputes) their published monthly report.
export const WorkerReportApprovalSchema = z
  .object({
    month: z.number().int().min(1).max(12),
    year: z.number().int().min(2020).max(2100),
    action: z.enum(['APPROVE', 'REQUEST_CHANGES']),
    note: z.string().max(500).optional(),
  })
  .refine((v) => v.action !== 'REQUEST_CHANGES' || Boolean(v.note && v.note.trim()), {
    message: 'A note is required when requesting changes',
  });

// Worker feedback on a monthly report: a job comment, or a missing-shift report.
export const WorkerReportNoteSchema = z.object({
  month: z.number().int().min(1).max(12),
  year: z.number().int().min(2020).max(2100),
  shiftId: z.string().optional(),
  type: z.enum(['COMMENT', 'MISSING_SHIFT']),
  message: z.string().min(1).max(1000),
});

// ─── End-of-Shift Form ────────────────────────────────────────────────────────

export const FormAnswerSchema = z.object({
  questionId: z.string(),
  value: z.union([z.string(), z.number(), z.boolean(), z.array(z.string())]),
});

export const FormSubmissionSchema = z.object({
  shiftId: z.string(),
  completionStatus: z.enum(['COMPLETED', 'PARTIALLY_COMPLETED', 'NOT_COMPLETED']),
  answers: z.array(FormAnswerSchema),
  managerNote: z.string().optional(),
});

// ─── Invoice ──────────────────────────────────────────────────────────────────

export const InvoiceSchema = z.object({
  caseId: z.string(),
  customerId: z.string(),
  jobIds: z.array(z.string()),
  billableHours: z.number().optional(),
  hourlyRate: z.number().optional(),
  fixedPrice: z.number().optional(),
  additionalFees: z.number().optional(),
  discount: z.number().optional(),
  vatRate: z.number().optional(),
  dueDate: z.string().optional(),
  notes: z.string().optional(),
});

export const CreateInvoiceSchema = InvoiceSchema;
export const UpdateInvoiceSchema = InvoiceSchema.partial().omit({
  caseId: true,
  customerId: true,
});

// ─── Customer Payment ─────────────────────────────────────────────────────────

export const CustomerPaymentSchema = z.object({
  invoiceId: z.string(),
  amount: z.number().positive(),
  paymentDate: z.string(),
  method: z.enum(['BANK_TRANSFER', 'CASH', 'BIT', 'CHECK', 'OTHER']),
  reference: z.string().optional(),
  notes: z.string().optional(),
});

// ─── Worker ───────────────────────────────────────────────────────────────────

export const WorkerProfileSchema = z.object({
  firstName: z.string().min(1),
  lastName: z.string().optional().default(''),
  phone: z.string().min(9),
  email: z.string().email(),
  hourlyWage: z.number().min(0),
  dailyPaymentAmount: z.number().min(0),
  paymentMethod: z.enum(['BANK_TRANSFER', 'CASH', 'BIT', 'CHECK', 'OTHER']),
  skills: z.array(
    z.enum([
      'SHIFT_LEADER',
      'PACKING_SPECIALIST',
      'UNPACKING_SPECIALIST',
      'ORGANIZATION_SPECIALIST',
      'DRIVER',
      'GENERAL_WORKER',
    ])
  ),
  isActive: z.boolean().optional(),
  homeArea: z.string().optional(),
  notes: z.string().optional(),
  internalNotes: z.string().optional(),
});

export const CreateWorkerSchema = WorkerProfileSchema;
export const UpdateWorkerSchema = WorkerProfileSchema.partial();

// Fields a worker may edit on their own profile (contact details only).
export const UpdateWorkerProfileSchema = z
  .object({
    phone: z.string().min(9),
    email: z.string().email(),
    homeArea: z.string().max(100),
  })
  .partial();

// ─── Worker Adjustment ────────────────────────────────────────────────────────

export const WorkerAdjustmentSchema = z.object({
  workerId: z.string(),
  amount: z.number(),
  category: z.enum([
    'CUSTOMER_REFERRAL',
    'SHIFT_LEADER_BONUS',
    'SPECIAL_ASSIGNMENT_BONUS',
    'TRAVEL_REIMBURSEMENT',
    'EXTRA_RESPONSIBILITY',
    'CORRECTION',
    'DEDUCTION',
  ]),
  reason: z.string(),
  shiftId: z.string().optional(),
  caseId: z.string().optional(),
  payrollMonth: z.number().int().min(1).max(12),
  payrollYear: z.number().int(),
  isIncluded: z.boolean().optional(),
});

// ─── Worker Payment ───────────────────────────────────────────────────────────

export const WorkerPaymentSchema = z.object({
  workerId: z.string(),
  month: z.number().int().min(1).max(12),
  year: z.number().int(),
  amount: z.number().positive(),
  paymentDate: z.string(),
  method: z.enum(['BANK_TRANSFER', 'CASH', 'BIT', 'CHECK', 'OTHER']),
  reference: z.string().optional(),
  notes: z.string().optional(),
});

// ─── Business Expense ─────────────────────────────────────────────────────────

export const BusinessExpenseSchema = z.object({
  date: z.string(),
  amount: z.number().positive(),
  category: z.enum([
    'SOFTWARE',
    'MARKETING',
    'INSURANCE',
    'ACCOUNTANT',
    'OFFICE',
    'EQUIPMENT',
    'VEHICLE',
    'PARKING',
    'SUPPLIES',
    'OTHER',
  ]),
  vendor: z.string().optional(),
  notes: z.string().optional(),
  receiptUrl: z.string().optional(),
  month: z.number().int().min(1).max(12),
  year: z.number().int(),
});

// ─── Exported types ───────────────────────────────────────────────────────────

export type CreateCustomerInput = z.infer<typeof CreateCustomerSchema>;
export type UpdateCustomerInput = z.infer<typeof UpdateCustomerSchema>;
export type CreateAddressInput = z.infer<typeof CreateAddressSchema>;
export type CreateCaseInput = z.infer<typeof CreateCaseSchema>;
export type UpdateCaseInput = z.infer<typeof UpdateCaseSchema>;
export type CreateJobInput = z.infer<typeof CreateJobSchema>;
export type UpdateJobInput = z.infer<typeof UpdateJobSchema>;
export type JoinRequestInput = z.infer<typeof JoinRequestSchema>;
export type ClockInInput = z.infer<typeof ClockInSchema>;
export type ClockOutInput = z.infer<typeof ClockOutSchema>;
export type AttendanceCorrectionInput = z.infer<typeof AttendanceCorrectionSchema>;
export type ReplacementRequestInput = z.infer<typeof ReplacementRequestSchema>;
export type FormSubmissionInput = z.infer<typeof FormSubmissionSchema>;
export type CreateInvoiceInput = z.infer<typeof CreateInvoiceSchema>;
export type CustomerPaymentInput = z.infer<typeof CustomerPaymentSchema>;
export type CreateWorkerInput = z.infer<typeof CreateWorkerSchema>;
export type UpdateWorkerInput = z.infer<typeof UpdateWorkerSchema>;
export type WorkerAdjustmentInput = z.infer<typeof WorkerAdjustmentSchema>;
export type WorkerPaymentInput = z.infer<typeof WorkerPaymentSchema>;
export type BusinessExpenseInput = z.infer<typeof BusinessExpenseSchema>;

'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { useAuth } from '@clerk/nextjs';
import { AlertTriangle, ArrowRight, CheckCircle2, Clock, FileText, MessageSquare, Plus, RefreshCw, Send, Trash2, XCircle } from 'lucide-react';
import {
  estimateWorkerHours,
  getCurrentQuotationVersion,
  CASE_LIFECYCLE_STEPS,
  caseStatusTone,
  computePlanVariance,
  formatVariancePct,
  buildHoursComparison,
  computePackingFormSchedule,
  getCaseNextAction,
  getCaseStepIndex,
  getCaseStepState,
  computeFinalAmount,
  evaluateFinalReview,
  FINAL_REVIEW_REASON_LABELS,
  type FinalReviewReason,
  type CaseStatusValue,
  type HoursComparisonEntry,
  type QuotationStatus,
  type StatusTone,
} from '@workforce/shared';
import { api, authHeaders } from '../../../lib/api';
import { StatusBadge } from '../../../components/ui/StatusBadge';
import { AvailabilityFinder } from '../../../components/scheduling/AvailabilityFinder';
import { DateFinder } from '../../../components/scheduling/DateFinder';
import MultiDayScheduler from '../../../components/scheduling/MultiDayScheduler';
import {
  communicationChannelLabel,
  communicationTemplateTitle,
  type ProjectCommunicationChannel,
  type ProjectCommunicationLogEntry,
  type ProjectCommunicationTemplateKey,
} from '../../../lib/project-communications';

const COMMUNICATION_TEMPLATES: ProjectCommunicationTemplateKey[] = [
  'quote',
  'packing_form',
  'move_reminder',
  'completion_summary',
];

type ServiceType = 'PACKING' | 'UNPACKING' | 'HOME_ORGANIZATION';
type TimingPrecision =
  | 'EXACT_DATE'
  | 'MULTIPLE_EXACT_DATES'
  | 'DATE_RANGE'
  | 'EXPECTED_MONTH'
  | 'EXPECTED_YEAR'
  | 'UNKNOWN';

type ApiCaseShift = {
  id: string;
  approvedHours: number | string | null;
  actualStart: string | null;
  actualEnd: string | null;
};

type ApiCaseJob = {
  id: string;
  date: string;
  jobType: ServiceType;
  status: string;
  requiredWorkerCount: number;
  plannedStart?: string | null;
  plannedEnd?: string | null;
  shifts?: ApiCaseShift[];
  address?: { fullAddress: string } | null;
};

type ApiCaseDetail = {
  id: string;
  name: string;
  status: CaseStatusValue;
  internalNotes: string | null;
  customer: {
    id: string;
    firstName: string;
    lastName: string;
    phone: string;
    email: string;
    addresses?: Array<{ id: string; fullAddress: string }>;
  };
  jobs: ApiCaseJob[];
  invoices: Array<{ id: string; total: number | string; status: string }>;
};

type ApiPlannedService = {
  id: string;
  serviceType: ServiceType;
  timingPrecision: TimingPrecision;
  timingNote: string | null;
  estimatedWorkdays: number | null;
  workersPerDay: number | null;
  hoursPerDay: number | string | null;
  requiresManager: boolean;
  reservedManagerPositions: number;
};

type ApiQuotationVersion = {
  id: string;
  versionNumber: number;
  status: QuotationStatus;
  estimatedTotal: number | string;
  isAddendum: boolean;
};

type ApiQuotation = {
  id: string;
  status: QuotationStatus;
  versions: ApiQuotationVersion[];
};

type ApiQuotationPreview = {
  quotationId: string;
  caseName: string;
  versionNumber: number;
  status: QuotationStatus;
  estimatedTotal: number | string;
  includedServices: string[];
  datePrecision: string;
  timingNote: string | null;
  validUntil: string | null;
  datesFinal: boolean;
};

type FormCompletionStatus = 'COMPLETED' | 'PARTIALLY_COMPLETED' | 'NOT_COMPLETED';

type ApiCaseHubForm = {
  id: string;
  shiftId: string;
  completionStatus: FormCompletionStatus;
  submittedAt: string | null;
  managerNote: string | null;
  workerName: string;
  jobType: ServiceType;
  shiftDate: string;
};

type ApiCaseHub = {
  checklist: {
    totalJobs: number;
    completedOrCancelledJobs: number;
    totalShifts: number;
    closedShifts: number;
    linkedForms: number;
  };
  readyForFinalReport: boolean;
  forms: ApiCaseHubForm[];
};

const CASE_STATUS_LABELS: Record<CaseStatusValue, string> = {
  DRAFT: 'טיוטה',
  ACTIVE: 'פעיל',
  READY_FOR_REVIEW: 'לבדיקה',
  COMPLETED: 'הושלם',
  CANCELLED: 'בוטל',
  LEAD: 'ליד חדש',
  QUOTATION_DRAFT: 'בהכנת הצעת מחיר',
  AWAITING_APPROVAL: 'מחכה לאישור',
  RESERVED: 'משוריין',
  APPROVED_NO_DATES: 'מאושר – ללא תאריכים',
  PARTIALLY_SCHEDULED: 'תזמון חלקי',
  READY_FOR_EXECUTION: 'מאושר לביצוע',
  IN_PROGRESS: 'בביצוע',
  AWAITING_COMPLETION: 'מחכה להשלמות',
  AWAITING_BILLING: 'מחכה לחיוב',
  AWAITING_PAYMENT: 'מחכה לתשלום',
  PAID: 'שולם',
};

const SERVICE_LABELS: Record<ServiceType, string> = {
  PACKING: 'אריזה',
  UNPACKING: 'פריקה',
  HOME_ORGANIZATION: 'סידור',
};

// Default rate used to seed a first-quotation estimate from the planned scope
// (the creation wizard's default). The owner can edit before sending.
const DEFAULT_QUOTE_HOURLY_RATE = 175;

const TIMING_LABELS: Record<TimingPrecision, string> = {
  EXACT_DATE: 'תאריך מדויק',
  MULTIPLE_EXACT_DATES: 'מספר תאריכים',
  DATE_RANGE: 'טווח תאריכים',
  EXPECTED_MONTH: 'חודש משוער',
  EXPECTED_YEAR: 'שנה משוערת',
  UNKNOWN: 'טרם נקבע',
};

const QUOTATION_STATUS_LABELS: Record<QuotationStatus, string> = {
  DRAFT: 'טיוטה',
  SENT: 'נשלחה',
  APPROVED: 'מאושרת',
  REJECTED: 'נדחתה',
  EXPIRED: 'פג תוקף',
};

const DATE_PRECISION_PREVIEW: Record<string, string> = {
  EXACT: 'תאריכים מדויקים',
  PARTIAL: 'תאריכים חלקיים',
  EXPECTED_MONTH: 'חודש משוער',
  DATE_RANGE: 'טווח תאריכים',
  TO_BE_DETERMINED: 'טרם נקבעו',
};

const JOB_STATUS_LABELS: Record<string, string> = {
  DRAFT: 'טיוטה',
  PUBLISHED: 'פורסמה',
  IN_PROGRESS: 'בביצוע',
  COMPLETED: 'הושלמה',
  CANCELLED: 'בוטלה',
};

const FORM_COMPLETION_LABELS: Record<FormCompletionStatus, string> = {
  COMPLETED: 'הושלם',
  PARTIALLY_COMPLETED: 'הושלם חלקית',
  NOT_COMPLETED: 'לא הושלם',
};

const FORM_COMPLETION_TONE: Record<FormCompletionStatus, StatusTone> = {
  COMPLETED: 'success',
  PARTIALLY_COMPLETED: 'warning',
  NOT_COMPLETED: 'error',
};

function formatCurrency(value: number | string): string {
  const amount = typeof value === 'string' ? Number(value) : value;
  if (Number.isNaN(amount)) return '—';
  return `₪${amount.toLocaleString('he-IL', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
}

function formatDate(value: string | null | undefined): string {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleDateString('he-IL');
}

function roundHours(value: number): number {
  return Number.isInteger(value) ? value : Math.round(value * 10) / 10;
}

export default function ProjectDetailPage() {
  const params = useParams<{ id: string }>();
  const caseId = params?.id;
  const { getToken } = useAuth();

  const [tab, setTab] = useState<'overview' | 'quotations' | 'jobs' | 'activity' | 'forms' | 'pricing'>('overview');
  const [kase, setKase] = useState<ApiCaseDetail | null>(null);
  const [planned, setPlanned] = useState<ApiPlannedService[]>([]);
  const [quotations, setQuotations] = useState<ApiQuotation[]>([]);
  const [comms, setComms] = useState<ProjectCommunicationLogEntry[]>([]);
  const [hub, setHub] = useState<ApiCaseHub | null>(null);
  const [preview, setPreview] = useState<ApiQuotationPreview | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [newTotal, setNewTotal] = useState('');
  const [newServices, setNewServices] = useState('');

  const [approvalFor, setApprovalFor] = useState<string | null>(null);
  const [approvalMethod, setApprovalMethod] = useState('DIGITAL');
  const [approvalNotes, setApprovalNotes] = useState('');
  const [approvalAttachment, setApprovalAttachment] = useState('');
  const [shareMessage, setShareMessage] = useState('');

  const [plannedForm, setPlannedForm] = useState({
    serviceType: 'PACKING' as ServiceType,
    timingPrecision: 'UNKNOWN' as TimingPrecision,
    estimatedWorkdays: '',
    workersPerDay: '',
    hoursPerDay: '',
    requiresManager: false,
  });

  const load = useCallback(async () => {
    if (!caseId) return;
    setIsLoading(true);
    setError(null);
    try {
      const auth = await authHeaders(getToken);
      const [caseRes, plannedRes, quotesRes] = await Promise.all([
        api.get<ApiCaseDetail>(`/cases/${caseId}`, auth),
        api.get<ApiPlannedService[]>(`/planned-services?caseId=${caseId}`, auth),
        api.get<ApiQuotation[]>(`/quotations?caseId=${caseId}`, auth),
      ]);
      setKase(caseRes.data);
      setPlanned(plannedRes.data);
      setQuotations(quotesRes.data);
      try {
        const commsRes = await api.get<ProjectCommunicationLogEntry[]>(`/cases/${caseId}/communications`, auth);
        setComms(commsRes.data);
      } catch {
        setComms([]);
      }
      try {
        const hubRes = await api.get<ApiCaseHub>(`/cases/${caseId}/hub`, auth);
        setHub(hubRes.data);
      } catch {
        setHub(null);
      }
    } catch {
      setError('טעינת הפרוייקט נכשלה');
    } finally {
      setIsLoading(false);
    }
  }, [caseId, getToken]);

  useEffect(() => {
    void load();
  }, [load]);

  const runQuotationAction = useCallback(
    async (action: () => Promise<unknown>, failureMessage: string) => {
      setBusy(true);
      setError(null);
      try {
        await action();
        const auth = await authHeaders(getToken);
        const res = await api.get<ApiQuotation[]>(`/quotations?caseId=${caseId}`, auth);
        setQuotations(res.data);
      } catch {
        setError(failureMessage);
      } finally {
        setBusy(false);
      }
    },
    [caseId, getToken],
  );

  const createQuotationVersion = useCallback(
    (quotationId: string, isAddendum: boolean) =>
      runQuotationAction(async () => {
        const auth = await authHeaders(getToken);
        const preview = await api.get<ApiQuotationPreview>(`/quotations/${quotationId}/preview`, auth);
        await api.post(
          `/quotations/${quotationId}/versions`,
          {
            estimatedTotal: Number(preview.data.estimatedTotal),
            includedServices: preview.data.includedServices,
            datePrecision: preview.data.datePrecision,
            isAddendum,
          },
          auth,
        );
      }, isAddendum ? 'יצירת תוספת נכשלה' : 'יצירת גרסה חדשה נכשלה'),
    [getToken, runQuotationAction],
  );

  const copyQuotationLink = useCallback((quotationId: string) => {
    if (typeof window === 'undefined') return;
    const link = `${window.location.origin}/quotations/${quotationId}`;
    void navigator.clipboard?.writeText(link).then(
      () => setShareMessage('קישור השיתוף הועתק ללוח'),
      () => setShareMessage(link),
    );
  }, []);

  const submitApproval = useCallback(
    (quotationId: string) =>
      runQuotationAction(async () => {
        const auth = await authHeaders(getToken);
        await api.post(
          `/quotations/${quotationId}/approve`,
          {
            approvalMethod,
            approvalNotes: approvalNotes.trim() || undefined,
            approvalAttachmentUrl: approvalAttachment.trim() || undefined,
          },
          auth,
        );
        setApprovalFor(null);
        setApprovalNotes('');
        setApprovalAttachment('');
      }, 'תיעוד אישור הלקוח נכשל'),
    [getToken, runQuotationAction, approvalMethod, approvalNotes, approvalAttachment],
  );

  const handleCreateQuotation = useCallback(() => {
    const services = newServices
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean);
    if (!newTotal || services.length === 0) {
      setError('יש למלא סכום משוער ולפחות שירות אחד');
      return;
    }
    void runQuotationAction(async () => {
      const auth = await authHeaders(getToken);
      await api.post(
        '/quotations',
        { caseId, estimatedTotal: Number(newTotal), includedServices: services },
        auth,
      );
      setNewTotal('');
      setNewServices('');
    }, 'יצירת הצעת המחיר נכשלה');
  }, [newTotal, newServices, caseId, getToken, runQuotationAction]);

  const runPlannedAction = useCallback(
    async (action: () => Promise<unknown>, failureMessage: string) => {
      setBusy(true);
      setError(null);
      try {
        await action();
        const auth = await authHeaders(getToken);
        const res = await api.get<ApiPlannedService[]>(`/planned-services?caseId=${caseId}`, auth);
        setPlanned(res.data);
      } catch {
        setError(failureMessage);
      } finally {
        setBusy(false);
      }
    },
    [caseId, getToken],
  );

  const handleAddPlanned = useCallback(() => {
    void runPlannedAction(async () => {
      const auth = await authHeaders(getToken);
      await api.post(
        '/planned-services',
        {
          caseId,
          serviceType: plannedForm.serviceType,
          timingPrecision: plannedForm.timingPrecision,
          estimatedWorkdays: plannedForm.estimatedWorkdays ? Number(plannedForm.estimatedWorkdays) : undefined,
          workersPerDay: plannedForm.workersPerDay ? Number(plannedForm.workersPerDay) : undefined,
          hoursPerDay: plannedForm.hoursPerDay ? Number(plannedForm.hoursPerDay) : undefined,
          requiresManager: plannedForm.requiresManager,
        },
        auth,
      );
      setPlannedForm({
        serviceType: 'PACKING',
        timingPrecision: 'UNKNOWN',
        estimatedWorkdays: '',
        workersPerDay: '',
        hoursPerDay: '',
        requiresManager: false,
      });
    }, 'הוספת השירות המתוכנן נכשלה');
  }, [plannedForm, caseId, getToken, runPlannedAction]);

  const handleAddFromSelection = useCallback(
    (selection: 'PACKING' | 'UNPACKING' | 'ORGANIZATION' | 'MOVING') => {
      void runPlannedAction(async () => {
        const auth = await authHeaders(getToken);
        await api.post('/planned-services/from-selection', { caseId, selection }, auth);
      }, 'הוספת השירותים המתוכננים נכשלה');
    },
    [caseId, getToken, runPlannedAction],
  );

  const handleDeletePlanned = useCallback(
    (plannedId: string) => {
      if (
        typeof window !== 'undefined' &&
        !window.confirm('מחיקת השירות המתוכנן תסיר אותו מתכנון הפרויקט. להמשיך?')
      ) {
        return;
      }
      void runPlannedAction(async () => {
        const auth = await authHeaders(getToken);
        await api.delete(`/planned-services/${plannedId}`, auth);
      }, 'מחיקת השירות המתוכנן נכשלה');
    },
    [getToken, runPlannedAction],
  );

  const buildCommPreview = useCallback(
    (templateKey: ProjectCommunicationTemplateKey): string => {
      const name = kase ? `${kase.customer.firstName} ${kase.customer.lastName}`.trim() : '';
      const project = kase?.name ?? '';
      switch (templateKey) {
        case 'quote':
          return `הצעת מחיר עבור "${project}" נשלחה ל${name}`;
        case 'packing_form':
          return `טופס ציוד אריזה עבור "${project}"`;
        case 'move_reminder':
          return `תזכורת לפני מעבר — "${project}"`;
        default:
          return `סיכום וסגירת פרוייקט "${project}"`;
      }
    },
    [kase],
  );

  const handleSendComm = useCallback(
    (templateKey: ProjectCommunicationTemplateKey, channel: ProjectCommunicationChannel) => {
      if (!kase) return;
      const recipient = channel === 'whatsapp' ? kase.customer.phone : kase.customer.email;
      setBusy(true);
      setError(null);
      void (async () => {
        try {
          const auth = await authHeaders(getToken);
          await api.post(
            `/cases/${caseId}/communications`,
            { templateKey, channel, recipient, preview: buildCommPreview(templateKey) },
            auth,
          );
          const res = await api.get<ProjectCommunicationLogEntry[]>(`/cases/${caseId}/communications`, auth);
          setComms(res.data);
        } catch {
          setError('שליחת ההודעה נכשלה');
        } finally {
          setBusy(false);
        }
      })();
    },
    [kase, caseId, getToken, buildCommPreview],
  );

  const financials = useMemo(() => {
    const invoices = kase?.invoices ?? [];
    const invoiced = invoices.reduce((sum, inv) => sum + Number(inv.total || 0), 0);
    const paid = invoices
      .filter((inv) => inv.status === 'PAID')
      .reduce((sum, inv) => sum + Number(inv.total || 0), 0);
    return { invoiced, paid };
  }, [kase]);

  const nextJob = useMemo(() => {
    const jobs = kase?.jobs ?? [];
    if (jobs.length === 0) return null;
    return [...jobs].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())[0];
  }, [kase]);

  const comparison = useMemo(() => {
    const estimatedHours = planned.reduce(
      (sum, ps) =>
        sum +
        estimateWorkerHours({
          estimatedWorkdays: ps.estimatedWorkdays,
          workersPerDay: ps.workersPerDay,
          hoursPerDay: typeof ps.hoursPerDay === 'string' ? Number(ps.hoursPerDay) : ps.hoursPerDay,
        }),
      0,
    );
    const approvedQuoteTotal = quotations.reduce((sum, q) => {
      const current = getCurrentQuotationVersion(q.versions);
      return current && current.status === 'APPROVED' ? sum + Number(current.estimatedTotal || 0) : sum;
    }, 0);
    return { estimatedHours, approvedQuoteTotal };
  }, [planned, quotations]);

  // Seed the "new quotation" form once from the planned scope so the owner
  // isn't retyping the wizard's estimate. Only when no quotation exists yet and
  // the fields are still untouched.
  const quotePrefilled = useRef(false);
  useEffect(() => {
    if (quotePrefilled.current) return;
    if (quotations.length > 0 || planned.length === 0) return;
    if (newTotal !== '' || newServices !== '') return;
    quotePrefilled.current = true;
    const total = Math.round(comparison.estimatedHours * DEFAULT_QUOTE_HOURLY_RATE);
    if (total > 0) setNewTotal(String(total));
    const services = planned.map((ps) => SERVICE_LABELS[ps.serviceType]).filter(Boolean);
    if (services.length > 0) setNewServices(services.join('\n'));
  }, [planned, quotations, comparison.estimatedHours, newTotal, newServices]);

  const hoursComparison = useMemo(() => {
    const entries: HoursComparisonEntry[] = planned.map((ps) => ({
      serviceType: ps.serviceType,
      estimated: estimateWorkerHours({
        estimatedWorkdays: ps.estimatedWorkdays,
        workersPerDay: ps.workersPerDay,
        hoursPerDay: typeof ps.hoursPerDay === 'string' ? Number(ps.hoursPerDay) : ps.hoursPerDay,
      }),
    }));
    for (const job of kase?.jobs ?? []) {
      const durationHours =
        job.plannedStart && job.plannedEnd
          ? Math.max(0, (new Date(job.plannedEnd).getTime() - new Date(job.plannedStart).getTime()) / 3_600_000)
          : 0;
      let actual: number | null = null;
      for (const shift of job.shifts ?? []) {
        const approved = shift.approvedHours != null ? Number(shift.approvedHours) : null;
        const fromActual =
          shift.actualStart && shift.actualEnd
            ? Math.max(0, (new Date(shift.actualEnd).getTime() - new Date(shift.actualStart).getTime()) / 3_600_000)
            : null;
        const value = approved ?? fromActual;
        if (value != null) actual = (actual ?? 0) + value;
      }
      entries.push({
        serviceType: job.jobType,
        scheduled: job.requiredWorkerCount * durationHours,
        actual,
      });
    }
    return buildHoursComparison(entries);
  }, [planned, kase]);

  const finalReview = useMemo(() => {
    const reasons: FinalReviewReason[] = [];
    if (hoursComparison.totals.actual === null) reasons.push('ATTENDANCE_CORRECTION_PENDING');
    if (hub && !hub.readyForFinalReport) reasons.push('MISSING_FORM');
    return evaluateFinalReview(reasons);
  }, [hoursComparison, hub]);

  const customerFinalAmount = useMemo(
    () =>
      computeFinalAmount({
        quotationEstimate: comparison.approvedQuoteTotal,
        scheduledEstimate: comparison.approvedQuoteTotal,
        actualBillableHours: null,
        fixedFees: 0,
        supplies: 0,
        discounts: 0,
        hourlyRate: 0,
      }),
    [comparison],
  );

  const packingAutomation = useMemo(() => {
    const jobs = kase?.jobs ?? [];
    const packingJobs = jobs.filter((job) => job.jobType === 'PACKING');
    const firstPackingDate = packingJobs.length
      ? [...packingJobs].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())[0].date
      : null;
    const quotationApproved = quotations.some(
      (quotation) => getCurrentQuotationVersion(quotation.versions)?.status === 'APPROVED',
    );
    const alreadySent = comms.some((entry) => entry.templateKey === 'packing_form');
    return computePackingFormSchedule({
      firstPackingDate,
      quotationApproved,
      alreadySent,
      today: new Date().toISOString().slice(0, 10),
    });
  }, [kase, quotations, comms]);

  if (isLoading) {
    return (
      <div className="p-6 text-sm text-gray-500" dir="rtl">
        טוען…
      </div>
    );
  }

  if (!kase) {
    return (
      <div className="p-6" dir="rtl">
        <p className="text-sm text-gray-500">{error ?? 'הפרוייקט לא נמצא'}</p>
        <Link href="/cases/board" className="text-sm text-primary-600 mt-2 inline-block">
          חזרה ללוח הפרוייקטים
        </Link>
      </div>
    );
  }

  const nextAction = getCaseNextAction(kase.status);

  return (
    <div className="p-6" dir="rtl">
      <Link href="/cases/board" className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700 mb-3">
        <ArrowRight className="w-4 h-4" />
        לוח פרוייקטים
      </Link>

      <div className="flex items-start justify-between mb-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">{kase.name}</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            {kase.customer.firstName} {kase.customer.lastName} · {kase.customer.phone}
          </p>
        </div>
        <StatusBadge tone={caseStatusTone(kase.status)} label={CASE_STATUS_LABELS[kase.status]} />
      </div>

      {getCaseStepIndex(kase.status) !== -1 && (
        <nav aria-label="שלבי הפרוייקט" className="mb-5 overflow-x-auto">
          <ol className="flex items-center min-w-max">
            {CASE_LIFECYCLE_STEPS.map((step, i) => {
              const current = getCaseStepIndex(kase.status);
              const state = getCaseStepState(kase.status, i);
              return (
                <li key={step.key} className="flex items-center">
                  <div className="flex items-center gap-2">
                    <span
                      className={`flex items-center justify-center w-7 h-7 rounded-full text-xs font-semibold ${
                        state === 'complete'
                          ? 'bg-primary-600 text-white'
                          : state === 'current'
                            ? 'bg-primary-100 text-primary-700 ring-2 ring-primary-500'
                            : state === 'attention'
                              ? 'bg-warning-bg text-warning ring-2 ring-warning'
                              : state === 'blocked'
                                ? 'bg-danger-bg text-danger ring-2 ring-danger'
                                : 'bg-gray-100 text-gray-400'
                      }`}
                    >
                      {state === 'complete' ? (
                        <CheckCircle2 className="w-4 h-4" />
                      ) : state === 'attention' ? (
                        <AlertTriangle className="w-4 h-4" />
                      ) : (
                        i + 1
                      )}
                    </span>
                    <span
                      className={`text-xs whitespace-nowrap ${
                        state === 'not-started' ? 'text-gray-400' : 'text-gray-800 font-medium'
                      }`}
                    >
                      {step.label}
                    </span>
                  </div>
                  {i < CASE_LIFECYCLE_STEPS.length - 1 && (
                    <span className={`mx-2 h-px w-6 ${i < current ? 'bg-primary-500' : 'bg-gray-200'}`} />
                  )}
                </li>
              );
            })}
          </ol>
        </nav>
      )}

      {nextAction && (
        <div className="mb-5 rounded-xl border border-primary-200 bg-primary-50 p-4 flex items-center justify-between gap-3">
          <div>
            <p className="text-xs font-semibold text-primary-700">הפעולה הבאה</p>
            <p className="text-sm text-gray-900 mt-0.5">{nextAction.title}</p>
          </div>
          <button
            onClick={() => setTab(nextAction.tab)}
            className="inline-flex items-center gap-1.5 px-4 py-2 text-sm rounded-lg bg-primary-600 text-white hover:bg-primary-700 whitespace-nowrap"
          >
            {nextAction.cta}
          </button>
        </div>
      )}

      {error && (
        <div className="mb-4 rounded-lg bg-rose-50 border border-rose-200 text-rose-700 text-sm px-4 py-3">
          {error}
        </div>
      )}

      <div className="mb-5 flex items-center gap-2">
        <button
          role="tab"
          aria-selected={tab === 'overview'}
          onClick={() => setTab('overview')}
          className={`px-4 py-2 text-sm rounded-lg font-medium ${tab === 'overview' ? 'bg-primary-600 text-white' : 'bg-white border border-gray-200 text-gray-600 hover:bg-gray-50'}`}
        >
          סקירה
        </button>
        <button
          role="tab"
          aria-selected={tab === 'quotations'}
          onClick={() => setTab('quotations')}
          className={`px-4 py-2 text-sm rounded-lg font-medium ${tab === 'quotations' ? 'bg-primary-600 text-white' : 'bg-white border border-gray-200 text-gray-600 hover:bg-gray-50'}`}
        >
          הצעת מחיר
        </button>
        <button
          role="tab"
          aria-selected={tab === 'jobs'}
          onClick={() => setTab('jobs')}
          className={`px-4 py-2 text-sm rounded-lg font-medium ${tab === 'jobs' ? 'bg-primary-600 text-white' : 'bg-white border border-gray-200 text-gray-600 hover:bg-gray-50'}`}
        >
          עבודות
        </button>
        <button
          role="tab"
          aria-selected={tab === 'forms'}
          onClick={() => setTab('forms')}
          className={`px-4 py-2 text-sm rounded-lg font-medium ${tab === 'forms' ? 'bg-primary-600 text-white' : 'bg-white border border-gray-200 text-gray-600 hover:bg-gray-50'}`}
        >
          טפסים והודעות
        </button>
        <button
          role="tab"
          aria-selected={tab === 'pricing'}
          onClick={() => setTab('pricing')}
          className={`px-4 py-2 text-sm rounded-lg font-medium ${tab === 'pricing' ? 'bg-primary-600 text-white' : 'bg-white border border-gray-200 text-gray-600 hover:bg-gray-50'}`}
        >
          שעות ותמחור
        </button>
        <button
          role="tab"
          aria-selected={tab === 'activity'}
          onClick={() => setTab('activity')}
          className={`px-4 py-2 text-sm rounded-lg font-medium ${tab === 'activity' ? 'bg-primary-600 text-white' : 'bg-white border border-gray-200 text-gray-600 hover:bg-gray-50'}`}
        >
          פעילות
        </button>
        <button
          onClick={() => void load()}
          className="ms-auto inline-flex items-center gap-2 px-3 py-2 text-sm rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50"
        >
          <RefreshCw className="w-4 h-4" />
          רענון
        </button>
      </div>

      {tab === 'overview' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <section className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
            <h2 className="text-sm font-semibold text-gray-900 mb-3">שירותים מתוכננים</h2>
            {planned.length === 0 ? (
              <p className="text-sm text-gray-400">טרם הוגדרו שירותים מתוכננים</p>
            ) : (
              <ul className="space-y-2">
                {planned.map((service) => (
                  <li key={service.id} className="rounded-lg border border-gray-100 px-3 py-2">
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-medium text-gray-900">{SERVICE_LABELS[service.serviceType]}</span>
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-gray-500">{TIMING_LABELS[service.timingPrecision]}</span>
                        <button
                          onClick={() => handleDeletePlanned(service.id)}
                          disabled={busy}
                          aria-label={`מחיקת ${SERVICE_LABELS[service.serviceType]}`}
                          className="text-rose-500 hover:text-rose-700 disabled:opacity-50"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                    <p className="text-xs text-gray-500 mt-1">
                      {estimateWorkerHours({
                        estimatedWorkdays: service.estimatedWorkdays,
                        workersPerDay: service.workersPerDay,
                        hoursPerDay:
                          service.hoursPerDay === null ? null : Number(service.hoursPerDay),
                      })}{' '}
                      שעות עבודה משוערות
                      {service.requiresManager ? ' · דורש מנהל עבודה' : ''}
                    </p>
                  </li>
                ))}
              </ul>
            )}

            <div className="mt-4 pt-4 border-t border-gray-100">
              <div className="flex flex-wrap gap-2 mb-3">
                <span className="text-xs text-gray-500 self-center">הוספה מהירה:</span>
                {(
                  [
                    ['MOVING', 'מעבר דירה'],
                    ['PACKING', 'אריזה'],
                    ['UNPACKING', 'פריקה'],
                    ['ORGANIZATION', 'סידור'],
                  ] as const
                ).map(([selection, label]) => (
                  <button
                    key={selection}
                    onClick={() => handleAddFromSelection(selection)}
                    disabled={busy}
                    className="px-2.5 py-1 text-xs rounded-lg border border-gray-200 text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                  >
                    {label}
                  </button>
                ))}
              </div>
              <div className="grid grid-cols-2 gap-2">
                <select
                  aria-label="סוג שירות"
                  value={plannedForm.serviceType}
                  onChange={(event) =>
                    setPlannedForm((prev) => ({ ...prev, serviceType: event.target.value as ServiceType }))
                  }
                  className="rounded-lg border border-gray-200 px-2 py-1.5 text-xs"
                >
                  {(Object.keys(SERVICE_LABELS) as ServiceType[]).map((key) => (
                    <option key={key} value={key}>
                      {SERVICE_LABELS[key]}
                    </option>
                  ))}
                </select>
                <select
                  aria-label="דיוק תאריכים"
                  value={plannedForm.timingPrecision}
                  onChange={(event) =>
                    setPlannedForm((prev) => ({ ...prev, timingPrecision: event.target.value as TimingPrecision }))
                  }
                  className="rounded-lg border border-gray-200 px-2 py-1.5 text-xs"
                >
                  {(Object.keys(TIMING_LABELS) as TimingPrecision[]).map((key) => (
                    <option key={key} value={key}>
                      {TIMING_LABELS[key]}
                    </option>
                  ))}
                </select>
                <input
                  type="number"
                  min={0}
                  placeholder="ימי עבודה"
                  aria-label="ימי עבודה"
                  value={plannedForm.estimatedWorkdays}
                  onChange={(event) => setPlannedForm((prev) => ({ ...prev, estimatedWorkdays: event.target.value }))}
                  className="rounded-lg border border-gray-200 px-2 py-1.5 text-xs"
                />
                <input
                  type="number"
                  min={0}
                  placeholder="עובדים/יום"
                  aria-label="עובדים ליום"
                  value={plannedForm.workersPerDay}
                  onChange={(event) => setPlannedForm((prev) => ({ ...prev, workersPerDay: event.target.value }))}
                  className="rounded-lg border border-gray-200 px-2 py-1.5 text-xs"
                />
                <input
                  type="number"
                  min={0}
                  placeholder="שעות/יום"
                  aria-label="שעות ליום"
                  value={plannedForm.hoursPerDay}
                  onChange={(event) => setPlannedForm((prev) => ({ ...prev, hoursPerDay: event.target.value }))}
                  className="rounded-lg border border-gray-200 px-2 py-1.5 text-xs"
                />
                <label className="flex items-center gap-1.5 text-xs text-gray-600">
                  <input
                    type="checkbox"
                    checked={plannedForm.requiresManager}
                    onChange={(event) => setPlannedForm((prev) => ({ ...prev, requiresManager: event.target.checked }))}
                  />
                  דורש מנהל עבודה
                </label>
              </div>
              <button
                onClick={handleAddPlanned}
                disabled={busy}
                className="mt-2 inline-flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg bg-primary-600 text-white hover:bg-primary-700 disabled:opacity-50"
              >
                <Plus className="w-3.5 h-3.5" />
                הוסף שירות מתוכנן
              </button>
            </div>
          </section>

          <section className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
            <h2 className="text-sm font-semibold text-gray-900 mb-3">עבודות ותמחור</h2>
            <dl className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm">
              <div>
                <dt className="text-gray-500">מספר עבודות</dt>
                <dd className="text-gray-900 font-semibold">{kase.jobs.length}</dd>
              </div>
              <div>
                <dt className="text-gray-500">עבודה קרובה</dt>
                <dd className="text-gray-900">{nextJob ? formatDate(nextJob.date) : '—'}</dd>
              </div>
              <div>
                <dt className="text-gray-500">חויב</dt>
                <dd className="text-gray-900">{formatCurrency(financials.invoiced)}</dd>
              </div>
              <div>
                <dt className="text-gray-500">שולם</dt>
                <dd className="text-gray-900">{formatCurrency(financials.paid)}</dd>
              </div>
            </dl>
            {kase.jobs.length > 0 && (
              <ul className="mt-3 space-y-1">
                {kase.jobs.slice(0, 5).map((job) => (
                  <li key={job.id} className="text-xs text-gray-500 flex items-center justify-between">
                    <span>
                      {SERVICE_LABELS[job.jobType]} · {formatDate(job.date)}
                    </span>
                    <span>{job.requiredWorkerCount} עובדים</span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      )}

      {tab === 'pricing' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <section className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm lg:col-span-2">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-semibold text-gray-900">סיכום תמחור ללקוח</h2>
              <StatusBadge tone={finalReview.tone} label={finalReview.label} />
            </div>
            <dl className="grid grid-cols-2 md:grid-cols-3 gap-3 text-sm">
              <div>
                <dt className="text-xs text-gray-500">הערכת הצעת מחיר</dt>
                <dd className="text-gray-900 font-medium">{formatCurrency(comparison.approvedQuoteTotal)}</dd>
              </div>
              <div>
                <dt className="text-xs text-gray-500">שעות מתוזמנות</dt>
                <dd className="text-gray-900 font-medium">{roundHours(hoursComparison.totals.scheduled)}</dd>
              </div>
              <div>
                <dt className="text-xs text-gray-500">שעות בפועל לחיוב</dt>
                <dd className="text-gray-900 font-medium">
                  {hoursComparison.totals.actual === null ? '—' : roundHours(hoursComparison.totals.actual)}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-gray-500">עמלות קבועות</dt>
                <dd className="text-gray-400">—</dd>
              </div>
              <div>
                <dt className="text-xs text-gray-500">חומרים</dt>
                <dd className="text-gray-400">—</dd>
              </div>
              <div>
                <dt className="text-xs text-gray-500">הנחות</dt>
                <dd className="text-gray-400">—</dd>
              </div>
            </dl>
            <div className="mt-3 flex items-center justify-between border-t border-gray-100 pt-3">
              <span className="text-sm text-gray-600">סכום סופי</span>
              <span className="text-lg font-bold text-gray-900">{formatCurrency(customerFinalAmount)}</span>
            </div>
            {finalReview.requiresReview && (
              <div className="mt-3 rounded-lg border border-warning/40 bg-warning-bg p-3">
                <p className="text-xs font-semibold text-warning mb-1">{finalReview.label}</p>
                <ul className="text-xs text-gray-700 list-disc pe-4 space-y-0.5">
                  {finalReview.reasons.map((reason) => (
                    <li key={reason}>{FINAL_REVIEW_REASON_LABELS[reason]}</li>
                  ))}
                </ul>
                <button
                  type="button"
                  onClick={() => setTab('activity')}
                  className="mt-2 inline-flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg bg-primary-600 text-white hover:bg-primary-700"
                >
                  בדיקת הסכום הסופי
                </button>
              </div>
            )}
          </section>
          <section className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
            <h2 className="text-sm font-semibold text-gray-900 mb-3">השוואת שעות עבודה</h2>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-xs text-gray-500 border-b border-gray-100">
                    <th className="text-right font-medium py-2">שירות</th>
                    <th className="text-right font-medium py-2">משוער</th>
                    <th className="text-right font-medium py-2">מתוזמן</th>
                    <th className="text-right font-medium py-2">בפועל</th>
                  </tr>
                </thead>
                <tbody>
                  {hoursComparison.rows.length === 0 ? (
                    <tr>
                      <td colSpan={4} className="py-3 text-gray-400">אין נתוני שעות לפרוייקט זה</td>
                    </tr>
                  ) : (
                    hoursComparison.rows.map((row) => (
                      <tr key={row.serviceType} className="border-b border-gray-50">
                        <td className="py-2 text-gray-700">{SERVICE_LABELS[row.serviceType as ServiceType] ?? row.serviceType}</td>
                        <td className="py-2 text-gray-900">{roundHours(row.estimated)}</td>
                        <td className="py-2 text-gray-900">{roundHours(row.scheduled)}</td>
                        <td className="py-2 text-gray-900">{row.actual === null ? '—' : roundHours(row.actual)}</td>
                      </tr>
                    ))
                  )}
                </tbody>
                {hoursComparison.rows.length > 0 && (
                  <tfoot>
                    <tr className="font-semibold text-gray-900">
                      <td className="py-2">סה״כ</td>
                      <td className="py-2">{roundHours(hoursComparison.totals.estimated)}</td>
                      <td className="py-2">{roundHours(hoursComparison.totals.scheduled)}</td>
                      <td className="py-2">{hoursComparison.totals.actual === null ? '—' : roundHours(hoursComparison.totals.actual)}</td>
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
          </section>

          <section className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
            <h2 className="text-sm font-semibold text-gray-900 mb-3">השוואת תכנון מול ביצוע</h2>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-xs text-gray-500 border-b border-gray-100">
                    <th className="text-right font-medium py-2">מדד</th>
                    <th className="text-right font-medium py-2">מתוכנן</th>
                    <th className="text-right font-medium py-2">בפועל</th>
                    <th className="text-right font-medium py-2">פער</th>
                  </tr>
                </thead>
                <tbody>
                  {[
                    {
                      key: 'billing',
                      label: 'חיוב מול הצעה מאושרת',
                      baseline: comparison.approvedQuoteTotal,
                      actual: financials.invoiced,
                    },
                    {
                      key: 'payment',
                      label: 'תשלום מול חיוב',
                      baseline: financials.invoiced,
                      actual: financials.paid,
                    },
                  ].map((row) => {
                    const variance = computePlanVariance(row.baseline, row.actual);
                    return (
                      <tr key={row.key} className="border-b border-gray-50 last:border-0">
                        <td className="py-2 text-gray-700">{row.label}</td>
                        <td className="py-2 text-gray-900">{formatCurrency(row.baseline)}</td>
                        <td className="py-2 text-gray-900">{formatCurrency(row.actual)}</td>
                        <td className="py-2">
                          <StatusBadge tone={variance.tone} label={formatVariancePct(variance)} />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <p className="mt-3 text-xs text-gray-500">
              שעות עבודה משוערות מהתכנון:{' '}
              <span className="font-semibold text-gray-800">{comparison.estimatedHours}</span>
            </p>
          </section>
        </div>
      )}

      {tab === 'quotations' && (
        <div className="space-y-5">
          {shareMessage && (
            <div className="rounded-lg border border-primary-200 bg-primary-50 px-3 py-2 text-xs text-primary-700">
              {shareMessage}
            </div>
          )}
          <section className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
            <h2 className="text-sm font-semibold text-gray-900 mb-3">הצעת מחיר חדשה</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <label className="text-sm">
                <span className="text-gray-600">סכום משוער (₪)</span>
                <input
                  type="number"
                  min={0}
                  value={newTotal}
                  onChange={(event) => setNewTotal(event.target.value)}
                  className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2"
                />
              </label>
              <label className="text-sm md:col-span-2">
                <span className="text-gray-600">שירותים כלולים (שורה לכל שירות)</span>
                <textarea
                  rows={2}
                  value={newServices}
                  onChange={(event) => setNewServices(event.target.value)}
                  className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2"
                  placeholder={'אריזת דירה 4 חדרים\nפריקה וסידור'}
                />
              </label>
            </div>
            <button
              onClick={handleCreateQuotation}
              disabled={busy}
              className="mt-3 inline-flex items-center gap-1.5 px-4 py-2 text-sm rounded-lg bg-primary-600 text-white hover:bg-primary-700 disabled:opacity-50"
            >
              <Plus className="w-4 h-4" />
              צור הצעת מחיר
            </button>
          </section>

          {quotations.length === 0 ? (
            <div className="rounded-lg border border-dashed border-gray-200 px-4 py-6 text-center">
              <p className="text-sm font-medium text-gray-700">עדיין לא הוכנה הצעת מחיר</p>
              <p className="mt-1 text-xs text-gray-500">הצעת המחיר תתבסס על היקף העבודה המשוער של הפרויקט.</p>
            </div>
          ) : (
            <ul className="space-y-3">
              {quotations.map((quotation) => {
                const current = getCurrentQuotationVersion(quotation.versions);
                const isApproved = current?.status === 'APPROVED';
                return (
                  <li key={quotation.id} className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
                    <div className="flex items-center justify-between">
                      <div>
                        <span className="text-sm font-semibold text-gray-900">
                          גרסה {current?.versionNumber ?? 1}
                          {current?.isAddendum ? ' · תוספת' : ''}
                        </span>
                        <span className="ms-2 text-xs px-2 py-0.5 rounded-full bg-gray-100 text-gray-700">
                          {QUOTATION_STATUS_LABELS[quotation.status]}
                        </span>
                      </div>
                      <span className="text-sm font-semibold text-gray-900">
                        {current ? formatCurrency(current.estimatedTotal) : '—'}
                      </span>
                    </div>
                    <div className="mt-3 flex flex-wrap items-center gap-2">
                      <button
                        onClick={() => {
                          void (async () => {
                            try {
                              const auth = await authHeaders(getToken);
                              const res = await api.get<ApiQuotationPreview>(`/quotations/${quotation.id}/preview`, auth);
                              setPreview(res.data);
                            } catch {
                              setError('טעינת התצוגה המקדימה נכשלה');
                            }
                          })();
                        }}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg border border-gray-200 text-gray-700 hover:bg-gray-50"
                      >
                        <FileText className="w-3.5 h-3.5" />
                        תצוגה מקדימה
                      </button>
                      <button
                        onClick={() =>
                          void runQuotationAction(async () => {
                            const auth = await authHeaders(getToken);
                            await api.post(`/quotations/${quotation.id}/send`, { channel: 'WHATSAPP', recipient: kase.customer.phone }, auth);
                          }, 'רישום שליחת הצעת המחיר נכשל')
                        }
                        disabled={busy || isApproved}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg border border-gray-200 text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                      >
                        <Send className="w-3.5 h-3.5" />
                        שלח בוואטסאפ
                      </button>
                      <button
                        onClick={() =>
                          void runQuotationAction(async () => {
                            const auth = await authHeaders(getToken);
                            await api.post(`/quotations/${quotation.id}/send`, { channel: 'EMAIL', recipient: kase.customer.email }, auth);
                          }, 'רישום שליחת הצעת המחיר נכשל')
                        }
                        disabled={busy || isApproved}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg border border-gray-200 text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                      >
                        <Send className="w-3.5 h-3.5" />
                        שלח באימייל
                      </button>
                      <button
                        onClick={() => {
                          setApprovalFor(quotation.id);
                          setApprovalMethod('DIGITAL');
                          setApprovalNotes('');
                          setApprovalAttachment('');
                        }}
                        disabled={busy || isApproved}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-50"
                      >
                        <CheckCircle2 className="w-3.5 h-3.5" />
                        תיעוד אישור לקוח
                      </button>
                      <button
                        onClick={() => {
                          if (
                            typeof window !== 'undefined' &&
                            !window.confirm('סימון ההצעה כנדחתה יסגור אותה. להמשיך?')
                          ) {
                            return;
                          }
                          void runQuotationAction(async () => {
                            const auth = await authHeaders(getToken);
                            await api.post(`/quotations/${quotation.id}/reject`, {}, auth);
                          }, 'סימון הצעת המחיר כנדחתה נכשל');
                        }}
                        disabled={busy || isApproved}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg border border-rose-200 text-rose-700 hover:bg-rose-50 disabled:opacity-50"
                      >
                        <XCircle className="w-3.5 h-3.5" />
                        סמן כנדחתה
                      </button>
                      <button
                        onClick={() =>
                          void runQuotationAction(async () => {
                            const auth = await authHeaders(getToken);
                            await api.post(`/quotations/${quotation.id}/expire`, {}, auth);
                          }, 'סימון פג תוקף נכשל')
                        }
                        disabled={busy || isApproved}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg border border-amber-200 text-amber-700 hover:bg-amber-50 disabled:opacity-50"
                      >
                        <Clock className="w-3.5 h-3.5" />
                        סמן כפג תוקף
                      </button>
                      <button
                        onClick={() => void createQuotationVersion(quotation.id, false)}
                        disabled={busy}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg border border-gray-200 text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                      >
                        <Plus className="w-3.5 h-3.5" />
                        גרסה חדשה
                      </button>
                      <button
                        onClick={() => void createQuotationVersion(quotation.id, true)}
                        disabled={busy}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg border border-gray-200 text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                      >
                        <Plus className="w-3.5 h-3.5" />
                        תוספת להצעה
                      </button>
                      <button
                        onClick={() => copyQuotationLink(quotation.id)}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg border border-gray-200 text-gray-700 hover:bg-gray-50"
                      >
                        <FileText className="w-3.5 h-3.5" />
                        העתקת קישור
                      </button>
                      <span className="ms-auto inline-flex items-center gap-1 text-[11px] text-gray-400">
                        <FileText className="w-3.5 h-3.5" />
                        {quotation.versions.length} גרסאות
                      </span>
                    </div>
                    {approvalFor === quotation.id && (
                      <div className="mt-3 rounded-lg border border-emerald-200 bg-emerald-50 p-3 space-y-2">
                        <p className="text-xs font-semibold text-emerald-800">תיעוד אישור לקוח</p>
                        <label className="block text-xs text-gray-700">
                          <span className="block mb-1">אופן האישור</span>
                          <select
                            value={approvalMethod}
                            onChange={(e) => setApprovalMethod(e.target.value)}
                            className="w-full rounded-md border border-gray-300 px-2.5 py-1.5 text-xs bg-white"
                          >
                            <option value="DIGITAL">אישור דיגיטלי</option>
                            <option value="SIGNED">מסמך חתום</option>
                            <option value="WHATSAPP">וואטסאפ</option>
                            <option value="EMAIL">אימייל</option>
                            <option value="VERBAL">אישור טלפוני/בעל פה</option>
                            <option value="MANUAL">הזנה ידנית</option>
                          </select>
                        </label>
                        <textarea
                          value={approvalNotes}
                          onChange={(e) => setApprovalNotes(e.target.value)}
                          placeholder="הערות (אופציונלי)"
                          className="w-full rounded-md border border-gray-300 px-2.5 py-1.5 text-xs min-h-[60px]"
                        />
                        <input
                          value={approvalAttachment}
                          onChange={(e) => setApprovalAttachment(e.target.value)}
                          placeholder="קישור לצילום מסך / מסמך (אופציונלי)"
                          className="w-full rounded-md border border-gray-300 px-2.5 py-1.5 text-xs"
                        />
                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => void submitApproval(quotation.id)}
                            disabled={busy}
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-50"
                          >
                            <CheckCircle2 className="w-3.5 h-3.5" />
                            שמירת האישור
                          </button>
                          <button
                            onClick={() => setApprovalFor(null)}
                            className="px-3 py-1.5 text-xs rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50"
                          >
                            ביטול
                          </button>
                        </div>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}

      {tab === 'jobs' && (
        <div className="space-y-5">
        <section className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
          <h2 className="text-sm font-semibold text-gray-900 mb-3">עבודות הפרוייקט</h2>
          {kase.jobs.length === 0 ? (
            <div className="rounded-lg border border-dashed border-gray-200 px-4 py-6 text-center">
              <p className="text-sm font-medium text-gray-700">עדיין לא נקבעו עבודות לפרויקט</p>
              <p className="mt-1 text-xs text-gray-500">אפשר לשלוח ולאשר הצעת מחיר גם לפני שהתאריכים ידועים.</p>
            </div>
          ) : (
            <ul className="divide-y divide-gray-100">
              {[...kase.jobs]
                .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())
                .map((job) => (
                  <li key={job.id} className="py-3">
                    <Link href={`/jobs/${job.id}`} className="flex items-center justify-between hover:bg-gray-50 rounded-lg px-2 -mx-2">
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium text-gray-900">{SERVICE_LABELS[job.jobType]}</span>
                          <span className="text-[11px] px-2 py-0.5 rounded-full bg-gray-100 text-gray-700">
                            {JOB_STATUS_LABELS[job.status] ?? job.status}
                          </span>
                        </div>
                        <p className="text-xs text-gray-500 mt-0.5">
                          {formatDate(job.date)} · {job.address?.fullAddress ?? 'כתובת לא זמינה'}
                        </p>
                      </div>
                      <span className="text-xs text-gray-500">{job.requiredWorkerCount} עובדים</span>
                    </Link>
                  </li>
                ))}
            </ul>
          )}
        </section>
          <MultiDayScheduler
            caseId={kase.id}
            customerId={kase.customer.id}
            addresses={kase.customer.addresses ?? []}
            getToken={getToken}
            onCreated={load}
          />
          <AvailabilityFinder defaultDate={nextJob ? nextJob.date.slice(0, 10) : ''} />
          <DateFinder defaultStart={nextJob ? nextJob.date.slice(0, 10) : ''} />
        </div>
      )}

      {tab === 'activity' && (
        <div className="space-y-5">
          <section className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
            <h2 className="text-sm font-semibold text-gray-900 mb-3">שליחות מתוזמנות</h2>
            <div className="flex items-center justify-between rounded-lg border border-gray-100 px-3 py-2">
              <div>
                <p className="text-sm text-gray-800">טופס ציוד לאריזה</p>
                <p className="text-[11px] text-gray-500 mt-0.5">נשלח אוטומטית 7 ימים לפני יום האריזה הראשון</p>
              </div>
              <StatusBadge
                tone={
                  packingAutomation.state === 'already_sent'
                    ? 'success'
                    : packingAutomation.state === 'due_now'
                      ? 'warning'
                      : packingAutomation.state === 'scheduled'
                        ? 'info'
                        : 'neutral'
                }
                label={
                  packingAutomation.state === 'already_sent'
                    ? 'נשלח'
                    : packingAutomation.state === 'due_now'
                      ? 'מוכן לשליחה עכשיו'
                      : packingAutomation.state === 'scheduled'
                        ? `מתוזמן לשליחה ב-${formatDate(packingAutomation.sendDate)}`
                        : packingAutomation.state === 'awaiting_approval'
                          ? 'ממתין לאישור הצעת מחיר'
                          : 'ממתין לקביעת תאריך אריזה'
                }
              />
            </div>
          </section>

          <section className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
            <h2 className="text-sm font-semibold text-gray-900 mb-3">שליחת הודעה ללקוח</h2>
            <ul className="space-y-2">
              {COMMUNICATION_TEMPLATES.map((templateKey) => (
                <li
                  key={templateKey}
                  className="flex items-center justify-between rounded-lg border border-gray-100 px-3 py-2"
                >
                  <span className="text-sm text-gray-800">{communicationTemplateTitle(templateKey)}</span>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => handleSendComm(templateKey, 'whatsapp')}
                      disabled={busy}
                      className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs rounded-lg border border-gray-200 text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                    >
                      <Send className="w-3.5 h-3.5" />
                      וואטסאפ
                    </button>
                    <button
                      onClick={() => handleSendComm(templateKey, 'email')}
                      disabled={busy}
                      className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs rounded-lg border border-gray-200 text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                    >
                      <Send className="w-3.5 h-3.5" />
                      אימייל
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          </section>

          <section className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
            <h2 className="text-sm font-semibold text-gray-900 mb-3">ציר תקשורת</h2>
            {comms.length === 0 ? (
              <p className="text-sm text-gray-400">טרם נשלחו הודעות בפרוייקט זה</p>
            ) : (
              <ul className="space-y-2">
                {comms.map((entry) => (
                  <li key={entry.id} className="rounded-lg border border-gray-100 px-3 py-2">
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-medium text-gray-900">
                        {communicationTemplateTitle(entry.templateKey)}
                      </span>
                      <span className="inline-flex items-center gap-1 text-[11px] text-gray-400">
                        <Clock className="w-3.5 h-3.5" />
                        {formatDate(entry.sentAt)}
                      </span>
                    </div>
                    <p className="mt-1 text-xs text-gray-500">{entry.preview}</p>
                    <p className="mt-1 inline-flex items-center gap-1 text-[11px] text-gray-400">
                      <MessageSquare className="w-3 h-3" />
                      {communicationChannelLabel(entry.channel)} · {entry.recipient}
                      {entry.performedByName ? ` · ${entry.performedByName}` : ''}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      )}

      {tab === 'forms' && (
        <div className="space-y-5">
          <section className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-semibold text-gray-900">מוכנות טפסים ודוחות</h2>
              <StatusBadge
                tone={hub?.readyForFinalReport ? 'success' : 'warning'}
                label={hub?.readyForFinalReport ? 'מוכן לדוח מסכם' : 'ממתין להשלמות'}
              />
            </div>
            {!hub ? (
              <p className="text-sm text-gray-400">אין נתוני טפסים לפרוייקט זה</p>
            ) : (
              <dl className="grid grid-cols-3 gap-x-6 gap-y-3 text-sm">
                <div>
                  <dt className="text-gray-500">עבודות שהושלמו</dt>
                  <dd className="text-gray-900 font-semibold">
                    {hub.checklist.completedOrCancelledJobs}/{hub.checklist.totalJobs}
                  </dd>
                </div>
                <div>
                  <dt className="text-gray-500">משמרות סגורות</dt>
                  <dd className="text-gray-900 font-semibold">
                    {hub.checklist.closedShifts}/{hub.checklist.totalShifts}
                  </dd>
                </div>
                <div>
                  <dt className="text-gray-500">טפסים שהוגשו</dt>
                  <dd className="text-gray-900 font-semibold">{hub.checklist.linkedForms}</dd>
                </div>
              </dl>
            )}
          </section>

          <section className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
            <h2 className="text-sm font-semibold text-gray-900 mb-3">טפסי עובדים</h2>
            {!hub || hub.forms.length === 0 ? (
              <p className="text-sm text-gray-400">טרם הוגשו טפסים בפרוייקט זה</p>
            ) : (
              <ul className="space-y-2">
                {hub.forms.map((form) => (
                  <li key={form.id} className="rounded-lg border border-gray-100 px-3 py-2">
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-medium text-gray-900">{form.workerName}</span>
                      <StatusBadge
                        tone={FORM_COMPLETION_TONE[form.completionStatus]}
                        label={FORM_COMPLETION_LABELS[form.completionStatus]}
                      />
                    </div>
                    <p className="mt-1 inline-flex items-center gap-1 text-[11px] text-gray-400">
                      <FileText className="w-3 h-3" />
                      {SERVICE_LABELS[form.jobType]} · {formatDate(form.shiftDate)}
                      {form.submittedAt ? ` · הוגש ${formatDate(form.submittedAt)}` : ''}
                    </p>
                    {form.managerNote ? (
                      <p className="mt-1 text-xs text-gray-500">הערת מנהל: {form.managerNote}</p>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      )}

      {preview && (
        <div
          className="fixed inset-0 z-50 bg-black/30 flex items-center justify-center p-4"
          onClick={() => setPreview(null)}
        >
          <div
            className="w-full max-w-md rounded-xl bg-white shadow-xl p-5"
            onClick={(event) => event.stopPropagation()}
            dir="rtl"
          >
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-base font-bold text-gray-900">תצוגה מקדימה — הצעת מחיר</h3>
              <button onClick={() => setPreview(null)} aria-label="סגירת התצוגה המקדימה" className="text-gray-400 hover:text-gray-600">
                <XCircle className="w-5 h-5" />
              </button>
            </div>
            <p className="text-sm text-gray-700">
              {preview.caseName} · גרסה {preview.versionNumber}
            </p>
            <p className="mt-2 text-lg font-bold text-gray-900">{formatCurrency(preview.estimatedTotal)}</p>
            {preview.includedServices.length > 0 && (
              <ul className="mt-2 text-sm text-gray-600 list-disc pr-5 space-y-0.5">
                {preview.includedServices.map((service, index) => (
                  <li key={index}>{service}</li>
                ))}
              </ul>
            )}
            <p className="mt-3 text-xs text-gray-500">
              דיוק תאריכים: {DATE_PRECISION_PREVIEW[preview.datePrecision] ?? preview.datePrecision}
            </p>
            {!preview.datesFinal && (
              <p className="mt-1 text-xs text-amber-700">המועדים המדויקים יתואמו בהמשך ובהתאם לזמינות.</p>
            )}
            {preview.validUntil && (
              <p className="mt-1 text-xs text-gray-500">בתוקף עד: {formatDate(preview.validUntil)}</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  CalendarClock,
  CheckCircle2,
  CircleDashed,
  Eye,
  FileText,
  FolderKanban,
  MapPin,
  Pencil,
  Plus,
  RotateCcw,
  Search,
  Trash2,
  Users,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { useAuth } from '@clerk/nextjs';
import type { EndShiftFormLink } from '../../lib/case-hub';
import { ensureCustomerFullName, importedWorkSeeds, shortDateToDateKey, shortDateToDisplayDate } from '../../lib/work-data';
import { showDevFeatureNotice } from '../../lib/dev-feature';
import { api } from '../../lib/api';
import { authHeaders } from '../../lib/api';
import { canViewSensitiveFinancials } from '../../lib/viewer-access';
import { useViewerRole } from '../../lib/use-viewer-role';
import {
  buildProjectCommunicationTemplates,
  communicationChannelLabel,
  communicationTemplateTitle,
  type ProjectCommunicationChannel,
  type ProjectCommunicationLogEntry,
  type ProjectCommunicationTemplateKey,
} from '../../lib/project-communications';

type CaseStatus = 'DRAFT' | 'ACTIVE' | 'READY_FOR_REVIEW' | 'COMPLETED';
type CaseJobStatus = 'מתוכנן' | 'בביצוע' | 'בוצע';
type ReportStatus = 'לא מוכן' | 'מוכן' | 'נשלח';
type QuoteStatus = {
  hourlyRate: number;
  estimatedHours: number;
  sentByEmail: boolean;
  approved: boolean;
};

type CaseJob = {
  id: string;
  date: string;
  type: 'אריזה' | 'פריקה' | 'סידור';
  address: string;
  workers: number;
  status: CaseJobStatus;
};

type CustomerCase = {
  id: string;
  customerName: string;
  customerPhone: string;
  customerEmail: string;
  caseName: string;
  status: CaseStatus;
  isArchived: boolean;
  startDate: string;
  latestActivityDate: string;
  assignedManager: string;
  internalNotes: string;
  addresses: string[];
  jobs: CaseJob[];
  finalReportStatus: ReportStatus;
  customerReportStatus: ReportStatus;
  lastShiftClockedOut: boolean;
  finalReportNotificationSent: boolean;
  customerFinalReportSentAt?: string;
  invoicedTotal: number;
  paidTotal: number;
  quote: QuoteStatus;
};

type ApiCaseListItem = {
  id: string;
  name: string;
  status: 'DRAFT' | 'ACTIVE' | 'READY_FOR_REVIEW' | 'COMPLETED' | 'CANCELLED';
  derivedStatus?: 'EMPTY' | 'RESERVATION' | 'PARTIALLY_APPROVED' | 'APPROVED' | 'IN_PROGRESS' | 'COMPLETED';
  startDate: string | null;
  latestActivityDate: string | null;
  updatedAt: string;
  customer: { firstName: string; lastName: string; phone: string; email: string };
  assignedAdmin: { firstName: string; lastName: string } | null;
  jobs: Array<{
    id: string;
    date: string;
    status: 'RESERVATION' | 'APPROVED' | 'COMPLETED' | 'ARCHIVED';
    jobType: 'PACKING' | 'UNPACKING' | 'HOME_ORGANIZATION';
    requiredWorkerCount: number;
    address: { fullAddress: string };
  }>;
};

type ApiCaseHubForm = {
  id: string;
  completionStatus: 'COMPLETED' | 'PARTIALLY_COMPLETED' | 'NOT_COMPLETED';
  submittedAt: string;
  managerNote: string | null;
  workerName: string;
  jobType: 'PACKING' | 'UNPACKING' | 'HOME_ORGANIZATION';
  shiftDate: string;
};

type ApiCaseHub = {
  caseId: string;
  readyForFinalReport: boolean;
  checklist: {
    totalJobs: number;
    completedOrCancelledJobs: number;
    totalShifts: number;
    closedShifts: number;
    linkedForms: number;
  };
  forms: ApiCaseHubForm[];
};

type ApiCustomer = {
  id: string;
  firstName: string;
  lastName: string;
  phone: string;
  email: string;
};

type DeletedCaseHistoryEntry = {
  id: string;
  customerName: string;
  caseName: string;
  deletedAt: string;
  reason: string;
  notApprovedAtDeletion: boolean;
};

type CasesFilter = 'all' | CaseStatus | 'needs_admin_action' | 'archived';
type CasesSort =
  | 'latest_activity_desc'
  | 'start_date_desc'
  | 'start_date_asc'
  | 'customer_name_asc'
  | 'status_flow';
type CasesViewMode = 'cards' | 'board';
type CaseActionFocus = 'details' | 'quote' | 'jobs' | 'reports' | 'payment';
type ProjectPipelineStage = 'NEW_LEAD' | 'PREPARING_QUOTE' | 'WAITING_QUOTE_APPROVAL' | 'RESERVED' | 'APPROVED_TO_EXECUTE';
type ProjectTimingPrecision = 'EXACT_DATE' | 'DATE_RANGE' | 'EXPECTED_MONTH' | 'EXPECTED_QUARTER' | 'DATE_UNKNOWN';

type PlannedServiceComponent = {
  id: string;
  serviceType: CaseJob['type'];
  estimatedDays: number;
  workersPerDay: number;
  notes: string;
};

type ProjectPlanningDraft = {
  pipelineStage: ProjectPipelineStage;
  timingPrecision: ProjectTimingPrecision;
  exactDate: string;
  rangeStart: string;
  rangeEnd: string;
  expectedMonth: string;
  expectedQuarter: 'Q1' | 'Q2' | 'Q3' | 'Q4';
  dateUnknownReason: string;
  plannedComponents: PlannedServiceComponent[];
};

function isCaseActionFocus(value: string | null): value is CaseActionFocus {
  return value === 'details' || value === 'quote' || value === 'jobs' || value === 'reports' || value === 'payment';
}

const pipelineStageLabel: Record<ProjectPipelineStage, string> = {
  NEW_LEAD: 'ליד חדש',
  PREPARING_QUOTE: 'בהכנת הצעת מחיר',
  WAITING_QUOTE_APPROVAL: 'מחכה לאישור הצעת מחיר',
  RESERVED: 'משוריין',
  APPROVED_TO_EXECUTE: 'מאושר לביצוע',
};

const timingPrecisionLabel: Record<ProjectTimingPrecision, string> = {
  EXACT_DATE: 'תאריך מדויק',
  DATE_RANGE: 'טווח תאריכים',
  EXPECTED_MONTH: 'חודש משוער',
  EXPECTED_QUARTER: 'רבעון משוער',
  DATE_UNKNOWN: 'תאריך עדיין לא ידוע',
};

function createDefaultPlanningDraft(): ProjectPlanningDraft {
  return {
    pipelineStage: 'NEW_LEAD',
    timingPrecision: 'DATE_UNKNOWN',
    exactDate: '',
    rangeStart: '',
    rangeEnd: '',
    expectedMonth: '',
    expectedQuarter: 'Q1',
    dateUnknownReason: '',
    plannedComponents: [],
  };
}

function describeTimingDraft(draft: ProjectPlanningDraft) {
  if (draft.timingPrecision === 'EXACT_DATE' && draft.exactDate) {
    return `תאריך מדויק: ${new Date(draft.exactDate).toLocaleDateString('he-IL')}`;
  }
  if (draft.timingPrecision === 'DATE_RANGE' && draft.rangeStart && draft.rangeEnd) {
    return `טווח: ${new Date(draft.rangeStart).toLocaleDateString('he-IL')} - ${new Date(draft.rangeEnd).toLocaleDateString('he-IL')}`;
  }
  if (draft.timingPrecision === 'EXPECTED_MONTH' && draft.expectedMonth) {
    const [year, month] = draft.expectedMonth.split('-').map(Number);
    return `חודש משוער: ${new Date(year, month - 1, 1).toLocaleDateString('he-IL', { month: 'long', year: 'numeric' })}`;
  }
  if (draft.timingPrecision === 'EXPECTED_QUARTER') {
    return `רבעון משוער: ${draft.expectedQuarter}`;
  }
  if (draft.dateUnknownReason.trim()) {
    return `תאריך לא ידוע: ${draft.dateUnknownReason.trim()}`;
  }
  return timingPrecisionLabel[draft.timingPrecision];
}

const caseStatusMeta: Record<CaseStatus, { label: string; className: string; icon: LucideIcon }> = {
  DRAFT: { label: 'משוריין', className: 'bg-gray-50 text-gray-700 border-gray-200', icon: CircleDashed },
  ACTIVE: { label: 'מאושר לביצוע', className: 'bg-blue-50 text-blue-700 border-blue-200', icon: FolderKanban },
  READY_FOR_REVIEW: { label: 'עבודה הסתיימה', className: 'bg-amber-50 text-amber-700 border-amber-200', icon: Eye },
  COMPLETED: { label: 'עבודה שולמה', className: 'bg-emerald-50 text-emerald-700 border-emerald-200', icon: CheckCircle2 },
};

function formatCurrency(amount: number) {
  return new Intl.NumberFormat('he-IL', { style: 'currency', currency: 'ILS', maximumFractionDigits: 0 }).format(amount);
}

function formatIsoDateToHebrew(isoDate: string | null | undefined) {
  if (!isoDate) return new Date().toLocaleDateString('he-IL');
  const parsed = new Date(isoDate);
  if (Number.isNaN(parsed.getTime())) return new Date().toLocaleDateString('he-IL');
  return parsed.toLocaleDateString('he-IL');
}

function mapApiCaseStatus(status: ApiCaseListItem['status']): CaseStatus {
  if (status === 'ACTIVE') return 'ACTIVE';
  if (status === 'READY_FOR_REVIEW') return 'READY_FOR_REVIEW';
  if (status === 'COMPLETED') return 'COMPLETED';
  return 'DRAFT';
}

function mapApiJobStatus(status: ApiCaseListItem['jobs'][number]['status']): CaseJobStatus {
  if (status === 'COMPLETED' || status === 'ARCHIVED') return 'בוצע';
  if (status === 'APPROVED') return 'בביצוע';
  return 'מתוכנן';
}

function mapApiJobType(jobType: ApiCaseListItem['jobs'][number]['jobType']): CaseJob['type'] {
  if (jobType === 'PACKING') return 'אריזה';
  if (jobType === 'UNPACKING') return 'פריקה';
  return 'סידור';
}

function mapApiFormStatus(status: ApiCaseHubForm['completionStatus']): EndShiftFormLink['status'] {
  if (status === 'COMPLETED') return 'הושלם';
  if (status === 'PARTIALLY_COMPLETED') return 'הושלם חלקית';
  return 'חסר מידע';
}

function mapApiJobTypeToEndShift(jobType: ApiCaseHubForm['jobType']): EndShiftFormLink['jobType'] {
  if (jobType === 'PACKING') return 'אריזה';
  if (jobType === 'UNPACKING') return 'פריקה';
  return 'סידור בית';
}

function mapUiCaseStatusToApi(status: CaseStatus): ApiCaseListItem['status'] {
  if (status === 'ACTIVE') return 'ACTIVE';
  if (status === 'READY_FOR_REVIEW') return 'READY_FOR_REVIEW';
  if (status === 'COMPLETED') return 'COMPLETED';
  return 'DRAFT';
}

function hasFirstAndLastName(value: string) {
  return value.trim().split(/\s+/).filter(Boolean).length >= 2;
}

function normalizePhone(value: string) {
  return value.replace(/\D/g, '');
}

function toWhatsAppLink(phone: string, text: string) {
  const normalized = normalizePhone(phone);
  if (!normalized) return null;
  const international = normalized.startsWith('0') ? `972${normalized.slice(1)}` : normalized;
  return `https://wa.me/${international}?text=${encodeURIComponent(text)}`;
}

function parseHebrewDateToTime(value: string) {
  const [day, month, year] = value.split(/[./]/).map(Number);
  if (!day || !month || !year) return 0;
  return new Date(year, month - 1, day).getTime();
}

function hebrewDateToDateKey(value: string) {
  const [day, month, year] = value.split(/[./]/).map(Number);
  if (!day || !month || !year) return null;
  return `${String(year)}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function isMovingProject(jobs: CaseJob[]) {
  const hasPacking = jobs.some((job) => job.type === 'אריזה');
  const hasUnpacking = jobs.some((job) => job.type === 'פריקה');
  return hasPacking && hasUnpacking;
}

function addDaysToDateKey(dateKey: string, days: number) {
  const [year, month, day] = dateKey.split('-').map(Number);
  const date = new Date(year, month - 1, day);
  date.setDate(date.getDate() + days);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function formatDateKeyToHebrew(dateKey: string) {
  const [year, month, day] = dateKey.split('-').map(Number);
  return new Date(year, month - 1, day).toLocaleDateString('he-IL');
}

function requiresAdminAction(item: CustomerCase) {
  if (item.isArchived) return false;
  const hasPendingReports = item.status === 'READY_FOR_REVIEW' && (item.finalReportStatus !== 'מוכן' || item.customerReportStatus !== 'נשלח');
  const hasOutstanding = item.status !== 'COMPLETED' && Math.max(item.invoicedTotal - item.paidTotal, 0) > 0;
  const quoteNotHandled = item.status === 'DRAFT' && (!item.quote.sentByEmail || !item.quote.approved);
  return quoteNotHandled || hasPendingReports || hasOutstanding;
}

function getRecommendedNextAction(item: CustomerCase): { label: string; focus: CaseActionFocus } {
  if (item.status === 'DRAFT' && !item.quote.sentByEmail) {
    return { label: 'לשלוח הצעת מחיר ללקוח', focus: 'quote' };
  }
  if (item.status === 'DRAFT' && !item.quote.approved) {
    return { label: 'לתעד אישור להצעת המחיר', focus: 'quote' };
  }
  if (item.status === 'ACTIVE' && item.jobs.length === 0) {
    return { label: 'להוסיף עבודה ראשונה לפרוייקט', focus: 'jobs' };
  }
  if (item.status === 'ACTIVE' && item.jobs.some((job) => job.status === 'מתוכנן')) {
    return { label: 'לאייש ולפרסם את העבודות המתוכננות', focus: 'jobs' };
  }
  if (item.status === 'READY_FOR_REVIEW' && item.finalReportStatus !== 'מוכן') {
    return { label: 'להפיק דוח פנימי לסגירת הפרוייקט', focus: 'reports' };
  }
  if (item.status === 'READY_FOR_REVIEW' && item.customerReportStatus !== 'נשלח') {
    return { label: 'לשלוח דוח סיכום ללקוח', focus: 'reports' };
  }
  if (item.status !== 'COMPLETED' && Math.max(item.invoicedTotal - item.paidTotal, 0) > 0) {
    return { label: 'לסגור יתרת תשלום פתוחה', focus: 'payment' };
  }
  return { label: 'לעדכן פרטי פרוייקט לפי הצורך', focus: 'details' };
}

function getAdminActionLabels(item: CustomerCase) {
  const labels: string[] = [];
  if (item.status === 'DRAFT' && !item.quote.sentByEmail) {
    labels.push('נדרש לשלוח הצעת מחיר');
  }
  if (item.status === 'DRAFT' && !item.quote.approved) {
    labels.push('נדרש אישור הצעת מחיר');
  }
  if (item.status === 'READY_FOR_REVIEW' && item.finalReportStatus !== 'מוכן') {
    labels.push('נדרש דוח פנימי');
  }
  if (item.status === 'READY_FOR_REVIEW' && item.customerReportStatus !== 'נשלח') {
    labels.push('נדרש דוח ללקוח');
  }
  if (item.status !== 'COMPLETED' && Math.max(item.invoicedTotal - item.paidTotal, 0) > 0) {
    labels.push('נדרש סגירת יתרה');
  }
  return labels;
}

function isCaseReadyForFinalReport(item: CustomerCase, linkedFormsCount: number) {
  const completedJobsCount = item.jobs.filter((job) => job.status === 'בוצע').length;
  return completedJobsCount > 0 && linkedFormsCount >= completedJobsCount && item.lastShiftClockedOut;
}

function buildSeedCases(): CustomerCase[] {
  const grouped = new Map<string, typeof importedWorkSeeds>();

  importedWorkSeeds.forEach((seed) => {
    const customerName = ensureCustomerFullName(seed.customerName);
    const current = grouped.get(customerName) ?? [];
    current.push(seed);
    grouped.set(customerName, current);
  });

  return Array.from(grouped.entries())
    .map(([customerName, seeds], index) => {
      const sortedSeeds = [...seeds].sort((a, b) => shortDateToDateKey(a.shortDate).localeCompare(shortDateToDateKey(b.shortDate)));
      const latestSeed = sortedSeeds[sortedSeeds.length - 1];
      const latestDateKey = shortDateToDateKey(latestSeed.shortDate);
      const startSeed = sortedSeeds[0];

      const status: CaseStatus =
        latestDateKey >= '2026-07-05'
          ? 'ACTIVE'
          : latestDateKey >= '2026-07-01'
            ? 'READY_FOR_REVIEW'
            : 'COMPLETED';

      const jobs: CaseJob[] = sortedSeeds.map((seed, jobIndex) => ({
        id: `seed-job-${index + 1}-${jobIndex + 1}`,
        date: shortDateToDisplayDate(seed.shortDate),
        type: seed.jobType,
        address: `כתובת עבודה ${index + 1}, תל אביב`,
        workers: Math.max(2, Math.min(8, Math.round(seed.totalHours / 4))),
        status:
          shortDateToDateKey(seed.shortDate) < '2026-07-05'
            ? 'בוצע'
            : shortDateToDateKey(seed.shortDate) === '2026-07-05'
              ? 'בביצוע'
              : 'מתוכנן',
      }));

      const estimatedHours = sortedSeeds.reduce((sum, seed) => sum + seed.totalHours, 0);
      const invoicedTotal = Math.round(estimatedHours * 175);
      const paidTotal = status === 'COMPLETED' ? invoicedTotal : 0;
      const internalReady = status === 'COMPLETED' || status === 'READY_FOR_REVIEW';
      const finalReportStatus: ReportStatus = internalReady ? 'מוכן' : 'לא מוכן';
      const customerReportStatus: ReportStatus = status === 'COMPLETED' ? 'נשלח' : internalReady ? 'מוכן' : 'לא מוכן';

      return {
        id: `seed-case-${index + 1}`,
        customerName,
        customerPhone: '',
        customerEmail: '',
        caseName: `${customerName} - ${latestDateKey >= '2026-07-01' ? 'יולי' : 'יוני'} 2026`,
        status,
        isArchived: false,
        startDate: shortDateToDisplayDate(startSeed.shortDate),
        latestActivityDate: shortDateToDisplayDate(latestSeed.shortDate),
        assignedManager: 'אורית',
        internalNotes: status === 'READY_FOR_REVIEW' ? 'ממתין להכנת דוח סופי ללקוח.' : '',
        addresses: [`כתובת עבודה ${index + 1}, תל אביב`],
        jobs,
        finalReportStatus,
        customerReportStatus,
        lastShiftClockedOut: internalReady,
        finalReportNotificationSent: status === 'COMPLETED',
        customerFinalReportSentAt: status === 'COMPLETED' ? shortDateToDisplayDate(latestSeed.shortDate) : undefined,
        invoicedTotal,
        paidTotal,
        quote: {
          hourlyRate: 175,
          estimatedHours: Math.round(estimatedHours),
          sentByEmail: true,
          approved: true,
        },
      };
    })
    .sort((a, b) => parseHebrewDateToTime(b.latestActivityDate) - parseHebrewDateToTime(a.latestActivityDate));
}

export default function CasesPage() {
  const { isLoaded: isAuthLoaded, isSignedIn, getToken } = useAuth();
  const canSeeFinancials = canViewSensitiveFinancials(useViewerRole());
  const [requestedCaseId, setRequestedCaseId] = useState<string | null>(null);
  const [requestedCaseFocus, setRequestedCaseFocus] = useState<CaseActionFocus | null>(null);
  const [highlightedCaseId, setHighlightedCaseId] = useState<string | null>(null);
  const [cases, setCases] = useState<CustomerCase[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<CasesFilter>('all');
  const [sortBy, setSortBy] = useState<CasesSort>('latest_activity_desc');
  const [viewMode, setViewMode] = useState<CasesViewMode>('board');
  const [draggedCaseId, setDraggedCaseId] = useState<string | null>(null);
  const [dragOverStatus, setDragOverStatus] = useState<CaseStatus | null>(null);
  const [openedCaseId, setOpenedCaseId] = useState<string | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [caseMessage, setCaseMessage] = useState('');

  const [formCustomerName, setFormCustomerName] = useState('');
  const [formCaseName, setFormCaseName] = useState('');
  const [formStatus, setFormStatus] = useState<CaseStatus>('DRAFT');
  const [formManager, setFormManager] = useState('');
  const [formNotes, setFormNotes] = useState('');
  const [formQuoteRate, setFormQuoteRate] = useState(175);
  const [formQuoteHours, setFormQuoteHours] = useState(8);
  const [formQuoteSent, setFormQuoteSent] = useState(false);
  const [formQuoteApproved, setFormQuoteApproved] = useState(false);
  const [selectedCustomerId, setSelectedCustomerId] = useState('');
  const [createNewCustomer, setCreateNewCustomer] = useState(false);
  const [newCustomerFirstName, setNewCustomerFirstName] = useState('');
  const [newCustomerLastName, setNewCustomerLastName] = useState('');
  const [newCustomerPhone, setNewCustomerPhone] = useState('');
  const [newCustomerEmail, setNewCustomerEmail] = useState('');
  const [deleteReason, setDeleteReason] = useState('');
  const [deletedCaseHistory, setDeletedCaseHistory] = useState<DeletedCaseHistoryEntry[]>([]);
  const [communicationLogByCaseId, setCommunicationLogByCaseId] = useState<Record<string, ProjectCommunicationLogEntry[]>>({});
  const [selectedCommunicationTemplateKey, setSelectedCommunicationTemplateKey] = useState<ProjectCommunicationTemplateKey>('quote');
  const [selectedCommunicationChannel, setSelectedCommunicationChannel] = useState<ProjectCommunicationChannel>('whatsapp');
  const [hubByCaseId, setHubByCaseId] = useState<Record<string, ApiCaseHub>>({});
  const [planningByCaseId, setPlanningByCaseId] = useState<Record<string, ProjectPlanningDraft>>({});
  const [apiError, setApiError] = useState('');
  const [isLoadingCases, setIsLoadingCases] = useState(true);
  const [customers, setCustomers] = useState<ApiCustomer[]>([]);
  const [caseActionFocus, setCaseActionFocus] = useState<CaseActionFocus | null>(null);
  const [formPipelineStage, setFormPipelineStage] = useState<ProjectPipelineStage>('NEW_LEAD');
  const [formTimingPrecision, setFormTimingPrecision] = useState<ProjectTimingPrecision>('DATE_UNKNOWN');
  const [formExactDate, setFormExactDate] = useState('');
  const [formRangeStart, setFormRangeStart] = useState('');
  const [formRangeEnd, setFormRangeEnd] = useState('');
  const [formExpectedMonth, setFormExpectedMonth] = useState('');
  const [formExpectedQuarter, setFormExpectedQuarter] = useState<'Q1' | 'Q2' | 'Q3' | 'Q4'>('Q1');
  const [formDateUnknownReason, setFormDateUnknownReason] = useState('');
  const [formPlannedComponents, setFormPlannedComponents] = useState<PlannedServiceComponent[]>([]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const raw = window.localStorage.getItem('spaceorder_deleted_case_history');
    if (!raw) return;
    try {
      const parsed = JSON.parse(raw) as DeletedCaseHistoryEntry[];
      if (Array.isArray(parsed)) {
        setDeletedCaseHistory(
          parsed.filter(
            (entry) =>
              typeof entry.customerName === 'string' &&
              typeof entry.caseName === 'string' &&
              typeof entry.deletedAt === 'string' &&
              typeof entry.reason === 'string',
          ),
        );
      }
    } catch (error) {
      console.error('Failed to parse deleted case history from localStorage', error);
    }
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem('spaceorder_deleted_case_history', JSON.stringify(deletedCaseHistory));
  }, [deletedCaseHistory]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const raw = window.localStorage.getItem('spaceorder_case_planning_drafts');
    if (!raw) return;
    try {
      const parsed = JSON.parse(raw) as Record<string, ProjectPlanningDraft>;
      if (parsed && typeof parsed === 'object') {
        setPlanningByCaseId(parsed);
      }
    } catch (error) {
      console.error('Failed to parse planning drafts from localStorage', error);
    }
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem('spaceorder_case_planning_drafts', JSON.stringify(planningByCaseId));
  }, [planningByCaseId]);

  const loadCasesFromApi = useCallback(async () => {
    setIsLoadingCases(true);
    try {
      console.log('Loading cases from API:', process.env.NEXT_PUBLIC_API_URL);
      const auth = await authHeaders(getToken);
      const response = await api.get<ApiCaseListItem[]>('/cases', auth);
      const mapped: CustomerCase[] = response.data.map((item) => {
        const mappedStatus = mapApiCaseStatus(item.status);
        const customerName = `${item.customer.firstName} ${item.customer.lastName}`.trim();
        const jobs: CaseJob[] = item.jobs.map((job) => ({
          id: job.id,
          date: formatIsoDateToHebrew(job.date),
          type: mapApiJobType(job.jobType),
          address: job.address?.fullAddress ?? 'כתובת לא זמינה',
          workers: job.requiredWorkerCount,
          status: mapApiJobStatus(job.status),
        }));
        return {
          id: item.id,
          customerName,
          customerPhone: item.customer.phone,
          customerEmail: item.customer.email,
          caseName: item.name,
          status: mappedStatus,
          isArchived: false,
          startDate: formatIsoDateToHebrew(item.startDate),
          latestActivityDate: formatIsoDateToHebrew(item.latestActivityDate ?? item.updatedAt),
          assignedManager: item.assignedAdmin ? `${item.assignedAdmin.firstName} ${item.assignedAdmin.lastName}`.trim() : 'טרם שובץ',
          internalNotes: '',
          addresses: Array.from(new Set(jobs.map((job) => job.address))),
          jobs,
          finalReportStatus: mappedStatus === 'COMPLETED' ? 'מוכן' : 'לא מוכן',
          customerReportStatus: mappedStatus === 'COMPLETED' ? 'נשלח' : 'לא מוכן',
          lastShiftClockedOut: mappedStatus === 'READY_FOR_REVIEW' || mappedStatus === 'COMPLETED',
          finalReportNotificationSent: false,
          customerFinalReportSentAt: undefined,
          invoicedTotal: 0,
          paidTotal: 0,
          quote: {
            hourlyRate: 175,
            estimatedHours: Math.max(1, jobs.length * 4),
            sentByEmail: true,
            approved: mappedStatus !== 'DRAFT',
          },
        };
      });
      console.log('Cases loaded successfully:', mapped.length);
      setCases(mapped);
      setApiError('');
    } catch (error) {
      console.error('Failed to load cases from API:', error);
      // Keep previously loaded data on transient API failures.
      // Only show error if it's not a loading issue
      if (error instanceof Error) {
        setApiError(`לא ניתן לטעון פרוייקטים: ${error.message}`);
      } else {
        setApiError('לא ניתן לטעון פרוייקטים מהשרת כרגע.');
      }
    } finally {
      setIsLoadingCases(false);
    }
  }, [getToken]);

  useEffect(() => {
    if (!isAuthLoaded) return;
    if (!isSignedIn) {
      setIsLoadingCases(false);
      setApiError('נדרש להתחבר כדי לטעון פרוייקטים מהשרת.');
      return;
    }
    void loadCasesFromApi();
  }, [isAuthLoaded, isSignedIn, loadCasesFromApi]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    const focus = params.get('focus');
    setRequestedCaseId(params.get('caseId'));
    setRequestedCaseFocus(isCaseActionFocus(focus) ? focus : null);
  }, []);

  useEffect(() => {
    if (!isAuthLoaded || !isSignedIn) return;
    const loadCustomers = async () => {
      try {
        const auth = await authHeaders(getToken);
        const response = await api.get<ApiCustomer[]>('/customers', auth);
        setCustomers(response.data);
      } catch (error) {
        console.error('Failed to load customers for case creation', error);
      }
    };
    void loadCustomers();
  }, [isAuthLoaded, isSignedIn, getToken]);

  const openedCase = useMemo(() => cases.find((item) => item.id === openedCaseId) ?? null, [cases, openedCaseId]);
  const openedCaseHub = openedCase ? hubByCaseId[openedCase.id] : undefined;
  const openedCaseIsMovingProject = useMemo(() => (openedCase ? isMovingProject(openedCase.jobs) : false), [openedCase]);
  const openedCaseFirstJobDateKey = useMemo(() => {
    if (!openedCase) return null;
    const keys = openedCase.jobs
      .map((job) => hebrewDateToDateKey(job.date))
      .filter((value): value is string => Boolean(value))
      .sort((a, b) => a.localeCompare(b));
    return keys[0] ?? null;
  }, [openedCase]);
  const openedCaseFirstPackingDateKey = useMemo(() => {
    if (!openedCase) return null;
    const keys = openedCase.jobs
      .filter((job) => job.type === 'אריזה')
      .map((job) => hebrewDateToDateKey(job.date))
      .filter((value): value is string => Boolean(value))
      .sort((a, b) => a.localeCompare(b));
    return keys[0] ?? null;
  }, [openedCase]);
  const packingFormAutoSendDateLabel = useMemo(() => {
    if (!openedCaseFirstPackingDateKey) return null;
    const oneWeekBefore = addDaysToDateKey(openedCaseFirstPackingDateKey, -7);
    const todayKey = new Date().toISOString().slice(0, 10);
    const target = oneWeekBefore < todayKey ? todayKey : oneWeekBefore;
    return formatDateKeyToHebrew(target);
  }, [openedCaseFirstPackingDateKey]);
  const moveReminderDateLabel = useMemo(() => {
    if (!openedCaseFirstJobDateKey || !openedCaseIsMovingProject) return null;
    return formatDateKeyToHebrew(addDaysToDateKey(openedCaseFirstJobDateKey, -2));
  }, [openedCaseFirstJobDateKey, openedCaseIsMovingProject]);
  const communicationTemplates = useMemo(() => {
    if (!openedCase) return [];
    return buildProjectCommunicationTemplates({
      customerName: openedCase.customerName,
      caseName: formCaseName || openedCase.caseName,
      quoteHours: formQuoteHours,
      quoteRate: formQuoteRate,
      quoteTotalLabel: formatCurrency(Math.round(formQuoteRate * formQuoteHours)),
      quoteApproved: formQuoteApproved,
      isMovingProject: openedCaseIsMovingProject,
      firstJobDateLabel: openedCaseFirstJobDateKey ? formatDateKeyToHebrew(openedCaseFirstJobDateKey) : null,
      firstPackingDateLabel: openedCaseFirstPackingDateKey ? formatDateKeyToHebrew(openedCaseFirstPackingDateKey) : null,
      packingFormAutoSendDateLabel,
    });
  }, [
    openedCase,
    formCaseName,
    formQuoteHours,
    formQuoteRate,
    formQuoteApproved,
    openedCaseIsMovingProject,
    openedCaseFirstJobDateKey,
    openedCaseFirstPackingDateKey,
    packingFormAutoSendDateLabel,
  ]);
  const selectedCommunicationTemplate = useMemo(
    () => communicationTemplates.find((template) => template.key === selectedCommunicationTemplateKey) ?? communicationTemplates[0] ?? null,
    [communicationTemplates, selectedCommunicationTemplateKey],
  );
  const openedCaseCommunicationLog = useMemo(() => {
    if (!openedCase) return [];
    return [...(communicationLogByCaseId[openedCase.id] ?? [])].sort((a, b) =>
      b.sentAt.localeCompare(a.sentAt),
    );
  }, [openedCase, communicationLogByCaseId]);

  const sendProjectCommunication = useCallback(async () => {
    if (!openedCase || !selectedCommunicationTemplate) return;
    if (!selectedCommunicationTemplate.isEnabled) {
      setCaseMessage(selectedCommunicationTemplate.disabledReason ?? 'התבנית לא זמינה לשליחה כרגע.');
      return;
    }

    if (selectedCommunicationChannel === 'whatsapp') {
      const whatsappLink = toWhatsAppLink(openedCase.customerPhone, selectedCommunicationTemplate.body);
      if (!whatsappLink) {
        setCaseMessage('מספר טלפון לקוח לא תקין לשליחה בוואטסאפ.');
        return;
      }
      window.open(whatsappLink, '_blank', 'noopener,noreferrer');
    } else {
      if (!openedCase.customerEmail) {
        setCaseMessage('אין כתובת אימייל ללקוח בכרטיס הפרוייקט.');
        return;
      }
      const subject = encodeURIComponent(selectedCommunicationTemplate.subject);
      const body = encodeURIComponent(selectedCommunicationTemplate.body);
      window.open(`mailto:${openedCase.customerEmail}?subject=${subject}&body=${body}`, '_blank', 'noopener,noreferrer');
    }

    try {
      const auth = await authHeaders(getToken);
      const response = await api.post<ProjectCommunicationLogEntry>(
        `/cases/${openedCase.id}/communications`,
        {
          templateKey: selectedCommunicationTemplate.key,
          channel: selectedCommunicationChannel,
          recipient: selectedCommunicationChannel === 'whatsapp' ? openedCase.customerPhone : openedCase.customerEmail,
          preview: selectedCommunicationTemplate.body.slice(0, 180),
        },
        auth,
      );
      setCommunicationLogByCaseId((prev) => ({
        ...prev,
        [openedCase.id]: [response.data, ...(prev[openedCase.id] ?? [])],
      }));
      setCaseMessage(`נשלחה ${selectedCommunicationTemplate.title} דרך ${communicationChannelLabel(selectedCommunicationChannel)}.`);
    } catch (error) {
      console.error('Failed to save case communication log in API', error);
      setCaseMessage('ההודעה נפתחה אך שמירת המעקב בשרת נכשלה.');
    }
  }, [openedCase, selectedCommunicationTemplate, selectedCommunicationChannel, getToken]);
  const openedCaseForms = useMemo(() => {
    if (!openedCase) return [];
    if (!openedCaseHub) return [];
    return openedCaseHub.forms.map((form) => ({
      id: form.id,
      workerName: form.workerName,
      jobType: mapApiJobTypeToEndShift(form.jobType),
      customerName: openedCase.customerName,
      caseName: openedCase.caseName,
      shiftDate: formatIsoDateToHebrew(form.shiftDate),
      completedAt: new Date(form.submittedAt).toLocaleString('he-IL'),
      status: mapApiFormStatus(form.completionStatus),
      hasPhotos: false,
      followUp: Boolean(form.managerNote),
    }));
  }, [openedCase, openedCaseHub]);

  useEffect(() => {
    if (!openedCase) return;
    const loadHub = async () => {
      try {
        const auth = await authHeaders(getToken);
        const response = await api.get<ApiCaseHub>(`/cases/${openedCase.id}/hub`, auth);
        setHubByCaseId((prev) => ({ ...prev, [openedCase.id]: response.data }));
      } catch (error) {
        console.error('Failed to load case hub from API', error);
      }
    };
    void loadHub();
  }, [openedCase, getToken]);

  const loadCaseCommunicationLog = useCallback(
    async (caseId: string) => {
      try {
        const auth = await authHeaders(getToken);
        const response = await api.get<ProjectCommunicationLogEntry[]>(`/cases/${caseId}/communications`, auth);
        setCommunicationLogByCaseId((prev) => ({
          ...prev,
          [caseId]: response.data,
        }));
      } catch (error) {
        console.error('Failed to load case communication logs from API', error);
      }
    },
    [getToken],
  );

  useEffect(() => {
    if (!openedCase || !isSignedIn) return;
    void loadCaseCommunicationLog(openedCase.id);
  }, [openedCase, isSignedIn, loadCaseCommunicationLog]);

  const filteredCases = useMemo(() => {
    const term = searchTerm.trim().toLowerCase();
    return cases.filter((item) => {
      const matchesStatus =
        statusFilter === 'all' ||
        (statusFilter === 'needs_admin_action'
          ? requiresAdminAction(item)
          : statusFilter === 'archived'
            ? item.isArchived
            : item.status === statusFilter && !item.isArchived);
      if (!matchesStatus) return false;
      if (!term) return true;
      return (
        item.customerName.toLowerCase().includes(term) ||
        item.caseName.toLowerCase().includes(term) ||
        item.assignedManager.toLowerCase().includes(term)
      );
    });
  }, [cases, searchTerm, statusFilter]);

  const sortedFilteredCases = useMemo(() => {
    const statusPriority: Record<CaseStatus, number> = {
      DRAFT: 0,
      ACTIVE: 1,
      READY_FOR_REVIEW: 2,
      COMPLETED: 3,
    };
    return [...filteredCases].sort((a, b) => {
      if (sortBy === 'customer_name_asc') {
        return a.customerName.localeCompare(b.customerName, 'he');
      }
      if (sortBy === 'start_date_asc') {
        return parseHebrewDateToTime(a.startDate) - parseHebrewDateToTime(b.startDate);
      }
      if (sortBy === 'start_date_desc') {
        return parseHebrewDateToTime(b.startDate) - parseHebrewDateToTime(a.startDate);
      }
      if (sortBy === 'status_flow') {
        return statusPriority[a.status] - statusPriority[b.status];
      }
      return parseHebrewDateToTime(b.latestActivityDate) - parseHebrewDateToTime(a.latestActivityDate);
    });
  }, [filteredCases, sortBy]);

  const pendingAdminCases = useMemo(() => sortedFilteredCases.filter((item) => requiresAdminAction(item)), [sortedFilteredCases]);

  const customerDeletedCases = useMemo(() => {
    const customerName = openedCase?.customerName ?? formCustomerName.trim();
    if (!customerName) return [];
    return deletedCaseHistory.filter((item) => item.customerName === customerName);
  }, [deletedCaseHistory, openedCase, formCustomerName]);

  const totals = useMemo(() => {
    const activeCount = cases.filter((item) => item.status === 'ACTIVE').length;
    const readyCount = cases.filter((item) => item.status === 'READY_FOR_REVIEW').length;
    const completedCount = cases.filter((item) => item.status === 'COMPLETED').length;
    const outstanding = cases.reduce((sum, item) => sum + Math.max(item.invoicedTotal - item.paidTotal, 0), 0);
    return { activeCount, readyCount, completedCount, outstanding };
  }, [cases]);
  const archivedCount = useMemo(() => cases.filter((item) => item.isArchived).length, [cases]);

  const openCase = (item: CustomerCase, focus: CaseActionFocus | null = null) => {
    const planningDraft = planningByCaseId[item.id] ?? createDefaultPlanningDraft();
    setOpenedCaseId(item.id);
    setCaseActionFocus(focus);
    setIsCreating(false);
    setCaseMessage('');
    setFormCustomerName(item.customerName);
    setFormCaseName(item.caseName);
    setFormStatus(item.status);
    setFormManager(item.assignedManager);
    setFormNotes(item.internalNotes);
    setFormQuoteRate(item.quote.hourlyRate);
    setFormQuoteHours(item.quote.estimatedHours);
    setFormQuoteSent(item.quote.sentByEmail);
    setFormQuoteApproved(item.quote.approved);
    const matchedCustomer = customers.find(
      (customer) => `${customer.firstName} ${customer.lastName}`.trim() === item.customerName,
    );
    setSelectedCustomerId(matchedCustomer?.id ?? '');
    setCreateNewCustomer(false);
    setNewCustomerFirstName('');
    setNewCustomerLastName('');
    setNewCustomerPhone('');
    setNewCustomerEmail('');
    setSelectedCommunicationTemplateKey('quote');
    setSelectedCommunicationChannel('whatsapp');
    setDeleteReason('');
    setFormPipelineStage(planningDraft.pipelineStage);
    setFormTimingPrecision(planningDraft.timingPrecision);
    setFormExactDate(planningDraft.exactDate);
    setFormRangeStart(planningDraft.rangeStart);
    setFormRangeEnd(planningDraft.rangeEnd);
    setFormExpectedMonth(planningDraft.expectedMonth);
    setFormExpectedQuarter(planningDraft.expectedQuarter);
    setFormDateUnknownReason(planningDraft.dateUnknownReason);
    setFormPlannedComponents(planningDraft.plannedComponents);
  };

  useEffect(() => {
    if (!requestedCaseId || cases.length === 0) return;
    const requestedCase = cases.find((item) => item.id === requestedCaseId);
    if (requestedCase) {
      if (openedCaseId === requestedCaseId && caseActionFocus === requestedCaseFocus) return;
      setHighlightedCaseId(requestedCase.id);
      window.requestAnimationFrame(() => {
        const target = document.querySelector<HTMLElement>(`[data-case-link-target="${requestedCase.id}"]`);
        target?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      });
      openCase(requestedCase, requestedCaseFocus);
    }
  }, [requestedCaseId, requestedCaseFocus, cases, openedCaseId, caseActionFocus]);

  useEffect(() => {
    if (!highlightedCaseId) return;
    const timeoutId = window.setTimeout(() => setHighlightedCaseId(null), 4000);
    return () => window.clearTimeout(timeoutId);
  }, [highlightedCaseId]);

  useEffect(() => {
    if (!openedCaseId || !caseActionFocus) return;
    const timeoutId = window.setTimeout(() => {
      const target = document.querySelector<HTMLElement>(`[data-case-section="${caseActionFocus}"]`);
      target?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 80);
    return () => window.clearTimeout(timeoutId);
  }, [openedCaseId, caseActionFocus]);

  const openCreate = () => {
    const defaultPlanning = createDefaultPlanningDraft();
    setOpenedCaseId(null);
    setCaseActionFocus(null);
    setIsCreating(true);
    setCaseMessage('');
    setFormCustomerName('');
    setFormCaseName('');
    setFormStatus('DRAFT');
    setFormManager('');
    setFormNotes('');
    setFormQuoteRate(175);
    setFormQuoteHours(8);
    setFormQuoteSent(false);
    setFormQuoteApproved(false);
    setSelectedCustomerId('');
    setCreateNewCustomer(false);
    setNewCustomerFirstName('');
    setNewCustomerLastName('');
    setNewCustomerPhone('');
    setNewCustomerEmail('');
    setSelectedCommunicationTemplateKey('quote');
    setSelectedCommunicationChannel('whatsapp');
    setDeleteReason('');
    setFormPipelineStage(defaultPlanning.pipelineStage);
    setFormTimingPrecision(defaultPlanning.timingPrecision);
    setFormExactDate(defaultPlanning.exactDate);
    setFormRangeStart(defaultPlanning.rangeStart);
    setFormRangeEnd(defaultPlanning.rangeEnd);
    setFormExpectedMonth(defaultPlanning.expectedMonth);
    setFormExpectedQuarter(defaultPlanning.expectedQuarter);
    setFormDateUnknownReason(defaultPlanning.dateUnknownReason);
    setFormPlannedComponents(defaultPlanning.plannedComponents);
  };

  const saveCase = async () => {
    const selectedCustomer = customers.find((customer) => customer.id === selectedCustomerId);
    const effectiveCustomerName = isCreating
      ? createNewCustomer
        ? `${newCustomerFirstName} ${newCustomerLastName}`.trim()
        : selectedCustomer
          ? `${selectedCustomer.firstName} ${selectedCustomer.lastName}`.trim()
          : ''
      : formCustomerName.trim();

    if (!effectiveCustomerName || !formCaseName.trim() || !formManager.trim()) {
      setCaseMessage('יש למלא לקוח, שם פרוייקט ומנהל אחראי.');
      return;
    }
    if (!hasFirstAndLastName(effectiveCustomerName)) {
      setCaseMessage('יש להזין שם פרטי ושם משפחה ללקוח.');
      return;
    }
    if (formQuoteRate <= 0 || formQuoteHours <= 0) {
      setCaseMessage('יש להזין תעריף שעתי ושעות משוערות תקינים בהצעת המחיר.');
      return;
    }
    if (formStatus === 'ACTIVE' && !formQuoteApproved) {
      setCaseMessage('לא ניתן להעביר פרוייקט לסטטוס מאושר לביצוע לפני אישור הצעת המחיר.');
      return;
    }
    if (formTimingPrecision === 'EXACT_DATE' && !formExactDate) {
      setCaseMessage('יש לבחור תאריך מדויק עבור דיוק תזמון.');
      return;
    }
    if (formTimingPrecision === 'DATE_RANGE' && (!formRangeStart || !formRangeEnd)) {
      setCaseMessage('יש להזין תאריך התחלה וסיום עבור טווח תאריכים.');
      return;
    }
    if (formTimingPrecision === 'DATE_RANGE' && formRangeStart > formRangeEnd) {
      setCaseMessage('טווח התאריכים אינו תקין: תאריך התחלה מאוחר מתאריך הסיום.');
      return;
    }
    if (formTimingPrecision === 'EXPECTED_MONTH' && !formExpectedMonth) {
      setCaseMessage('יש לבחור חודש משוער.');
      return;
    }
    if (formTimingPrecision === 'DATE_UNKNOWN' && !formDateUnknownReason.trim()) {
      setCaseMessage('כאשר התאריך עדיין לא ידוע, יש לציין סיבה קצרה.');
      return;
    }
    if (formPlannedComponents.some((component) => component.estimatedDays <= 0 || component.workersPerDay <= 0)) {
      setCaseMessage('בכל רכיב שירות מתוכנן יש להזין ימי עבודה ועובדים ליום גדולים מאפס.');
      return;
    }

    const planningDraft: ProjectPlanningDraft = {
      pipelineStage: formPipelineStage,
      timingPrecision: formTimingPrecision,
      exactDate: formExactDate,
      rangeStart: formRangeStart,
      rangeEnd: formRangeEnd,
      expectedMonth: formExpectedMonth,
      expectedQuarter: formExpectedQuarter,
      dateUnknownReason: formDateUnknownReason,
      plannedComponents: formPlannedComponents,
    };

    if (isCreating) {
      let customerId = selectedCustomerId;
      try {
        if (createNewCustomer) {
          if (!newCustomerFirstName.trim() || !newCustomerLastName.trim() || !newCustomerPhone.trim() || !newCustomerEmail.trim()) {
            setCaseMessage('ליצירת לקוח חדש יש למלא שם פרטי, שם משפחה, טלפון ואימייל.');
            return;
          }
          const createdCustomer = await api.post<ApiCustomer>('/customers', {
            firstName: newCustomerFirstName.trim(),
            lastName: newCustomerLastName.trim(),
            phone: newCustomerPhone.trim(),
            email: newCustomerEmail.trim(),
          });
          customerId = createdCustomer.data.id;
        } else if (!customerId) {
          setCaseMessage('יש לבחור לקוח קיים או ליצור לקוח חדש לפני יצירת פרוייקט.');
          return;
        }

        const createdCase = await api.post<{ id: string }>('/cases', {
          customerId,
          name: formCaseName.trim(),
          status: mapUiCaseStatusToApi(formStatus),
          internalNotes: formNotes.trim() || undefined,
          startDate: new Date().toISOString(),
        });

        await Promise.all([loadCasesFromApi(), api.get<ApiCustomer[]>('/customers').then((res) => setCustomers(res.data))]);
        setPlanningByCaseId((prev) => ({ ...prev, [createdCase.data.id]: planningDraft }));
        setOpenedCaseId(createdCase.data.id);
        setIsCreating(false);
        setCaseMessage('פרוייקט חדש נוצר בהצלחה בשרת.');
      } catch (error) {
        setCaseMessage('יצירת פרוייקט חדש נכשלה. יש לבדוק נתונים ולנסות שוב.');
        console.error('Failed to create case from cases page', error);
      }
      return;
    }

    if (!openedCaseId) {
      setCaseMessage('לא נמצא פרוייקט לעריכה.');
      return;
    }

    try {
      await api.patch(`/cases/${openedCaseId}`, {
        name: formCaseName.trim(),
        status: mapUiCaseStatusToApi(formStatus),
        internalNotes: formNotes.trim() || undefined,
      });
      setPlanningByCaseId((prev) => ({ ...prev, [openedCaseId]: planningDraft }));
      await loadCasesFromApi();
      setCaseMessage('הפרוייקט נשמר בהצלחה בשרת.');
    } catch (error) {
      setCaseMessage('שמירת הפרוייקט נכשלה. יש לנסות שוב.');
      console.error('Failed to update case in API', error);
    }
  };

  const runCaseAction = async (action: 'ready' | 'complete' | 'reopen') => {
    if (!openedCase) return;
    const nextStatus: CaseStatus =
      action === 'ready' ? 'READY_FOR_REVIEW' : action === 'complete' ? 'COMPLETED' : 'ACTIVE';
    if ((action === 'reopen' || action === 'ready') && !formQuoteApproved) {
      setCaseMessage('נדרש אישור הצעת מחיר לפני העברת הפרוייקט לסטטוס מאושר לביצוע/עבודה הסתיימה.');
      return;
    }
    await updateCaseStatus(openedCase.id, nextStatus);
    setFormStatus(nextStatus);
    setCaseMessage(
      action === 'ready'
        ? 'הפרוייקט סומן כעבודה הסתיימה.'
        : action === 'complete'
          ? 'הפרוייקט סומן כעבודה שולמה.'
          : 'הפרוייקט הוחזר לסטטוס מאושר לביצוע.',
    );
  };

  const updateCaseStatus = async (caseId: string, nextStatus: CaseStatus) => {
    const selectedCase = cases.find((item) => item.id === caseId);
    if (!selectedCase) return;
    if ((nextStatus === 'ACTIVE' || nextStatus === 'READY_FOR_REVIEW') && !selectedCase.quote.approved) {
      setCaseMessage('נדרש אישור הצעת מחיר לפני העברה למאושר לביצוע/עבודה הסתיימה.');
      return;
    }
    try {
      await api.patch(`/cases/${caseId}`, {
        status: mapUiCaseStatusToApi(nextStatus),
      });
      await loadCasesFromApi();
    } catch (error) {
      setCaseMessage('עדכון סטטוס נכשל. יש לנסות שוב.');
      console.error('Failed to update case status in API', error);
      return;
    }
    if (openedCaseId === caseId) {
      setFormStatus(nextStatus);
    }
    setCaseMessage('סטטוס הפרוייקט עודכן בהצלחה.');
  };

  const handleBoardDrop = (targetStatus: CaseStatus) => {
    if (!draggedCaseId) return;
    const selectedCase = cases.find((item) => item.id === draggedCaseId);
    if (selectedCase && selectedCase.status !== targetStatus) {
      void updateCaseStatus(draggedCaseId, targetStatus);
    }
    setDraggedCaseId(null);
    setDragOverStatus(null);
  };

  const deleteOpenedCase = async () => {
    if (!openedCase) return;
    if (!deleteReason.trim()) {
      setCaseMessage('לפני מחיקת פרוייקט חובה להזין סיבת מחיקה.');
      return;
    }
    const deletedEntry: DeletedCaseHistoryEntry = {
      id: `deleted-${Date.now()}`,
      customerName: openedCase.customerName,
      caseName: openedCase.caseName,
      deletedAt: new Date().toLocaleString('he-IL'),
      reason: deleteReason.trim(),
      notApprovedAtDeletion: !openedCase.quote.approved,
    };
    setDeletedCaseHistory((prev) => [deletedEntry, ...prev]);
    try {
      await api.post(`/cases/${openedCase.id}/archive`, { reason: deleteReason.trim() });
      await loadCasesFromApi();
      setOpenedCaseId(null);
      setIsCreating(false);
      setDeleteReason('');
      setCaseMessage('הפרוייקט הועבר לארכיון בהצלחה ונרשם באודיט.');
    } catch (error) {
      setCaseMessage('ארכוב הפרוייקט נכשל. יש לנסות שוב.');
      console.error('Failed to archive case via API', error);
    }
  };

  const quoteTotal = useMemo(() => Math.round(formQuoteRate * formQuoteHours), [formQuoteRate, formQuoteHours]);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">פרוייקטים</h1>
          <p className="text-gray-600 mt-1">ניהול מחזור חיי פרוייקט: משוריין, מאושר לביצוע, עבודה הסתיימה ועבודה שולמה</p>
        </div>
        <button
          type="button"
          onClick={openCreate}
          className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-3 py-2 text-sm font-medium text-white hover:bg-emerald-700"
        >
          <Plus className="w-4 h-4" />
          פרוייקט חדש
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="bg-white rounded-lg border border-gray-200 p-4">
          <p className="text-xs text-gray-500">פרוייקטים מאושרים לביצוע</p>
          <p className="text-2xl font-bold text-gray-900 mt-1">{totals.activeCount}</p>
        </div>
        <div className="bg-white rounded-lg border border-gray-200 p-4">
          <p className="text-xs text-gray-500">עבודות הסתיימו</p>
          <p className="text-2xl font-bold text-gray-900 mt-1">{totals.readyCount}</p>
        </div>
        <div className="bg-white rounded-lg border border-gray-200 p-4">
          <p className="text-xs text-gray-500">פרוייקטים שהושלמו</p>
          <p className="text-2xl font-bold text-gray-900 mt-1">{totals.completedCount}</p>
        </div>
        <div className="bg-white rounded-lg border border-gray-200 p-4">
          <p className="text-xs text-gray-500">יתרה פתוחה</p>
          <p className="text-2xl font-bold text-gray-900 mt-1">{canSeeFinancials ? formatCurrency(totals.outstanding) : 'מוסתר'}</p>
        </div>
      </div>

      {isLoadingCases ? <div className="rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-sm text-blue-800">טוען פרוייקטים מהשרת…</div> : null}
      {apiError ? (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span>{apiError}</span>
            <button
              type="button"
              onClick={() => void loadCasesFromApi()}
              disabled={isLoadingCases}
              className="rounded-md border border-amber-300 bg-white px-2.5 py-1 text-xs font-medium text-amber-900 hover:bg-amber-100 disabled:cursor-not-allowed disabled:opacity-60"
            >
              נסה שוב
            </button>
          </div>
        </div>
      ) : null}

      <div className="bg-white rounded-lg border border-gray-200 p-4">
        <div className="grid grid-cols-1 lg:grid-cols-5 gap-3">
          <div className="relative">
            <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full rounded-lg border border-gray-300 pr-9 pl-3 py-2 text-sm text-right"
              placeholder="חיפוש לפי לקוח / פרוייקט / מנהל"
            />
          </div>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as CasesFilter)}
            className="rounded-lg border border-gray-300 px-3 py-2 text-sm bg-white"
          >
            <option value="all">כל הסטטוסים</option>
            <option value="DRAFT">משוריין</option>
            <option value="ACTIVE">מאושר לביצוע</option>
            <option value="READY_FOR_REVIEW">עבודה הסתיימה</option>
            <option value="COMPLETED">עבודה שולמה</option>
            <option value="archived">בארכיון</option>
            <option value="needs_admin_action">ממתין לטיפול מנהל</option>
          </select>
          <select value={sortBy} onChange={(e) => setSortBy(e.target.value as CasesSort)} className="rounded-lg border border-gray-300 px-3 py-2 text-sm bg-white">
            <option value="latest_activity_desc">מיון: פעילות אחרונה (חדש לישן)</option>
            <option value="start_date_desc">מיון: תאריך פתיחה (חדש לישן)</option>
            <option value="start_date_asc">מיון: תאריך פתיחה (ישן לחדש)</option>
            <option value="customer_name_asc">מיון: שם לקוח (א-ת)</option>
            <option value="status_flow">מיון: לפי רצף סטטוסים</option>
          </select>
          <div className="inline-flex rounded-lg border border-gray-300 overflow-hidden">
            <button type="button" onClick={() => setViewMode('cards')} className={`px-3 py-2 text-xs ${viewMode === 'cards' ? 'bg-emerald-50 text-emerald-700' : 'bg-white text-gray-700'}`}>
              תצוגת כרטיסים
            </button>
            <button type="button" onClick={() => setViewMode('board')} className={`px-3 py-2 text-xs border-r border-gray-300 ${viewMode === 'board' ? 'bg-emerald-50 text-emerald-700' : 'bg-white text-gray-700'}`}>
              תצוגת עמודות
            </button>
          </div>
          <div className="text-xs text-gray-500 flex items-center lg:col-span-1">
            פרוייקטים שממתינים לטיפול יוצגו בראש המסך עם פירוט הפעולה הנדרשת.
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => setStatusFilter('all')}
              className={`rounded-full border px-3 py-1 text-xs ${statusFilter === 'all' ? 'border-emerald-300 bg-emerald-50 text-emerald-700' : 'border-gray-300 bg-white text-gray-700'}`}
            >
              כל הפרוייקטים
            </button>
            <button
              type="button"
              onClick={() => setStatusFilter('archived')}
              className={`rounded-full border px-3 py-1 text-xs ${statusFilter === 'archived' ? 'border-amber-300 bg-amber-50 text-amber-700' : 'border-gray-300 bg-white text-gray-700'}`}
            >
              בארכיון ({archivedCount})
            </button>
          </div>
        </div>
      </div>

      {pendingAdminCases.length > 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 space-y-3">
          <p className="text-sm font-semibold text-amber-800">פרוייקטים שממתינים לטיפול</p>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-2">
            {pendingAdminCases.slice(0, 6).map((item) => {
              const recommendedAction = getRecommendedNextAction(item);
              return (
              <button
                key={`pending-${item.id}`}
                type="button"
                onClick={() => openCase(item, recommendedAction.focus)}
                data-case-link-target={item.id}
                className={`text-right rounded-lg border border-amber-300 bg-white px-3 py-2 hover:bg-amber-100/40 ${
                  highlightedCaseId === item.id ? 'ring-2 ring-emerald-400 ring-offset-2' : ''
                }`}
              >
                <p className="text-sm font-semibold text-gray-900">{item.caseName}</p>
                <p className="text-xs text-gray-700 mt-1">{item.customerName}</p>
                <div className="mt-2 flex flex-wrap justify-end gap-1">
                  {getAdminActionLabels(item).map((label) => (
                    <span key={`${item.id}-${label}`} className="inline-flex rounded-full border border-amber-300 bg-amber-100 px-2 py-0.5 text-[11px] text-amber-900">
                      {label}
                    </span>
                  ))}
                </div>
                <div className="mt-2 rounded-md border border-amber-300 bg-amber-100/70 px-2 py-1 text-[11px] text-amber-900">
                  <span className="font-semibold">הפעולה הבאה:</span> {recommendedAction.label}
                </div>
              </button>
            )})}
          </div>
        </div>
      )}

      {viewMode === 'cards' && (
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
          {sortedFilteredCases.map((item) => {
            const status = caseStatusMeta[item.status];
            const StatusIcon = status.icon;
            const outstanding = Math.max(item.invoicedTotal - item.paidTotal, 0);
            const recommendedAction = getRecommendedNextAction(item);
            const planningDraft = planningByCaseId[item.id];
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => openCase(item, recommendedAction.focus)}
                data-case-link-target={item.id}
                className={`text-right bg-white rounded-lg border border-gray-200 p-4 hover:border-emerald-300 hover:bg-emerald-50/30 transition-colors ${
                  highlightedCaseId === item.id ? 'ring-2 ring-emerald-400 ring-offset-2' : ''
                }`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-sm text-gray-600">{item.customerName}</p>
                    <p className="text-lg font-semibold text-gray-900 mt-0.5">{item.caseName}</p>
                    {isMovingProject(item.jobs) ? (
                      <span className="inline-flex mt-2 rounded-full border border-indigo-200 bg-indigo-50 px-2 py-0.5 text-[11px] font-medium text-indigo-700">
                        מעבר דירה
                      </span>
                    ) : null}
                  </div>
                  <div className="flex flex-col items-end gap-1">
                    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-xs font-medium ${status.className}`}>
                      <StatusIcon className="w-3.5 h-3.5" />
                      {status.label}
                    </span>
                    {item.isArchived ? (
                      <span className="inline-flex rounded-full border border-amber-300 bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-700">
                        בארכיון
                      </span>
                    ) : null}
                  </div>
                </div>

                <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-2 text-xs text-gray-600">
                  <div className="inline-flex items-center gap-1.5">
                    <CalendarClock className="w-3.5 h-3.5 text-gray-500" />
                    התחלה: {item.startDate}
                  </div>
                  <div className="inline-flex items-center gap-1.5">
                    <RotateCcw className="w-3.5 h-3.5 text-gray-500" />
                    פעילות אחרונה: {item.latestActivityDate}
                  </div>
                  <div className="inline-flex items-center gap-1.5">
                    <Users className="w-3.5 h-3.5 text-gray-500" />
                    מנהל אחראי: {item.assignedManager}
                  </div>
                  <div className="inline-flex items-center gap-1.5">
                    <MapPin className="w-3.5 h-3.5 text-gray-500" />
                    {item.addresses.length} כתובות קשורות
                  </div>
                </div>

                <div className="mt-3 border-t border-gray-100 pt-3 grid grid-cols-3 gap-2 text-center">
                  <div>
                    <p className="text-[11px] text-gray-500">עבודות</p>
                    <p className="text-sm font-semibold text-gray-900">{item.jobs.length}</p>
                  </div>
                  <div>
                    <p className="text-[11px] text-gray-500">חויב</p>
                    <p className="text-sm font-semibold text-gray-900">{canSeeFinancials ? formatCurrency(item.invoicedTotal) : 'מוסתר'}</p>
                  </div>
                  <div>
                    <p className="text-[11px] text-gray-500">יתרה</p>
                    <p className={`text-sm font-semibold ${outstanding > 0 ? 'text-amber-700' : 'text-emerald-700'}`}>
                      {canSeeFinancials ? formatCurrency(outstanding) : 'מוסתר'}
                    </p>
                  </div>
                </div>

                <div className="mt-3 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-900">
                  <span className="font-semibold">הפעולה הבאה:</span> {recommendedAction.label}
                </div>
                {planningDraft ? (
                  <div className="mt-2 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-xs text-gray-700">
                    <span className="font-semibold">שלב:</span> {pipelineStageLabel[planningDraft.pipelineStage]} •{' '}
                    <span className="font-semibold">תזמון:</span> {describeTimingDraft(planningDraft)}
                  </div>
                ) : null}
              </button>
            );
          })}
        </div>
      )}

      {viewMode === 'board' && (
        <div className="grid grid-cols-1 xl:grid-cols-4 gap-4">
          {(Object.keys(caseStatusMeta) as CaseStatus[]).map((columnStatus) => (
            <div
              key={columnStatus}
              onDragOver={(event) => {
                event.preventDefault();
                setDragOverStatus(columnStatus);
              }}
              onDragLeave={() => {
                if (dragOverStatus === columnStatus) {
                  setDragOverStatus(null);
                }
              }}
              onDrop={(event) => {
                event.preventDefault();
                handleBoardDrop(columnStatus);
              }}
              className={`rounded-lg border bg-white p-3 space-y-2 transition-colors ${
                dragOverStatus === columnStatus ? 'border-emerald-400 bg-emerald-50/40' : 'border-gray-200'
              }`}
            >
              <div className="flex items-center justify-between">
                <p className="text-sm font-semibold text-gray-900">{caseStatusMeta[columnStatus].label}</p>
                <span className="text-xs text-gray-500">{sortedFilteredCases.filter((item) => item.status === columnStatus).length}</span>
              </div>
              <div className="space-y-2 max-h-[420px] overflow-y-auto">
                {sortedFilteredCases.filter((item) => item.status === columnStatus).map((item) => {
                  const recommendedAction = getRecommendedNextAction(item);
                  return (
                  <div
                    key={`${columnStatus}-${item.id}`}
                    data-case-link-target={item.id}
                    draggable
                    onDragStart={() => {
                      setDraggedCaseId(item.id);
                      setDragOverStatus(columnStatus);
                    }}
                    onDragEnd={() => {
                      setDraggedCaseId(null);
                      setDragOverStatus(null);
                    }}
                    className={`rounded-lg border p-2 text-right cursor-grab active:cursor-grabbing ${
                      highlightedCaseId === item.id
                        ? 'border-emerald-300 bg-emerald-50 ring-2 ring-emerald-400 ring-offset-2'
                        : draggedCaseId === item.id
                          ? 'border-emerald-300 bg-emerald-50'
                          : 'border-gray-200'
                    }`}
                  >
                    <button type="button" onClick={() => openCase(item, recommendedAction.focus)} className="w-full text-right">
                      <p className="text-sm font-semibold text-gray-900">{item.caseName}</p>
                      <p className="text-xs text-gray-600 mt-1">{item.customerName}</p>
                      {isMovingProject(item.jobs) ? (
                        <span className="inline-flex mt-1 rounded-full border border-indigo-200 bg-indigo-50 px-2 py-0.5 text-[10px] font-medium text-indigo-700">
                          מעבר דירה
                        </span>
                      ) : null}
                    </button>
                    <div className="mt-2 rounded-md border border-emerald-200 bg-emerald-50 px-2 py-1 text-[11px] text-emerald-900">
                      <span className="font-medium">הפעולה הבאה:</span> {recommendedAction.label}
                    </div>
                    <p className="mt-2 text-[11px] text-gray-500">גררו לעמודת סטטוס אחרת כדי לעדכן.</p>
                  </div>
                )})}
              </div>
            </div>
          ))}
        </div>
      )}

      {sortedFilteredCases.length === 0 && (
        <div className="bg-white rounded-lg border border-gray-200 p-8 text-center text-sm text-gray-500">
          לא נמצאו פרוייקטים לפי הסינון הנוכחי.
        </div>
      )}

      {(openedCase || isCreating) && (
        <div
          className="fixed inset-0 z-50 bg-black/30 flex items-start justify-center overflow-y-auto p-4 py-6"
          onMouseDown={() => {
            setOpenedCaseId(null);
            setIsCreating(false);
            setCaseMessage('');
          }}
        >
          <div
            className="w-full max-w-2xl rounded-lg border border-gray-200 bg-white shadow-xl max-h-[84vh] overflow-y-auto"
            onMouseDown={(e) => e.stopPropagation()}
          >
            <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
              <button
                type="button"
                onClick={() => {
                  setOpenedCaseId(null);
                  setIsCreating(false);
                  setCaseMessage('');
                }}
                className="text-xs px-2 py-1 rounded border border-gray-300 text-gray-700 hover:bg-gray-50"
              >
                סגירה
              </button>
              <h3 className="font-semibold text-gray-900">{isCreating ? 'יצירת פרוייקט' : 'ניהול פרוייקט'}</h3>
            </div>

            <div className="p-6 space-y-4 text-right">
              {!isCreating && openedCase && caseActionFocus ? (
                <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-900" data-case-section="details">
                  <span className="font-semibold">מומלץ עכשיו:</span> {getRecommendedNextAction(openedCase).label}
                </div>
              ) : null}

              {!isCreating && openedCase ? (
                <div className="flex flex-wrap items-center justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => setCaseActionFocus('details')}
                    className={`rounded-full border px-3 py-1 text-xs ${caseActionFocus === 'details' ? 'border-emerald-300 bg-emerald-50 text-emerald-700' : 'border-gray-300 bg-white text-gray-700'}`}
                  >
                    פרטי פרוייקט
                  </button>
                  <button
                    type="button"
                    onClick={() => setCaseActionFocus('quote')}
                    className={`rounded-full border px-3 py-1 text-xs ${caseActionFocus === 'quote' ? 'border-emerald-300 bg-emerald-50 text-emerald-700' : 'border-gray-300 bg-white text-gray-700'}`}
                  >
                    הצעת מחיר
                  </button>
                  <button
                    type="button"
                    onClick={() => setCaseActionFocus('jobs')}
                    className={`rounded-full border px-3 py-1 text-xs ${caseActionFocus === 'jobs' ? 'border-emerald-300 bg-emerald-50 text-emerald-700' : 'border-gray-300 bg-white text-gray-700'}`}
                  >
                    עבודות
                  </button>
                  <button
                    type="button"
                    onClick={() => setCaseActionFocus('reports')}
                    className={`rounded-full border px-3 py-1 text-xs ${caseActionFocus === 'reports' ? 'border-emerald-300 bg-emerald-50 text-emerald-700' : 'border-gray-300 bg-white text-gray-700'}`}
                  >
                    דוחות וסגירה
                  </button>
                  <button
                    type="button"
                    onClick={() => setCaseActionFocus('payment')}
                    className={`rounded-full border px-3 py-1 text-xs ${caseActionFocus === 'payment' ? 'border-emerald-300 bg-emerald-50 text-emerald-700' : 'border-gray-300 bg-white text-gray-700'}`}
                  >
                    תשלום
                  </button>
                </div>
              ) : null}

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {isCreating ? (
                  <div className="md:col-span-2 space-y-2">
                    <label className="text-xs text-gray-700 block">לקוח לפרוייקט</label>
                    <select
                      value={selectedCustomerId}
                      onChange={(e) => {
                        setSelectedCustomerId(e.target.value);
                        const customer = customers.find((item) => item.id === e.target.value);
                        if (customer) {
                          setFormCustomerName(`${customer.firstName} ${customer.lastName}`.trim());
                        }
                      }}
                      disabled={createNewCustomer}
                      className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm bg-white disabled:bg-gray-50 disabled:text-gray-400"
                    >
                      <option value="">בחירת לקוח קיים</option>
                      {customers.map((customer) => (
                        <option key={customer.id} value={customer.id}>
                          {customer.firstName} {customer.lastName}
                        </option>
                      ))}
                    </select>
                    <label className="inline-flex items-center gap-2 text-xs text-gray-700">
                      <input
                        type="checkbox"
                        checked={createNewCustomer}
                        onChange={(e) => {
                          setCreateNewCustomer(e.target.checked);
                          if (e.target.checked) {
                            setSelectedCustomerId('');
                          }
                        }}
                      />
                      יצירת לקוח חדש מתוך חלון יצירת הפרוייקט
                    </label>
                    {createNewCustomer ? (
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                        <input value={newCustomerFirstName} onChange={(e) => setNewCustomerFirstName(e.target.value)} className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-right" placeholder="שם פרטי" />
                        <input value={newCustomerLastName} onChange={(e) => setNewCustomerLastName(e.target.value)} className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-right" placeholder="שם משפחה" />
                        <input value={newCustomerPhone} onChange={(e) => setNewCustomerPhone(e.target.value)} className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-right" placeholder="טלפון" />
                        <input value={newCustomerEmail} onChange={(e) => setNewCustomerEmail(e.target.value)} className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-right" placeholder="אימייל" />
                      </div>
                    ) : null}
                  </div>
                ) : (
                  <input value={formCustomerName} onChange={(e) => setFormCustomerName(e.target.value)} className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-right bg-gray-50" placeholder="שם לקוח" disabled />
                )}
                <input value={formCaseName} onChange={(e) => setFormCaseName(e.target.value)} className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-right" placeholder="שם פרוייקט" />
                <select title="סטטוס פרוייקט" value={formStatus} onChange={(e) => setFormStatus(e.target.value as CaseStatus)} className="rounded-lg border border-gray-300 px-3 py-2 text-sm bg-white">
                  <option value="DRAFT">משוריין</option>
                  <option value="ACTIVE">מאושר לביצוע</option>
                  <option value="READY_FOR_REVIEW">עבודה הסתיימה</option>
                  <option value="COMPLETED">עבודה שולמה</option>
                </select>
                <input value={formManager} onChange={(e) => setFormManager(e.target.value)} className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-right" placeholder="מנהל אחראי" />
                <textarea value={formNotes} onChange={(e) => setFormNotes(e.target.value)} className="md:col-span-2 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-right min-h-[90px]" placeholder="הערות פנימיות" />
              </div>

              <div className="rounded-lg border border-gray-200 p-4 space-y-3" data-case-section="details">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-sm font-semibold text-gray-900">תכנון פרוייקט ראשוני</p>
                  <span className="text-xs text-gray-500">לניהול פרוייקט גם לפני שיש עבודות ביומן</span>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <label className="text-xs text-gray-700 space-y-1">
                    <span className="block">שלב פרוייקט</span>
                    <select
                      value={formPipelineStage}
                      onChange={(e) => setFormPipelineStage(e.target.value as ProjectPipelineStage)}
                      className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm bg-white"
                    >
                      {(Object.keys(pipelineStageLabel) as ProjectPipelineStage[]).map((stage) => (
                        <option key={stage} value={stage}>{pipelineStageLabel[stage]}</option>
                      ))}
                    </select>
                  </label>
                  <label className="text-xs text-gray-700 space-y-1">
                    <span className="block">דיוק תזמון</span>
                    <select
                      value={formTimingPrecision}
                      onChange={(e) => setFormTimingPrecision(e.target.value as ProjectTimingPrecision)}
                      className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm bg-white"
                    >
                      {(Object.keys(timingPrecisionLabel) as ProjectTimingPrecision[]).map((precision) => (
                        <option key={precision} value={precision}>{timingPrecisionLabel[precision]}</option>
                      ))}
                    </select>
                  </label>
                </div>
                {formTimingPrecision === 'EXACT_DATE' ? (
                  <input value={formExactDate} onChange={(e) => setFormExactDate(e.target.value)} type="date" className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm bg-white" />
                ) : null}
                {formTimingPrecision === 'DATE_RANGE' ? (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <input value={formRangeStart} onChange={(e) => setFormRangeStart(e.target.value)} type="date" className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm bg-white" />
                    <input value={formRangeEnd} onChange={(e) => setFormRangeEnd(e.target.value)} type="date" className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm bg-white" />
                  </div>
                ) : null}
                {formTimingPrecision === 'EXPECTED_MONTH' ? (
                  <input value={formExpectedMonth} onChange={(e) => setFormExpectedMonth(e.target.value)} type="month" className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm bg-white" />
                ) : null}
                {formTimingPrecision === 'EXPECTED_QUARTER' ? (
                  <select value={formExpectedQuarter} onChange={(e) => setFormExpectedQuarter(e.target.value as 'Q1' | 'Q2' | 'Q3' | 'Q4')} className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm bg-white">
                    <option value="Q1">Q1 (ינואר-מרץ)</option>
                    <option value="Q2">Q2 (אפריל-יוני)</option>
                    <option value="Q3">Q3 (יולי-ספטמבר)</option>
                    <option value="Q4">Q4 (אוקטובר-דצמבר)</option>
                  </select>
                ) : null}
                {formTimingPrecision === 'DATE_UNKNOWN' ? (
                  <input value={formDateUnknownReason} onChange={(e) => setFormDateUnknownReason(e.target.value)} className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-right" placeholder="מדוע התאריך עדיין לא ידוע?" />
                ) : null}

                <div className="rounded-lg border border-gray-200 bg-gray-50 p-3 space-y-2">
                  <div className="flex items-center justify-between">
                    <p className="text-xs font-semibold text-gray-800">רכיבי שירות מתוכננים</p>
                    <button
                      type="button"
                      onClick={() =>
                        setFormPlannedComponents((prev) => [
                          ...prev,
                          {
                            id: `planned-${Date.now()}-${prev.length + 1}`,
                            serviceType: 'אריזה',
                            estimatedDays: 1,
                            workersPerDay: 2,
                            notes: '',
                          },
                        ])
                      }
                      className="px-2 py-1 text-[11px] rounded border border-gray-300 text-gray-700 hover:bg-white"
                    >
                      הוספת רכיב
                    </button>
                  </div>
                  {formPlannedComponents.length === 0 ? (
                    <p className="text-xs text-gray-500">אין רכיבים עדיין. אפשר להתחיל בלי עבודות ביומן ולהוסיף כאן תכנון ראשוני.</p>
                  ) : (
                    <div className="space-y-2">
                      {formPlannedComponents.map((component) => (
                        <div key={component.id} className="grid grid-cols-1 md:grid-cols-5 gap-2 rounded-lg border border-gray-200 bg-white p-2">
                          <select
                            value={component.serviceType}
                            onChange={(e) =>
                              setFormPlannedComponents((prev) =>
                                prev.map((current) => (current.id === component.id ? { ...current, serviceType: e.target.value as CaseJob['type'] } : current)),
                              )
                            }
                            className="rounded border border-gray-300 px-2 py-1 text-xs bg-white"
                          >
                            <option value="אריזה">אריזה</option>
                            <option value="פריקה">פריקה</option>
                            <option value="סידור">סידור</option>
                          </select>
                          <input
                            type="number"
                            min={1}
                            value={component.estimatedDays}
                            onChange={(e) =>
                              setFormPlannedComponents((prev) =>
                                prev.map((current) => (current.id === component.id ? { ...current, estimatedDays: Number(e.target.value) } : current)),
                              )
                            }
                            className="rounded border border-gray-300 px-2 py-1 text-xs"
                            placeholder="ימי עבודה"
                          />
                          <input
                            type="number"
                            min={1}
                            value={component.workersPerDay}
                            onChange={(e) =>
                              setFormPlannedComponents((prev) =>
                                prev.map((current) => (current.id === component.id ? { ...current, workersPerDay: Number(e.target.value) } : current)),
                              )
                            }
                            className="rounded border border-gray-300 px-2 py-1 text-xs"
                            placeholder="עובדים ליום"
                          />
                          <input
                            value={component.notes}
                            onChange={(e) =>
                              setFormPlannedComponents((prev) =>
                                prev.map((current) => (current.id === component.id ? { ...current, notes: e.target.value } : current)),
                              )
                            }
                            className="rounded border border-gray-300 px-2 py-1 text-xs text-right"
                            placeholder="הערה"
                          />
                          <button
                            type="button"
                            onClick={() => setFormPlannedComponents((prev) => prev.filter((current) => current.id !== component.id))}
                            className="rounded border border-rose-300 px-2 py-1 text-xs text-rose-700 hover:bg-rose-50"
                          >
                            הסרה
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              <div className="rounded-lg border border-gray-200 p-4 space-y-3" data-case-section="quote">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-semibold text-gray-900">הצעת מחיר</p>
                  <span className="text-xs text-gray-500">נדרש אישור לפני מעבר ממשוריין למאושר לביצוע</span>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  <label className="text-xs text-gray-700 space-y-1">
                    <span className="block">תעריף שעתי</span>
                    <select
                      value={formQuoteRate}
                      onChange={(e) => setFormQuoteRate(Number(e.target.value))}
                      className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm bg-white"
                    >
                      {[175, 170, 160, 150, 140].map((rate) => (
                        <option key={rate} value={rate}>{rate} ₪</option>
                      ))}
                    </select>
                  </label>
                  <label className="text-xs text-gray-700 space-y-1">
                    <span className="block">שעות משוערות</span>
                    <input
                      type="number"
                      min={1}
                      step={0.5}
                      value={formQuoteHours}
                      onChange={(e) => setFormQuoteHours(Number(e.target.value))}
                      className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                    />
                  </label>
                  <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-800">
                    <p>סה״כ הצעה</p>
                    <p className="text-base font-semibold mt-1">{formatCurrency(quoteTotal)}</p>
                  </div>
                </div>
                <div className="rounded-lg border border-gray-200 bg-gray-50 p-3 text-xs text-gray-700">
                  <p className="font-semibold text-gray-900 mb-1">תצוגה מקדימה ללקוח</p>
                  <p>היי {formCustomerName || 'לקוח יקר'},</p>
                  <p>
                    מצורפת הצעת מחיר עבור "{formCaseName || 'פרוייקט חדש'}": {formQuoteHours || 0} שעות × {formQuoteRate || 0} ₪ לשעה = {formatCurrency(quoteTotal)}.
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      if (!openedCase?.customerEmail) {
                        setCaseMessage('אין כתובת אימייל ללקוח בכרטיס הפרוייקט.');
                        return;
                      }
                      const subject = encodeURIComponent(`הצעת מחיר - ${formCaseName || openedCase.caseName}`);
                      const body = encodeURIComponent(
                        `היי ${openedCase.customerName},\nמצורפת הצעת המחיר עבור "${formCaseName || openedCase.caseName}".\n${formQuoteHours || 0} שעות × ${formQuoteRate || 0} ₪ לשעה = ${formatCurrency(quoteTotal)}.\n\nתודה,\nצוות Space & Order`,
                      );
                      window.open(`mailto:${openedCase.customerEmail}?subject=${subject}&body=${body}`, '_blank', 'noopener,noreferrer');
                      setFormQuoteSent(true);
                      setCaseMessage('נפתח אימייל עם הצעת המחיר ללקוח.');
                    }}
                    className="px-3 py-2 text-xs rounded-lg border border-blue-300 text-blue-700 hover:bg-blue-50"
                  >
                    שליחת הצעת מחיר במייל
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      if (!openedCase?.customerPhone) {
                        setCaseMessage('אין מספר טלפון ללקוח בכרטיס הפרוייקט.');
                        return;
                      }
                      const whatsappLink = toWhatsAppLink(
                        openedCase.customerPhone,
                        `היי ${openedCase.customerName}, מצורפת הצעת המחיר עבור "${formCaseName || openedCase.caseName}": ${formQuoteHours || 0} שעות × ${formQuoteRate || 0} ₪ לשעה = ${formatCurrency(quoteTotal)}. נשמח לאישור.`,
                      );
                      if (!whatsappLink) {
                        setCaseMessage('מספר הטלפון של הלקוח לא תקין לשליחה בוואטסאפ.');
                        return;
                      }
                      window.open(whatsappLink, '_blank', 'noopener,noreferrer');
                      setFormQuoteSent(true);
                      setCaseMessage('נפתח חלון וואטסאפ לשליחת הצעת המחיר.');
                    }}
                    className="px-3 py-2 text-xs rounded-lg border border-emerald-300 text-emerald-700 hover:bg-emerald-50"
                  >
                    שליחת הצעת מחיר בוואטסאפ
                  </button>
                  <label className="inline-flex items-center gap-2 text-xs text-gray-700">
                    <input
                      type="checkbox"
                      checked={formQuoteApproved}
                      onChange={(e) => setFormQuoteApproved(e.target.checked)}
                      className="rounded border-gray-300"
                    />
                    הצעת המחיר אושרה על ידי הלקוח
                  </label>
                  <span className={`text-xs ${formQuoteSent ? 'text-emerald-700' : 'text-amber-700'}`}>
                    {formQuoteSent ? 'הצעה נשלחה' : 'הצעה טרם נשלחה'}
                  </span>
                </div>
              </div>

              {!isCreating && openedCase && selectedCommunicationTemplate ? (
                <div className="rounded-lg border border-sky-200 bg-sky-50 p-4 space-y-3">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-sm font-semibold text-sky-900">תבניות תקשורת לקוח</p>
                    <span className="text-xs text-sky-800">תצוגה מקדימה + מעקב שליחות</span>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <label className="text-xs text-sky-900 space-y-1">
                      <span className="block">בחירת תבנית</span>
                      <select
                        value={selectedCommunicationTemplateKey}
                        onChange={(event) => {
                          const nextKey = event.target.value as ProjectCommunicationTemplateKey;
                          setSelectedCommunicationTemplateKey(nextKey);
                          const nextTemplate = communicationTemplates.find((template) => template.key === nextKey);
                          if (nextTemplate) {
                            setSelectedCommunicationChannel(nextTemplate.defaultChannel);
                          }
                        }}
                        className="w-full rounded-lg border border-sky-300 px-3 py-2 text-sm bg-white"
                      >
                        {communicationTemplates.map((template) => (
                          <option key={template.key} value={template.key}>
                            {template.title}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="text-xs text-sky-900 space-y-1">
                      <span className="block">ערוץ שליחה</span>
                      <select
                        value={selectedCommunicationChannel}
                        onChange={(event) => setSelectedCommunicationChannel(event.target.value as ProjectCommunicationChannel)}
                        className="w-full rounded-lg border border-sky-300 px-3 py-2 text-sm bg-white"
                      >
                        <option value="whatsapp">וואטסאפ</option>
                        <option value="email">אימייל</option>
                      </select>
                    </label>
                  </div>
                  <div className="rounded-lg border border-sky-200 bg-white p-3 text-xs text-sky-900 space-y-2">
                    <p className="font-semibold">{selectedCommunicationTemplate.title}</p>
                    <p>{selectedCommunicationTemplate.description}</p>
                    <p className="font-semibold">נושא:</p>
                    <p>{selectedCommunicationTemplate.subject}</p>
                    <p className="font-semibold">תוכן:</p>
                    <pre className="whitespace-pre-wrap text-xs leading-5">{selectedCommunicationTemplate.body}</pre>
                    {!selectedCommunicationTemplate.isEnabled ? (
                      <p className="text-amber-700">{selectedCommunicationTemplate.disabledReason}</p>
                    ) : null}
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={sendProjectCommunication}
                      disabled={!selectedCommunicationTemplate.isEnabled}
                      className="px-3 py-2 text-xs rounded-lg border border-sky-300 text-sky-800 hover:bg-sky-100 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      שליחת {selectedCommunicationTemplate.title} דרך {communicationChannelLabel(selectedCommunicationChannel)}
                    </button>
                    <span className="text-xs text-sky-800">נמען: {selectedCommunicationChannel === 'whatsapp' ? openedCase.customerPhone || 'לא קיים' : openedCase.customerEmail || 'לא קיים'}</span>
                  </div>
                  <div className="rounded-lg border border-sky-200 bg-white p-3">
                    <p className="text-xs font-semibold text-sky-900 mb-2">מעקב שליחות לפרוייקט</p>
                    {openedCaseCommunicationLog.length === 0 ? (
                      <p className="text-xs text-sky-800">טרם נשלחו הודעות מתוך מודול התבניות.</p>
                    ) : (
                      <div className="space-y-2 max-h-[180px] overflow-y-auto">
                        {openedCaseCommunicationLog.map((entry) => (
                          <div key={entry.id} className="rounded-lg border border-sky-200 bg-sky-50 px-3 py-2 text-xs">
                            <p className="font-semibold text-sky-900">
                              {communicationTemplateTitle(entry.templateKey)} • {communicationChannelLabel(entry.channel)}
                            </p>
                            <p className="text-sky-800 mt-1">נמען: {entry.recipient || 'לא זמין'}</p>
                            <p className="text-sky-800 mt-1">נשלח: {new Date(entry.sentAt).toLocaleString('he-IL')}</p>
                            <p className="text-sky-800 mt-1">נשלח על ידי: {entry.performedByName || 'משתמש מערכת'}</p>
                            <p className="text-sky-700 mt-1">{entry.preview}...</p>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              ) : null}

              {!isCreating && openedCase ? (
                <div className="rounded-lg border border-indigo-200 bg-indigo-50 p-4 space-y-2">
                  <p className="text-sm font-semibold text-indigo-900">אוטומציות לקוח לפי פרוייקט</p>
                  <div className="text-xs text-indigo-900 space-y-1">
                    <p>
                      סוג פרוייקט: <span className="font-semibold">{openedCaseIsMovingProject ? 'מעבר דירה' : 'פרוייקט רגיל'}</span>
                    </p>
                    <p>
                      שליחת טופס ציוד אריזה: <span className="font-semibold">{formQuoteApproved ? packingFormAutoSendDateLabel ?? 'אין עבודת אריזה' : 'לאחר אישור הצעת מחיר'}</span>
                    </p>
                    <p>
                      תזכורת לקוח יומיים לפני תחילת עבודה: <span className="font-semibold">{moveReminderDateLabel ?? 'לא רלוונטי (אין מעבר דירה)'}</span>
                    </p>
                    <p>
                      מעבר אוטומטי ל"עבודה הסתיימה": <span className="font-semibold">כאשר כל המשמרות נסגרו וכל טפסי סוף משמרת נקלטו</span>
                    </p>
                  </div>
                </div>
              ) : null}

              {!isCreating && openedCase && (
                <>
                  {(openedCaseHub?.readyForFinalReport ?? isCaseReadyForFinalReport(openedCase, openedCaseForms.length)) && (
                    <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3">
                      <p className="text-sm font-semibold text-emerald-800">הפרוייקט מוכן לדוח סופי ללקוח</p>
                      <p className="text-xs text-emerald-700 mt-1">
                        כל המשמרות בפרוייקט הושלמו, טפסי הסיום נקלטו, וכל העובדות יצאו מהמשמרת האחרונה. ניתן לשלוח התראה ולהפיק דוח סופי מתוך הפרוייקט.
                      </p>
                      <div className="mt-2 flex flex-wrap items-center gap-2">
                        <button
                          type="button"
                          onClick={() => {
                            setCases((prev) =>
                              prev.map((item) =>
                                item.id === openedCase.id
                                  ? { ...item, finalReportNotificationSent: true, finalReportStatus: 'מוכן' }
                                  : item,
                              ),
                            );
                            setCaseMessage('נשלחה התראה: הפרוייקט מוכן להפקת דוח סופי.');
                          }}
                          className="px-3 py-1.5 text-xs rounded-lg border border-emerald-300 text-emerald-700 hover:bg-emerald-100"
                        >
                          שליחת התראה למנהל
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setCases((prev) =>
                              prev.map((item) =>
                                item.id === openedCase.id
                                  ? {
                                      ...item,
                                      finalReportStatus: 'מוכן',
                                      customerReportStatus: 'נשלח',
                                      customerFinalReportSentAt: new Date().toLocaleString('he-IL'),
                                    }
                                  : item,
                              ),
                            );
                            setCaseMessage('דוח סופי ללקוח סומן כנשלח מתוך הפרוייקט.');
                          }}
                          className="px-3 py-1.5 text-xs rounded-lg border border-emerald-300 text-emerald-700 hover:bg-emerald-50"
                        >
                          שליחת דוח סופי ללקוח
                        </button>
                      </div>
                    </div>
                  )}

                  <div className="rounded-lg border border-gray-200 p-3" data-case-section="reports">
                    <p className="text-xs text-gray-500 mb-2">צ׳קליסט סגירת פרוייקט</p>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-2 text-xs">
                      <div className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2">
                        <p className="text-gray-500">משמרות שבוצעו</p>
                        <p className="font-semibold text-gray-900 mt-1">
                          {openedCaseHub ? openedCaseHub.checklist.completedOrCancelledJobs : openedCase.jobs.filter((job) => job.status === 'בוצע').length}/
                          {openedCaseHub ? openedCaseHub.checklist.totalJobs : openedCase.jobs.length}
                        </p>
                      </div>
                      <div className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2">
                        <p className="text-gray-500">טפסי סוף משמרת קשורים</p>
                        <p className="font-semibold text-gray-900 mt-1">{openedCaseHub ? openedCaseHub.checklist.linkedForms : openedCaseForms.length}</p>
                      </div>
                      <div className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2">
                        <p className="text-gray-500">יציאה ממשמרת אחרונה</p>
                        <p
                          className={`font-semibold mt-1 ${
                            openedCaseHub
                              ? openedCaseHub.checklist.totalShifts > 0 && openedCaseHub.checklist.totalShifts === openedCaseHub.checklist.closedShifts
                                ? 'text-emerald-700'
                                : 'text-amber-700'
                              : openedCase.lastShiftClockedOut
                                ? 'text-emerald-700'
                                : 'text-amber-700'
                          }`}
                        >
                          {openedCaseHub
                            ? openedCaseHub.checklist.totalShifts > 0 && openedCaseHub.checklist.totalShifts === openedCaseHub.checklist.closedShifts
                              ? 'סומן'
                              : 'טרם סומן'
                            : openedCase.lastShiftClockedOut
                              ? 'סומן'
                              : 'טרם סומן'}
                        </p>
                      </div>
                    </div>
                  </div>

                  <div className="rounded-lg border border-gray-200 p-3" data-case-section="jobs">
                    <p className="text-xs text-gray-500 mb-2">עבודות קשורות לפרוייקט</p>
                    <div className="space-y-2 max-h-[180px] overflow-y-auto">
                      {openedCase.jobs.map((job) => (
                        <div key={job.id} className="rounded-lg border border-gray-200 px-3 py-2 text-xs">
                          <div className="flex items-center justify-between gap-2">
                            <span className="font-semibold text-gray-900">{job.type} • {job.date}</span>
                            <span className="text-gray-600">{job.status}</span>
                          </div>
                          <div className="text-gray-600 mt-1">{job.address} • {job.workers} עובדים</div>
                        </div>
                      ))}
                    </div>
                    <div className="mt-3 inline-flex items-center gap-2 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-xs text-gray-700">
                      <input
                        type="checkbox"
                        checked={openedCase.lastShiftClockedOut}
                        onChange={(event) => {
                          const checked = event.target.checked;
                          setCases((prev) =>
                            prev.map((item) => (item.id === openedCase.id ? { ...item, lastShiftClockedOut: checked } : item)),
                          );
                        }}
                      />
                      סימון: כל העובדות יצאו מהמשמרת האחרונה בפרוייקט
                    </div>
                  </div>

                  <div className="rounded-lg border border-gray-200 p-3">
                    <div className="flex items-center justify-between gap-2 mb-2">
                      <p className="text-xs text-gray-500">טפסי סיום משמרת מקושרים לפרוייקט</p>
                      <button
                        type="button"
                        onClick={() => {
                          window.location.href = '/forms';
                        }}
                        className="px-2 py-1 text-[11px] rounded border border-gray-300 text-gray-700 hover:bg-gray-50"
                      >
                        לטפסים
                      </button>
                    </div>
                    {openedCaseForms.length === 0 ? (
                      <p className="text-xs text-amber-700">טרם נקלטו טפסי סוף משמרת לפרוייקט זה.</p>
                    ) : (
                      <div className="space-y-2 max-h-[180px] overflow-y-auto">
                        {openedCaseForms.map((form) => (
                          <div key={form.id} className="rounded-lg border border-gray-200 px-3 py-2 text-xs">
                            <p className="font-semibold text-gray-900">{form.workerName}</p>
                            <p className="text-gray-600 mt-1">
                              {form.jobType} • {form.shiftDate} • {form.status}
                            </p>
                            <p className="text-gray-500 mt-1">{form.completedAt}</p>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                    <button type="button" onClick={() => runCaseAction('ready')} className="px-3 py-2 text-xs rounded-lg border border-amber-300 text-amber-700 hover:bg-amber-50 inline-flex items-center justify-center gap-1.5">
                      <Eye className="w-3.5 h-3.5" />
                      סימון כעבודה הסתיימה
                    </button>
                    <button type="button" onClick={() => runCaseAction('complete')} className="px-3 py-2 text-xs rounded-lg border border-emerald-300 text-emerald-700 hover:bg-emerald-50 inline-flex items-center justify-center gap-1.5">
                      <CheckCircle2 className="w-3.5 h-3.5" />
                      סימון כעבודה שולמה
                    </button>
                    <button type="button" onClick={() => runCaseAction('reopen')} className="px-3 py-2 text-xs rounded-lg border border-blue-300 text-blue-700 hover:bg-blue-50 inline-flex items-center justify-center gap-1.5">
                      <RotateCcw className="w-3.5 h-3.5" />
                      החזרה למאושר לביצוע
                    </button>
                  </div>

                  <div className="rounded-lg border border-rose-200 bg-rose-50 p-3 space-y-2">
                    <p className="text-xs font-semibold text-rose-700">מחיקת פרוייקט</p>
                    <textarea
                      value={deleteReason}
                      onChange={(e) => setDeleteReason(e.target.value)}
                      className="w-full rounded-lg border border-rose-200 bg-white px-3 py-2 text-sm text-right min-h-[70px]"
                      placeholder="סיבת מחיקה (חובה)"
                    />
                    <button
                      type="button"
                      onClick={deleteOpenedCase}
                      className="px-3 py-2 text-xs rounded-lg border border-rose-300 text-rose-700 hover:bg-rose-100 inline-flex items-center gap-1.5"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      מחיקת פרוייקט ושמירה בהיסטוריה
                    </button>
                  </div>

                  <div className="rounded-lg border border-gray-200 p-3">
                    <p className="text-xs text-gray-500 mb-2">היסטוריית מחיקות ללקוח</p>
                    {customerDeletedCases.length === 0 ? (
                      <p className="text-xs text-gray-500">אין היסטוריית מחיקות ללקוח זה.</p>
                    ) : (
                      <div className="space-y-2 max-h-[130px] overflow-y-auto">
                        {customerDeletedCases.map((entry) => (
                          <div key={entry.id} className="rounded-lg border border-gray-200 px-3 py-2 text-xs">
                            <p className="font-semibold text-gray-900">{entry.caseName}</p>
                            <p className="text-gray-600 mt-1">{entry.deletedAt}</p>
                            <p className="text-gray-700 mt-1">סיבה: {entry.reason}</p>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-xs" data-case-section="payment">
                    <div className="rounded-lg border border-gray-200 p-3">
                      <p className="text-gray-500">סטטוס דוח פנימי</p>
                      <p className="font-semibold text-gray-900 mt-1">{openedCase.finalReportStatus}</p>
                    </div>
                    <div className="rounded-lg border border-gray-200 p-3">
                      <p className="text-gray-500">סטטוס דוח לקוח</p>
                      <p className="font-semibold text-gray-900 mt-1">{openedCase.customerReportStatus}</p>
                      <p className="text-[11px] text-gray-500 mt-1">{openedCase.customerFinalReportSentAt ? `נשלח: ${openedCase.customerFinalReportSentAt}` : 'טרם נשלח'}</p>
                    </div>
                    <div className="rounded-lg border border-gray-200 p-3">
                      <p className="text-gray-500">יתרה פתוחה</p>
                      <p className="font-semibold text-gray-900 mt-1">{canSeeFinancials ? formatCurrency(Math.max(openedCase.invoicedTotal - openedCase.paidTotal, 0)) : 'מוסתר'}</p>
                    </div>
                  </div>
                </>
              )}

              <div className="flex items-center gap-2">
                <button type="button" onClick={saveCase} className="px-4 py-2 text-sm rounded-lg bg-emerald-600 text-white hover:bg-emerald-700 inline-flex items-center gap-1.5">
                  <Pencil className="w-4 h-4" />
                  {isCreating ? 'יצירת פרוייקט' : 'שמירת עדכון'}
                </button>
                {!isCreating && (
                  <button
                    type="button"
                    onClick={() =>
                      showDevFeatureNotice('יצירת דוח סופי', 'הדוח הסופי המלא עדיין לא מחובר לייצוא אמיתי מתוך הפרוייקט.')
                    }
                    className="px-4 py-2 text-sm rounded-lg border border-gray-300 text-gray-700 hover:bg-gray-50 inline-flex items-center gap-1.5"
                  >
                    <FileText className="w-4 h-4" />
                    יצירת דוח סופי (דמו)
                  </button>
                )}
              </div>

              {caseMessage && (
                <p className={`text-sm ${caseMessage.includes('בהצלחה') || caseMessage.includes('סומן') || caseMessage.includes('נפתח') || caseMessage.includes('נמחק') ? 'text-emerald-700' : 'text-rose-700'}`}>
                  {caseMessage}
                </p>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

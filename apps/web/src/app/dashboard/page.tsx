'use client';

import { useMemo, useState, useEffect, useRef } from 'react';
import Link from 'next/link';
import { useUser, useAuth } from '@clerk/nextjs';
import { dashboardIssueActionLabel, orderDashboardWorkflowSections, caseStatusLabel, caseStatusTone, type CaseStatusValue, type StatusTone, workerRowBadge, fillsRequiredSlot, workerRowAssignments, getStaffingIssueBreakdown, formatBusinessDate } from '@workforce/shared';
import {
  AlertTriangle,
  BriefcaseBusiness,
  Bell,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Clock3,
  FileText,
  MoreHorizontal,
  Plus,
  Repeat2,
  Settings,
  UserPlus,
  Users,
  UsersRound,
  WandSparkles,
} from 'lucide-react';
import { getNonWorkingDayLabel, isWorkCreationBlockedDay } from '../../lib/non-working-days';
import { QuickCreateForm } from '../../components/jobs/QuickCreateForm';
import { JoinRequestsPanel } from '../../components/owner/JoinRequestsPanel';
import { SidePanel } from '../../components/ui/SidePanel';
import { PageHeader } from '../../components/ui/PageHeader';
import { api, authHeaders } from '../../lib/api';
import { OwnerJobDetail } from '../../components/jobs/OwnerJobDetail';
import { StaffingGapSummary } from '../../components/jobs/StaffingStateSummary';

type JobType = 'אריזה' | 'פריקה' | 'סידור';
type StaffingMode = 'auto' | 'approval';

const JOB_TYPE_TO_ENUM: Record<JobType, string> = {
  'אריזה': 'PACKING',
  'פריקה': 'UNPACKING',
  'סידור': 'HOME_ORGANIZATION',
};
type CaseStatus = 'DRAFT' | 'ACTIVE' | 'READY_FOR_REVIEW' | 'COMPLETED';
type DashboardWorkerRole = 'מנהלת' | 'ראש צוות' | 'עובדת';

type Customer = {
  id: string;
  fullName: string;
  phone: string;
  email: string;
  addresses: string[];
};

type CustomerCase = {
  id: string;
  customerId: string;
  caseName: string;
  status: CaseStatus;
  latestJobDate: string;
};

type DashboardWorker = {
  id: string;
  name: string;
  role: DashboardWorkerRole;
  hourlyWage: number;
};

type DailyInfo = {
  id: string;
  dateKey: string;
  title: string;
  body: string;
  updatedAt: string;
};

// Actionable owner items (spec §7) — all backed by implemented domain logic
// via GET /admin/tasks.
type AttentionJobView = {
  jobId: string;
  date: string;
  plannedStart: string;
  status: 'RESERVATION' | 'APPROVED' | 'COMPLETED' | 'ARCHIVED';
  customerName: string;
  jobType: string | null;
};

type OwnerTasks = {
  joinRequests: number;
  pendingAcceptance: number;
  replacementRequests: number;
  swapApprovals: number;
  attendanceReview: number;
  reportCorrections: number;
  customerReportReady: number;
  // Priority-1 operational items (§7.4): counts + directly-linkable job rows.
  todayInReservation: number;
  pastNotCompleted: number;
  missingExactAddress: number;
  todayInReservationJobs: AttentionJobView[];
  pastNotCompletedJobs: AttentionJobView[];
  missingExactAddressJobs: Array<AttentionJobView & { address: string }>;
};

const MOM_OWNER_NAME = 'אורית';

const initialCustomers: Customer[] = [];
const initialCases: CustomerCase[] = [];

function normalizePhone(value: string) {
  return value.replace(/\D/g, '');
}

function toDisplayDateFromDateKey(dateKey: string) {
  const [, month, day] = dateKey.split('-').map(Number);
  return `${String(day).padStart(2, '0')}.${String(month).padStart(2, '0')}`;
}

function toSundayWeekKey(dateKey: string) {
  const date = parseDateKey(dateKey);
  const sunday = new Date(date);
  sunday.setDate(date.getDate() - date.getDay());
  return toDateKeyFromDate(sunday);
}

function isValidIsraeliPhone(value: string) {
  const n = normalizePhone(value);
  return n.startsWith('0') && (n.length === 9 || n.length === 10);
}

function isValidEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

function isValidFullAddress(value: string) {
  const trimmed = value.trim();
  return trimmed.length >= 12 && /\d/.test(trimmed) && trimmed.includes(',');
}

function buildAddressWithUnit(baseAddress: string, floor: string, apartment: string) {
  const parts = [baseAddress.trim()];
  if (floor.trim()) {
    parts.push(`קומה ${floor.trim()}`);
  }
  if (apartment.trim()) {
    parts.push(`דירה ${apartment.trim()}`);
  }
  return parts.join(', ');
}

function parseDateKey(dateKey: string) {
  const [year, month, day] = dateKey.split('-').map(Number);
  return new Date(year, month - 1, day);
}

function toDateKeyFromDate(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function getTodayAnchorDate() {
  const current = new Date();
  return new Date(current.getFullYear(), current.getMonth(), current.getDate());
}

function daysBetween(a: string, b: string) {
  const aTime = parseDateKey(a).getTime();
  const bTime = parseDateKey(b).getTime();
  return Math.floor((aTime - bTime) / (1000 * 60 * 60 * 24));
}

function formatK(value: number) {
  return `₪${(value / 1000).toFixed(1)}K`;
}

function getGreetingByHour(hour: number) {
  if (hour >= 5 && hour < 12) return 'בוקר טוב';
  if (hour >= 12 && hour < 17) return 'צהריים טובים';
  if (hour >= 17 && hour < 22) return 'ערב טוב';
  return 'לילה טוב';
}

function sortWorksByDate<T extends { dateKey: string; id: number }>(works: T[]) {
  return [...works].sort((a, b) => a.dateKey.localeCompare(b.dateKey) || a.id - b.id);
}

function addDaysToDateKey(dateKey: string, days: number) {
  const date = parseDateKey(dateKey);
  date.setDate(date.getDate() + days);
  return toDateKeyFromDate(date);
}

function getShiftTypeCardClasses(jobType: JobType) {
  if (jobType === 'אריזה') {
    return 'border-red-200 bg-red-50 text-red-900 hover:border-red-400';
  }
  if (jobType === 'פריקה') {
    return 'border-amber-200 bg-amber-50 text-amber-900 hover:border-amber-400';
  }
  return 'border-blue-200 bg-blue-50 text-blue-900 hover:border-blue-400';
}

const CASE_BADGE_CLASS_BY_TONE: Record<StatusTone, string> = {
  success: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  warning: 'border-amber-200 bg-amber-50 text-amber-700',
  info: 'border-blue-200 bg-blue-50 text-blue-700',
  error: 'border-rose-200 bg-rose-50 text-rose-700',
  neutral: 'border-gray-200 bg-gray-50 text-gray-600',
};

function caseBadge(status: CaseStatusValue): { label: string; className: string } {
  return { label: caseStatusLabel(status), className: CASE_BADGE_CLASS_BY_TONE[caseStatusTone(status)] };
}

export default function DashboardPage() {
  const { user } = useUser();
  const { getToken } = useAuth();
  // Gate time/user-dependent text so SSR and first client render match (React #418).
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setMounted(true);
  }, []);
  type RangeKey = 'today' | 'week' | 'month' | 'custom';
  const [selectedRange, setSelectedRange] = useState<RangeKey>('week');
  const [customFromDate, setCustomFromDate] = useState('2026-07-01');
  const [customToDate, setCustomToDate] = useState('2026-07-31');

  const rangeOptions: { key: RangeKey; label: string }[] = [
    { key: 'today', label: 'יום' },
    { key: 'week', label: 'שבוע' },
    { key: 'month', label: 'חודש' },
    { key: 'custom', label: 'טווח מותאם' },
  ];

  const now = new Date();
  const [anchorDate, setAnchorDate] = useState(() => getTodayAnchorDate());
  const todayDateKey = toDateKeyFromDate(now);
  const anchorDateKey = useMemo(
    () =>
      `${anchorDate.getFullYear()}-${String(anchorDate.getMonth() + 1).padStart(2, '0')}-${String(anchorDate.getDate()).padStart(2, '0')}`,
    [anchorDate],
  );
  const monthAnchor = useMemo(
    () => new Date(anchorDate.getFullYear(), anchorDate.getMonth(), 1),
    [anchorDate],
  );
  const periodLabel = useMemo(() => {
    if (selectedRange === 'today') {
      return anchorDate.toLocaleDateString('he-IL', {
        weekday: 'short',
        day: '2-digit',
        month: '2-digit',
      });
    }
    if (selectedRange === 'week') {
      const first = new Date(anchorDate);
      const day = anchorDate.getDay();
      first.setDate(anchorDate.getDate() - day);
      const last = new Date(first);
      last.setDate(first.getDate() + 6);
      return `${first.toLocaleDateString('he-IL', { day: '2-digit', month: '2-digit' })} - ${last.toLocaleDateString('he-IL', { day: '2-digit', month: '2-digit' })}`;
    }
    if (selectedRange === 'month') {
      return monthAnchor.toLocaleDateString('he-IL', { month: 'long', year: 'numeric' });
    }
    return 'טווח מותאם';
  }, [selectedRange, anchorDate, monthAnchor]);

  const movePeriod = (direction: 'next' | 'prev') => {
    const multiplier = direction === 'next' ? 1 : -1;
    setAnchorDate((prev) => {
      const next = new Date(prev);
      if (selectedRange === 'today') {
        next.setDate(prev.getDate() + multiplier);
      } else if (selectedRange === 'week') {
        next.setDate(prev.getDate() + 7 * multiplier);
      } else if (selectedRange === 'month') {
        const preferredDay = prev.getDate();
        next.setDate(1);
        next.setMonth(prev.getMonth() + multiplier);
        const lastDay = new Date(next.getFullYear(), next.getMonth() + 1, 0).getDate();
        next.setDate(Math.min(preferredDay, lastDay));
      }
      return next;
    });
  };

  const activateTodayView = () => {
    setSelectedRange('today');
    setAnchorDate(getTodayAnchorDate());
  };

  const jumpToToday = () => {
    const today = getTodayAnchorDate();
    if (selectedRange === 'custom') {
      const todayKey = toDateKeyFromDate(today);
      setCustomFromDate(todayKey);
      setCustomToDate(todayKey);
      return;
    }
    setAnchorDate(today);
  };

  const selectedRangeLabel = rangeOptions.find((option) => option.key === selectedRange)?.label ?? '';
  const selectedRangeContextLabel =
    selectedRange === 'today' ? 'יום' : selectedRange === 'week' ? 'שבוע' : selectedRange === 'month' ? 'חודש' : 'הטווח המותאם';
  const ownerName = user?.firstName?.trim() || user?.fullName?.trim() || 'אורית';
  const greetingText = `${getGreetingByHour(now.getHours())} ${ownerName}!`;
  type WorkStatus = 'done' | 'active' | 'planned';
  type AssignedWorker = { name: string; isTeamLead: boolean; joinRequestStatus: string | null; assignmentRole: string | null };
  type ActiveWork = {
    id: number;
    jobId: string;
    customerName: string;
    caseId: string;
    caseName: string;
    address: string;
    jobType: JobType;
    dateKey: string;
    date: string;
    hours: number;
    startTime: string;
    endTime: string;
    requiredWorkers: number;
    requiredTeamLeads: number;
    assignedWorkers: AssignedWorker[];
    approvedWorkers: number;
    actualTeamLeadName: string | null;
    responsibleName: string;
    responsibleRole: 'admin' | 'owner';
    payrollCost: string;
    estimatedRevenue: string;
    status: WorkStatus;
    jobStatus: string;
  };

  const allActiveWorks: ActiveWork[] = [];

  const [dashboardWorks, setDashboardWorks] = useState<ActiveWork[]>(allActiveWorks);
  const [dashboardWorkers, setDashboardWorkers] = useState<DashboardWorker[]>([]);

  const displayedWorks = useMemo(() => {
    if (selectedRange === 'today') {
      return sortWorksByDate(dashboardWorks.filter((work) => work.dateKey === anchorDateKey));
    }
    if (selectedRange === 'week') {
      const weekStart = new Date(anchorDate);
      const day = anchorDate.getDay();
      weekStart.setDate(anchorDate.getDate() - day);
      const weekEnd = new Date(weekStart);
      weekEnd.setDate(weekStart.getDate() + 6);
      const weekStartKey = `${weekStart.getFullYear()}-${String(weekStart.getMonth() + 1).padStart(2, '0')}-${String(weekStart.getDate()).padStart(2, '0')}`;
      const weekEndKey = `${weekEnd.getFullYear()}-${String(weekEnd.getMonth() + 1).padStart(2, '0')}-${String(weekEnd.getDate()).padStart(2, '0')}`;
      return sortWorksByDate(dashboardWorks.filter((work) => work.dateKey >= weekStartKey && work.dateKey <= weekEndKey));
    }
    if (selectedRange === 'month') {
      const currentMonthPrefix = `${monthAnchor.getFullYear()}-${String(monthAnchor.getMonth() + 1).padStart(2, '0')}`;
      return sortWorksByDate(dashboardWorks.filter((work) => work.dateKey.startsWith(currentMonthPrefix)));
    }
    if (!customFromDate || !customToDate) {
      return sortWorksByDate(dashboardWorks);
    }
    const rangeStart = customFromDate <= customToDate ? customFromDate : customToDate;
    const rangeEnd = customFromDate <= customToDate ? customToDate : customFromDate;
    return sortWorksByDate(dashboardWorks.filter((work) => work.dateKey >= rangeStart && work.dateKey <= rangeEnd));
  }, [dashboardWorks, selectedRange, anchorDateKey, anchorDate, monthAnchor, customFromDate, customToDate]);


  const [customers, setCustomers] = useState<Customer[]>(initialCustomers);
  const [cases, setCases] = useState<CustomerCase[]>(initialCases);
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  // Job-first Quick Create is opened from a date-level action.
  const [quickCreateDate, setQuickCreateDate] = useState<string | null>(null);
  const redirectedCreateHandled = useRef(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [joinPanelOpen, setJoinPanelOpen] = useState(false);
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null);
  const [dashboardAvailability, setDashboardAvailability] = useState<Array<{
    workerId: string;
    dateKey: string;
    reason: string;
    startTime: string | null;
    endTime: string | null;
  }>>([]);
  const [dailyInfo, setDailyInfo] = useState<DailyInfo[]>([]);
  const [dailyInfoTargetDate, setDailyInfoTargetDate] = useState<string | null>(null);
  const [dailyInfoTitle, setDailyInfoTitle] = useState('');
  const [dailyInfoBody, setDailyInfoBody] = useState('');
  const [dailyInfoBusy, setDailyInfoBusy] = useState(false);
  const [dailyInfoError, setDailyInfoError] = useState<string | null>(null);
  const [dateMenuKey, setDateMenuKey] = useState<string | null>(null);
  const [ownerToolsOpen, setOwnerToolsOpen] = useState(false);
  const [assignmentTarget, setAssignmentTarget] = useState<{
    workerId: string;
    workerName: string;
    workerRole: DashboardWorkerRole;
    dateKey: string;
  } | null>(null);
  const [assignmentBusyJobId, setAssignmentBusyJobId] = useState<string | null>(null);
  const [assignmentError, setAssignmentError] = useState<string | null>(null);
  const [attention, setAttention] = useState<OwnerTasks | null>(null);
  const [openAttentionKey, setOpenAttentionKey] = useState<string | null>(null);
  const [editingWorkId, setEditingWorkId] = useState<number | null>(null);
  const [createMessage, setCreateMessage] = useState('');
  const [formAttempted, setFormAttempted] = useState(false);
  const [selectedCustomerId, setSelectedCustomerId] = useState('');
  const [newCustomerFirstName, setNewCustomerFirstName] = useState('');
  const [newCustomerLastName, setNewCustomerLastName] = useState('');
  const [newCustomerPhone, setNewCustomerPhone] = useState('');
  const [newCustomerEmail, setNewCustomerEmail] = useState('');
  const [, setAddressMode] = useState<'existing' | 'new'>('existing');
  const [selectedAddress, setSelectedAddress] = useState('');
  const [existingAddressQuery, setExistingAddressQuery] = useState('');
  const [newAddress, setNewAddress] = useState('');
  const [addressFloor, setAddressFloor] = useState('');
  const [addressApartment, setAddressApartment] = useState('');
  const [jobType, setJobType] = useState<JobType>('אריזה');
  const [jobDate, setJobDate] = useState('2026-07-06');
  const [startTime, setStartTime] = useState('09:00');
  const [endTime, setEndTime] = useState('14:00');
  const [requiredWorkers, setRequiredWorkers] = useState(4);
  const [requireTeamLead, setRequireTeamLead] = useState(true);
  const [selectedAssignedWorkerNames, setSelectedAssignedWorkerNames] = useState<string[]>([]);
  const [selectedActualTeamLeadName, setSelectedActualTeamLeadName] = useState('');
  const [selectedFormTemplateId, setSelectedFormTemplateId] = useState<string | null>(null);
  const [formTemplates, setFormTemplates] = useState<Array<{ id: string; name: string; jobType?: string; isDefault?: boolean }>>([]);
  const [staffingMode, setStaffingMode] = useState<StaffingMode>('approval');
  const [workerVisibleNotes, setWorkerVisibleNotes] = useState('');
  const [customerMode, setCustomerMode] = useState<'existing' | 'new'>('new');
  const [dayJobsPickerDateKey, setDayJobsPickerDateKey] = useState<string | null>(null);

  useEffect(() => {
    if (redirectedCreateHandled.current) return;
    const createDate = new URLSearchParams(window.location.search).get('createDate');
    if (!createDate || !/^\d{4}-\d{2}-\d{2}$/.test(createDate)) return;
    redirectedCreateHandled.current = true;
    setQuickCreateDate(createDate);
  }, []);

  // Load form templates when the create modal is opened
  useEffect(() => {
    if (isCreateOpen) {
      (async () => {
        try {
          const auth = await authHeaders(getToken);
          const res = await api.get<Array<{ id: string; name: string; jobType?: string; isDefault?: boolean }>>('/forms/templates', auth);
          setFormTemplates(res.data);
        } catch (error) {
          console.error('Failed to load form templates:', error);
          setFormTemplates([]);
        }
      })();
    } else {
      // Reset form template when modal closes
      setSelectedFormTemplateId(null);
    }
  }, [getToken, isCreateOpen]);

  // Forms are on by default: auto-select the default template for the chosen job type.
  useEffect(() => {
    if (!isCreateOpen || formTemplates.length === 0) return;
    const enumType = JOB_TYPE_TO_ENUM[jobType];
    const defaultTemplate =
      formTemplates.find((t) => t.isDefault && t.jobType === enumType) ??
      formTemplates.find((t) => t.jobType === enumType) ??
      null;
    setSelectedFormTemplateId(defaultTemplate?.id ?? null);
  }, [isCreateOpen, formTemplates, jobType]);

  // Load real data from API on component mount
  useEffect(() => {
    (async () => {
      try {
        const auth = await authHeaders(getToken);
        const [customersRes, casesRes, jobsRes, workersRes] = await Promise.all([
          api.get('/customers', auth),
          api.get('/cases', auth),
          api.get('/jobs', auth),
          api.get('/workers', auth),
        ]);
        
        const apiCustomers = customersRes.data.map((c: any) => ({
          id: c.id,
          fullName: `${c.firstName} ${c.lastName}`,
          phone: c.phone || '',
          email: c.email || '',
          // API returns addresses as objects; the UI expects address strings.
          addresses: (c.addresses || []).map((a: any) => (typeof a === 'string' ? a : a?.fullAddress ?? '')).filter(Boolean),
        }));
        
        const apiCases = casesRes.data.map((c: any) => ({
          id: c.id,
          customerId: c.customerId,
          caseName: c.name,
          status: c.status,
          latestJobDate: c.updatedAt?.split('T')[0] || new Date().toISOString().split('T')[0],
        }));

        // Cancelled projects (and cancelled jobs) must not appear as active work.
        const cancelledCaseIds = new Set(
          casesRes.data.filter((c: any) => c.status === 'CANCELLED').map((c: any) => c.id),
        );

        const apiWorks: ActiveWork[] = jobsRes.data
          .filter((job: any) => job.status !== 'CANCELLED' && !cancelledCaseIds.has(job.caseId))
          .map((job: any, index: number) => {
          const customerName = `${job.customer?.firstName ?? ''} ${job.customer?.lastName ?? ''}`.trim();
          const date = new Date(job.date);
          const plannedStart = job.plannedStart ? new Date(job.plannedStart) : new Date(date);
          if (!job.plannedStart) plannedStart.setHours(9, 0, 0, 0);
          const plannedEnd = job.plannedEnd ? new Date(job.plannedEnd) : new Date(plannedStart.getTime() + 5 * 3_600_000);
          const dateKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
          const day = String(date.getDate()).padStart(2, '0');
          const month = String(date.getMonth() + 1).padStart(2, '0');
          // Exclude rejected/cancelled requests. Owner invitations awaiting the
          // worker reserve capacity; worker-initiated pending requests do not.
          const assignedWorkers: AssignedWorker[] = (job.shifts ?? [])
            .filter((shift: any) => shift.joinRequestStatus !== 'REJECTED' && shift.joinRequestStatus !== 'CANCELLED')
            .map((shift: any) => ({
              name: shift.worker ? `${shift.worker.firstName ?? ''} ${shift.worker.lastName ?? ''}`.trim() : 'עובדת',
              isTeamLead: shift.assignmentRole === 'TEAM_LEADER',
              joinRequestStatus: shift.joinRequestStatus ?? null,
              assignmentRole: shift.assignmentRole ?? null,
            }));
          const approvedWorkers = assignedWorkers.filter(
            (worker) =>
              worker.assignmentRole !== 'BACKUP' &&
              (fillsRequiredSlot(worker) || worker.joinRequestStatus === 'AWAITING_WORKER'),
          ).length;
          const actualTeamLeadName =
            assignedWorkers.find(
              (worker: AssignedWorker) =>
                worker.isTeamLead && worker.joinRequestStatus === 'APPROVED',
            )?.name ?? null;
          const status: WorkStatus =
            job.status === 'COMPLETED' || job.status === 'ARCHIVED'
              ? 'done'
              : job.status === 'APPROVED'
                ? 'active'
                : 'planned';
          const jobType: JobType =
            job.jobType === 'PACKING' ? 'אריזה' : job.jobType === 'UNPACKING' ? 'פריקה' : 'סידור';
          const estimatedRevenueValue = Math.round((job.requiredWorkerCount ?? 0) * 5 * 175);
          const payrollCostValue = Math.round((job.requiredWorkerCount ?? 0) * 5 * 82);
          return {
            id: Number(job.id) || index + 1,
            jobId: String(job.id),
            customerName,
            caseId: job.caseId ?? '',
            caseName: job.case?.name ?? `${customerName} - פרוייקט`,
            address: job.address?.fullAddress ?? 'כתובת לא עודכנה',
            jobType,
            dateKey,
            date: `${day}.${month}`,
            hours: Math.max(0, (plannedEnd.getTime() - plannedStart.getTime()) / 3_600_000),
            startTime: plannedStart.toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit', hour12: false }),
            endTime: plannedEnd.toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit', hour12: false }),
            requiredWorkers: job.requiredWorkerCount ?? 0,
            requiredTeamLeads: (job.slots ?? []).some((slot: any) => slot.requiredSkill === 'SHIFT_LEADER') ? 1 : 0,
            assignedWorkers,
            approvedWorkers,
            actualTeamLeadName,
            responsibleName: actualTeamLeadName ?? MOM_OWNER_NAME,
            responsibleRole: actualTeamLeadName ? 'admin' : 'owner',
            payrollCost: `₪${payrollCostValue.toLocaleString('he-IL')}`,
            estimatedRevenue: formatK(estimatedRevenueValue),
            status,
            jobStatus: job.status ?? 'RESERVATION',
          };
        });
        
        setCustomers(apiCustomers);
        setCases(apiCases);
        setDashboardWorks(apiWorks);
        setDashboardWorkers(
          (workersRes.data as any[]).map((w) => ({
            id: w.id,
            name: `${w.firstName ?? ''} ${w.lastName ?? ''}`.trim(),
            role: (w.skills ?? []).includes('SHIFT_LEADER') ? ('ראש צוות' as const) : ('עובדת' as const),
            hourlyWage: 0,
          })),
        );
        
        // Set first customer as selected if available
        if (apiCustomers.length > 0) {
          setSelectedCustomerId(apiCustomers[0].id);
          setSelectedAddress(apiCustomers[0].addresses?.[0] || '');
          setExistingAddressQuery(apiCustomers[0].addresses?.[0] || '');
        }
      } catch (error) {
        console.error('Failed to load customers/cases from API:', error);
        setCustomers([]);
        setCases([]);
        setDashboardWorks([]);
        setDashboardWorkers([]);
      }
    })();
  }, [getToken, reloadKey]);

  // Requires Attention counts (spec §7) — refreshed after creating a job too.
  useEffect(() => {
    (async () => {
      try {
        const auth = await authHeaders(getToken);
        const res = await api.get<OwnerTasks>('/admin/tasks', auth);
        setAttention(res.data ?? null);
      } catch {
        setAttention(null);
      }
    })();
  }, [getToken, reloadKey]);

  const attentionItems = useMemo(() => {
    if (!attention) return [] as Array<{ key: string; title: string; count: number; href: string }>;
    return [
      { key: 'joinRequests', title: 'אישור בקשות הצטרפות', count: attention.joinRequests, href: '/jobs' },
      { key: 'pendingAcceptance', title: 'מעקב אישורי עובדות', count: attention.pendingAcceptance, href: '/jobs' },
      { key: 'replacementRequests', title: 'טיפול בבקשות החלפה', count: attention.replacementRequests, href: '/shifts/swaps' },
      { key: 'swapApprovals', title: 'אישור החלפות משמרות', count: attention.swapApprovals, href: '/shifts/swaps' },
      { key: 'attendanceReview', title: 'בדיקת חריגות נוכחות', count: attention.attendanceReview, href: '/attendance' },
      { key: 'reportCorrections', title: 'טיפול בתיקוני דוחות', count: attention.reportCorrections, href: '/payroll' },
      { key: 'customerReportReady', title: 'הכנת דוח ללקוחה', count: attention.customerReportReady, href: '/reports/customer' },
    ].filter((i) => i.count > 0);
  }, [attention]);

  // Priority-1 operational items (space_order_product_refactor_spec.md §7.3
  // items 1–2, §7.4): rendered ABOVE the decision items, each expanding to direct
  // links to every affected job. Empty groups are not shown; the lists are derived
  // server-side and disappear on the next fetch once a job's status/date no longer
  // matches (no done/snooze state).
  const priorityAttention = useMemo(() => {
    if (!attention) return [] as Array<{ key: string; title: string; jobs: AttentionJobView[] }>;
    return [
      { key: 'pastNotCompleted', title: 'סגירת עבודות מהעבר', jobs: attention.pastNotCompletedJobs ?? [] },
      { key: 'todayInReservation', title: 'אישור עבודות של היום', jobs: attention.todayInReservationJobs ?? [] },
      { key: 'missingExactAddress', title: 'השלמת כתובת לפני העבודה', jobs: attention.missingExactAddressJobs ?? [] },
    ].filter((g) => g.jobs.length > 0);
  }, [attention]);

  const selectedCustomer = useMemo(
    () => customers.find((customer) => customer.id === selectedCustomerId) ?? null,
    [customers, selectedCustomerId],
  );
  const customerSuggestions = useMemo(() => {
    const fullNameTerm = `${newCustomerFirstName} ${newCustomerLastName}`.trim().toLowerCase();
    const phoneTerm = normalizePhone(newCustomerPhone);
    if (!fullNameTerm && !phoneTerm) return [];
    return customers
      .filter((customer) => {
        const matchesName = fullNameTerm ? customer.fullName.toLowerCase().includes(fullNameTerm) : false;
        const matchesPhone = phoneTerm ? normalizePhone(customer.phone).includes(phoneTerm) : false;
        return matchesName || matchesPhone;
      })
      .slice(0, 6);
  }, [customers, newCustomerFirstName, newCustomerLastName, newCustomerPhone]);
  const existingAddressSuggestions = useMemo(() => {
    if (!selectedCustomer) return [];
    const term = String(existingAddressQuery ?? '').trim().toLowerCase();
    if (!term) return selectedCustomer.addresses;
    return selectedCustomer.addresses.filter((address) => String(address ?? '').toLowerCase().includes(term));
  }, [selectedCustomer, existingAddressQuery]);
  const caseById = useMemo(() => new Map(cases.map((item) => [item.id, item])), [cases]);

  const caseSuggestion = useMemo(() => {
    if (customerMode !== 'existing' || !selectedCustomerId) return null;
    const customerCases = cases.filter((c) => c.customerId === selectedCustomerId);
    const activeCase = customerCases.find((c) => c.status === 'ACTIVE');
    if (activeCase) {
      return {
        type: 'active' as const,
        text: `ללקוח יש פרוייקט מאושר לביצוע: "${activeCase.caseName}". לצרף אליו את העבודה?`,
      };
    }
    const recentCompleted = customerCases.find(
      (c) => c.status === 'COMPLETED' && daysBetween(jobDate, c.latestJobDate) >= 0 && daysBetween(jobDate, c.latestJobDate) <= 60,
    );
    if (recentCompleted) {
      return {
        type: 'recent' as const,
        text: `נמצא פרוייקט שהסתיים ב-60 הימים האחרונים: "${recentCompleted.caseName}". לפתוח מחדש ולהוסיף?`,
      };
    }
    return {
      type: 'none' as const,
      text: 'לא נמצא פרוייקט פעיל. ייפתח פרוייקט חדש אוטומטית.',
    };
  }, [cases, customerMode, selectedCustomerId, jobDate]);

  // Single source of truth for staffing shortages (spec §12): the team-leader
  // slot is a ROLE constraint inside the required headcount, never a substitute
  // for a missing worker. Total missing-worker count and the missing-leader
  // warning are computed independently here so the grid, counters and attention
  // cards all agree.
  const workStaffing = (work: ActiveWork) =>
    getStaffingIssueBreakdown({
      requiredWorkers: work.requiredWorkers,
      assignedWorkers: work.approvedWorkers,
      requiresManager: work.requiredTeamLeads > 0,
      hasAssignedManager: Boolean(work.actualTeamLeadName),
    });

  const futureWorks = useMemo(
    () => dashboardWorks.filter((work) => work.dateKey >= todayDateKey),
    [dashboardWorks, todayDateKey],
  );
  const workflowSections = useMemo(() => {
    const worksByCaseId = new Map<string, ActiveWork[]>();
    futureWorks.forEach((work) => {
      worksByCaseId.set(work.caseId, [...(worksByCaseId.get(work.caseId) ?? []), work]);
    });

    const draftCases = cases.filter((item) => item.status === 'DRAFT');
    const activeCases = cases.filter((item) => item.status === 'ACTIVE');
    const activeCasesWithoutDates = activeCases.filter((item) => (worksByCaseId.get(item.id) ?? []).length === 0);
    const partialSchedulingCases = activeCases.filter((item) => {
      const caseWorks = worksByCaseId.get(item.id) ?? [];
      if (caseWorks.length === 0) return false;
      return caseWorks.some((work) => {
        const breakdown = workStaffing(work);
        return breakdown.workerShortageSlots > 0 || breakdown.managerShortage;
      });
    });

    const jobsWithWorkerShortage = futureWorks.filter((work) => workStaffing(work).workerShortageSlots > 0);
    const jobsMissingManager = futureWorks.filter((work) => workStaffing(work).managerShortage);
    const attendanceExceptions = futureWorks.filter(
      (work) => (work.status === 'active' || work.status === 'done') && work.assignedWorkers.length > 0,
    );
    const awaitingBillingCases = cases.filter((item) => item.status === 'READY_FOR_REVIEW');
    const awaitingPaymentCases = cases.filter((item) => {
      if (item.status !== 'COMPLETED') return false;
      const diff = daysBetween(todayDateKey, item.latestJobDate);
      return diff >= 0 && diff <= 45;
    });

    const orderedSections = orderDashboardWorkflowSections([
      {
        key: 'quote-awaiting-approval',
        title: 'מחכה לאישור הצעת מחיר',
        items: draftCases.map((item) => ({
          id: item.id,
          projectName: item.caseName,
          issue: 'הצעת המחיר עדיין ממתינה לאישור',
          href: `/cases?caseId=${item.id}&focus=quote`,
          dateLabel: toDisplayDateFromDateKey(item.latestJobDate),
          severity: 'high' as const,
        })),
      },
      {
        key: 'approved-awaiting-scheduling',
        title: 'מאושר – מחכה לקביעת תאריכים',
        items: activeCasesWithoutDates.map((item) => ({
          id: item.id,
          projectName: item.caseName,
          issue: 'הפרויקט מאושר אך עדיין ללא עבודות מתוזמנות',
          href: `/cases?caseId=${item.id}&focus=jobs`,
          severity: 'medium' as const,
        })),
      },
      {
        key: 'partial-scheduling',
        title: 'מאושר – תזמון חלקי',
        items: partialSchedulingCases.map((item) => ({
          id: item.id,
          projectName: item.caseName,
          issue: 'יש עבודות שלא מוכנות לביצוע מלא',
          href: `/cases?caseId=${item.id}&focus=jobs`,
          severity: 'medium' as const,
        })),
      },
      {
        key: 'jobs-understaffed',
        title: 'עבודות לא מאוישות',
        items: jobsWithWorkerShortage.map((work) => ({
          id: String(work.id),
          projectName: work.caseName,
          issue: `חסרים ${workStaffing(work).workerShortageSlots} עובדים`,
          href: `/jobs/${work.id}`,
          dateLabel: toDisplayDateFromDateKey(work.dateKey),
          severity: 'high' as const,
        })),
      },
      {
        key: 'jobs-missing-manager',
        title: 'חסר ראש צוות',
        items: jobsMissingManager.map((work) => ({
          id: `manager-${work.id}`,
          projectName: work.caseName,
          issue: 'לעבודה אין ראש צוות משויך',
          href: `/jobs/${work.id}`,
          dateLabel: toDisplayDateFromDateKey(work.dateKey),
          severity: 'high' as const,
        })),
      },
      {
        key: 'customer-forms-pending',
        title: 'טפסי לקוח ממתינים',
        items: [],
      },
      {
        key: 'attendance-exceptions',
        title: 'חריגות נוכחות',
        items: attendanceExceptions.map((work) => ({
          id: `attendance-${work.id}`,
          projectName: work.caseName,
          issue: 'נדרש אימות נוכחות לפני סגירת עבודה',
          href: '/attendance',
          dateLabel: toDisplayDateFromDateKey(work.dateKey),
          severity: 'high' as const,
        })),
      },
      {
        key: 'awaiting-billing',
        title: 'מחכה לחיוב',
        items: awaitingBillingCases.map((item) => ({
          id: `billing-${item.id}`,
          projectName: item.caseName,
          issue: 'העבודה הסתיימה וממתינה לחיוב',
          href: `/cases?caseId=${item.id}&focus=reports`,
          severity: 'medium' as const,
        })),
      },
      {
        key: 'awaiting-payment',
        title: 'מחכה לתשלום מהלקוח',
        items: awaitingPaymentCases.map((item) => ({
          id: `payment-${item.id}`,
          projectName: item.caseName,
          issue: 'טרם סומן תשלום לקוח',
          href: `/cases?caseId=${item.id}&focus=payment`,
          severity: 'medium' as const,
        })),
      },
    ]);

    return orderedSections.map((section) => ({
      ...section,
      items: section.items.map((item) => ({
        ...item,
        actionLabel: dashboardIssueActionLabel(section.key),
      })),
    }));
  }, [cases, futureWorks, todayDateKey]);

  const visibleShiftDates = useMemo(() => {
    if (selectedRange === 'today') {
      return [new Date(anchorDate.getFullYear(), anchorDate.getMonth(), anchorDate.getDate())];
    }
    if (selectedRange === 'week') {
      const weekStart = new Date(anchorDate);
      const day = anchorDate.getDay();
      weekStart.setDate(anchorDate.getDate() - day);
      return Array.from({ length: 7 }).map((_, idx) => {
        const date = new Date(weekStart);
        date.setDate(weekStart.getDate() + idx);
        return date;
      });
    }
    if (selectedRange === 'month') {
      const year = monthAnchor.getFullYear();
      const month = monthAnchor.getMonth();
      const daysInMonth = new Date(year, month + 1, 0).getDate();
      return Array.from({ length: daysInMonth }).map((_, idx) => new Date(year, month, idx + 1));
    }
    if (!customFromDate || !customToDate) {
      return [];
    }
    const start = parseDateKey(customFromDate <= customToDate ? customFromDate : customToDate);
    const end = parseDateKey(customFromDate <= customToDate ? customToDate : customFromDate);
    const dates: Date[] = [];
    const cursor = new Date(start);
    while (cursor <= end) {
      dates.push(new Date(cursor));
      cursor.setDate(cursor.getDate() + 1);
      if (dates.length > 62) break;
    }
    return dates;
  }, [selectedRange, anchorDate, monthAnchor, customFromDate, customToDate]);

  const visibleAvailabilityRange = useMemo(() => {
    if (visibleShiftDates.length === 0) return null;
    return {
      start: toDateKeyFromDate(visibleShiftDates[0]),
      end: toDateKeyFromDate(visibleShiftDates[visibleShiftDates.length - 1]),
    };
  }, [visibleShiftDates]);

  useEffect(() => {
    if (!visibleAvailabilityRange) {
      setDashboardAvailability([]);
      setDailyInfo([]);
      return;
    }
    void (async () => {
      try {
        const auth = await authHeaders(getToken);
        const res = await api.get<Array<{
          workerId: string;
          dateKey: string;
          reason: string;
          startTime: string | null;
          endTime: string | null;
        }>>(
          `/workers/calendar-availability?start=${visibleAvailabilityRange.start}&end=${visibleAvailabilityRange.end}`,
          auth,
        );
        setDashboardAvailability(res.data ?? []);
      } catch {
        setDashboardAvailability([]);
      }
    })();
  }, [getToken, reloadKey, visibleAvailabilityRange]);

  useEffect(() => {
    if (!visibleAvailabilityRange) return;
    void (async () => {
      try {
        const auth = await authHeaders(getToken);
        const res = await api.get<DailyInfo[]>(
          `/daily-info?start=${visibleAvailabilityRange.start}&end=${visibleAvailabilityRange.end}`,
          auth,
        );
        setDailyInfo(res.data ?? []);
      } catch {
        setDailyInfo([]);
      }
    })();
  }, [getToken, reloadKey, visibleAvailabilityRange]);

  useEffect(() => {
    if (!dateMenuKey) return;
    const close = (event: MouseEvent) => {
      if (!(event.target as HTMLElement).closest('[data-date-menu]')) setDateMenuKey(null);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [dateMenuKey]);

  const shiftsByWorkerDate = useMemo(() => {
    const map = new Map<string, ActiveWork[]>();
    displayedWorks.forEach((work) => {
      // Worker rows show actual assignments only — a PENDING join request appears
      // in Requires Attention / the join panel / staffing, never as a row card.
      workerRowAssignments(work.assignedWorkers).forEach((assignedWorker) => {
        const key = `${assignedWorker.name}|${work.dateKey}`;
        map.set(key, [...(map.get(key) ?? []), work]);
      });
    });
    return map;
  }, [displayedWorks]);

  const unassignedWorksByDate = useMemo(() => {
    const map = new Map<string, Array<{ work: ActiveWork; open: number }>>();
    displayedWorks.forEach((work) => {
      const open = workStaffing(work).workerShortageSlots;
      if (open > 0) {
        map.set(work.dateKey, [...(map.get(work.dateKey) ?? []), { work, open }]);
      }
    });
    return map;
  }, [displayedWorks]);

  const dailyInfoByDate = useMemo(
    () => new Map(dailyInfo.map((entry) => [entry.dateKey, entry])),
    [dailyInfo],
  );

  const dateSummaryByDate = useMemo(() => {
    const map = new Map<string, { hours: number; jobs: number; assigned: number; required: number }>();
    displayedWorks.forEach((work) => {
      const current = map.get(work.dateKey) ?? { hours: 0, jobs: 0, assigned: 0, required: 0 };
      current.hours += work.hours;
      current.jobs += 1;
      current.assigned += work.approvedWorkers;
      current.required += work.requiredWorkers;
      map.set(work.dateKey, current);
    });
    return map;
  }, [displayedWorks]);

  const assignmentJobs = useMemo(() => {
    if (!assignmentTarget) return [];
    return (unassignedWorksByDate.get(assignmentTarget.dateKey) ?? []).filter(
      ({ work }) => !work.assignedWorkers.some((assigned) => assigned.name === assignmentTarget.workerName),
    );
  }, [assignmentTarget, unassignedWorksByDate]);

  const assignWorkerFromCalendar = async (work: ActiveWork) => {
    if (!assignmentTarget) return;
    setAssignmentBusyJobId(work.jobId);
    setAssignmentError(null);
    try {
      const auth = await authHeaders(getToken);
      const needsTeamLead =
        work.requiredTeamLeads > 0 && !work.assignedWorkers.some((assigned) => assigned.isTeamLead);
      const role = needsTeamLead && assignmentTarget.workerRole !== 'עובדת' ? 'TEAM_LEADER' : 'REGULAR';
      await api.post(
        '/shifts/admin-assign',
        { jobId: work.jobId, workerId: assignmentTarget.workerId, role },
        auth,
      );
      setAssignmentTarget(null);
      setReloadKey((key) => key + 1);
    } catch (error) {
      const data = (error as { response?: { data?: { error?: string; message?: string } } })?.response?.data;
      setAssignmentError(data?.message ?? data?.error ?? 'השיבוץ נכשל. ייתכן שהעובדת אינה זמינה או שכבר שובצה בתאריך זה.');
    } finally {
      setAssignmentBusyJobId(null);
    }
  };

  const openDailyInfo = (dateKey: string) => {
    const existing = dailyInfoByDate.get(dateKey);
    setDailyInfoTargetDate(dateKey);
    setDailyInfoTitle(existing?.title ?? '');
    setDailyInfoBody(existing?.body ?? '');
    setDailyInfoError(null);
  };

  const saveDailyInfo = async () => {
    if (!dailyInfoTargetDate) return;
    if (!dailyInfoTitle.trim() && !dailyInfoBody.trim()) {
      setDailyInfoError('יש להזין כותרת או הודעה.');
      return;
    }
    setDailyInfoBusy(true);
    setDailyInfoError(null);
    try {
      const auth = await authHeaders(getToken);
      const res = await api.put<DailyInfo>(
        `/daily-info/${dailyInfoTargetDate}`,
        { title: dailyInfoTitle.trim(), body: dailyInfoBody.trim() },
        auth,
      );
      setDailyInfo((entries) => [
        ...entries.filter((entry) => entry.dateKey !== res.data.dateKey),
        res.data,
      ]);
      setDailyInfoTargetDate(null);
    } catch (error) {
      const data = (error as { response?: { data?: { error?: string; message?: string } } })?.response?.data;
      setDailyInfoError(data?.message ?? data?.error ?? 'שמירת המידע היומי נכשלה.');
    } finally {
      setDailyInfoBusy(false);
    }
  };

  const deleteDailyInfo = async () => {
    if (!dailyInfoTargetDate) return;
    setDailyInfoBusy(true);
    setDailyInfoError(null);
    try {
      const auth = await authHeaders(getToken);
      await api.delete(`/daily-info/${dailyInfoTargetDate}`, auth);
      setDailyInfo((entries) => entries.filter((entry) => entry.dateKey !== dailyInfoTargetDate));
      setDailyInfoTargetDate(null);
    } catch (error) {
      const data = (error as { response?: { data?: { error?: string; message?: string } } })?.response?.data;
      setDailyInfoError(data?.message ?? data?.error ?? 'מחיקת המידע היומי נכשלה.');
    } finally {
      setDailyInfoBusy(false);
    }
  };

  const editingWork = useMemo(
    () => (editingWorkId ? dashboardWorks.find((work) => work.id === editingWorkId) ?? null : null),
    [dashboardWorks, editingWorkId],
  );

  const selectedLinkedCase = useMemo(
    () => (editingWork ? cases.find((item) => item.id === editingWork.caseId) ?? null : null),
    [cases, editingWork],
  );

  const selectedTeamLeadOptions = useMemo(
    () =>
      selectedAssignedWorkerNames.filter((workerName) => {
        const worker = dashboardWorkers.find((item) => item.name === workerName);
        return worker?.role === 'ראש צוות' || worker?.role === 'מנהלת';
      }),
    [selectedAssignedWorkerNames],
  );
  const workerColumnWidth = 180;
  const dayColumnMinWidth = 104;
  const shiftGridTemplate = `${workerColumnWidth}px repeat(${Math.max(1, visibleShiftDates.length)}, minmax(${dayColumnMinWidth}px, 1fr))`;
  const shiftGridMinWidth = workerColumnWidth + Math.max(1, visibleShiftDates.length) * dayColumnMinWidth;
  const shiftGridStyle = { gridTemplateColumns: shiftGridTemplate, minWidth: `${shiftGridMinWidth}px` };

  return (
    <div className="space-y-5 lg:flex lg:h-[calc(100vh-4rem)] lg:flex-col lg:gap-3 lg:space-y-0 lg:overflow-hidden">
      <PageHeader
        eyebrow="SPACE FOR A WELL-RUN DAY"
        title="היום בעסק"
        description={mounted ? greetingText : '\u00A0'}
        icon={<CalendarDays className="h-6 w-6" />}
      />

      {(priorityAttention.length > 0 || attentionItems.length > 0) && (
        <section className="border-y border-[var(--color-border)] py-2.5" data-testid="requires-attention">
          <div className="mb-2 flex items-center gap-2">
            <span className="text-xs font-semibold text-gray-900">פעולות ניהול</span>
            <span className="text-[10px] text-[var(--color-text-muted)]">הנושאים שמחכים לטיפולך</span>
          </div>
          <div className="flex gap-2 overflow-x-auto pb-1">
            {priorityAttention.map((group) => (
              <div key={group.key} className="relative shrink-0" data-testid={`attention-${group.key}`}>
                <button
                  type="button"
                  onClick={() => setOpenAttentionKey((prev) => (prev === group.key ? null : group.key))}
                  aria-expanded={openAttentionKey === group.key}
                  className="flex min-w-48 items-center justify-between gap-3 rounded-md border border-[var(--color-calendar-sand-border)] bg-[var(--color-calendar-sand-soft)] px-3 py-2 text-right hover:border-[var(--color-calendar-sand)]"
                >
                  <span>
                    <span className="block text-[10px] font-medium text-[var(--color-calendar-sand)]">פעולה נדרשת</span>
                    <span className="block text-xs font-semibold text-gray-900">{group.title}</span>
                  </span>
                  <span className="inline-flex h-7 min-w-7 items-center justify-center rounded-full bg-[var(--color-calendar-sand)] px-2 text-xs font-bold text-white">
                    {group.jobs.length}
                  </span>
                </button>
                {openAttentionKey === group.key && (
                  <div className="absolute right-0 z-30 mt-1 max-h-64 w-72 overflow-auto border border-[var(--color-border)] bg-[var(--color-surface)] p-1 shadow-lg">
                    {group.jobs.map((job) => (
                      <button
                        key={job.jobId}
                        type="button"
                        onClick={() => {
                          setOpenAttentionKey(null);
                          setSelectedJobId(job.jobId);
                        }}
                        className="block w-full px-2.5 py-2 text-right text-[11px] text-gray-700 hover:bg-[var(--color-calendar-sand-soft)]"
                      >
                        <span className="font-medium text-gray-900">{formatBusinessDate(job.date)}</span>
                        {' · '}
                        {job.customerName || 'שריון כללי'}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            ))}
            {attentionItems.map((item) => {
              const content = (
                <>
                  <span>
                    <span className="block text-[10px] font-medium text-[var(--color-calendar-sage)]">ממתין להחלטה</span>
                    <span className="block text-xs font-semibold text-gray-900">{item.title}</span>
                  </span>
                  <span className="inline-flex h-7 min-w-7 items-center justify-center rounded-full bg-[var(--color-calendar-sage)] px-2 text-xs font-bold text-white">
                    {item.count}
                  </span>
                </>
              );
              const className = 'flex min-w-48 shrink-0 items-center justify-between gap-3 rounded-md border border-[var(--color-border-strong)] bg-[var(--color-surface-muted)] px-3 py-2 text-right hover:border-[var(--color-calendar-sage)]';
              return item.key === 'joinRequests' ? (
                <button key={item.key} type="button" onClick={() => setJoinPanelOpen(true)} className={className}>
                  {content}
                </button>
              ) : (
                <Link key={item.key} href={item.href} className={className}>
                  {content}
                </Link>
              );
            })}
          </div>
        </section>
      )}

      {/* Owner KPI Bar */}
      <div className="space-y-3 border-b border-[var(--color-border)] pb-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <span className="inline-flex mt-1.5 px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 text-[11px] font-semibold">
              תצוגה פעילה: {selectedRangeLabel}
            </span>
          </div>
          <div className="inline-flex gap-4 border-b border-[var(--color-border)]">
            {rangeOptions.map((option) => {
              const isActive = option.key === selectedRange;
              return (
                <button
                  key={option.key}
                  type="button"
                  onClick={() => {
                    if (option.key === 'today') {
                      activateTodayView();
                      return;
                    }
                    setSelectedRange(option.key);
                  }}
                  className={`border-b-2 px-1 py-2 text-[11px] font-medium transition-colors ${
                    isActive
                      ? 'border-primary-700 text-primary-800'
                      : 'border-transparent text-gray-600 hover:text-gray-900'
                  }`}
                >
                  {option.label}
                </button>
              );
            })}
          </div>
          {selectedRange !== 'custom' && (
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => movePeriod('prev')}
                className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-gray-300 text-gray-700 hover:bg-gray-50"
                aria-label="תקופה קודמת"
              >
                <ChevronRight className="h-4 w-4" />
              </button>
              <button
                type="button"
                onClick={() => movePeriod('next')}
                className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-gray-300 text-gray-700 hover:bg-gray-50"
                aria-label="תקופה הבאה"
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
              <button
                type="button"
                onClick={jumpToToday}
                className="inline-flex items-center rounded-lg border border-[var(--color-calendar-sage-border)] bg-[var(--color-calendar-sage-soft)] px-2.5 py-1.5 text-[11px] font-medium text-[var(--color-calendar-sage)] hover:border-[var(--color-calendar-sage)]"
              >
                היום
              </button>
              <label className="relative inline-flex h-8 cursor-pointer items-center gap-1.5 border border-[var(--color-border-strong)] bg-[var(--color-surface)] px-2.5">
                <CalendarDays className="h-3.5 w-3.5 text-[var(--color-text-muted)]" />
                <span className="text-[11px] font-semibold text-gray-700">{periodLabel}</span>
                <input
                  type="date"
                  value={anchorDateKey}
                  onChange={(event) => {
                    if (event.target.value) setAnchorDate(parseDateKey(event.target.value));
                  }}
                  aria-label="בחירת תאריך לתצוגת היומן"
                  className="absolute inset-0 cursor-pointer opacity-0"
                />
              </label>
            </div>
          )}
        </div>
        {selectedRange === 'custom' && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2 bg-gray-50 border border-gray-200 rounded-lg p-2.5">
            <label className="text-xs text-gray-700 space-y-1">
              <span className="block font-medium">מתאריך</span>
              <input
                value={customFromDate}
                onChange={(e) => setCustomFromDate(e.target.value)}
                type="date"
                className="w-full rounded-md border border-gray-300 bg-[var(--color-surface)] px-2.5 py-1.5 text-xs"
              />
            </label>
            <label className="text-xs text-gray-700 space-y-1">
              <span className="block font-medium">עד תאריך</span>
              <input
                value={customToDate}
                onChange={(e) => setCustomToDate(e.target.value)}
                type="date"
                className="w-full rounded-md border border-gray-300 bg-[var(--color-surface)] px-2.5 py-1.5 text-xs"
              />
            </label>
          </div>
        )}

      </div>

      <div id="owner-shift-grid" className="flex min-h-0 flex-col gap-2.5 scroll-mt-4 lg:flex-1">
        <div className="flex min-h-[430px] flex-1 flex-col overflow-hidden rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-muted)] lg:min-h-0">
            <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
              <h2 className="font-semibold text-gray-900">
                תצוגת משמרות {selectedRangeContextLabel} ({displayedWorks.length})
              </h2>
              <Link
                href="/shifts/swaps"
                aria-label="החלפות משמרות"
                title="החלפות משמרות"
                className="inline-flex h-8 w-8 items-center justify-center text-[var(--color-calendar-sage)] hover:bg-[var(--color-calendar-sage-soft)]"
              >
                <Repeat2 className="h-4 w-4" />
              </Link>
            </div>

            <div data-testid="owner-calendar-scroll" className="calendar-scroll min-h-0 flex-1 overflow-auto">
              <div className="sticky top-0 z-30 grid border-b border-[var(--color-border)] bg-[var(--color-background)] shadow-sm" style={shiftGridStyle}>
                <div className="sticky right-0 z-40 flex min-h-[88px] items-center border-l border-gray-200 bg-[var(--color-background)] p-2.5 text-xs font-semibold text-gray-700">
                  עובדת
                </div>
                {visibleShiftDates.map((date) => {
                  const dateKey = toDateKeyFromDate(date);
                  const nonWorkingLabel = getNonWorkingDayLabel(dateKey);
                  const isNonWorkingDay = isWorkCreationBlockedDay(dateKey);
                  const isToday = dateKey === todayDateKey;
                  const isPast = dateKey < todayDateKey;
                  const summary = dateSummaryByDate.get(dateKey) ?? { hours: 0, jobs: 0, assigned: 0, required: 0 };
                  const staffedPercent = summary.required > 0
                    ? Math.min(100, Math.round((summary.assigned / summary.required) * 100))
                    : 0;
                  return (
                    <div
                      key={`head-${dateKey}`}
                      className={`group/date relative min-h-[88px] min-w-0 border-l border-[var(--color-border)] p-2 text-center ${
                        isNonWorkingDay || isPast
                          ? 'bg-[var(--color-background)] text-gray-500'
                          : isToday
                            ? 'bg-[var(--color-calendar-sage-soft)] text-[var(--color-calendar-sage)] shadow-[inset_0_2px_0_var(--color-calendar-sage)]'
                            : 'bg-[var(--color-background)] text-gray-700'
                      }`}
                    >
                      <div className="text-xs">{date.toLocaleDateString('he-IL', { weekday: 'short' })}</div>
                      <div className="text-xs font-semibold">{date.toLocaleDateString('he-IL', { day: '2-digit', month: '2-digit' })}</div>
                      <div className="mt-1 flex items-center justify-center gap-2 text-[9px] text-[var(--color-text-muted)]">
                        <span className="inline-flex items-center gap-0.5"><Clock3 className="h-2.5 w-2.5" />{summary.hours.toFixed(summary.hours % 1 ? 1 : 0)}</span>
                        <span className="inline-flex items-center gap-0.5"><BriefcaseBusiness className="h-2.5 w-2.5" />{summary.jobs}</span>
                        <span className="inline-flex items-center gap-0.5"><UsersRound className="h-2.5 w-2.5" />{summary.assigned}</span>
                      </div>
                      <div className={`mt-1.5 h-1 overflow-hidden rounded-full ${summary.required > 0 ? 'bg-rose-200' : 'bg-gray-200'}`}>
                        <div className="h-full bg-emerald-500" style={{ width: `${staffedPercent}%` }} />
                      </div>
                      {isToday && <div className="mt-0.5 text-[9px] font-semibold leading-3 text-[var(--color-calendar-sage)]">היום</div>}
                      {nonWorkingLabel && <div className="mt-0.5 text-[9px] text-[var(--color-calendar-sand)]">{nonWorkingLabel}</div>}
                      {!isNonWorkingDay && !isPast && (
                        <div data-date-menu className="absolute left-1 top-1">
                          <button
                            type="button"
                            onClick={() => setDateMenuKey((current) => current === dateKey ? null : dateKey)}
                            aria-label={`פעולות לתאריך ${dateKey}`}
                            aria-expanded={dateMenuKey === dateKey}
                            className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-white/90 text-gray-600 opacity-0 shadow-sm transition-opacity hover:text-primary-700 focus:opacity-100 group-hover/date:opacity-100"
                          >
                            <MoreHorizontal className="h-4 w-4" />
                          </button>
                          {dateMenuKey === dateKey && (
                            <div className="absolute left-0 top-7 z-50 w-36 border border-[var(--color-border-strong)] bg-[var(--color-background)] p-1 text-right shadow-lg">
                              <button
                                type="button"
                                onClick={() => {
                                  setDateMenuKey(null);
                                  setQuickCreateDate(dateKey);
                                }}
                                className="flex w-full items-center gap-2 px-2 py-2 text-xs font-medium text-gray-700 hover:bg-[var(--color-calendar-sage-soft)]"
                              >
                                <Plus className="h-3.5 w-3.5" />
                                יצירת עבודה
                              </button>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>

              <div className="grid border-b border-[var(--color-border)] bg-[var(--color-calendar-sage-soft)]/40" style={shiftGridStyle}>
                <div className="sticky right-0 z-20 flex items-center gap-1.5 border-l border-[var(--color-border)] bg-[var(--color-calendar-sage-soft)] p-2.5 text-xs font-semibold text-gray-700">
                  <FileText className="h-3.5 w-3.5 text-[var(--color-calendar-sage)]" />
                  מידע יומי
                </div>
                {visibleShiftDates.map((date) => {
                  const dateKey = toDateKeyFromDate(date);
                  const entry = dailyInfoByDate.get(dateKey);
                  const isNonWorkingDay = isWorkCreationBlockedDay(dateKey);
                  return (
                    <div key={`daily-info-${dateKey}`} className="group/daily min-h-11 border-l border-[var(--color-border)] bg-[var(--color-calendar-sage-soft)]/40 p-1.5">
                      {!isNonWorkingDay && (
                        <button
                          type="button"
                          onClick={() => openDailyInfo(dateKey)}
                          aria-label={`${entry ? 'עריכת' : 'הוספת'} מידע יומי לתאריך ${dateKey}`}
                          className={`flex h-full min-h-8 w-full items-center justify-center gap-1.5 rounded-md px-2 text-[10px] transition-colors ${
                            entry
                              ? 'border border-[var(--color-calendar-sage)]/20 bg-[var(--color-background)]/60 font-medium text-[var(--color-calendar-sage)]'
                              : 'text-gray-400 hover:bg-[var(--color-background)]/60 hover:text-[var(--color-calendar-sage)]'
                          }`}
                        >
                          {entry ? (
                            <span className="line-clamp-2">{entry.title || entry.body}</span>
                          ) : (
                            <Plus className="h-4 w-4 opacity-0 transition-opacity group-hover/daily:opacity-100" />
                          )}
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>

              <div className="sticky top-[88px] z-20 grid border-b border-[var(--color-border)] bg-[var(--color-calendar-sand-soft)] shadow-sm" style={shiftGridStyle}>
                <div className="sticky right-0 z-30 flex items-center gap-1.5 border-l border-gray-200 bg-[var(--color-calendar-sand-soft)] p-2.5 text-xs font-semibold text-gray-700">
                  <WandSparkles className="h-3.5 w-3.5 text-[var(--color-calendar-sand)]" />
                  סטטוס עבודות
                </div>
                {visibleShiftDates.map((date) => {
                  const dateKey = toDateKeyFromDate(date);
                  const isNonWorkingDay = isWorkCreationBlockedDay(dateKey);
                  const isToday = dateKey === todayDateKey;
                  const openWorks = unassignedWorksByDate.get(dateKey) ?? [];
                  return (
                    <div
                      key={`unassigned-${dateKey}`}
                      className={`min-h-[56px] border-l border-[var(--color-border)] p-1.5 ${isNonWorkingDay ? 'bg-[var(--color-background)]' : isToday ? 'bg-[var(--color-calendar-sage-soft)]' : ''}`}
                    >
                      {isNonWorkingDay || openWorks.length === 0 ? null : (
                        <div className="space-y-1">
                          {openWorks.slice(0, 2).map(({ work }) => (
                            <div
                              key={`unassigned-${work.id}`}
                              className={`group/staffing relative w-full rounded-md border px-2 py-1 text-right shadow-sm ${getShiftTypeCardClasses(work.jobType)}`}
                            >
                              <span className="absolute -right-1.5 -top-1.5 inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-primary-600 px-1 text-[10px] font-bold text-white shadow-sm">
                                {Math.max(work.requiredWorkers - work.approvedWorkers, 0)}
                              </span>
                              <button
                                type="button"
                                onClick={() => work.jobId && setSelectedJobId(work.jobId)}
                                className="block w-full pr-2 text-right"
                              >
                                <span className="block text-[10px] font-semibold text-gray-700">{work.startTime}–{work.endTime}</span>
                                <span className="block truncate text-[11px] font-semibold text-gray-900">{work.customerName}</span>
                              </button>
                              <StaffingGapSummary
                                shifts={work.assignedWorkers}
                                requiredWorkerCount={work.requiredWorkers}
                              />
                            </div>
                          ))}
                          {openWorks.length > 2 && (
                            <p className="text-center text-[11px] text-gray-500">+{openWorks.length - 2} נוספות</p>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>

              {dashboardWorkers.map((worker) => (
                <div
                  key={worker.id}
                  className="grid border-b border-gray-100"
                  style={shiftGridStyle}
                >
                 <div className="sticky right-0 z-10 border-l border-gray-100 bg-[var(--color-background)] p-2.5">
                   <p className="text-xs font-semibold text-gray-900">{worker.name}</p>
                    <p className="text-xs text-gray-500">
                      {worker.role}
                    </p>
                  </div>
                  {visibleShiftDates.map((date) => {
                    const dateKey = toDateKeyFromDate(date);
                    const nonWorkingLabel = getNonWorkingDayLabel(dateKey);
                    const isNonWorkingDay = isWorkCreationBlockedDay(dateKey);
                    const isToday = dateKey === todayDateKey;
                    const isPast = dateKey < todayDateKey;
                    const canAssign = !isNonWorkingDay && !isPast;
                    const unavailable = dashboardAvailability.find((item) => item.workerId === worker.id && item.dateKey === dateKey);
                    const shifts = shiftsByWorkerDate.get(`${worker.name}|${dateKey}`) ?? [];
                    return (
                      <div
                        key={`${worker.id}-${dateKey}`}
                        className={`min-h-[70px] border-l border-[var(--color-border)] p-1.5 ${
                          isNonWorkingDay
                            ? isToday
                              ? 'bg-[var(--color-calendar-sage-soft)]'
                              : 'bg-[var(--color-background)]'
                            : isToday
                              ? 'bg-[var(--color-calendar-sage-soft)]'
                              : 'bg-[var(--color-surface-muted)]'
                        }`}
                      >
                        {isNonWorkingDay ? (
                          <p className="mt-5 text-center text-[11px] text-gray-500">{nonWorkingLabel}</p>
                        ) : unavailable ? (
                          <div className="border-y border-[var(--color-calendar-unavailable-border)] px-2 py-2 text-center">
                            <p className="text-[11px] font-semibold text-[var(--color-calendar-unavailable)]">לא זמינה</p>
                            <p className="mt-0.5 text-[10px] text-[var(--color-text-secondary)]">{unavailable.reason}</p>
                            <p className="mt-0.5 text-[10px] font-medium text-[var(--color-calendar-unavailable)]">
                              {unavailable.startTime && unavailable.endTime
                                ? `${unavailable.startTime}–${unavailable.endTime}`
                                : 'כל היום'}
                            </p>
                          </div>
                        ) : shifts.length > 0 ? (
                          <div className="space-y-1">
                            {shifts.slice(0, 2).map((shift) => {
                              const linkedCase = caseById.get(shift.caseId);
                              const linkedCaseStatus = linkedCase?.status ?? 'ACTIVE';
                              const upcomingDiffDays = daysBetween(shift.dateKey, todayDateKey);
                              const isUrgentCase =
                                linkedCaseStatus === 'DRAFT' &&
                                upcomingDiffDays >= 0 &&
                                upcomingDiffDays <= 7;
                              // Badge describes THIS worker's assignment status, not the job status.
                              // A regular approved assignment shows no badge — the card already says "assigned".
                              const myAssignment = shift.assignedWorkers.find((w) => w.name === worker.name);
                              const badge = workerRowBadge(myAssignment ?? {});
                              return (
                                <div
                                  key={`${worker.id}-${shift.id}`}
                                  className={`w-full rounded-md border px-2 py-1 text-right ${getShiftTypeCardClasses(shift.jobType)}`}
                                >
                                  <button
                                    type="button"
                                    onClick={() => shift.jobId && setSelectedJobId(shift.jobId)}
                                    className="block w-full text-right"
                                  >
                                  <span className="block text-[11px] font-semibold text-gray-900">{shift.startTime}–{shift.endTime}</span>
                                  <span className="block text-[11px] text-gray-600">{shift.customerName}</span>
                                  {badge && (
                                    <span className={`mt-0.5 inline-flex items-center rounded-full border px-1.5 py-0.5 text-[10px] font-medium ${badge.className}`}>
                                      {badge.label}
                                    </span>
                                  )}
                                  </button>
                                  {isUrgentCase && (
                                    <p className="text-[10px] text-rose-700 mt-0.5">דחוף: העבודה ממתינה לאישור לקוח</p>
                                  )}
                                </div>
                              );
                            })}
                            {shifts.length > 2 && <p className="text-[11px] text-gray-500 text-center">+{shifts.length - 2} נוספות</p>}
                          </div>
                        ) : canAssign ? (
                          <button
                            type="button"
                            onClick={() => {
                              setAssignmentError(null);
                              setAssignmentTarget({
                                workerId: worker.id,
                                workerName: worker.name,
                                workerRole: worker.role,
                                dateKey,
                              });
                            }}
                            aria-label={`שיבוץ ${worker.name} בתאריך ${dateKey}`}
                            className="group flex h-full min-h-[54px] w-full items-center justify-center rounded-md text-gray-300 transition-colors hover:bg-primary-50 hover:text-primary-600"
                          >
                            <span className="inline-flex h-7 w-7 items-center justify-center rounded-full border border-current opacity-0 transition-opacity group-hover:opacity-100 group-focus:opacity-100">
                              <Plus className="h-4 w-4" />
                            </span>
                          </button>
                        ) : (
                          <p className="text-[11px] text-gray-300 mt-5 text-center">—</p>
                        )}
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>
          </div>
      </div>

      <SidePanel
        open={dailyInfoTargetDate !== null}
        onClose={() => setDailyInfoTargetDate(null)}
        title={
          dailyInfoTargetDate
            ? `מידע יומי · ${parseDateKey(dailyInfoTargetDate).toLocaleDateString('he-IL', {
                weekday: 'long',
                day: 'numeric',
                month: 'long',
              })}`
            : 'מידע יומי'
        }
      >
        <div className="space-y-5 p-6" dir="rtl">
          <div>
            <h4 className="font-semibold text-gray-900">הודעה יומית</h4>
            <p className="mt-1 text-xs text-[var(--color-text-secondary)]">
              ההודעה תוצג לכל העובדות ביום הזה, גם אם הן לא משובצות או סימנו שאינן זמינות.
            </p>
          </div>
          <label className="block text-sm">
            <span className="mb-1 block font-medium text-gray-700">כותרת</span>
            <input
              value={dailyInfoTitle}
              onChange={(event) => setDailyInfoTitle(event.target.value)}
              maxLength={100}
              placeholder="למשל: דגשים ליום העבודה"
              className="w-full border border-[var(--color-border-strong)] px-3 py-2"
            />
          </label>
          <label className="block text-sm">
            <span className="mb-1 block font-medium text-gray-700">הודעה</span>
            <textarea
              value={dailyInfoBody}
              onChange={(event) => setDailyInfoBody(event.target.value)}
              maxLength={1000}
              rows={7}
              placeholder="פרטים והנחיות שחשוב שכל העובדות יראו"
              className="w-full resize-y border border-[var(--color-border-strong)] px-3 py-2"
            />
            <span className="mt-1 block text-left text-[10px] text-[var(--color-text-muted)]">
              {dailyInfoBody.length}/1000
            </span>
          </label>
          <div className="border-y border-[var(--color-border)] py-3 text-sm text-gray-600">
            <span className="font-medium text-gray-800">מי רואה:</span> כל העובדות
          </div>
          {dailyInfoError && (
            <p className="border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{dailyInfoError}</p>
          )}
          <div className="flex items-center justify-between gap-3">
            {dailyInfoTargetDate && dailyInfoByDate.has(dailyInfoTargetDate) ? (
              <button
                type="button"
                onClick={() => void deleteDailyInfo()}
                disabled={dailyInfoBusy}
                className="px-3 py-2 text-sm font-medium text-rose-700 hover:bg-rose-50 disabled:opacity-50"
              >
                מחיקת ההודעה
              </button>
            ) : <span />}
            <button
              type="button"
              onClick={() => void saveDailyInfo()}
              disabled={dailyInfoBusy}
              className="bg-[var(--color-calendar-sage)] px-5 py-2.5 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
            >
              {dailyInfoBusy ? 'שומרת…' : 'שמירה'}
            </button>
          </div>
        </div>
      </SidePanel>

      <SidePanel
        open={Boolean(selectedJobId)}
        onClose={() => setSelectedJobId(null)}
        title="פרטי עבודה"
        widthClassName="sm:max-w-2xl xl:max-w-3xl"
      >
        {selectedJobId && <OwnerJobDetail jobId={selectedJobId} embedded />}
      </SidePanel>

      <SidePanel
        open={quickCreateDate !== null}
        onClose={() => setQuickCreateDate(null)}
        title={
          <span>יצירת עבודה</span>
        }
        widthClassName="sm:max-w-xl"
      >
        <div className="flex-1 px-6 py-4">
          <QuickCreateForm
            initialDate={quickCreateDate ?? undefined}
            onCreated={() => {
              setQuickCreateDate(null);
              setReloadKey((k) => k + 1);
            }}
            onCancel={() => setQuickCreateDate(null)}
          />
        </div>
      </SidePanel>

      <SidePanel
        open={assignmentTarget !== null}
        onClose={() => {
          setAssignmentTarget(null);
          setAssignmentError(null);
        }}
        title="שיבוץ עובדת"
      >
        <div className="space-y-4 p-6" dir="rtl">
          {assignmentTarget && (
            <>
              <div className="border-b border-[var(--color-border)] pb-3">
                <p className="font-semibold text-gray-900">{assignmentTarget.workerName}</p>
                <p className="text-sm text-gray-500">
                  {parseDateKey(assignmentTarget.dateKey).toLocaleDateString('he-IL', {
                    weekday: 'long',
                    day: '2-digit',
                    month: '2-digit',
                  })}
                </p>
              </div>
              {assignmentError && (
                <p className="border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{assignmentError}</p>
              )}
              {assignmentJobs.length === 0 ? (
                <div className="space-y-3">
                  <p className="text-sm text-gray-600">אין עבודות עם מקום פנוי בתאריך הזה.</p>
                  <button
                    type="button"
                    onClick={() => {
                      const dateKey = assignmentTarget.dateKey;
                      setAssignmentTarget(null);
                      setQuickCreateDate(dateKey);
                    }}
                    className="w-full bg-[var(--color-calendar-sage)] px-4 py-2.5 text-sm font-medium text-white hover:opacity-90"
                  >
                    יצירת עבודה בתאריך
                  </button>
                </div>
              ) : (
                <div className="space-y-2">
                  <p className="text-sm text-gray-600">בחרי עבודה לשיבוץ. העובדת תצטרך לאשר את ההזמנה.</p>
                  {assignmentJobs.map(({ work, open }) => (
                    <button
                      key={work.jobId}
                      type="button"
                      onClick={() => void assignWorkerFromCalendar(work)}
                      disabled={assignmentBusyJobId !== null}
                      className="w-full border border-[var(--color-border)] bg-[var(--color-surface)] p-3 text-right hover:border-[var(--color-calendar-sage)] disabled:opacity-50"
                    >
                      <span className="block font-semibold text-gray-900">{work.customerName} · {work.jobType}</span>
                      <span className="block text-xs text-gray-500">{work.address} · {open} מקומות פנויים</span>
                      <span className="mt-2 block text-xs font-medium text-[var(--color-calendar-sage)]">
                        {assignmentBusyJobId === work.jobId ? 'משבצת…' : 'שיבוץ לעבודה'}
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      </SidePanel>

      <JoinRequestsPanel
        open={joinPanelOpen}
        onClose={() => setJoinPanelOpen(false)}
        onChanged={() => setReloadKey((k) => k + 1)}
      />

      {!quickCreateDate && ownerToolsOpen && (
        <button
          type="button"
          aria-label="סגירת פעולות מהירות"
          className="fixed inset-0 z-40 cursor-default bg-transparent"
          onClick={() => setOwnerToolsOpen(false)}
        />
      )}
      {!quickCreateDate && <div className="fixed bottom-5 left-5 z-50 flex flex-col items-end gap-2" dir="rtl">
        {ownerToolsOpen && (
          <div className="w-56 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-1.5 shadow-xl">
            <button
              type="button"
              onClick={() => {
                setOwnerToolsOpen(false);
                setQuickCreateDate(todayDateKey);
              }}
              className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-right text-xs font-medium text-gray-800 hover:bg-[var(--color-calendar-sage-soft)]"
            >
              <BriefcaseBusiness className="h-4 w-4 text-[var(--color-calendar-sage)]" />
              יצירת עבודה
            </button>
            <Link
              href="/workers?action=invite"
              onClick={() => setOwnerToolsOpen(false)}
              className="flex items-center gap-2 rounded-md px-3 py-2 text-xs font-medium text-gray-800 hover:bg-[var(--color-calendar-sage-soft)]"
            >
              <UserPlus className="h-4 w-4 text-[var(--color-calendar-sage)]" />
              הזמנת עובדת
            </Link>
            <Link
              href="/workers"
              onClick={() => setOwnerToolsOpen(false)}
              className="flex items-center gap-2 rounded-md px-3 py-2 text-xs font-medium text-gray-800 hover:bg-[var(--color-calendar-sage-soft)]"
            >
              <Users className="h-4 w-4 text-[var(--color-calendar-sage)]" />
              ניהול עובדות וארכיון
            </Link>
            <Link
              href="/settings?section=notifications"
              onClick={() => setOwnerToolsOpen(false)}
              className="flex items-center gap-2 rounded-md px-3 py-2 text-xs font-medium text-gray-800 hover:bg-[var(--color-calendar-sage-soft)]"
            >
              <Bell className="h-4 w-4 text-[var(--color-calendar-sage)]" />
              הגדרות התראות
            </Link>
          </div>
        )}
        <button
          type="button"
          onClick={() => setOwnerToolsOpen((open) => !open)}
          aria-label="פעולות מהירות"
          aria-expanded={ownerToolsOpen}
          className="inline-flex h-11 w-11 items-center justify-center rounded-full bg-[var(--color-calendar-sage)] text-white shadow-lg transition-transform hover:scale-105"
        >
          {ownerToolsOpen ? <Settings className="h-5 w-5" /> : <Plus className="h-5 w-5" />}
        </button>
      </div>}

    </div>
  );
}

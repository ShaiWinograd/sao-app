'use client';

import { Suspense, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useAuth, useUser } from '@clerk/nextjs';
import { getStaffingIssueBreakdown, summarizeAgreedScheduledActual, validateServiceAddition } from '@workforce/shared';
import {
  ChevronLeft,
  ChevronRight,
  CheckCircle2,
  Circle,
  CalendarDays,
  Plus,
  Search,
  XCircle,
} from 'lucide-react';
import { getNonWorkingDayLabel, isWorkCreationBlockedDay } from '../../lib/non-working-days';
import { canViewSensitiveFinancials, resolveAppViewerRole } from '../../lib/viewer-access';
import { api, authHeaders } from '../../lib/api';

function getApiErrorMessage(error: unknown, fallback: string) {
  if (typeof error === 'object' && error !== null && 'response' in error) {
    const response = (error as { response?: { data?: unknown } }).response;
    const data = response?.data;
    if (typeof data === 'object' && data !== null && 'error' in data) {
      const message = (data as { error?: unknown }).error;
      if (typeof message === 'string' && message.trim()) {
        return message;
      }
    }
  }
  return fallback;
}

type RangeKey = 'today' | 'week' | 'month';
type PlannerView = 'works' | 'shifts';
type WorkStatus = 'done' | 'active' | 'planned';
type JobType = 'אריזה' | 'פריקה' | 'סידור';
type StaffingMode = 'auto' | 'approval';

type WorkItem = {
  id: string;
  addressId: string;
  customerId: string;
  customerName: string;
  caseId: string;
  caseName: string;
  jobType: JobType;
  address: string;
  date: string; // YYYY-MM-DD
  startTime: string;
  endTime: string;
  requiredWorkers: number;
  assignedWorkers: number;
  staffingMode: StaffingMode;
  status: WorkStatus;
  weeklyLimitApproved: boolean;
  requiresManager: boolean;
};
type CaseStatus = 'draft' | 'active' | 'ready_for_review' | 'completed';

type Customer = {
  id: string;
  fullName: string;
  phone: string;
  email: string;
  addresses: string[];
};

type CustomerAddressOption = {
  id: string;
  fullAddress: string;
};

type CustomerCase = {
  id: string;
  customerId: string;
  caseName: string;
  status: CaseStatus;
  latestJobDate: string; // YYYY-MM-DD
};

type Worker = {
  id: string;
  name: string;
  role: 'מנהלת' | 'ראש צוות' | 'עובדת';
  hourlyWage: number;
};

type WorkerAvailability = {
  workerId: string;
  date: string;
  reason: string;
};

type ShiftAssignment = {
  workerId: string;
  workId: string;
  date: string;
};

type ApiCustomer = {
  id: string;
  firstName: string;
  lastName: string;
  phone: string;
  email: string;
};

type ApiAddress = {
  id: string;
  customerId: string;
  fullAddress: string;
};

type ApiCase = {
  id: string;
  name: string;
  status: 'DRAFT' | 'ACTIVE' | 'READY_FOR_REVIEW' | 'COMPLETED' | 'CANCELLED';
  latestActivityDate: string | null;
  customer: {
    id: string;
  };
};

type FormTemplate = {
  id: string;
  title: string;
};

type ApiJob = {
  id: string;
  customerId: string;
  caseId: string;
  addressId: string;
  jobType: 'PACKING' | 'UNPACKING' | 'HOME_ORGANIZATION';
  date: string;
  plannedStart: string;
  plannedEnd: string;
  requiredWorkerCount: number;
  staffingMode: 'AUTO_APPROVE' | 'MANAGER_APPROVAL';
  status: 'DRAFT' | 'PUBLISHED' | 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED';
  workerVisibleNotes?: string | null;
  customer: { firstName: string; lastName: string };
  case: { id: string; name: string } | null;
  address: { fullAddress: string };
  slots: Array<{ requiredSkill: 'SHIFT_LEADER' | 'PACKING_SPECIALIST' | 'UNPACKING_SPECIALIST' | 'ORGANIZATION_SPECIALIST' | 'DRIVER' | 'GENERAL_WORKER' | null }>;
  shifts: Array<{ workerId: string }>;
};

const MOM_OWNER_NAME = 'אורית';

const rangeOptions: { key: RangeKey; label: string }[] = [
  { key: 'today', label: 'יום' },
  { key: 'week', label: 'שבוע' },
  { key: 'month', label: 'חודש' },
];

const statusMeta: Record<WorkStatus, { label: string; className: string }> = {
  done: { label: 'בוצע', className: 'bg-gray-100 text-gray-700 border-gray-200' },
  active: { label: 'בביצוע', className: 'bg-green-50 text-green-700 border-green-200' },
  planned: { label: 'מתוכנן', className: 'bg-blue-50 text-blue-700 border-blue-200' },
};

const caseStatusMeta: Record<CaseStatus, { label: string; className: string }> = {
  draft: { label: 'משוריין', className: 'border-amber-200 bg-amber-50 text-amber-700' },
  active: { label: 'מאושר לביצוע', className: 'border-blue-200 bg-blue-50 text-blue-700' },
  ready_for_review: { label: 'עבודה הסתיימה', className: 'border-purple-200 bg-purple-50 text-purple-700' },
  completed: { label: 'סגור', className: 'border-gray-200 bg-gray-100 text-gray-700' },
};

const jobTypeColorClass: Record<JobType, string> = {
  אריזה: 'bg-red-500',
  פריקה: 'bg-amber-500',
  סידור: 'bg-blue-500',
};

function getShiftTypeCardClasses(jobType: JobType) {
  if (jobType === 'אריזה') {
    return 'border-rose-200 bg-rose-50 hover:border-rose-300 hover:bg-rose-100';
  }
  if (jobType === 'פריקה') {
    return 'border-amber-200 bg-amber-50 hover:border-amber-300 hover:bg-amber-100';
  }
  return 'border-sky-200 bg-sky-50 hover:border-sky-300 hover:bg-sky-100';
}

function hoursToShiftHours(totalHours: number) {
  return Math.max(4, Math.min(9, Math.round(totalHours / 3)));
}

const initialCustomers: Customer[] = [];
const initialCases: CustomerCase[] = [];
const seededWorks: WorkItem[] = [];

const initialWorkers: Worker[] = [];

const initialAvailability: WorkerAvailability[] = [];

function toSundayWeekKey(dateKey: string) {
  const date = parseDateKey(dateKey);
  const sunday = new Date(date);
  sunday.setDate(date.getDate() - date.getDay());
  return toDateKey(sunday);
}

function buildConstrainedInitialAssignments(works: WorkItem[], workers: Worker[]) {
  const assignments: ShiftAssignment[] = [];
  const assignedDatesByWorker = new Map<string, Set<string>>();
  const weeklyCountByWorker = new Map<string, number>();

  sortWorksByDate(works).forEach((work) => {
    let assignedForWork = 0;
    const weekKey = toSundayWeekKey(work.date);
    for (const worker of workers) {
      if (assignedForWork >= work.requiredWorkers) break;
      const dates = assignedDatesByWorker.get(worker.id) ?? new Set<string>();
      if (dates.has(work.date)) continue;
      const weeklyKey = `${worker.id}|${weekKey}`;
      const weeklyCount = weeklyCountByWorker.get(weeklyKey) ?? 0;
      if (weeklyCount >= 4) continue;

      assignments.push({ workerId: worker.id, workId: work.id, date: work.date });
      dates.add(work.date);
      assignedDatesByWorker.set(worker.id, dates);
      weeklyCountByWorker.set(weeklyKey, weeklyCount + 1);
      assignedForWork += 1;
    }
  });

  return assignments;
}

const initialAssignments: ShiftAssignment[] = [];
const initialAssignedCountByWork = initialAssignments.reduce((acc, assignment) => {
  acc.set(assignment.workId, (acc.get(assignment.workId) ?? 0) + 1);
  return acc;
}, new Map<string, number>());
const initialWorks: WorkItem[] = [];

function normalizePhone(value: string) {
  return value.replace(/\D/g, '');
}

function isValidIsraeliPhone(value: string) {
  const n = normalizePhone(value);
  return n.startsWith('0') && (n.length === 9 || n.length === 10);
}

function isValidEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
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

function toDateKey(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function parseDateKey(dateKey: string) {
  const [year, month, day] = dateKey.split('-').map(Number);
  return new Date(year, month - 1, day);
}

function formatDayName(date: Date) {
  return date.toLocaleDateString('he-IL', { weekday: 'short' });
}

function formatDayDate(date: Date) {
  return date.toLocaleDateString('he-IL', { day: '2-digit', month: '2-digit' });
}

function daysBetween(a: string, b: string) {
  const aTime = parseDateKey(a).getTime();
  const bTime = parseDateKey(b).getTime();
  return Math.floor((aTime - bTime) / (1000 * 60 * 60 * 24));
}

function sortWorksByDate<T extends { date: string; startTime: string; id: string }>(works: T[]) {
  return [...works].sort(
    (a, b) => a.date.localeCompare(b.date) || a.startTime.localeCompare(b.startTime) || a.id.localeCompare(b.id),
  );
}

function toDisplayDateFromDateKey(dateKey: string) {
  return parseDateKey(dateKey).toLocaleDateString('he-IL', { weekday: 'long', day: '2-digit', month: '2-digit' });
}

function addDaysToDateKey(dateKey: string, days: number) {
  const date = parseDateKey(dateKey);
  date.setDate(date.getDate() + days);
  return toDateKey(date);
}

function mapApiCaseStatusToUi(status: ApiCase['status']): CaseStatus {
  if (status === 'ACTIVE') return 'active';
  if (status === 'READY_FOR_REVIEW') return 'ready_for_review';
  if (status === 'COMPLETED' || status === 'CANCELLED') return 'completed';
  return 'draft';
}

function mapUiJobTypeToApi(jobType: JobType): ApiJob['jobType'] {
  if (jobType === 'אריזה') return 'PACKING';
  if (jobType === 'פריקה') return 'UNPACKING';
  return 'HOME_ORGANIZATION';
}

function mapApiJobTypeToUi(jobType: ApiJob['jobType']): JobType {
  if (jobType === 'PACKING') return 'אריזה';
  if (jobType === 'UNPACKING') return 'פריקה';
  return 'סידור';
}

function getApiJobTypeForValidation(jobType: JobType): 'PACKING' | 'UNPACKING' | 'HOME_ORGANIZATION' {
  if (jobType === 'אריזה') return 'PACKING';
  if (jobType === 'פריקה') return 'UNPACKING';
  return 'HOME_ORGANIZATION';
}

function mapUiStaffingModeToApi(mode: StaffingMode): ApiJob['staffingMode'] {
  return mode === 'auto' ? 'AUTO_APPROVE' : 'MANAGER_APPROVAL';
}

function mapApiStaffingModeToUi(mode: ApiJob['staffingMode']): StaffingMode {
  return mode === 'AUTO_APPROVE' ? 'auto' : 'approval';
}

function mapApiJobStatusToUi(status: ApiJob['status']): WorkStatus {
  if (status === 'IN_PROGRESS') return 'active';
  if (status === 'COMPLETED' || status === 'CANCELLED') return 'done';
  return 'planned';
}

function toTimeString(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '09:00';
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

function toIsoDateTime(dateKey: string, time: string) {
  const normalized = time.length === 5 ? `${time}:00` : time;
  return new Date(`${dateKey}T${normalized}`).toISOString();
}

function JobsPageContent() {
  const { user } = useUser();
  const { getToken } = useAuth();
  const viewerRole = resolveAppViewerRole(user);
  const canSeeFinancials = canViewSensitiveFinancials(viewerRole);
  const searchParams = useSearchParams();
  const rangeFromQuery = searchParams.get('range');
  const viewFromQuery = searchParams.get('view');
  const initialRange: RangeKey =
    rangeFromQuery === 'today' || rangeFromQuery === 'week' || rangeFromQuery === 'month'
      ? rangeFromQuery
      : 'week';
  const initialPlannerView: PlannerView =
    viewFromQuery === 'works' || viewFromQuery === 'shifts' ? viewFromQuery : 'shifts';
  const [selectedRange, setSelectedRange] = useState<RangeKey>(initialRange);
  const [plannerView, setPlannerView] = useState<PlannerView>(initialPlannerView);
  const handledDashboardActionRef = useRef<string | null>(null);
  const today = new Date();
  const todayKey = toDateKey(today);
  const [anchorDate, setAnchorDate] = useState(
    () => new Date(today.getFullYear(), today.getMonth(), today.getDate()),
  );

  const [works, setWorks] = useState<WorkItem[]>(initialWorks);
  const [workers] = useState<Worker[]>(initialWorkers);
  const [availability] = useState<WorkerAvailability[]>(initialAvailability);
  const [assignments, setAssignments] = useState<ShiftAssignment[]>(initialAssignments);
  const [customers, setCustomers] = useState<Customer[]>(initialCustomers);
  const [cases, setCases] = useState<CustomerCase[]>(initialCases);
  const [customerAddressBook, setCustomerAddressBook] = useState<Record<string, CustomerAddressOption[]>>({});
  const [isSyncingData, setIsSyncingData] = useState(false);
  const [dataError, setDataError] = useState('');
  const [searchTerm, setSearchTerm] = useState('');
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [editingWorkId, setEditingWorkId] = useState<string | null>(null);
  const [createMessage, setCreateMessage] = useState('');
  const [formAttempted, setFormAttempted] = useState(false);
  const [customerMode, setCustomerMode] = useState<'existing' | 'new'>('existing');
  const [dayJobsPickerDateKey, setDayJobsPickerDateKey] = useState<string | null>(null);
  const [selectedCustomerId, setSelectedCustomerId] = useState('');
  const [newCustomerName, setNewCustomerName] = useState('');
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
  const [requireManager, setRequireManager] = useState(true);
  const [staffingMode, setStaffingMode] = useState<StaffingMode>('approval');
  const [workerVisibleNotes, setWorkerVisibleNotes] = useState('');
  const [weeklyLimitApproved, setWeeklyLimitApproved] = useState(false);
  const [formTemplates, setFormTemplates] = useState<FormTemplate[]>([]);
  const [selectedFormTemplateId, setSelectedFormTemplateId] = useState<string | null>(null);
  const [publishNow, setPublishNow] = useState(true);
  const [connectedFlow, setConnectedFlow] = useState<{
    caseId: string;
    caseName: string;
    customerId: string;
    customerName: string;
    address: string;
    packingDate: string;
  } | null>(null);
  const [lastCreatedCase, setLastCreatedCase] = useState<{ id: string; name: string } | null>(null);

  const loadOperationalData = async () => {
    setIsSyncingData(true);
    setDataError('');
    try {
      const auth = await authHeaders(getToken);
      const [customersResponse, casesResponse, jobsResponse] = await Promise.all([
        api.get<ApiCustomer[]>('/customers', auth),
        api.get<ApiCase[]>('/cases', auth),
        api.get<ApiJob[]>('/jobs', auth),
      ]);

      const addressEntries = await Promise.all(
        customersResponse.data.map(async (customer) => {
          try {
            const response = await api.get<ApiAddress[]>(`/addresses/for-customer/${customer.id}`, auth);
            return [customer.id, response.data] as const;
          } catch {
            return [customer.id, []] as const;
          }
        }),
      );

      const addressBook = Object.fromEntries(addressEntries) as Record<string, CustomerAddressOption[]>;

      const nextCustomers: Customer[] = customersResponse.data.map((customer) => {
        const addresses = (addressBook[customer.id] ?? []).map((address) => address.fullAddress);
        return {
          id: customer.id,
          fullName: `${customer.firstName} ${customer.lastName}`.trim(),
          phone: customer.phone,
          email: customer.email,
          addresses,
        };
      });

      const nextCases: CustomerCase[] = casesResponse.data.map((item) => ({
        id: item.id,
        customerId: item.customer.id,
        caseName: item.name,
        status: mapApiCaseStatusToUi(item.status),
        latestJobDate: item.latestActivityDate ? toDateKey(new Date(item.latestActivityDate)) : todayKey,
      }));

      const nextWorks: WorkItem[] = jobsResponse.data.map((job) => {
        const customerName = `${job.customer.firstName} ${job.customer.lastName}`.trim();
        const plannedDate = toDateKey(new Date(job.date));
        return {
          id: job.id,
          addressId: job.addressId,
          customerId: job.customerId,
          customerName,
          caseId: job.caseId,
          caseName: job.case?.name ?? `${customerName} - פרוייקט`,
          jobType: mapApiJobTypeToUi(job.jobType),
          address: job.address.fullAddress,
          date: plannedDate,
          startTime: toTimeString(job.plannedStart),
          endTime: toTimeString(job.plannedEnd),
          requiredWorkers: job.requiredWorkerCount,
          assignedWorkers: job.shifts.length,
          staffingMode: mapApiStaffingModeToUi(job.staffingMode),
          status: mapApiJobStatusToUi(job.status),
          weeklyLimitApproved: false,
          requiresManager: job.slots.some((slot) => slot.requiredSkill === 'SHIFT_LEADER'),
        };
      });

      const nextAssignments: ShiftAssignment[] = jobsResponse.data.flatMap((job) => {
        const date = toDateKey(new Date(job.date));
        return job.shifts.map((shift) => ({
          workerId: shift.workerId,
          workId: job.id,
          date,
        }));
      });

      setCustomerAddressBook(addressBook);
      setCustomers(nextCustomers);
      setCases(nextCases);
      setWorks(nextWorks);
      setAssignments(nextAssignments);
    } catch (error) {
      setDataError('טעינת נתונים מהשרת נכשלה.');
      setCustomerAddressBook({});
      setCustomers([]);
      setCases([]);
      setWorks([]);
      setAssignments([]);
      console.error('Failed loading jobs operational data', error);
    } finally {
      setIsSyncingData(false);
    }
  };

  useEffect(() => {
    void loadOperationalData();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [getToken]);

  const selectedCustomer = useMemo(
    () => customers.find((customer) => customer.id === selectedCustomerId) ?? null,
    [customers, selectedCustomerId],
  );
  const customerSuggestions = useMemo(() => {
    const nameTerm = newCustomerName.trim().toLowerCase();
    const phoneTerm = normalizePhone(newCustomerPhone);
    if (!nameTerm && !phoneTerm) return [];
    return customers
      .filter((customer) => {
        const matchesName = nameTerm ? customer.fullName.toLowerCase().includes(nameTerm) : false;
        const matchesPhone = phoneTerm ? normalizePhone(customer.phone).includes(phoneTerm) : false;
        return matchesName || matchesPhone;
      })
      .slice(0, 6);
  }, [customers, newCustomerName, newCustomerPhone]);
  const existingAddressSuggestions = useMemo(() => {
    if (!selectedCustomer) return [];
    const term = existingAddressQuery.trim().toLowerCase();
    if (!term) return selectedCustomer.addresses;
    return selectedCustomer.addresses.filter((address) => address.toLowerCase().includes(term));
  }, [selectedCustomer, existingAddressQuery]);
  const caseById = useMemo(() => new Map(cases.map((item) => [item.id, item])), [cases]);

  const monthAnchor = new Date(anchorDate.getFullYear(), anchorDate.getMonth(), 1);

  const monthOptions = useMemo(() => {
    return Array.from({ length: 18 }).map((_, index) => {
      const offset = index - 6;
      const date = new Date(today.getFullYear(), today.getMonth() + offset, 1);
      const value = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
      const label = date.toLocaleDateString('he-IL', { month: 'long', year: '2-digit' });
      return { value, label, date };
    });
  }, [today]);

  const visibleDates = useMemo(() => {
    if (selectedRange === 'today') {
      return [new Date(anchorDate.getFullYear(), anchorDate.getMonth(), anchorDate.getDate())];
    }

    if (selectedRange === 'week') {
      const day = anchorDate.getDay();
      const start = new Date(anchorDate);
      start.setDate(anchorDate.getDate() - day);
      return Array.from({ length: 7 }).map((_, i) => {
        const d = new Date(start);
        d.setDate(start.getDate() + i);
        return d;
      });
    }

    const daysInMonth = new Date(monthAnchor.getFullYear(), monthAnchor.getMonth() + 1, 0).getDate();
    return Array.from({ length: daysInMonth }).map(
      (_, i) => new Date(monthAnchor.getFullYear(), monthAnchor.getMonth(), i + 1),
    );
  }, [selectedRange, anchorDate, monthAnchor]);

  const monthCells = useMemo(() => {
    if (selectedRange !== 'month') return [];
    const firstDayOfMonth = new Date(monthAnchor.getFullYear(), monthAnchor.getMonth(), 1).getDay();
    const leadingEmpty = Array.from({ length: firstDayOfMonth }).map(() => null as Date | null);
    const days = visibleDates.map((date) => date as Date | null);
    const all = [...leadingEmpty, ...days];
    const trailingCount = (7 - (all.length % 7)) % 7;
    const trailingEmpty = Array.from({ length: trailingCount }).map(() => null as Date | null);
    return [...all, ...trailingEmpty];
  }, [selectedRange, monthAnchor, visibleDates]);

  const periodLabel = useMemo(() => {
    if (selectedRange === 'today') {
      return anchorDate.toLocaleDateString('he-IL', {
        weekday: 'short',
        day: '2-digit',
        month: '2-digit',
      });
    }
    if (selectedRange === 'week') {
      const first = visibleDates[0];
      const last = visibleDates[visibleDates.length - 1];
      if (!first || !last) return '';
      return `${first.toLocaleDateString('he-IL', { day: '2-digit', month: '2-digit' })} - ${last.toLocaleDateString('he-IL', { day: '2-digit', month: '2-digit' })}`;
    }
    return monthAnchor.toLocaleDateString('he-IL', { month: 'long', year: 'numeric' });
  }, [selectedRange, anchorDate, visibleDates, monthAnchor]);

  const movePeriod = (direction: 'next' | 'prev') => {
    const multiplier = direction === 'next' ? 1 : -1;
    setAnchorDate((prev) => {
      const next = new Date(prev);
      if (selectedRange === 'today') {
        next.setDate(prev.getDate() + multiplier);
      } else if (selectedRange === 'week') {
        next.setDate(prev.getDate() + 7 * multiplier);
      } else {
        next.setMonth(prev.getMonth() + multiplier);
        next.setDate(1);
      }
      return next;
    });
  };

  const jumpToToday = () => {
    setAnchorDate(new Date(today.getFullYear(), today.getMonth(), today.getDate()));
  };

  const filteredWorks = useMemo(() => {
    const term = searchTerm.trim().toLowerCase();
    if (!term) return works;
    return works.filter(
      (work) =>
        work.customerName.toLowerCase().includes(term) ||
        work.caseName.toLowerCase().includes(term) ||
        work.address.toLowerCase().includes(term),
    );
  }, [works, searchTerm]);

  const worksByDate = useMemo(() => {
    const map = new Map<string, WorkItem[]>();
    visibleDates.forEach((d) => map.set(toDateKey(d), []));
    filteredWorks.forEach((work) => {
      if (isWorkCreationBlockedDay(work.date)) {
        return;
      }
      if (map.has(work.date)) {
        map.get(work.date)!.push(work);
      }
    });
    return map;
  }, [visibleDates, filteredWorks, selectedRange]);

  const weeklySummary = useMemo(() => {
    const visibleDateKeys = new Set(visibleDates.map((date) => toDateKey(date)));
    const visibleWorks = works.filter((work) => {
      if (!visibleDateKeys.has(work.date)) return false;
      if (isWorkCreationBlockedDay(work.date)) return false;
      return true;
    });
    const totalShifts = visibleWorks.length;
    const totalRequired = visibleWorks.reduce((sum, work) => sum + work.requiredWorkers, 0);
    const totalAssigned = visibleWorks.reduce((sum, work) => sum + work.assignedWorkers, 0);
    return {
      totalShifts,
      totalRequired,
      totalAssigned,
      openSlots: Math.max(totalRequired - totalAssigned, 0),
    };
  }, [works, visibleDates]);

  const shiftsSummary = useMemo(() => {
    const visibleDateKeys = new Set(visibleDates.map((date) => toDateKey(date)));
    const visibleAssignments = assignments.filter((assignment) => visibleDateKeys.has(assignment.date));
    const workersScheduled = new Set(visibleAssignments.map((assignment) => assignment.workerId)).size;
    const unavailableEntries = availability.filter((entry) => visibleDateKeys.has(entry.date)).length;
    return {
      workersScheduled,
      assignedShifts: visibleAssignments.length,
      unavailableEntries,
    };
  }, [assignments, availability, visibleDates]);

  const dailyShiftCoverage = useMemo(() => {
    return visibleDates.map((date) => {
      const dateKey = toDateKey(date);
      const nonWorkingLabel = getNonWorkingDayLabel(dateKey);
      const isNonWorkingDay = isWorkCreationBlockedDay(dateKey);
      const dayWorks = works.filter((work) => work.date === dateKey);
      const required = dayWorks.reduce((sum, work) => sum + work.requiredWorkers, 0);
      const assigned = dayWorks.reduce((sum, work) => sum + Math.min(work.assignedWorkers, work.requiredWorkers), 0);
      const openSlots = Math.max(required - assigned, 0);
      const unfilledShifts = dayWorks.filter((work) => work.assignedWorkers < work.requiredWorkers).length;
      const coverage = required > 0 ? assigned / required : 1;
      const coverageClass = isNonWorkingDay
        ? 'bg-gray-300'
        : coverage >= 1
          ? 'bg-emerald-500'
          : coverage >= 0.75
            ? 'bg-amber-500'
            : 'bg-rose-500';
      return {
        dateKey,
        isNonWorkingDay,
        nonWorkingLabel,
        dayLabel: formatDayName(date),
        dateLabel: formatDayDate(date),
        required,
        assigned,
        openSlots,
        unfilledShifts,
        coverage,
        coverageClass,
      };
    });
  }, [visibleDates, works]);

  const totalUnfilledShifts = useMemo(
    () => dailyShiftCoverage.reduce((sum, day) => sum + day.unfilledShifts, 0),
    [dailyShiftCoverage],
  );

  const shiftsGridTemplateColumns = useMemo(() => {
    if (selectedRange === 'today') {
      return '220px minmax(0,1fr)';
    }
    return `220px repeat(${visibleDates.length}, minmax(110px, 1fr))`;
  }, [selectedRange, visibleDates.length]);

  const caseSuggestion = useMemo(() => {
    if (customerMode !== 'existing' || !selectedCustomerId) return null;
    const customerCases = cases.filter((c) => c.customerId === selectedCustomerId);
    const openCase = customerCases.find((c) => c.status === 'draft' || c.status === 'active');
    if (openCase) {
      return {
        type: openCase.status === 'draft' ? ('draft' as const) : ('active' as const),
        text:
          openCase.status === 'draft'
            ? `ללקוח יש פרוייקט משוריין: "${openCase.caseName}". לצרף אליו את העבודה?`
            : `ללקוח יש פרוייקט מאושר לביצוע: "${openCase.caseName}". לצרף אליו את העבודה?`,
        caseId: openCase.id,
      };
    }
    const recentCompleted = customerCases.find(
      (c) => c.status === 'completed' && daysBetween(jobDate, c.latestJobDate) >= 0 && daysBetween(jobDate, c.latestJobDate) <= 60,
    );
    if (recentCompleted) {
      return {
        type: 'recent' as const,
        text: `נמצא פרוייקט שהסתיים ב-60 הימים האחרונים: "${recentCompleted.caseName}". לפתוח מחדש ולהוסיף?`,
        caseId: recentCompleted.id,
      };
    }
    return {
      type: 'none' as const,
      text: 'לא נמצא פרוייקט פעיל. ייפתח פרוייקט חדש אוטומטית.',
      caseId: null,
    };
  }, [cases, customerMode, selectedCustomerId, jobDate]);

  const resetCreateForm = () => {
    setCustomerMode('new');
    setSelectedCustomerId('');
    setNewCustomerName('');
    setNewCustomerPhone('');
    setNewCustomerEmail('');
    setAddressMode('new');
    setSelectedAddress('');
    setExistingAddressQuery('');
    setNewAddress('');
    setAddressFloor('');
    setAddressApartment('');
    setJobType('אריזה');
    setJobDate('2026-07-06');
    setStartTime('09:00');
    setEndTime('14:00');
    setRequiredWorkers(4);
    setRequireManager(true);
    setStaffingMode('approval');
    setWorkerVisibleNotes('');
    setWeeklyLimitApproved(false);
    setSelectedFormTemplateId(null);
    setPublishNow(true);
    setConnectedFlow(null);
    setEditingWorkId(null);
    setCreateMessage('');
    setFormAttempted(false);
  };

  const openCreateModal = (targetDate?: string) => {
    if (targetDate && isWorkCreationBlockedDay(targetDate)) {
      return;
    }
    resetCreateForm();
    void authHeaders(getToken)
      .then((auth) =>
        api.get<FormTemplate[] | { templates?: FormTemplate[]; items?: FormTemplate[] }>('/forms/templates', auth),
      )
      .then((response) => {
        const data = response.data;
        setFormTemplates(Array.isArray(data) ? data : data.templates ?? data.items ?? []);
      })
      .catch(() => setFormTemplates([]));
    if (targetDate) {
      setJobDate(targetDate);
    }
    setIsCreateOpen(true);
  };

  const openDayJobsFromCoverage = (dateKey: string) => {
    const worksForDay = sortWorksByDate(works.filter((work) => work.date === dateKey));
    if (worksForDay.length === 0) {
      openCreateModal(dateKey);
      return;
    }
    if (worksForDay.length === 1) {
      openEditModal(worksForDay[0]);
      return;
    }
    setDayJobsPickerDateKey(dateKey);
  };

  const openEditModal = (work: WorkItem) => {
    setConnectedFlow(null);
    const customer = customers.find((c) => c.id === work.customerId);
    setEditingWorkId(work.id);
    setCustomerMode('existing');
    setSelectedCustomerId(work.customerId);
    setNewCustomerName(customer?.fullName ?? work.customerName);
    setNewCustomerPhone(customer?.phone ?? '');
    setNewCustomerEmail(customer?.email ?? '');
    if (customer?.addresses.includes(work.address)) {
      setAddressMode('existing');
      setSelectedAddress(work.address);
      setExistingAddressQuery(work.address);
      setNewAddress('');
    } else {
      setAddressMode('new');
      setSelectedAddress(customer?.addresses[0] ?? '');
      setExistingAddressQuery(customer?.addresses[0] ?? '');
      setNewAddress(work.address);
    }
    setAddressFloor('');
    setAddressApartment('');
    setJobType(work.jobType);
    setJobDate(work.date);
    setStartTime(work.startTime);
    setEndTime(work.endTime);
    setRequiredWorkers(work.requiredWorkers);
    setRequireManager(work.requiresManager);
    setStaffingMode(work.staffingMode);
    setWorkerVisibleNotes('');
    setWeeklyLimitApproved(work.weeklyLimitApproved);
    setCreateMessage('');
    setIsCreateOpen(true);
  };

  const saveNewWork = async () => {
    setCreateMessage('');
    const auth = await authHeaders(getToken);

    if (editingWorkId && customerMode === 'new') {
      setCreateMessage('בעריכת עבודה ניתן לבחור לקוח קיים בלבד.');
      return;
    }

    let customerId = selectedCustomerId;
    let customerName = selectedCustomer?.fullName ?? '';
    const baseAddress = customerMode === 'existing' ? (selectedAddress || existingAddressQuery.trim()) : newAddress.trim();
    let targetAddress = buildAddressWithUnit(baseAddress, addressFloor, addressApartment);
    let followupCustomerId = customerId;
    let createdCaseInfo: { id: string; name: string } | null = null;

    if (customerMode === 'new') {
      if (!newCustomerName.trim() || !newCustomerPhone.trim()) {
        setCreateMessage('ביצירת לקוח חדש יש למלא שם פרטי וטלפון.');
        setFormAttempted(true);
        return;
      }
      if (!isValidIsraeliPhone(newCustomerPhone)) {
        setCreateMessage('מספר הטלפון של הלקוח החדש לא תקין.');
        return;
      }
      const exactPhoneMatch = customers.find(
        (customer) => normalizePhone(customer.phone) === normalizePhone(newCustomerPhone),
      );
      if (exactPhoneMatch) {
        setCustomerMode('existing');
        setSelectedCustomerId(exactPhoneMatch.id);
        setSelectedAddress(exactPhoneMatch.addresses[0] ?? '');
        setExistingAddressQuery(exactPhoneMatch.addresses[0] ?? '');
        setCreateMessage(`נמצא לקוח קיים עם הטלפון הזה: ${exactPhoneMatch.fullName}. בחרי אותו מהרשימה.`);
        return;
      }
      if (newCustomerEmail.trim() && !isValidEmail(newCustomerEmail)) {
        setCreateMessage('כתובת האימייל של הלקוח החדש לא תקינה.');
        return;
      }
      if (!newAddress.trim()) {
        setCreateMessage('ביצירת לקוח חדש יש להזין כתובת עבודה.');
        return;
      }
      customerName = newCustomerName.trim();
      targetAddress = buildAddressWithUnit(newAddress.trim(), addressFloor, addressApartment);
    } else {
      if (!customerId || !customerName) {
        setCreateMessage('יש לבחור לקוח קיים מהרשימה הקופצת.');
        return;
      }
      if (!targetAddress) {
        setCreateMessage('יש לבחור כתובת קיימת ללקוח שנבחר.');
        return;
      }
      if (selectedCustomer && !selectedCustomer.addresses.includes(baseAddress.trim())) {
        setCreateMessage('בחרי כתובת מתוך רשימת הכתובות של הלקוח.');
        return;
      }
    }

    if (!jobDate || !startTime || !endTime) {
      setCreateMessage('יש למלא תאריך ושעות עבודה.');
      setFormAttempted(true);
      return;
    }
    if (!requiredWorkers || requiredWorkers < 1 || !Number.isInteger(requiredWorkers)) {
      setCreateMessage('כמות עובדים חייבת להיות מספר שלם חיובי.');
      setFormAttempted(true);
      return;
    }
    if (!requireManager) {
      setCreateMessage('בזרימת בעלת העסק חובה לסמן מנהל/ראש צוות אחראי לעבודה.');
      return;
    }
    const nonWorkingLabel = getNonWorkingDayLabel(jobDate);
    if (isWorkCreationBlockedDay(jobDate)) {
      setCreateMessage(`לא ניתן ליצור עבודה ביום ${nonWorkingLabel}.`);
      return;
    }
    if (connectedFlow && jobType === 'פריקה' && jobDate <= connectedFlow.packingDate) {
      setCreateMessage(
        `תאריך פריקה חייב להיות אחרי תאריך האריזה (${toDisplayDateFromDateKey(connectedFlow.packingDate)}).`,
      );
      return;
    }

    const existingWork = editingWorkId ? works.find((work) => work.id === editingWorkId) ?? null : null;
    if (editingWorkId && !existingWork) {
      setCreateMessage('לא נמצאה העבודה לעריכה.');
      return;
    }

    if (existingWork) {
      const assignmentsForWork = assignments.filter((assignment) => assignment.workId === existingWork.id);
      if (assignmentsForWork.length > 0) {
        const workersById = new Map(workers.map((worker) => [worker.id, worker]));
        const duplicatePerDay = assignmentsForWork
          .filter((assignment) =>
            assignments.some(
              (other) =>
                other.workId !== existingWork.id &&
                other.workerId === assignment.workerId &&
                other.date === jobDate,
            ),
          )
          .map((assignment) => workersById.get(assignment.workerId)?.name ?? assignment.workerId);

        if (duplicatePerDay.length > 0) {
          setCreateMessage(`לא ניתן לשבץ יותר ממשמרת אחת ביום לעובדת: ${Array.from(new Set(duplicatePerDay)).join(', ')}.`);
          return;
        }

        const targetWeekKey = toSundayWeekKey(jobDate);
        const overLimitWorkers = assignmentsForWork
          .filter((assignment) => {
            const countWithoutCurrentWork = assignments.filter(
              (other) =>
                other.workerId === assignment.workerId &&
                other.workId !== existingWork.id &&
                toSundayWeekKey(other.date) === targetWeekKey,
            ).length;
            return countWithoutCurrentWork + 1 > 4;
          })
          .map((assignment) => workersById.get(assignment.workerId)?.name ?? assignment.workerId);

        if (overLimitWorkers.length > 0 && !weeklyLimitApproved) {
          setCreateMessage(`שיבוץ של 5+ משמרות בשבוע דורש אישור חריג מאורית: ${Array.from(new Set(overLimitWorkers)).join(', ')}.`);
          return;
        }
      }
    }

    try {
      let resolvedCustomerId = customerId;
      let resolvedCustomerName = customerName;

      if (customerMode === 'new') {
        const [firstName, ...lastNameParts] = newCustomerName.trim().split(/\s+/);
        const fallbackEmail = `${normalizePhone(newCustomerPhone) || Date.now()}@spaceorder.local`;
        const createdCustomer = await api.post<ApiCustomer>('/customers', {
          firstName,
          lastName: lastNameParts.join(' ') || '-',
          phone: newCustomerPhone.trim(),
          email: newCustomerEmail.trim() || fallbackEmail,
        }, auth);
        resolvedCustomerId = createdCustomer.data.id;
        resolvedCustomerName = `${createdCustomer.data.firstName} ${createdCustomer.data.lastName}`.trim();
      }
      followupCustomerId = resolvedCustomerId;

      const addressOptions = customerAddressBook[resolvedCustomerId] ?? [];
      const existingAddressOption = addressOptions.find((address) => address.fullAddress === targetAddress);
      const ensuredAddress =
        existingAddressOption ??
        (
          await api.post<ApiAddress>('/addresses', {
            customerId: resolvedCustomerId,
            fullAddress: targetAddress,
            label: 'OTHER',
          }, auth)
        ).data;

      const customerCases = cases.filter((c) => c.customerId === resolvedCustomerId);
      const openCase = customerCases.find((c) => c.status === 'draft' || c.status === 'active');

      let caseId = existingWork?.caseId ?? '';
      let caseName = existingWork?.caseName ?? `${resolvedCustomerName} - פרוייקט`;
      if (!editingWorkId) {
        if (connectedFlow?.caseId) {
          caseId = connectedFlow.caseId;
          caseName = connectedFlow.caseName || caseName;
        } else if (openCase) {
          caseId = openCase.id;
          caseName = openCase.caseName;
        } else {
          const createdCase = await api.post<{ id: string }>('/cases', {
            customerId: resolvedCustomerId,
            name: `${resolvedCustomerName} - ${jobType} - ${parseDateKey(jobDate).toLocaleDateString('he-IL', { month: 'long', year: 'numeric' })}`,
            status: 'DRAFT',
            startDate: new Date().toISOString(),
          }, auth);
          caseId = createdCase.data.id;
          caseName = `${resolvedCustomerName} - ${jobType} - ${parseDateKey(jobDate).toLocaleDateString('he-IL', { month: 'long', year: 'numeric' })}`;
        }
      }

      const existingWorksInCase = works.filter((work) => work.caseId === caseId && work.id !== editingWorkId);
      const nextJobTypeForValidation = getApiJobTypeForValidation(jobType);
      const serviceValidationMessage = validateServiceAddition(
        existingWorksInCase.map((work) => getApiJobTypeForValidation(work.jobType)),
        nextJobTypeForValidation,
      );
      if (serviceValidationMessage) {
        setCreateMessage(serviceValidationMessage);
        return;
      }

      if (nextJobTypeForValidation === 'UNPACKING') {
        const latestPackingDate = existingWorksInCase
          .filter((work) => getApiJobTypeForValidation(work.jobType) === 'PACKING')
          .map((work) => work.date)
          .sort()
          .at(-1);
        if (latestPackingDate && jobDate <= latestPackingDate) {
          setCreateMessage(
            `תאריך פריקה חייב להיות אחרי יום האריזה האחרון בפרויקט (${toDisplayDateFromDateKey(latestPackingDate)}).`,
          );
          return;
        }
      }

      if (editingWorkId) {
        await api.patch(`/jobs/${editingWorkId}`, {
          addressId: ensuredAddress.id,
          jobType: mapUiJobTypeToApi(jobType),
          date: jobDate,
          plannedStart: toIsoDateTime(jobDate, startTime),
          plannedEnd: toIsoDateTime(jobDate, endTime),
          requiredWorkerCount: requiredWorkers,
          staffingMode: mapUiStaffingModeToApi(staffingMode),
          workerVisibleNotes: workerVisibleNotes.trim() || undefined,
          formTemplateId: selectedFormTemplateId ?? undefined,
        }, auth);
      } else {
        await api.post('/jobs', {
          caseId,
          customerId: resolvedCustomerId,
          addressId: ensuredAddress.id,
          jobType: mapUiJobTypeToApi(jobType),
          date: jobDate,
          plannedStart: toIsoDateTime(jobDate, startTime),
          plannedEnd: toIsoDateTime(jobDate, endTime),
          requiredWorkerCount: requiredWorkers,
          staffingMode: mapUiStaffingModeToApi(staffingMode),
          workerVisibleNotes: workerVisibleNotes.trim() || undefined,
          formTemplateId: selectedFormTemplateId ?? undefined,
          workerSlots: [
            { requiredSkill: 'SHIFT_LEADER', label: 'ראש/ת צוות' },
            ...Array.from({ length: Math.max(requiredWorkers - 1, 0) }, () => ({ requiredSkill: undefined })),
          ],
          publishNow,
        }, auth);
        createdCaseInfo = { id: caseId, name: caseName };
      }

      await loadOperationalData();
    } catch (error) {
      setCreateMessage(getApiErrorMessage(error, 'שמירת העבודה בשרת נכשלה. נסי שוב.'));
      console.error('Failed saving job to API', error);
      return;
    }

    if (!editingWorkId && jobType === 'אריזה') {
      const shouldAddUnpacking = window.confirm('נוצרה משמרת אריזה. להוסיף עכשיו גם משמרת פריקה ללקוח הזה?');
      if (shouldAddUnpacking) {
        const suggestedUnpackingDate = addDaysToDateKey(jobDate, 1);
        const currentCaseId = createdCaseInfo?.id ?? lastCreatedCase?.id;
        const currentCaseName = createdCaseInfo?.name ?? lastCreatedCase?.name;
        setEditingWorkId(null);
        setCustomerMode('existing');
        setSelectedCustomerId(followupCustomerId);
        setSelectedAddress(targetAddress);
        setExistingAddressQuery(targetAddress);
        setAddressMode('existing');
        setNewAddress('');
        setJobType('פריקה');
        setJobDate(suggestedUnpackingDate);
        setStartTime(startTime);
        setEndTime(endTime);
        setConnectedFlow({
          caseId: currentCaseId ?? '',
          caseName: currentCaseName ?? '',
          customerId: followupCustomerId,
          customerName: (selectedCustomer?.fullName ?? newCustomerName.trim()) || 'לקוח',
          address: targetAddress,
          packingDate: jobDate,
        });
        setCreateMessage('הוגדרה משמרת פריקה מחוברת. יש לבחור תאריך שאחרי האריזה ולשמור.');
        return;
      }
    }

    if (!editingWorkId && connectedFlow && jobType === 'פריקה') {
      setConnectedFlow(null);
    }
    if (createdCaseInfo) {
      setLastCreatedCase(createdCaseInfo);
    }

    setEditingWorkId(null);
    setIsCreateOpen(false);
  };

  const cancelWork = async () => {
    if (!editingWorkId) return;
    const shouldCancel = window.confirm('לבטל את העבודה? ניתן לשחזר דרך יצירה מחדש במידת הצורך.');
    if (!shouldCancel) return;
    try {
      const auth = await authHeaders(getToken);
      await api.post(`/jobs/${editingWorkId}/cancel`, undefined, auth);
      await loadOperationalData();
      setEditingWorkId(null);
      setIsCreateOpen(false);
      setCreateMessage('');
    } catch (error) {
      setCreateMessage(getApiErrorMessage(error, 'ביטול העבודה נכשל. נסי שוב.'));
      console.error('Failed cancelling job', error);
    }
  };

  const workById = useMemo(() => {
    return new Map(works.map((work) => [work.id, work]));
  }, [works]);

  const dayJobsForPicker = useMemo(() => {
    if (!dayJobsPickerDateKey) return [];
    return sortWorksByDate(works.filter((work) => work.date === dayJobsPickerDateKey));
  }, [works, dayJobsPickerDateKey]);

  const assignmentByWorkerAndDate = useMemo(() => {
    const visibleDateKeys = new Set(visibleDates.map((date) => toDateKey(date)));
    const map = new Map<string, ShiftAssignment[]>();
    assignments
      .filter((assignment) => visibleDateKeys.has(assignment.date))
      .forEach((assignment) => {
        const key = `${assignment.workerId}|${assignment.date}`;
        map.set(key, [...(map.get(key) ?? []), assignment]);
      });
    return map;
  }, [assignments, visibleDates]);

  const shiftCountByWorkerId = useMemo(() => {
    const visibleDateKeys = new Set(visibleDates.map((date) => toDateKey(date)));
    const map = new Map<string, number>();
    assignments
      .filter((assignment) => visibleDateKeys.has(assignment.date))
      .forEach((assignment) => {
        map.set(assignment.workerId, (map.get(assignment.workerId) ?? 0) + 1);
      });
    return map;
  }, [assignments, visibleDates]);

  const workResponsibilityById = useMemo(() => {
    const workerById = new Map(workers.map((worker) => [worker.id, worker]));
    const map = new Map<string, { leadName: string | null; responsibleName: string; responsibleRole: 'admin' | 'owner' }>();
    works.forEach((work) => {
      const assignmentsForWork = assignments.filter((assignment) => assignment.workId === work.id);
      const firstLeadAssignment = assignmentsForWork.find((assignment) => {
        const worker = workerById.get(assignment.workerId);
        return worker?.role === 'ראש צוות' || worker?.role === 'מנהלת';
      });
      const leadName = firstLeadAssignment ? workerById.get(firstLeadAssignment.workerId)?.name ?? null : null;
      map.set(work.id, {
        leadName,
        responsibleName: leadName ?? MOM_OWNER_NAME,
        responsibleRole: leadName ? 'admin' : 'owner',
      });
    });
    return map;
  }, [assignments, workers, works]);

  const staffingInsights = useMemo(() => {
    const visibleDateKeys = new Set(visibleDates.map((date) => toDateKey(date)));
    const visibleWorks = works.filter((work) => {
      if (!visibleDateKeys.has(work.date)) return false;
      if (isWorkCreationBlockedDay(work.date)) return false;
      return true;
    });

    const perWork = visibleWorks.map((work) => {
      const responsibility = workResponsibilityById.get(work.id);
      const hasAssignedManager = responsibility?.responsibleRole === 'admin';
      return getStaffingIssueBreakdown({
        requiredWorkers: work.requiredWorkers,
        assignedWorkers: work.assignedWorkers,
        requiresManager: work.requiresManager,
        hasAssignedManager,
        status: work.status,
      });
    });

    const workerShortageSlots = perWork.reduce((sum, item) => sum + item.workerShortageSlots, 0);
    const managerShortageJobs = perWork.filter((item) => item.managerShortage).length;
    const readyJobs = perWork.filter((item) => item.isReadyForExecution).length;

    const agreedScheduledActual = summarizeAgreedScheduledActual(
      visibleWorks.map((work) => {
        const responsibility = workResponsibilityById.get(work.id);
        return {
          requiredWorkers: work.requiredWorkers,
          assignedWorkers: work.assignedWorkers,
          requiresManager: work.requiresManager,
          hasAssignedManager: responsibility?.responsibleRole === 'admin',
          status: work.status,
        };
      }),
    );

    return {
      workerShortageSlots,
      managerShortageJobs,
      readyJobs,
      totalJobs: visibleWorks.length,
      agreedScheduledActual,
    };
  }, [visibleDates, works, workResponsibilityById]);

  useEffect(() => {
    if (plannerView === 'shifts' && selectedRange === 'month') {
      setSelectedRange('week');
    }
  }, [plannerView, selectedRange]);

  useEffect(() => {
    const action = searchParams.get('open');
    if (!action) return;

    const token = searchParams.toString();
    if (handledDashboardActionRef.current === token) return;

    if (action === 'create') {
      const date = searchParams.get('date') ?? undefined;
      openCreateModal(date);
      handledDashboardActionRef.current = token;
      return;
    }

    if (action === 'edit') {
      const jobId = searchParams.get('jobId');
      if (!jobId) return;
      const workToEdit = works.find((work) => work.id === jobId);
      if (!workToEdit) return;
      openEditModal(workToEdit);
      handledDashboardActionRef.current = token;
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams, works]);

  const visibleRangeOptions = useMemo(
    () => (plannerView === 'shifts' ? rangeOptions.filter((option) => option.key !== 'month') : rangeOptions),
    [plannerView],
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">עבודות</h1>
          <p className="text-gray-600 mt-1">תכנון שבועי ברור + יצירת עבודה חדשה בלחיצה אחת</p>
          <span className="inline-flex mt-2 px-2.5 py-1 rounded-full border border-gray-300 text-xs text-gray-700">
            תצוגת מתכנן חדשה
          </span>
        </div>
        <button
          type="button"
          onClick={() => openCreateModal()}
          className="inline-flex items-center gap-2 rounded-lg bg-purple-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-purple-700"
        >
          <Plus className="w-4 h-4" />
          עבודה חדשה
        </button>
      </div>

      {isSyncingData ? (
        <div className="rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-sm text-blue-700">טוען נתוני עבודות מהשרת...</div>
      ) : null}
      {dataError ? (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">{dataError}</div>
      ) : null}
      {lastCreatedCase ? (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800 flex flex-wrap items-center justify-between gap-2">
          <span>העבודה נשמרה בהצלחה. הפרוייקט מקושר וזמין להמשך טיפול.</span>
          <div className="flex items-center gap-2">
            <Link
              href={{ pathname: '/cases', query: { caseId: lastCreatedCase.id } }}
              className="rounded-md border border-emerald-300 bg-white px-2.5 py-1 text-xs font-medium text-emerald-800 hover:bg-emerald-100"
            >
              מעבר לפרוייקט
            </Link>
            <button
              type="button"
              onClick={() => setLastCreatedCase(null)}
              className="rounded-md border border-emerald-200 bg-emerald-100 px-2.5 py-1 text-xs font-medium text-emerald-800 hover:bg-emerald-200"
            >
              סגירה
            </button>
          </div>
        </div>
      ) : null}

      <div className="bg-white rounded-lg border border-gray-200 p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="inline-flex rounded-lg border border-gray-200 bg-gray-50 p-1">
            {[
              { key: 'works' as const, label: 'תצוגת עבודות' },
              { key: 'shifts' as const, label: 'תצוגת משמרות' },
            ].map((option) => {
              const isActive = plannerView === option.key;
              return (
                <button
                  key={option.key}
                  type="button"
                  onClick={() => setPlannerView(option.key)}
                  className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                    isActive ? 'bg-gray-800 text-white shadow-sm' : 'text-gray-600 hover:bg-white'
                  }`}
                >
                  {option.label}
                </button>
              );
            })}
          </div>
          <div className="inline-flex rounded-lg border border-gray-200 bg-gray-50 p-1">
            {visibleRangeOptions.map((option) => {
              const isActive = option.key === selectedRange;
              return (
                <button
                  key={option.key}
                  type="button"
                  onClick={() => setSelectedRange(option.key)}
                  className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                    isActive ? 'bg-purple-600 text-white shadow-sm ring-2 ring-purple-200' : 'text-gray-600 hover:bg-white'
                  }`}
                >
                  {option.label}
                </button>
              );
            })}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => movePeriod('prev')}
              className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-gray-300 text-gray-700 hover:bg-gray-50"
              aria-label="שבוע קודם"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={() => movePeriod('next')}
              className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-gray-300 text-gray-700 hover:bg-gray-50"
              aria-label="שבוע הבא"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={jumpToToday}
              className="inline-flex items-center rounded-lg border border-purple-200 bg-purple-50 px-3 py-2 text-xs font-medium text-purple-700 hover:bg-purple-100"
            >
              היום
            </button>
            <div className="inline-flex items-center gap-2 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2">
              <CalendarDays className="h-4 w-4 text-gray-500" />
              <span className="text-xs font-semibold text-gray-700">{periodLabel}</span>
            </div>
            {selectedRange === 'month' && plannerView === 'works' && (
              <select
                value={`${anchorDate.getFullYear()}-${String(anchorDate.getMonth() + 1).padStart(2, '0')}`}
                onChange={(e) => {
                  const [year, month] = e.target.value.split('-').map(Number);
                  setAnchorDate(new Date(year, month - 1, 1));
                }}
                className="h-9 rounded-lg border border-gray-300 bg-white px-3 text-xs text-gray-700"
              >
                {monthOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            )}
          </div>
          <div className="relative w-full max-w-sm">
            <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full rounded-lg border border-gray-300 pr-9 pl-3 py-2 text-sm text-right"
              placeholder="חיפוש לקוח / פרוייקט / כתובת"
            />
          </div>
        </div>

        <div className="mt-4 grid grid-cols-2 md:grid-cols-4 gap-3">
          <div className="rounded-lg border border-gray-200 p-3">
            <p className="text-xs text-gray-500">{plannerView === 'works' ? 'סה״כ עבודות בטווח' : 'עובדים ששובצו'}</p>
            <p className="text-xl font-bold text-gray-900 mt-1">{plannerView === 'works' ? weeklySummary.totalShifts : shiftsSummary.workersScheduled}</p>
          </div>
          <div className="rounded-lg border border-gray-200 p-3">
            <p className="text-xs text-gray-500">{plannerView === 'works' ? 'תקנים משובצים' : 'סה״כ שיבוצי עובדים'}</p>
            <p className="text-xl font-bold text-gray-900 mt-1">
              {plannerView === 'works' ? `${weeklySummary.totalAssigned}/${weeklySummary.totalRequired}` : shiftsSummary.assignedShifts}
            </p>
          </div>
          <div className="rounded-lg border border-gray-200 p-3">
            <p className="text-xs text-gray-500">{plannerView === 'works' ? 'חוסר עובדים' : 'ימי אי-זמינות'}</p>
            <p className={`text-xl font-bold mt-1 ${plannerView === 'works' ? (staffingInsights.workerShortageSlots > 0 ? 'text-amber-700' : 'text-emerald-700') : shiftsSummary.unavailableEntries > 0 ? 'text-rose-700' : 'text-emerald-700'}`}>
              {plannerView === 'works' ? staffingInsights.workerShortageSlots : shiftsSummary.unavailableEntries}
            </p>
          </div>
          <div className="rounded-lg border border-gray-200 p-3">
            <p className="text-xs text-gray-500">מסגרת תצוגה</p>
            <p className="text-xl font-bold text-gray-900 mt-1">{visibleRangeOptions.find((r) => r.key === selectedRange)?.label}</p>
          </div>
        </div>

        {plannerView === 'works' ? (
          <div className="mt-4 grid grid-cols-1 gap-3 lg:grid-cols-2" data-testid="staffing-insights-panel">
            <div className="rounded-lg border border-gray-200 p-3">
              <p className="text-xs text-gray-500">מה סוכם מול לקוח / מה שובץ / מה בוצע בפועל</p>
              <div className="mt-2 grid grid-cols-3 gap-2 text-center">
                <div className="rounded-md border border-blue-200 bg-blue-50 px-2 py-2">
                  <p className="text-[11px] text-blue-700">סוכם</p>
                  <p className="text-base font-bold text-blue-800">{staffingInsights.agreedScheduledActual.agreedSlots}</p>
                </div>
                <div className="rounded-md border border-amber-200 bg-amber-50 px-2 py-2">
                  <p className="text-[11px] text-amber-700">שובץ</p>
                  <p className="text-base font-bold text-amber-800">{staffingInsights.agreedScheduledActual.scheduledSlots}</p>
                </div>
                <div className="rounded-md border border-emerald-200 bg-emerald-50 px-2 py-2">
                  <p className="text-[11px] text-emerald-700">בוצע בפועל</p>
                  <p className="text-base font-bold text-emerald-800">{staffingInsights.agreedScheduledActual.actualSlots}</p>
                </div>
              </div>
            </div>

            <div className="rounded-lg border border-gray-200 p-3" data-testid="staffing-shortages-panel">
              <p className="text-xs text-gray-500">מצב איוש</p>
              <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
                <span className={`rounded-full border px-2 py-1 ${staffingInsights.workerShortageSlots > 0 ? 'border-amber-200 bg-amber-50 text-amber-700' : 'border-emerald-200 bg-emerald-50 text-emerald-700'}`}>
                  חוסר עובדים: {staffingInsights.workerShortageSlots}
                </span>
                <span className={`rounded-full border px-2 py-1 ${staffingInsights.managerShortageJobs > 0 ? 'border-rose-200 bg-rose-50 text-rose-700' : 'border-emerald-200 bg-emerald-50 text-emerald-700'}`}>
                  חוסר מנהל: {staffingInsights.managerShortageJobs}
                </span>
                <span className="rounded-full border border-gray-200 bg-gray-50 px-2 py-1 text-gray-700">
                  מוכן לביצוע: {staffingInsights.readyJobs}/{staffingInsights.totalJobs}
                </span>
                <span className="rounded-full border border-gray-200 bg-gray-50 px-2 py-1 text-gray-700">
                  בקשות ממתינות: 0
                </span>
                <span className="rounded-full border border-gray-200 bg-gray-50 px-2 py-1 text-gray-700">
                  רשימת המתנה: 0
                </span>
              </div>
            </div>
          </div>
        ) : null}
      </div>

      <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
        <div className="overflow-x-auto">
          {plannerView === 'shifts' && (
            <div className="border-b border-gray-200 bg-gray-50 py-3">
              <div className="flex flex-wrap items-center justify-between gap-2 px-4">
                <p className="text-sm font-semibold text-gray-900">בקרת איוש משמרות</p>
                <p className={`text-xs font-semibold ${totalUnfilledShifts > 0 ? 'text-rose-700' : 'text-emerald-700'}`}>
                  {totalUnfilledShifts > 0
                    ? `${totalUnfilledShifts} משמרות לא מאוישות במלואן`
                    : 'כל המשמרות בטווח מאוישות במלואן'}
                </p>
              </div>
              <div
                className="mt-3 grid gap-2 min-w-[1100px]"
                style={{ gridTemplateColumns: shiftsGridTemplateColumns }}
              >
                <div aria-hidden className="px-2.5 py-2" />
                {dailyShiftCoverage.map((day) =>
                  day.isNonWorkingDay ? (
                    <div
                      key={`coverage-${day.dateKey}`}
                      className={`rounded-lg border px-2.5 py-2 text-right ${day.dateKey === todayKey ? 'border-purple-300 bg-purple-100' : 'border-gray-300 bg-gray-100'}`}
                    >
                      <div className="text-right">
                        <div className="flex items-center justify-between gap-1">
                          {day.dateKey === todayKey && (
                            <span className="rounded-full bg-purple-600 px-1.5 py-0.5 text-[10px] font-semibold text-white">היום</span>
                          )}
                          <div className="text-right">
                            <p className="text-xs leading-4 text-gray-500">{day.dayLabel}</p>
                            <p className="text-xs leading-4 text-gray-500">{day.dateLabel}</p>
                          </div>
                        </div>
                      </div>
                      <p className="mt-3 text-xs text-gray-500">{day.nonWorkingLabel}</p>
                    </div>
                  ) : (
                    <button
                      key={`coverage-${day.dateKey}`}
                      type="button"
                      onClick={() => openDayJobsFromCoverage(day.dateKey)}
                      className={`rounded-lg border px-2.5 py-2 text-right hover:border-purple-300 hover:bg-purple-50 ${day.dateKey === todayKey ? 'border-purple-300 bg-purple-50' : 'border-gray-200 bg-white'}`}
                    >
                      <div className="flex items-center justify-between">
                        <div className="text-right">
                          <div className="flex items-center justify-end gap-1">
                            {day.dateKey === todayKey && (
                              <span className="rounded-full bg-purple-600 px-1.5 py-0.5 text-[10px] font-semibold text-white">היום</span>
                            )}
                            <p className="text-xs leading-4 text-gray-700">{day.dayLabel}</p>
                          </div>
                          <p className="text-xs leading-4 text-gray-700">{day.dateLabel}</p>
                        </div>
                        <p className="text-xs font-semibold text-gray-700">{day.assigned}/{day.required || 0}</p>
                      </div>
                      <div className="mt-1.5 h-1.5 w-full rounded-full bg-gray-200 overflow-hidden">
                        <div
                          className={`h-full ${day.coverageClass}`}
                          style={{ width: `${Math.max(6, Math.min(100, Math.round(day.coverage * 100)))}%` }}
                        />
                      </div>
                      <p className={`mt-1 text-xs font-medium ${day.unfilledShifts > 0 ? 'text-rose-700' : 'text-emerald-700'}`}>
                        {day.required === 0 ? 'אין משמרות' : day.unfilledShifts > 0 ? `${day.unfilledShifts} משמרות בחוסר` : 'איוש מלא'}
                      </p>
                    </button>
                  ),
                )}
              </div>
            </div>
          )}
          {plannerView === 'works' ? (
            <div dir="ltr" className={`grid gap-3 p-4 min-w-[980px] ${selectedRange === 'today' ? 'grid-cols-1' : 'grid-cols-7'}`}>
              {(selectedRange === 'month' ? monthCells : visibleDates).map((date, index) => {
                if (!date) {
                  return <div key={`empty-${index}`} className="rounded-lg border border-transparent min-h-[260px]" />;
                }

                const key = toDateKey(date);
                const nonWorkingLabel = getNonWorkingDayLabel(key);
                const isNonWorkingDay = isWorkCreationBlockedDay(key);
                const isToday = key === todayKey;
                const items = isNonWorkingDay ? [] : worksByDate.get(key) ?? [];
                return (
                  <div
                    key={key}
                    onClick={() => {
                      if (!isNonWorkingDay) openCreateModal(key);
                    }}
                    className={`rounded-lg border min-h-[260px] flex flex-col ${
                      isNonWorkingDay
                        ? 'border-gray-300 bg-gray-100'
                        : isToday
                          ? 'border-purple-300 bg-purple-50/40 cursor-pointer hover:border-purple-400 hover:bg-purple-100/60'
                          : 'border-gray-200 bg-white cursor-pointer hover:border-purple-300 hover:bg-purple-50/70'
                    }`}
                  >
                    <div className={`px-3 py-2 border-b ${isNonWorkingDay ? 'border-gray-300 bg-gray-200/60' : 'border-gray-100 bg-gray-50'}`}>
                      <div className="flex items-center justify-between">
                        <p className="text-xs text-gray-500">{formatDayName(date)}</p>
                        {isToday && (
                          <span className="inline-flex items-center gap-1 rounded-full bg-purple-100 px-2 py-0.5 text-[10px] font-semibold text-purple-700">
                            <Circle className="h-2 w-2 fill-current" />
                            היום
                          </span>
                        )}
                      </div>
                      <p className={`text-sm font-semibold ${isNonWorkingDay ? 'text-gray-600' : 'text-gray-900'}`}>{formatDayDate(date)}</p>
                      {nonWorkingLabel && (
                        <p className={`text-[11px] mt-0.5 ${isNonWorkingDay ? 'text-gray-500' : 'text-amber-700'}`}>{nonWorkingLabel}</p>
                      )}
                    </div>
                    <div className="p-2 space-y-2 flex-1 overflow-y-auto">
                      {isNonWorkingDay ? (
                        <p className="text-xs text-gray-500 py-3 text-center">{nonWorkingLabel} - אין עבודות</p>
                      ) : items.length === 0 ? (
                        <p className="text-xs text-gray-400 py-3 text-center">לחיצה ליצירת עבודה</p>
                      ) : (
                        items.map((work) => {
                          const status = statusMeta[work.status];
                          const staffingGap = Math.max(work.requiredWorkers - work.assignedWorkers, 0);
                          const responsibility = workResponsibilityById.get(work.id);
                          const staffingBreakdown = getStaffingIssueBreakdown({
                            requiredWorkers: work.requiredWorkers,
                            assignedWorkers: work.assignedWorkers,
                            requiresManager: work.requiresManager,
                            hasAssignedManager: responsibility?.responsibleRole === 'admin',
                            status: work.status,
                          });
                          const linkedCase = caseById.get(work.caseId);
                          const linkedCaseMeta = caseStatusMeta[linkedCase?.status ?? 'draft'];
                          return (
                            <button
                              key={work.id}
                              type="button"
                              onClick={(event) => {
                                event.stopPropagation();
                                openEditModal(work);
                              }}
                              className="relative w-full rounded-md border border-gray-200 bg-white p-2 pr-3 text-right hover:border-purple-300 hover:bg-purple-50/70"
                            >
                              <div className={`absolute right-0 top-1 bottom-1 w-1 rounded-full ${jobTypeColorClass[work.jobType]}`} />
                              <p className="text-sm font-semibold text-gray-900">לקוח: {work.customerName}</p>
                              <p className="text-[11px] text-gray-600 mt-0.5 truncate">פרוייקט: {work.caseName}</p>
                              <p className="text-[11px] text-gray-600 mt-0.5">{work.startTime}-{work.endTime}</p>
                              <p className="text-[11px] text-gray-500 mt-1 truncate">{work.address}</p>
                              <p className={`text-[11px] mt-1 ${staffingGap > 0 ? 'text-amber-700' : 'text-emerald-700'}`}>
                                {work.assignedWorkers}/{work.requiredWorkers} שובצו
                              </p>
                              <p className={`text-[11px] mt-0.5 ${staffingBreakdown.managerShortage ? 'text-rose-700' : 'text-emerald-700'}`}>
                                מצב מנהל: {staffingBreakdown.managerShortage ? 'חסר מנהל' : 'מנהל משויך'}
                              </p>
                              <p className={`text-[11px] mt-0.5 ${staffingBreakdown.isReadyForExecution ? 'text-emerald-700' : 'text-amber-700'}`}>
                                מוכנות: {staffingBreakdown.isReadyForExecution ? 'מוכן לביצוע' : 'חסר איוש/מנהל'}
                              </p>
                              <p className="text-[11px] text-gray-600 mt-1">
                                {responsibility?.responsibleRole === 'admin' ? 'ראש צוות' : 'בעלות'}: {responsibility?.responsibleName ?? MOM_OWNER_NAME}
                              </p>
                              <span className={`inline-block mt-1 px-2 py-0.5 text-[11px] font-medium rounded-full border ${status.className}`}>
                                {status.label}
                              </span>
                              <span className={`inline-block mt-1 mr-1 px-2 py-0.5 text-[11px] font-medium rounded-full border ${linkedCaseMeta.className}`}>
                                {linkedCaseMeta.label}
                              </span>
                            </button>
                          );
                        })
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div dir="ltr" className="min-w-[1100px]">
              <div
                className="grid border-b border-gray-200 bg-gray-50"
                style={{ gridTemplateColumns: shiftsGridTemplateColumns }}
              >
                <div className="p-3 text-sm font-semibold text-gray-700 border-r border-gray-200">עובד/ת</div>
                {visibleDates.map((date) => {
                  const dateKey = toDateKey(date);
                  const nonWorkingLabel = getNonWorkingDayLabel(dateKey);
                  const isNonWorkingDay = isWorkCreationBlockedDay(dateKey);
                  const isToday = dateKey === todayKey;
                  return (
                    <button
                      key={dateKey}
                      type="button"
                      disabled={isNonWorkingDay}
                      onClick={() => openCreateModal(dateKey)}
                      className={`p-3 text-center border-l border-gray-200 ${isNonWorkingDay ? (isToday ? 'bg-purple-100 text-purple-700' : 'bg-gray-200 text-gray-500') : isToday ? 'bg-purple-50 text-purple-700 hover:bg-purple-100' : 'text-gray-700 hover:bg-purple-50'} disabled:cursor-not-allowed`}
                    >
                      <div className="flex items-center justify-center gap-1">
                        {isToday && <span className="rounded-full bg-purple-600 px-1.5 py-0.5 text-[10px] font-semibold text-white">היום</span>}
                        <div className="text-xs">{formatDayName(date)}</div>
                      </div>
                      <div className="text-sm font-semibold">{formatDayDate(date)}</div>
                      {nonWorkingLabel && (
                        <div className={`text-[10px] ${isNonWorkingDay ? '' : 'text-amber-700'}`}>{nonWorkingLabel}</div>
                      )}
                    </button>
                  );
                })}
              </div>
              {workers.map((worker) => (
                <div
                  key={worker.id}
                  className="grid border-b border-gray-100"
                  style={{ gridTemplateColumns: shiftsGridTemplateColumns }}
                >
                  <div className="p-3 border-r border-gray-100">
                    <p className="text-sm font-semibold text-gray-900">
                      {worker.name} ({shiftCountByWorkerId.get(worker.id) ?? 0})
                    </p>
                    <p className="text-xs text-gray-500">
                      {worker.role}
                      {canSeeFinancials ? ` • ₪${worker.hourlyWage}/שעה` : ''}
                    </p>
                  </div>
                  {visibleDates.map((date) => {
                    const dateKey = toDateKey(date);
                    const nonWorkingLabel = getNonWorkingDayLabel(dateKey);
                    const isNonWorkingDay = isWorkCreationBlockedDay(dateKey);
                    const isToday = dateKey === todayKey;
                    const unavailable = availability.find((item) => item.workerId === worker.id && item.date === dateKey);
                    const workerAssignments = assignmentByWorkerAndDate.get(`${worker.id}|${dateKey}`) ?? [];
                    return (
                      <div
                        key={`${worker.id}-${dateKey}`}
                        className={`p-2 border-l border-gray-100 min-h-[88px] ${isNonWorkingDay ? (isToday ? 'bg-purple-100' : 'bg-gray-100') : isToday ? 'bg-purple-50/50' : 'bg-white'}`}
                      >
                        {isNonWorkingDay ? (
                          <p className="text-[11px] text-center text-gray-500 mt-5">{nonWorkingLabel}</p>
                        ) : unavailable ? (
                          <div className="rounded-md border border-rose-200 bg-rose-50 px-2 py-1.5 text-center">
                            <p className="text-[11px] font-semibold text-rose-700">לא זמין</p>
                            <p className="text-[11px] text-rose-600">{unavailable.reason}</p>
                          </div>
                        ) : workerAssignments.length > 0 ? (
                          <div className="space-y-1">
                            {workerAssignments.map((assignment) => {
                              const assignedWork = workById.get(assignment.workId);
                              if (!assignedWork) return null;
                              const responsibility = workResponsibilityById.get(assignedWork.id);
                              const isActualLead = responsibility?.leadName === worker.name;
                              const linkedCase = caseById.get(assignedWork.caseId);
                              const linkedCaseStatus = linkedCase?.status ?? 'active';
                              const upcomingDiffDays = daysBetween(assignedWork.date, toDateKey(today));
                              const isUrgentCase =
                                linkedCaseStatus === 'draft' &&
                                upcomingDiffDays >= 0 &&
                                upcomingDiffDays <= 7;
                              const caseMeta = caseStatusMeta[linkedCaseStatus];
                              return (
                                <button
                                  key={`${assignment.workerId}-${assignment.workId}`}
                                  type="button"
                                  onClick={() => openEditModal(assignedWork)}
                                  className={`w-full rounded-md border px-2 py-1 text-right ${getShiftTypeCardClasses(assignedWork.jobType)}`}
                                >
                                  <p className="text-xs font-semibold text-gray-900">{assignedWork.startTime}-{assignedWork.endTime}</p>
                                  <p className="text-xs text-gray-600">לקוח: {assignedWork.customerName}</p>
                                  <p className="text-[11px] text-gray-600 truncate">פרוייקט: {assignedWork.caseName}</p>
                                  <p
                                    className={`mt-0.5 inline-flex items-center rounded-full border px-1.5 py-0.5 text-[10px] font-medium ${
                                      isUrgentCase ? 'border-rose-300 bg-rose-100 text-rose-700' : caseMeta.className
                                    }`}
                                  >
                                    {isUrgentCase ? 'דחוף: ממתין לאישור לקוח' : caseMeta.label}
                                  </p>
                                  {isActualLead && (
                                    <p className="text-xs text-purple-700 font-medium mt-0.5">ראש צוות</p>
                                  )}
                                </button>
                              );
                            })}
                          </div>
                        ) : (
                          <p className="text-[11px] text-gray-400 mt-5 text-center">זמין</p>
                        )}
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {isCreateOpen && (
        <div className="fixed inset-0 z-50 bg-black/30 flex items-start justify-center overflow-y-auto p-4 py-6">
          <div className="w-full max-w-2xl rounded-lg border border-gray-200 bg-white shadow-xl max-h-[84vh] overflow-y-auto">
            <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
              <button
                type="button"
                onClick={() => {
                  setEditingWorkId(null);
                  setIsCreateOpen(false);
                }}
                className="text-xs px-2 py-1 rounded border border-gray-300 text-gray-700 hover:bg-gray-50"
              >
                סגירה
              </button>
              <h3 className="font-semibold text-gray-900">{editingWorkId ? 'עריכת עבודה' : 'יצירת עבודה חדשה'}</h3>
            </div>

            <div className="p-6 space-y-4 text-right">
              <div className="rounded-lg border border-gray-200 p-4 space-y-3">
                <p className="text-sm font-semibold text-gray-900">לקוח</p>
                <p className="text-xs text-gray-500">התחילי להקליד שם/טלפון ונציע לקוחות קיימים אוטומטית.</p>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  <input
                    value={newCustomerName}
                    disabled={Boolean(editingWorkId)}
                    onChange={(e) => {
                      setNewCustomerName(e.target.value);
                      if (!editingWorkId) {
                        setCustomerMode('new');
                        setSelectedCustomerId('');
                        setSelectedAddress('');
                        setExistingAddressQuery('');
                      }
                    }}
                    className={`rounded-lg border px-3 py-2 text-sm text-right ${formAttempted && !newCustomerName.trim() ? 'border-red-500 bg-red-50' : 'border-gray-300'} ${editingWorkId ? 'bg-gray-50 text-gray-500' : ''}`}
                    placeholder="שם פרטי *"
                  />
                  <input
                    value={newCustomerPhone}
                    disabled={Boolean(editingWorkId)}
                    onChange={(e) => {
                      setNewCustomerPhone(e.target.value);
                      if (!editingWorkId) {
                        setCustomerMode('new');
                        setSelectedCustomerId('');
                        setSelectedAddress('');
                        setExistingAddressQuery('');
                      }
                    }}
                    className={`rounded-lg border px-3 py-2 text-sm text-right ${formAttempted && !newCustomerPhone.trim() ? 'border-red-500 bg-red-50' : 'border-gray-300'} ${editingWorkId ? 'bg-gray-50 text-gray-500' : ''}`}
                    placeholder="טלפון *"
                  />
                  <input
                    value={newCustomerEmail}
                    disabled={Boolean(editingWorkId)}
                    onChange={(e) => setNewCustomerEmail(e.target.value)}
                    className={`rounded-lg border border-gray-300 px-3 py-2 text-sm text-right ${editingWorkId ? 'bg-gray-50 text-gray-500' : ''}`}
                    placeholder="אימייל (אופציונלי)"
                  />
                </div>
                {!editingWorkId && customerSuggestions.length > 0 && (
                  <div className="rounded-lg border border-purple-100 bg-purple-50 p-2 space-y-1">
                    {customerSuggestions.map((customer) => (
                      <button
                        key={`customer-suggestion-${customer.id}`}
                        type="button"
                        onClick={() => {
                          setCustomerMode('existing');
                          setSelectedCustomerId(customer.id);
                          setNewCustomerName(customer.fullName);
                          setNewCustomerPhone(customer.phone);
                          setNewCustomerEmail(customer.email);
                          setSelectedAddress(customer.addresses[0] ?? '');
                          setExistingAddressQuery(customer.addresses[0] ?? '');
                          setAddressMode('existing');
                        }}
                        className="w-full rounded-md border border-purple-200 bg-white px-3 py-1.5 text-right text-xs text-gray-700 hover:bg-purple-100"
                      >
                        {customer.fullName} • {customer.phone}
                      </button>
                    ))}
                  </div>
                )}
                {customerMode === 'existing' && selectedCustomer && (
                  <div className="flex items-center justify-between rounded-md border border-blue-200 bg-blue-50 px-3 py-2">
                    <p className="text-xs text-blue-800">נבחר לקוח קיים: {selectedCustomer.fullName}</p>
                    {!editingWorkId && (
                      <button
                        type="button"
                        onClick={() => {
                          setCustomerMode('new');
                          setSelectedCustomerId('');
                          setSelectedAddress('');
                          setExistingAddressQuery('');
                        }}
                        className="text-xs text-blue-700 underline"
                      >
                        ביטול בחירה
                      </button>
                    )}
                  </div>
                )}
              </div>

              <div className="rounded-lg border border-gray-200 p-4 space-y-3">
                <p className="text-sm font-semibold text-gray-900">מה כתובת העבודה לעבודה הזו?</p>
                {customerMode === 'existing' && selectedCustomer ? (
                  <>
                    <input
                      value={existingAddressQuery}
                      onChange={(e) => {
                        setExistingAddressQuery(e.target.value);
                        setSelectedAddress('');
                      }}
                      className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-right"
                      placeholder="הקלידי כדי למצוא כתובת קיימת של הלקוח"
                    />
                    {existingAddressSuggestions.length > 0 && (
                      <div className="max-h-32 overflow-y-auto rounded-md border border-gray-200 bg-white">
                        {existingAddressSuggestions.map((address) => (
                          <button
                            key={`address-suggestion-${address}`}
                            type="button"
                            onClick={() => {
                              setSelectedAddress(address);
                              setExistingAddressQuery(address);
                            }}
                            className={`w-full px-3 py-2 text-right text-xs hover:bg-purple-50 ${selectedAddress === address ? 'bg-purple-50 text-purple-700' : 'text-gray-700'}`}
                          >
                            {address}
                          </button>
                        ))}
                      </div>
                    )}
                  </>
                ) : (
                  <input
                    value={newAddress}
                    onChange={(e) => setNewAddress(e.target.value)}
                    className={`w-full rounded-lg border px-3 py-2 text-sm text-right ${formAttempted && !newAddress.trim() ? 'border-red-500 bg-red-50' : 'border-gray-300'}`}
                    placeholder="כתובת מלאה"
                  />
                )}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <input
                    value={addressFloor}
                    onChange={(e) => setAddressFloor(e.target.value)}
                    className="rounded-lg border border-gray-300 px-3 py-2 text-sm text-right"
                    placeholder="קומה (אופציונלי)"
                  />
                  <input
                    value={addressApartment}
                    onChange={(e) => setAddressApartment(e.target.value)}
                    className="rounded-lg border border-gray-300 px-3 py-2 text-sm text-right"
                    placeholder="דירה (אופציונלי)"
                  />
                </div>
              </div>

              <div className="rounded-lg border border-gray-200 p-4 space-y-3">
                <p className="text-sm font-semibold text-gray-900">שיוך אוטומטי לפרוייקט</p>
                <p className="text-xs text-gray-600">
                  {jobType === 'פריקה'
                    ? 'פריקה מצורפת אוטומטית לפרוייקט הפעיל של הלקוח כל עוד הפרוייקט לא נסגר.'
                    : caseSuggestion?.text ?? 'בחר לקוח כדי לבדוק התאמת פרוייקט.'}
                </p>
                {connectedFlow ? (
                  <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                    נוצרה עבודת אריזה בפרוייקט "{connectedFlow.caseName || 'פרוייקט קיים'}". לעבודה המחוברת חובה לבחור תאריך שאחרי{' '}
                    {toDisplayDateFromDateKey(connectedFlow.packingDate)}.
                  </div>
                ) : null}
              </div>

              <div className="rounded-lg border border-gray-200 p-4 space-y-3">
                <p className="text-sm font-semibold text-gray-900">פרטי עבודה</p>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  <select value={jobType} onChange={(e) => setJobType(e.target.value as JobType)} className="rounded-lg border border-gray-300 px-3 py-2 text-sm bg-white">
                    <option value="אריזה">אריזה</option>
                    <option value="פריקה">פריקה</option>
                    <option value="סידור">סידור</option>
                  </select>
                  <div>
                    <label className="text-xs text-gray-700 block mb-1">טופס לסיום משמרת</label>
                    <select
                      value={selectedFormTemplateId ?? ''}
                      onChange={(e) => setSelectedFormTemplateId(e.target.value || null)}
                      className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm bg-white"
                    >
                      <option value="">ללא טופס</option>
                      {formTemplates.map((t) => (
                        <option key={t.id} value={t.id}>{t.title}</option>
                      ))}
                    </select>
                  </div>
                  <input value={jobDate} onChange={(e) => setJobDate(e.target.value)} type="date" className={`rounded-lg border px-3 py-2 text-sm ${formAttempted && !jobDate ? 'border-red-500 bg-red-50' : 'border-gray-300'}`} />
                  <select value={staffingMode} onChange={(e) => setStaffingMode(e.target.value as StaffingMode)} className="rounded-lg border border-gray-300 px-3 py-2 text-sm bg-white">
                    <option value="approval">אישור מנהל</option>
                    <option value="auto">אישור אוטומטי (FCFS)</option>
                  </select>
                  <input value={startTime} onChange={(e) => setStartTime(e.target.value)} type="time" className={`rounded-lg border px-3 py-2 text-sm ${formAttempted && !startTime ? 'border-red-500 bg-red-50' : 'border-gray-300'}`} />
                  <input value={endTime} onChange={(e) => setEndTime(e.target.value)} type="time" className={`rounded-lg border px-3 py-2 text-sm ${formAttempted && !endTime ? 'border-red-500 bg-red-50' : 'border-gray-300'}`} />
                  <input value={requiredWorkers} onChange={(e) => setRequiredWorkers(Number(e.target.value))} type="number" min={1} className={`rounded-lg border px-3 py-2 text-sm ${formAttempted && (!requiredWorkers || requiredWorkers < 1) ? 'border-red-500 bg-red-50' : 'border-gray-300'}`} placeholder="כמות עובדים *" />
                </div>
                <label className="inline-flex items-center gap-2 text-sm text-gray-700">
                  <input
                    type="checkbox"
                    checked={requireManager}
                    onChange={(e) => setRequireManager(e.target.checked)}
                    className="rounded border-gray-300"
                  />
                  חובה מנהל/ראש צוות אחראי לעבודה (ברירת מחדל)
                </label>
                <p className="text-xs text-gray-600">איסוף טפסי סיום מהעובדות מופעל כברירת מחדל לכל עבודה.</p>
                <textarea
                  value={workerVisibleNotes}
                  onChange={(e) => setWorkerVisibleNotes(e.target.value)}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-right min-h-[80px]"
                  placeholder="הערות לעובד (גלוי לעובדים)"
                />
                <label className="inline-flex items-center gap-2 text-sm text-gray-700">
                  <input
                    type="checkbox"
                    checked={weeklyLimitApproved}
                    onChange={(e) => setWeeklyLimitApproved(e.target.checked)}
                    className="rounded border-gray-300"
                  />
                  אישור חריג מאורית לשיבוץ 5+ משמרות באותו שבוע
                </label>
                {!editingWorkId ? (
                  <label className="inline-flex items-center gap-2 text-sm text-gray-700">
                    <input
                      type="checkbox"
                      checked={publishNow}
                      onChange={(e) => setPublishNow(e.target.checked)}
                      className="rounded border-gray-300"
                    />
                    פרסום מיידי לעובדות אחרי השמירה
                  </label>
                ) : null}
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={saveNewWork}
                  className="px-4 py-2 text-sm rounded-lg bg-purple-600 text-white hover:bg-purple-700 inline-flex items-center gap-1.5"
                >
                  <CheckCircle2 className="w-4 h-4" />
                  {editingWorkId ? 'שמירת שינויים' : 'יצירת עבודה'}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setEditingWorkId(null);
                    setIsCreateOpen(false);
                  }}
                  className="px-4 py-2 text-sm rounded-lg border border-gray-300 text-gray-700 hover:bg-gray-50 inline-flex items-center gap-1.5"
                >
                  <XCircle className="w-4 h-4" />
                  ביטול
                </button>
                {editingWorkId && (
                  <button
                    type="button"
                    onClick={() => void cancelWork()}
                    className="px-4 py-2 text-sm rounded-lg border border-rose-300 text-rose-700 hover:bg-rose-50 inline-flex items-center gap-1.5"
                  >
                    <XCircle className="w-4 h-4" />
                    מחיקת עבודה
                  </button>
                )}
              </div>

              {createMessage && <p className="text-sm text-rose-700">{createMessage}</p>}
            </div>
          </div>
        </div>
      )}
      {dayJobsPickerDateKey && (
        <div
          className="fixed inset-0 z-50 bg-black/30 flex items-start justify-center overflow-y-auto p-4 py-6"
          onMouseDown={() => setDayJobsPickerDateKey(null)}
        >
          <div
            className="w-full max-w-xl rounded-lg border border-gray-200 bg-white shadow-xl max-h-[80vh] overflow-y-auto"
            onMouseDown={(e) => e.stopPropagation()}
          >
            <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
              <button
                type="button"
                onClick={() => setDayJobsPickerDateKey(null)}
                className="text-sm px-2.5 py-1.5 rounded border border-gray-300 text-gray-700 hover:bg-gray-50"
              >
                סגירה
              </button>
              <h3 className="text-lg font-semibold text-gray-900">
                עבודות ביום {dayJobsPickerDateKey ? toDisplayDateFromDateKey(dayJobsPickerDateKey) : ''}
              </h3>
            </div>
            <div className="p-4 space-y-2 max-h-[60vh] overflow-y-auto">
              {dayJobsForPicker.map((work) => (
                <button
                  key={`picker-work-${work.id}`}
                  type="button"
                  onClick={() => {
                    setDayJobsPickerDateKey(null);
                    openEditModal(work);
                  }}
                  className={`w-full rounded-lg border px-3 py-2.5 text-right ${getShiftTypeCardClasses(work.jobType)}`}
                >
                  <p className="text-base font-semibold text-gray-900">לקוח: {work.customerName}</p>
                  <p className="text-sm text-gray-700 mt-0.5">פרוייקט: {work.caseName}</p>
                  <p className="text-sm text-gray-700 mt-0.5">{work.startTime}-{work.endTime}</p>
                  <p className="text-sm text-gray-700 mt-0.5">{work.assignedWorkers}/{work.requiredWorkers} שובצו</p>
                  <p className="mt-0.5">
                    <span className={`inline-flex rounded-full border px-2 py-0.5 text-[11px] font-medium ${caseStatusMeta[caseById.get(work.caseId)?.status ?? 'draft'].className}`}>
                      {caseStatusMeta[caseById.get(work.caseId)?.status ?? 'draft'].label}
                    </span>
                  </p>
                  <p className="text-sm text-gray-700 mt-0.5">
                    {(workResponsibilityById.get(work.id)?.responsibleRole === 'admin' ? 'ראש צוות' : 'בעלות')}: {workResponsibilityById.get(work.id)?.responsibleName ?? MOM_OWNER_NAME}
                  </p>
                  <p className="text-xs text-gray-600 mt-0.5 truncate">{work.address}</p>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default function JobsPage() {
  return (
    <Suspense
      fallback={
        <div className="rounded-xl border border-gray-200 bg-white p-6 text-center text-base text-gray-700">
          טוען עבודות...
        </div>
      }
    >
      <JobsPageContent />
    </Suspense>
  );
}

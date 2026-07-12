'use client';

import { useMemo, useState, useEffect } from 'react';
import Link from 'next/link';
import { useUser, useAuth } from '@clerk/nextjs';
import { extractUrgentDashboardIssues, orderDashboardWorkflowSections } from '@workforce/shared';
import { CalendarDays, CheckCircle2, ChevronLeft, ChevronRight, XCircle } from 'lucide-react';
import { getNonWorkingDayLabel, isWorkCreationBlockedDay } from '../../lib/non-working-days';
import AzureMapsAddressInput, { type AddressSelection } from '../../components/forms/AzureMapsAddressInput';
import { canViewSensitiveFinancials, resolveAppViewerRole } from '../../lib/viewer-access';
import { api, authHeaders } from '../../lib/api';

type JobType = 'אריזה' | 'פריקה' | 'סידור';
type StaffingMode = 'auto' | 'approval';
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

const MOM_OWNER_NAME = 'אורית';

const initialCustomers: Customer[] = [];
const initialCases: CustomerCase[] = [];

const dashboardWorkers: DashboardWorker[] = [];

const dashboardAvailability: Array<{ workerName: string; dateKey: string; reason: string }> = [];

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

function addHoursToTime(start: string, hours: number) {
  const [h, m] = start.split(':').map(Number);
  const totalMinutes = h * 60 + m + Math.round(hours * 60);
  const safeMinutes = ((totalMinutes % (24 * 60)) + (24 * 60)) % (24 * 60);
  const outH = Math.floor(safeMinutes / 60);
  const outM = safeMinutes % 60;
  return `${String(outH).padStart(2, '0')}:${String(outM).padStart(2, '0')}`;
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
    return 'border-rose-200 bg-rose-50 hover:border-rose-300 hover:bg-rose-100';
  }
  if (jobType === 'פריקה') {
    return 'border-amber-200 bg-amber-50 hover:border-amber-300 hover:bg-amber-100';
  }
  return 'border-sky-200 bg-sky-50 hover:border-sky-300 hover:bg-sky-100';
}

const caseStatusMeta: Record<CaseStatus, { label: string; className: string }> = {
  DRAFT: { label: 'משוריין', className: 'border-amber-200 bg-amber-50 text-amber-700' },
  ACTIVE: { label: 'עבודה אושרה', className: 'border-blue-200 bg-blue-50 text-blue-700' },
  READY_FOR_REVIEW: { label: 'עבודה הסתיימה', className: 'border-amber-200 bg-amber-50 text-amber-700' },
  COMPLETED: { label: 'עבודה שולמה', className: 'border-emerald-200 bg-emerald-50 text-emerald-700' },
};

export default function DashboardPage() {
  const { user } = useUser();
  const { getToken } = useAuth();
  const viewerRole = resolveAppViewerRole(user);
  const canSeeFinancials = canViewSensitiveFinancials(viewerRole);
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
  const monthOptions = useMemo(() => {
    return Array.from({ length: 18 }).map((_, index) => {
      const offset = index - 6;
      const date = new Date(now.getFullYear(), now.getMonth() + offset, 1);
      const value = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
      const label = date.toLocaleDateString('he-IL', { month: 'long', year: '2-digit' });
      return { value, label };
    });
  }, []);

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
        next.setMonth(prev.getMonth() + multiplier);
        next.setDate(1);
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
  const feedbackMailtoHref = `mailto:shaiwinograd@gmail.com?subject=${encodeURIComponent('Space & Order - משוב מהאפליקציה')}&body=${encodeURIComponent(
    'מה לחצתי:\n\nמה ציפיתי שיקרה:\n\nמה קרה בפועל:\n\nצילום מסך (אם אפשר):\n',
  )}`;

  type WorkStatus = 'done' | 'active' | 'planned';
  type AssignedWorker = { name: string; isTeamLead: boolean };
  type ActiveWork = {
    id: number;
    customerName: string;
    caseId: string;
    caseName: string;
    address: string;
    jobType: JobType;
    dateKey: string;
    date: string;
    hours: number;
    requiredWorkers: number;
    requiredTeamLeads: number;
    assignedWorkers: AssignedWorker[];
    actualTeamLeadName: string | null;
    responsibleName: string;
    responsibleRole: 'admin' | 'owner';
    payrollCost: string;
    estimatedRevenue: string;
    status: WorkStatus;
  };

  const allActiveWorks: ActiveWork[] = [];

  const [dashboardWorks, setDashboardWorks] = useState<ActiveWork[]>(allActiveWorks);

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
  const [newAddressSelection, setNewAddressSelection] = useState<AddressSelection | null>(null);
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
  const [formTemplates, setFormTemplates] = useState<Array<{ id: string; title: string }>>([]);
  const [staffingMode, setStaffingMode] = useState<StaffingMode>('approval');
  const [workerVisibleNotes, setWorkerVisibleNotes] = useState('');
  const [customerMode, setCustomerMode] = useState<'existing' | 'new'>('new');
  const [dayJobsPickerDateKey, setDayJobsPickerDateKey] = useState<string | null>(null);
  const [activeSectionKey, setActiveSectionKey] = useState<string | null>(null);

  // Load form templates when the create modal is opened
  useEffect(() => {
    if (isCreateOpen) {
      (async () => {
        try {
          const auth = await authHeaders(getToken);
          const res = await api.get<Array<{ id: string; title: string }>>('/forms/templates', auth);
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

  // Load real data from API on component mount
  useEffect(() => {
    (async () => {
      try {
        const auth = await authHeaders(getToken);
        const [customersRes, casesRes, jobsRes] = await Promise.all([
          api.get('/customers', auth),
          api.get('/cases', auth),
          api.get('/jobs', auth),
        ]);
        
        const apiCustomers = customersRes.data.map((c: any) => ({
          id: c.id,
          fullName: `${c.firstName} ${c.lastName}`,
          phone: c.phone || '',
          email: c.email || '',
          addresses: c.addresses || [],
        }));
        
        const apiCases = casesRes.data.map((c: any) => ({
          id: c.id,
          customerId: c.customerId,
          caseName: c.name,
          status: c.status,
          latestJobDate: c.updatedAt?.split('T')[0] || new Date().toISOString().split('T')[0],
        }));

        const apiWorks: ActiveWork[] = jobsRes.data.map((job: any, index: number) => {
          const customerName = `${job.customer?.firstName ?? ''} ${job.customer?.lastName ?? ''}`.trim();
          const date = new Date(job.date);
          const dateKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
          const day = String(date.getDate()).padStart(2, '0');
          const month = String(date.getMonth() + 1).padStart(2, '0');
          const assignedWorkers = (job.shifts ?? []).map((shift: any) => ({
            name: shift.worker ? `${shift.worker.firstName ?? ''} ${shift.worker.lastName ?? ''}`.trim() : 'עובדת',
            isTeamLead: false,
          }));
          const actualTeamLeadName = assignedWorkers.find((worker: AssignedWorker) => worker.name === 'אורית')?.name ?? null;
          const status: WorkStatus =
            job.status === 'IN_PROGRESS' ? 'active' : job.status === 'COMPLETED' || job.status === 'CANCELLED' ? 'done' : 'planned';
          const jobType: JobType =
            job.jobType === 'PACKING' ? 'אריזה' : job.jobType === 'UNPACKING' ? 'פריקה' : 'סידור';
          const estimatedRevenueValue = Math.round((job.requiredWorkerCount ?? 0) * 5 * 175);
          const payrollCostValue = Math.round((job.requiredWorkerCount ?? 0) * 5 * 82);
          return {
            id: Number(job.id) || index + 1,
            customerName,
            caseId: job.caseId ?? '',
            caseName: job.case?.name ?? `${customerName} - פרוייקט`,
            address: job.address?.fullAddress ?? 'כתובת לא עודכנה',
            jobType,
            dateKey,
            date: `${day}.${month}`,
            hours: 5,
            requiredWorkers: job.requiredWorkerCount ?? 0,
            requiredTeamLeads: (job.slots ?? []).some((slot: any) => slot.requiredSkill === 'SHIFT_LEADER') ? 1 : 0,
            assignedWorkers,
            actualTeamLeadName,
            responsibleName: actualTeamLeadName ?? MOM_OWNER_NAME,
            responsibleRole: actualTeamLeadName ? 'admin' : 'owner',
            payrollCost: `₪${payrollCostValue.toLocaleString('he-IL')}`,
            estimatedRevenue: formatK(estimatedRevenueValue),
            status,
          };
        });
        
        setCustomers(apiCustomers);
        setCases(apiCases);
        setDashboardWorks(apiWorks);
        
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
      }
    })();
  }, [getToken]);

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
    const term = existingAddressQuery.trim().toLowerCase();
    if (!term) return selectedCustomer.addresses;
    return selectedCustomer.addresses.filter((address) => address.toLowerCase().includes(term));
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

  const resetCreateForm = () => {
    setEditingWorkId(null);
    setCustomerMode('new');
    setSelectedCustomerId('');
    setNewCustomerFirstName('');
    setNewCustomerLastName('');
    setNewCustomerPhone('');
    setNewCustomerEmail('');
    setAddressMode('new');
    setSelectedAddress('');
    setExistingAddressQuery('');
    setNewAddress('');
    setNewAddressSelection(null);
    setAddressFloor('');
    setAddressApartment('');
    setJobType('אריזה');
    setJobDate('2026-07-06');
    setStartTime('09:00');
    setEndTime('14:00');
    setRequiredWorkers(4);
    setRequireTeamLead(true);
    setSelectedAssignedWorkerNames([]);
    setSelectedActualTeamLeadName('');
    setStaffingMode('approval');
    setWorkerVisibleNotes('');
    setCreateMessage('');
    setFormAttempted(false);
  };

  const openCreateModal = (presetDateKey?: string) => {
    if (presetDateKey && isWorkCreationBlockedDay(presetDateKey)) {
      return;
    }
    resetCreateForm();
    if (presetDateKey) {
      setJobDate(presetDateKey);
    }
    setIsCreateOpen(true);
  };

  const openWorkModal = (work: ActiveWork) => {
    setEditingWorkId(work.id);
    setCustomerMode('existing');
    const matchedCustomer =
      customers.find((customer) => customer.fullName === work.customerName) ??
      customers.find((customer) => customer.fullName.includes(work.customerName)) ??
      customers[0];
    setSelectedCustomerId(matchedCustomer?.id ?? customers[0]?.id ?? '');
    setAddressMode('existing');
    setSelectedAddress(work.address);
    setExistingAddressQuery(work.address);
    setNewAddress('');
    setNewAddressSelection(null);
    setAddressFloor('');
    setAddressApartment('');
    setJobType(work.jobType);
    setJobDate(work.dateKey);
    setStartTime('09:00');
    setEndTime(addHoursToTime('09:00', work.hours));
    setRequiredWorkers(work.requiredWorkers);
    setRequireTeamLead(work.requiredTeamLeads > 0);
    setSelectedAssignedWorkerNames(work.assignedWorkers.map((assigned) => assigned.name));
    setSelectedActualTeamLeadName(work.actualTeamLeadName ?? '');
    setStaffingMode('approval');
    setWorkerVisibleNotes('');
    setCreateMessage('');
    setIsCreateOpen(true);
  };

  const saveNewWorkFromDashboard = () => {
    setCreateMessage('');
    const existingWork = editingWorkId ? dashboardWorks.find((work) => work.id === editingWorkId) ?? null : null;
    let customerId = selectedCustomerId;
    let customerName = selectedCustomer?.fullName ?? '';
    const baseAddress = customerMode === 'existing' ? (selectedAddress || existingAddressQuery.trim()) : newAddress.trim();
    let targetAddress = buildAddressWithUnit(baseAddress, addressFloor, addressApartment);

    if (existingWork) {
      customerName = existingWork.customerName;
      targetAddress = existingWork.address;
      const matchedCustomer = customers.find((customer) => customer.fullName === existingWork.customerName);
      customerId = matchedCustomer?.id ?? selectedCustomerId;
    } else if (customerMode === 'new') {
      if (!newCustomerFirstName.trim() || !newCustomerPhone.trim()) {
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
        setCreateMessage('ביצירת לקוח חדש יש להזין כתובת עבודה מלאה.');
        return;
      }
      if (!newAddressSelection) {
        setCreateMessage('יש לבחור כתובת מתוצאות החיפוש של Azure Maps (לא טקסט חופשי בלבד).');
        return;
      }
      if (!isValidFullAddress(newAddress)) {
        setCreateMessage('יש להזין כתובת מלאה בפורמט מפורט (רחוב ומספר, עיר, קומה/דירה).');
        return;
      }
      customerId = `c-${Date.now()}`;
      customerName = `${newCustomerFirstName.trim()} ${newCustomerLastName.trim()}`;
      targetAddress = buildAddressWithUnit(newAddressSelection.formattedAddress, addressFloor, addressApartment);
      setCustomers((prev) => [
        {
          id: customerId,
          fullName: customerName,
          phone: newCustomerPhone.trim(),
          email: newCustomerEmail.trim(),
          addresses: [targetAddress],
        },
        ...prev,
      ]);
    } else if (!customerId || !customerName || !targetAddress) {
      setCreateMessage('יש לבחור לקוח קיים וכתובת קיימת.');
      return;
    } else if (selectedCustomer && !selectedCustomer.addresses.includes(baseAddress.trim())) {
      setCreateMessage('בחרי כתובת מתוך רשימת הכתובות של הלקוח.');
      return;
    }
    if (customerMode === 'new' && !newAddressSelection) {
      setCreateMessage('יש לבחור כתובת מתוך ההצעות כדי לאשר מיקום משמרת.');
      return;
    }
    if (!isValidFullAddress(targetAddress)) {
      setCreateMessage('כתובת העבודה צריכה להיות מלאה ומדויקת.');
      return;
    }

    if (!jobDate || !startTime || !endTime) {
      setCreateMessage('יש למלא תאריך ושעות עבודה.');
      return;
    }

    const nonWorkingLabel = getNonWorkingDayLabel(jobDate);
    if (isWorkCreationBlockedDay(jobDate)) {
      setCreateMessage(`לא ניתן ליצור עבודה ביום ${nonWorkingLabel}.`);
      return;
    }
    if (jobType === 'פריקה') {
      const latestPacking = dashboardWorks
        .filter((work) => work.customerName === customerName && work.jobType === 'אריזה')
        .map((work) => work.dateKey)
        .sort()
        .at(-1);
      if (!latestPacking) {
        setCreateMessage('לפני פריקה חייבת להיות לפחות עבודת אריזה אחת לאותו לקוח.');
        return;
      }
      if (daysBetween(jobDate, latestPacking) < 1) {
        setCreateMessage('תאריך פריקה חייב להיות לפחות יום אחד אחרי תאריך האריזה.');
        return;
      }
    }

    let resolvedCaseId = existingWork?.caseId ?? '';
    let resolvedCaseName = existingWork?.caseName ?? '';

    if (!existingWork) {
      const customerCases = cases.filter((item) => item.customerId === customerId);
      const activeCase = customerCases.find((item) => item.status === 'ACTIVE');

      if (jobType === 'פריקה' && activeCase) {
        resolvedCaseId = activeCase.id;
        resolvedCaseName = activeCase.caseName;
      } else if (activeCase) {
        resolvedCaseId = activeCase.id;
        resolvedCaseName = activeCase.caseName;
      } else {
        const newCase = {
          id: `case-${Date.now()}`,
          customerId,
          caseName: `${customerName} - ${jobType} - ${parseDateKey(jobDate).toLocaleDateString('he-IL', { month: 'long', year: 'numeric' })}`,
          status: 'ACTIVE' as CaseStatus,
          latestJobDate: jobDate,
        };
        resolvedCaseId = newCase.id;
        resolvedCaseName = newCase.caseName;
        setCases((prev) => [newCase, ...prev]);
      }
    }

    const computedHours = Math.max(
      (parseDateKey(`2026-01-01`).setHours(Number(endTime.split(':')[0]), Number(endTime.split(':')[1])) -
        parseDateKey(`2026-01-01`).setHours(Number(startTime.split(':')[0]), Number(startTime.split(':')[1]))) /
        (1000 * 60 * 60),
      0.5,
    );

    const selectedWorkerRows = selectedAssignedWorkerNames
      .map((name) => dashboardWorkers.find((worker) => worker.name === name))
      .filter((worker): worker is DashboardWorker => Boolean(worker))
      .slice(0, Math.max(0, requiredWorkers));

    const selectedTeamLeads = selectedWorkerRows.filter((worker) => worker.role === 'ראש צוות' || worker.role === 'מנהלת');
    if (requireTeamLead && selectedWorkerRows.length > 0 && selectedTeamLeads.length === 0) {
      setCreateMessage('כאשר חובה ראש צוות, יש לבחור לפחות ראש צוות/מנהלת בשיבוץ.');
      return;
    }

    const selectedWorkerNames = selectedWorkerRows.map((worker) => worker.name);
    const actualTeamLeadName =
      selectedTeamLeads.length > 0
        ? selectedTeamLeads.find((worker) => worker.name === selectedActualTeamLeadName)?.name ?? selectedTeamLeads[0].name
        : null;
    const dashboardWorksWithoutCurrent = dashboardWorks.filter((work) => work.id !== editingWorkId);
    const duplicatePerDay = selectedWorkerNames.filter((workerName) =>
      dashboardWorksWithoutCurrent.some(
        (work) => work.dateKey === jobDate && work.assignedWorkers.some((assigned) => assigned.name === workerName),
      ),
    );
    if (duplicatePerDay.length > 0) {
      setCreateMessage(`לא ניתן לשבץ יותר ממשמרת אחת ביום לעובדת: ${Array.from(new Set(duplicatePerDay)).join(', ')}.`);
      return;
    }

    const targetWeekKey = toSundayWeekKey(jobDate);
    const overLimitWorkers = selectedWorkerNames.filter((workerName) => {
      const existingWeeklyCount = dashboardWorksWithoutCurrent.filter(
        (work) =>
          toSundayWeekKey(work.dateKey) === targetWeekKey &&
          work.assignedWorkers.some((assigned) => assigned.name === workerName),
      ).length;
      return existingWeeklyCount + 1 > 4;
    });
    if (overLimitWorkers.length > 0) {
      setCreateMessage(`חרוג: ${Array.from(new Set(overLimitWorkers)).join(', ')} כבר משובצות בעבודות זה בשבוע. מקסימום 4 משמרות לשבוע.`);
    }

    const normalizedAssignedWorkers: AssignedWorker[] = selectedWorkerRows.map((worker) => ({
      name: worker.name,
      isTeamLead: worker.name === actualTeamLeadName,
    }));
    const responsibleName = actualTeamLeadName ?? MOM_OWNER_NAME;
    const responsibleRole: 'admin' | 'owner' = actualTeamLeadName ? 'admin' : 'owner';

    setDashboardWorks((prev) => {
      if (editingWorkId) {
        return prev
          .map((work) =>
            work.id === editingWorkId
              ? {
                  ...work,
                  customerName,
                  caseId: work.caseId,
                  caseName: work.caseName,
                  address: work.address,
                  jobType,
                  dateKey: jobDate,
                  date: toDisplayDateFromDateKey(jobDate),
                  hours: Number.isFinite(computedHours) ? computedHours : work.hours,
                  requiredWorkers,
                  requiredTeamLeads: requireTeamLead ? 1 : 0,
                  assignedWorkers: normalizedAssignedWorkers,
                  actualTeamLeadName,
                  responsibleName,
                  responsibleRole,
                }
              : work,
          )
          .sort((a, b) => a.dateKey.localeCompare(b.dateKey) || a.id - b.id);
      }

      const newDashboardWork: ActiveWork = {
        id: Date.now(),
        customerName,
        caseId: resolvedCaseId,
        caseName: resolvedCaseName,
        address: targetAddress,
        jobType,
        dateKey: jobDate,
        date: toDisplayDateFromDateKey(jobDate),
        hours: Number.isFinite(computedHours) ? computedHours : 5,
        requiredWorkers,
        requiredTeamLeads: requireTeamLead ? 1 : 0,
        assignedWorkers: normalizedAssignedWorkers,
        actualTeamLeadName,
        responsibleName,
        responsibleRole,
        payrollCost: '₪0',
        estimatedRevenue: '₪0',
        status: 'planned',
      };

      return [...prev, newDashboardWork].sort((a, b) => a.dateKey.localeCompare(b.dateKey) || a.id - b.id);
    });

    if (!editingWorkId && jobType === 'אריזה') {
      const shouldAddUnpacking = window.confirm('נוצרה משמרת אריזה. להוסיף עכשיו גם משמרת פריקה ללקוח הזה?');
      if (shouldAddUnpacking) {
        const suggestedUnpackingDate = addDaysToDateKey(jobDate, 1);
        setEditingWorkId(null);
        setCustomerMode('existing');
        setSelectedCustomerId(customerId);
        setSelectedAddress(targetAddress);
        setExistingAddressQuery(targetAddress);
        setAddressMode('existing');
        setNewAddress('');
        setNewAddressSelection(null);
        setJobType('פריקה');
        setJobDate(suggestedUnpackingDate);
        setStartTime(startTime);
        setEndTime(endTime);
        setCreateMessage('הוגדרה משמרת פריקה חדשה על בסיס משמרת האריזה. עדכני פרטים ושמרי.');
        return;
      }
    }

    setCreateMessage(editingWorkId ? 'העבודה עודכנה בהצלחה בדאשבורד.' : 'העבודה נוצרה בהצלחה מהדאשבורד.');
    setTimeout(() => {
      setIsCreateOpen(false);
      setEditingWorkId(null);
      setCreateMessage('');
    }, 700);
  };

  const openDayJobsFromSummary = (dateKey: string) => {
    if (isWorkCreationBlockedDay(dateKey)) {
      return;
    }
    const worksForDay = displayedWorks.filter((work) => work.dateKey === dateKey);
    if (worksForDay.length === 0) {
      openCreateModal(dateKey);
      return;
    }
    if (worksForDay.length === 1) {
      openWorkModal(worksForDay[0]);
      return;
    }
    setDayJobsPickerDateKey(dateKey);
  };

  const dayJobsForPicker = useMemo(() => {
    if (!dayJobsPickerDateKey) return [];
    return sortWorksByDate(displayedWorks.filter((work) => work.dateKey === dayJobsPickerDateKey));
  }, [displayedWorks, dayJobsPickerDateKey]);

  const worksSummary = useMemo(() => {
    const totalWorks = displayedWorks.length;
    const totalRequired = displayedWorks.reduce((sum, work) => sum + work.requiredWorkers, 0);
    const totalAssigned = displayedWorks.reduce((sum, work) => sum + work.assignedWorkers.length, 0);
    const openSlots = displayedWorks.reduce(
      (sum, work) => sum + Math.max(work.requiredWorkers - work.assignedWorkers.length, 0),
      0,
    );
    const completionRate = totalRequired > 0 ? Math.round((totalAssigned / totalRequired) * 100) : 0;

    return {
      totalWorks,
      totalRequired,
      totalAssigned,
      openSlots,
      completionRate,
    };
  }, [displayedWorks]);
  const workflowSections = useMemo(() => {
    const worksByCaseId = new Map<string, ActiveWork[]>();
    displayedWorks.forEach((work) => {
      worksByCaseId.set(work.caseId, [...(worksByCaseId.get(work.caseId) ?? []), work]);
    });

    const draftCases = cases.filter((item) => item.status === 'DRAFT');
    const activeCases = cases.filter((item) => item.status === 'ACTIVE');
    const activeCasesWithoutDates = activeCases.filter((item) => (worksByCaseId.get(item.id) ?? []).length === 0);
    const partialSchedulingCases = activeCases.filter((item) => {
      const caseWorks = worksByCaseId.get(item.id) ?? [];
      if (caseWorks.length === 0) return false;
      return caseWorks.some(
        (work) => work.assignedWorkers.length < work.requiredWorkers || (work.requiredTeamLeads > 0 && !work.actualTeamLeadName),
      );
    });

    const jobsWithWorkerShortage = displayedWorks.filter((work) => work.assignedWorkers.length < work.requiredWorkers);
    const jobsMissingManager = displayedWorks.filter((work) => work.requiredTeamLeads > 0 && !work.actualTeamLeadName);
    const attendanceExceptions = displayedWorks.filter(
      (work) => (work.status === 'active' || work.status === 'done') && work.assignedWorkers.length > 0,
    );
    const awaitingBillingCases = cases.filter((item) => item.status === 'READY_FOR_REVIEW');
    const awaitingPaymentCases = cases.filter((item) => {
      if (item.status !== 'COMPLETED') return false;
      const diff = daysBetween(todayDateKey, item.latestJobDate);
      return diff >= 0 && diff <= 45;
    });

    return orderDashboardWorkflowSections([
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
          issue: `חסרים ${Math.max(work.requiredWorkers - work.assignedWorkers.length, 0)} עובדים`,
          href: `/jobs?open=edit&jobId=${work.id}`,
          dateLabel: toDisplayDateFromDateKey(work.dateKey),
          severity: 'high' as const,
        })),
      },
      {
        key: 'jobs-missing-manager',
        title: 'חסר מנהל עבודה',
        items: jobsMissingManager.map((work) => ({
          id: `manager-${work.id}`,
          projectName: work.caseName,
          issue: 'לעבודה אין מנהל עבודה משויך',
          href: `/jobs?open=edit&jobId=${work.id}`,
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
  }, [cases, displayedWorks, todayDateKey]);

  const urgentIssues = useMemo(
    () => extractUrgentDashboardIssues(workflowSections, 8),
    [workflowSections],
  );

  const activeWorkflowSection = useMemo(
    () => workflowSections.find((section) => section.key === activeSectionKey) ?? null,
    [workflowSections, activeSectionKey],
  );

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

  const shiftsByWorkerDate = useMemo(() => {
    const map = new Map<string, ActiveWork[]>();
    displayedWorks.forEach((work) => {
      work.assignedWorkers.forEach((assignedWorker) => {
        const key = `${assignedWorker.name}|${work.dateKey}`;
        map.set(key, [...(map.get(key) ?? []), work]);
      });
    });
    return map;
  }, [displayedWorks]);

  const dailyUnfilledSummary = useMemo(() => {
    return visibleShiftDates.map((date) => {
      const dateKey = toDateKeyFromDate(date);
      const nonWorkingLabel = getNonWorkingDayLabel(dateKey);
      const isNonWorkingDay = isWorkCreationBlockedDay(dateKey);
      const dayWorks = displayedWorks.filter((work) => work.dateKey === dateKey);
      const required = dayWorks.reduce((sum, work) => sum + work.requiredWorkers, 0);
      const assigned = dayWorks.reduce((sum, work) => sum + Math.min(work.assignedWorkers.length, work.requiredWorkers), 0);
      const unfilledShifts = dayWorks.filter((work) => work.assignedWorkers.length < work.requiredWorkers).length;
      const openSlots = Math.max(required - assigned, 0);
      const coverage = required > 0 ? assigned / required : 1;
      const coverageClass = isNonWorkingDay ? 'bg-gray-300' : coverage >= 1 ? 'bg-emerald-500' : coverage >= 0.75 ? 'bg-amber-500' : 'bg-rose-500';
      return {
        dateKey,
        dayLabel: date.toLocaleDateString('he-IL', { weekday: 'short' }),
        dateLabel: date.toLocaleDateString('he-IL', { day: '2-digit', month: '2-digit' }),
        nonWorkingLabel,
        isNonWorkingDay,
        required,
        assigned,
        unfilledShifts,
        openSlots,
        coverage,
        coverageClass,
      };
    });
  }, [visibleShiftDates, displayedWorks]);

  const shiftCountByWorkerName = useMemo(() => {
    const map = new Map<string, number>();
    displayedWorks.forEach((work) => {
      work.assignedWorkers.forEach((assignedWorker) => {
        map.set(assignedWorker.name, (map.get(assignedWorker.name) ?? 0) + 1);
      });
    });
    return map;
  }, [displayedWorks]);

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
    <div className="space-y-4">
      {/* Header with Actions */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-gray-900">לוח בקרה</h1>
          <p className="text-sm text-gray-600 mt-0.5">{greetingText}</p>
        </div>
        <a
          href={feedbackMailtoHref}
          className="inline-flex items-center rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium text-gray-800 hover:bg-gray-50"
        >
          דיווח באג או בקשה
        </a>
      </div>

      {/* Owner KPI Bar */}
      <div className="bg-white rounded-lg border border-gray-200 p-2 space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <span className="inline-flex mt-1.5 px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 text-[11px] font-semibold">
              תצוגה פעילה: {selectedRangeLabel}
            </span>
          </div>
          <div className="inline-flex rounded-lg border border-gray-200 bg-gray-50 p-0.5">
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
                  className={`px-2 py-1 text-[11px] font-medium rounded-md transition-colors ${
                    isActive
                      ? 'bg-emerald-600 text-white shadow-sm ring-2 ring-emerald-200'
                      : 'text-gray-600 hover:text-gray-900 hover:bg-white'
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
                className="inline-flex items-center rounded-lg border border-emerald-200 bg-emerald-50 px-2.5 py-1.5 text-[11px] font-medium text-emerald-700 hover:bg-emerald-100"
              >
                היום
              </button>
              {selectedRange === 'month' ? (
                <select
                  value={`${anchorDate.getFullYear()}-${String(anchorDate.getMonth() + 1).padStart(2, '0')}`}
                  onChange={(e) => {
                    const [year, month] = e.target.value.split('-').map(Number);
                    setAnchorDate(new Date(year, month - 1, 1));
                  }}
                  className="h-8 rounded-lg border border-gray-300 bg-white px-2.5 text-[11px] font-semibold text-gray-700"
                >
                  {monthOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              ) : (
                <div className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 bg-gray-50 px-2.5 py-1.5">
                  <CalendarDays className="h-3.5 w-3.5 text-gray-500" />
                  <span className="text-[11px] font-semibold text-gray-700">{periodLabel}</span>
                </div>
              )}
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
                className="w-full rounded-md border border-gray-300 px-2.5 py-1.5 text-xs bg-white"
              />
            </label>
            <label className="text-xs text-gray-700 space-y-1">
              <span className="block font-medium">עד תאריך</span>
              <input
                value={customToDate}
                onChange={(e) => setCustomToDate(e.target.value)}
                type="date"
                className="w-full rounded-md border border-gray-300 px-2.5 py-1.5 text-xs bg-white"
              />
            </label>
          </div>
        )}

      </div>

      {/* Main Content */}
      <section className="bg-white rounded-lg border border-gray-200 p-3" data-testid="dashboard-urgent-panel">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-sm font-semibold text-gray-900">דורש טיפול</h2>
          <span className="text-[11px] text-gray-500">{urgentIssues.length} פריטים דחופים</span>
        </div>
        {urgentIssues.length === 0 ? (
          <p className="mt-2 text-xs text-emerald-700">אין כרגע דברים דחופים שדורשים טיפול</p>
        ) : (
          <div className="mt-2 space-y-2">
            {urgentIssues.map((item) => (
              <div
                key={`urgent-${item.id}`}
                className={`rounded-lg border px-3 py-2 ${
                  item.severity === 'high' ? 'border-rose-200 bg-rose-50' : 'border-amber-200 bg-amber-50'
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="text-right">
                    <p className="text-xs font-semibold text-gray-900">{item.projectName}</p>
                    <p className="text-xs text-gray-700 mt-0.5">{item.issue}</p>
                    {item.dateLabel ? <p className="text-[11px] text-gray-600 mt-0.5">תאריך: {item.dateLabel}</p> : null}
                  </div>
                  <Link
                    href={item.href}
                    className="inline-flex items-center rounded-md border border-gray-300 bg-white px-2.5 py-1 text-[11px] font-medium text-gray-800 hover:bg-gray-50"
                  >
                    פעולה ישירה
                  </Link>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      <div className="flex flex-col gap-2.5 lg:h-[calc(100vh-180px)] lg:min-h-[620px] min-h-0">
        <div className="bg-white rounded-lg border border-gray-200 overflow-hidden flex-1 min-h-[430px] flex flex-col">
            <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
              <h2 className="font-semibold text-gray-900">
                תצוגת משמרות {selectedRangeContextLabel} ({displayedWorks.length})
              </h2>
              <Link
                href={{ pathname: '/jobs', query: { range: selectedRange, view: 'shifts' } }}
                className="text-emerald-600 text-xs font-medium hover:text-emerald-700"
              >
                הצג הכל →
              </Link>
            </div>

            <div className="overflow-auto flex-1 min-h-0">
              <div className="border-b border-gray-100 bg-gray-50 py-2">
                <div className="flex flex-wrap items-center justify-between gap-2 px-3">
                  <p className="text-xs font-semibold text-gray-900">משמרות לא מאוישות במלואן</p>
                  <p className={`text-xs font-semibold ${worksSummary.openSlots > 0 ? 'text-rose-700' : 'text-emerald-700'}`}>
                    {worksSummary.openSlots > 0 ? `${worksSummary.openSlots} תקנים חסרים בטווח` : 'אין חוסרים בטווח הנבחר'}
                  </p>
                </div>
                <div className="grid mt-1.5 border-y border-gray-200 bg-white" style={shiftGridStyle}>
                  <div aria-hidden className="border-l border-gray-200 bg-gray-50/80" />
                  {dailyUnfilledSummary.map((day) =>
                    day.isNonWorkingDay ? (
                      <div
                        key={`daily-${day.dateKey}`}
                        className={`min-w-0 border-l border-gray-200 px-2 py-2 text-center ${day.dateKey === todayDateKey ? 'bg-emerald-100' : 'bg-gray-100'}`}
                      >
                        <div className="text-right">
                          <div className="flex items-center justify-between gap-1">
                            {day.dateKey === todayDateKey && (
                              <span className="rounded-full bg-emerald-600 px-1.5 py-0.5 text-[10px] font-semibold text-white">היום</span>
                            )}
                            <div className="text-right">
                              <p className="text-[11px] text-gray-500 leading-4">{day.dayLabel}</p>
                              <p className="text-[11px] text-gray-500 leading-4">{day.dateLabel}</p>
                            </div>
                          </div>
                        </div>
                        <p className="mt-3 text-[11px] font-medium text-gray-500">{day.nonWorkingLabel}</p>
                      </div>
                    ) : (
                      <button
                        key={`daily-${day.dateKey}`}
                        type="button"
                        onClick={() => openDayJobsFromSummary(day.dateKey)}
                        className={`min-w-0 border-l border-gray-200 px-2 py-2 text-center hover:bg-emerald-50 ${day.dateKey === todayDateKey ? 'bg-emerald-50' : ''}`}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <p className="text-[11px] font-semibold text-gray-700">{day.assigned}/{day.required || 0}</p>
                          <div className="text-right">
                            <div className="flex items-center justify-end gap-1">
                              {day.dateKey === todayDateKey && (
                                <span className="rounded-full bg-emerald-600 px-1.5 py-0.5 text-[10px] font-semibold text-white">היום</span>
                              )}
                              <p className="text-[11px] text-gray-700 leading-4">{day.dayLabel}</p>
                            </div>
                            <p className="text-[11px] text-gray-700 leading-4">{day.dateLabel}</p>
                          </div>
                        </div>
                        <div className="mt-1 h-1.5 w-full rounded-full bg-gray-200 overflow-hidden">
                          <div className={`h-full ${day.coverageClass}`} style={{ width: `${Math.max(6, Math.min(100, Math.round(day.coverage * 100)))}%` }} />
                        </div>
                        <p className={`mt-1 text-[11px] font-medium ${day.unfilledShifts > 0 ? 'text-rose-700' : 'text-emerald-700'}`}>
                          {day.required === 0 ? 'אין משמרות' : day.unfilledShifts > 0 ? `${day.unfilledShifts} משמרות בחוסר` : 'איוש מלא'}
                        </p>
                      </button>
                    ),
                  )}
                </div>
              </div>

              <div className="grid border-b border-gray-200 bg-gray-50" style={shiftGridStyle}>
                <div className="p-2.5 text-xs font-semibold text-gray-700 border-l border-gray-200">עובדת</div>
                {visibleShiftDates.map((date) => {
                  const dateKey = toDateKeyFromDate(date);
                  const nonWorkingLabel = getNonWorkingDayLabel(dateKey);
                  const isNonWorkingDay = isWorkCreationBlockedDay(dateKey);
                  const isToday = dateKey === todayDateKey;
                  return isNonWorkingDay ? (
                    <div key={`head-${dateKey}`} className={`min-w-0 border-l border-gray-200 p-2.5 text-center text-gray-500 ${isToday ? 'bg-emerald-100' : 'bg-gray-200'}`}>
                      <div className="flex items-center justify-center gap-1">
                        {isToday && <span className="rounded-full bg-emerald-600 px-1.5 py-0.5 text-[10px] font-semibold text-white">היום</span>}
                        <div className="text-xs">{date.toLocaleDateString('he-IL', { weekday: 'short' })}</div>
                      </div>
                      <div className="text-xs font-semibold">{date.toLocaleDateString('he-IL', { day: '2-digit', month: '2-digit' })}</div>
                      <div className="mt-0.5 text-[10px]">{nonWorkingLabel}</div>
                    </div>
                  ) : (
                    <button
                      key={`head-${dateKey}`}
                      type="button"
                      onClick={() => openCreateModal(dateKey)}
                      className={`min-w-0 p-2.5 text-center border-l border-gray-200 text-gray-700 hover:bg-emerald-50 ${isToday ? 'bg-emerald-50 text-emerald-700' : ''}`}
                    >
                      <div className="flex items-center justify-center gap-1">
                        {isToday && <span className="rounded-full bg-emerald-600 px-1.5 py-0.5 text-[10px] font-semibold text-white">היום</span>}
                        <div className="text-xs">{date.toLocaleDateString('he-IL', { weekday: 'short' })}</div>
                      </div>
                      <div className="text-xs font-semibold">{date.toLocaleDateString('he-IL', { day: '2-digit', month: '2-digit' })}</div>
                      {nonWorkingLabel && <div className="text-[10px] text-amber-700">{nonWorkingLabel}</div>}
                    </button>
                  );
                })}
              </div>

              {dashboardWorkers.map((worker) => (
                <div
                  key={worker.id}
                  className="grid border-b border-gray-100"
                  style={shiftGridStyle}
                >
                 <div className="p-2.5 border-l border-gray-100">
                   <p className="text-xs font-semibold text-gray-900">
                      {worker.name} ({shiftCountByWorkerName.get(worker.name) ?? 0})
                    </p>
                    <p className="text-xs text-gray-500">
                      {worker.role}
                      {canSeeFinancials ? ` • ₪${worker.hourlyWage}/שעה` : ''}
                    </p>
                  </div>
                  {visibleShiftDates.map((date) => {
                    const dateKey = toDateKeyFromDate(date);
                    const nonWorkingLabel = getNonWorkingDayLabel(dateKey);
                    const isNonWorkingDay = isWorkCreationBlockedDay(dateKey);
                    const isToday = dateKey === todayDateKey;
                    const unavailable = dashboardAvailability.find((item) => item.workerName === worker.name && item.dateKey === dateKey);
                    const shifts = shiftsByWorkerDate.get(`${worker.name}|${dateKey}`) ?? [];
                    return (
                      <div
                        key={`${worker.id}-${dateKey}`}
                        className={`min-h-[70px] border-l border-gray-100 p-1.5 ${isNonWorkingDay ? (isToday ? 'bg-emerald-100' : 'bg-gray-100') : isToday ? 'bg-emerald-50/50' : 'bg-white'}`}
                      >
                        {isNonWorkingDay ? (
                          <p className="mt-5 text-center text-[11px] text-gray-500">{nonWorkingLabel}</p>
                        ) : unavailable ? (
                          <div className="rounded-md border border-rose-200 bg-rose-50 px-2 py-1.5 text-center">
                            <p className="text-[11px] font-semibold text-rose-700">לא זמינה</p>
                            <p className="text-[11px] text-rose-600">{unavailable.reason}</p>
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
                              const caseMeta = caseStatusMeta[linkedCaseStatus];
                              return (
                                <button
                                  key={`${worker.id}-${shift.id}`}
                                  type="button"
                                  onClick={() => openWorkModal(shift)}
                                  className={`w-full rounded-md border px-2 py-1 text-right ${getShiftTypeCardClasses(shift.jobType)}`}
                                >
                                  <p className="text-[11px] font-semibold text-gray-900">09:00-{addHoursToTime('09:00', shift.hours)}</p>
                                  <p className="text-[11px] text-gray-600">{shift.customerName}</p>
                                  <p
                                    className={`mt-0.5 inline-flex items-center rounded-full border px-1.5 py-0.5 text-[10px] font-medium ${
                                      isUrgentCase ? 'border-rose-300 bg-rose-100 text-rose-700' : caseMeta.className
                                    }`}
                                  >
                                    {isUrgentCase ? 'דחוף: ממתין לאישור לקוח' : caseMeta.label}
                                  </p>
                                  {shift.actualTeamLeadName === worker.name && (
                                    <p className="text-[11px] text-emerald-700 font-medium mt-0.5">ראש צוות</p>
                                  )}
                                </button>
                              );
                            })}
                            {shifts.length > 2 && <p className="text-[11px] text-gray-500 text-center">+{shifts.length - 2} נוספות</p>}
                          </div>
                        ) : (
                          <p className="text-[11px] text-gray-400 mt-5 text-center">זמינה</p>
                        )}
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>
          </div>
        <div className="bg-white rounded-lg border border-gray-200 shrink-0">
          <div className="px-3 py-2.5 border-y border-gray-100">
            <h3 className="font-semibold text-gray-900 text-sm">סיכום שיבוץ לעבודות {selectedRangeContextLabel}</h3>
            <p className="text-xs text-gray-500 mt-1 mb-2">מבוסס על העבודות שמוצגות מעל</p>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
              <div>
                <p className="text-xs text-gray-600">מספר עבודות</p>
                <p className="font-semibold text-sm text-gray-900">{worksSummary.totalWorks}</p>
              </div>
              <div>
                <p className="text-xs text-gray-600">תקנים משובצים</p>
                <p className="font-semibold text-sm text-gray-900">{worksSummary.totalAssigned}/{worksSummary.totalRequired}</p>
              </div>
              <div>
                <p className="text-xs text-gray-600">פערי שיבוץ פתוחים</p>
                <p className={`font-semibold text-sm ${worksSummary.openSlots > 0 ? 'text-red-600' : 'text-emerald-600'}`}>{worksSummary.openSlots}</p>
              </div>
              <div>
                <p className="text-xs text-gray-600">אחוז שיבוץ</p>
                <p className={`font-semibold text-sm ${worksSummary.completionRate >= 95 ? 'text-emerald-600' : 'text-amber-600'}`}>{worksSummary.completionRate}%</p>
              </div>
            </div>
          </div>

          <div className="px-3 py-2.5">
            <h3 className="font-semibold text-gray-900 text-sm mb-2">זרימות עבודה</h3>
            <div className="space-y-2" data-testid="dashboard-workflow-sections">
              {workflowSections.map((section) => {
                const previewItems = section.items.slice(0, 5);
                return (
                  <div key={section.key} className="rounded-lg border border-gray-200 bg-white p-2">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-xs font-semibold text-gray-900">{section.title}</p>
                      <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${section.items.length > 0 ? 'bg-amber-100 text-amber-800' : 'bg-emerald-100 text-emerald-700'}`}>
                        {section.items.length}
                      </span>
                    </div>
                    <div className="mt-1 space-y-1">
                      {previewItems.length === 0 ? (
                        <p className="text-[11px] text-emerald-700">אין פריטים פתוחים</p>
                      ) : (
                        previewItems.map((item) => (
                          <Link
                            key={`${section.key}-${item.id}`}
                            href={item.href}
                            className="block rounded-md border border-gray-200 bg-gray-50 px-2 py-1 text-[11px] text-gray-700 hover:bg-gray-100"
                          >
                            {item.projectName} • {item.issue}
                          </Link>
                        ))
                      )}
                    </div>
                    {section.items.length > 5 ? (
                      <button
                        type="button"
                        onClick={() => setActiveSectionKey(section.key)}
                        className="mt-1.5 text-[11px] font-medium text-emerald-700 hover:text-emerald-800"
                      >
                        הצגת הכל
                      </button>
                    ) : null}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>

      {isCreateOpen && (
        <div
          className="fixed inset-0 z-50 bg-black/30 flex items-start justify-center overflow-y-auto p-4 py-6"
          onMouseDown={() => {
            setEditingWorkId(null);
            setIsCreateOpen(false);
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
              {editingWork ? (
                <div className="rounded-lg border border-gray-200 p-4 space-y-3">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <p className="text-sm font-semibold text-gray-900">פרוייקט מקושר לעבודה</p>
                      <p className="mt-1 text-xs text-gray-600">כל שינוי בשיוך הלקוח, הכתובת או הפרוייקט צריך להתבצע מתוך מסך הפרוייקטים.</p>
                    </div>
                    <Link
                      href={editingWork.caseId ? { pathname: '/cases', query: { caseId: editingWork.caseId } } : '/cases'}
                      className="inline-flex items-center rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-medium text-emerald-700 hover:bg-emerald-100"
                    >
                      מעבר לפרוייקט
                    </Link>
                  </div>
                  <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                    <div className="rounded-lg border border-gray-200 bg-gray-50 p-3">
                      <p className="text-[11px] text-gray-500">לקוח</p>
                      <p className="mt-1 text-sm font-semibold text-gray-900">{editingWork.customerName}</p>
                    </div>
                    <div className="rounded-lg border border-gray-200 bg-gray-50 p-3">
                      <p className="text-[11px] text-gray-500">פרוייקט</p>
                      <p className="mt-1 text-sm font-semibold text-gray-900">{selectedLinkedCase?.caseName ?? editingWork.caseName}</p>
                    </div>
                    <div className="rounded-lg border border-gray-200 bg-gray-50 p-3">
                      <p className="text-[11px] text-gray-500">כתובת עבודה</p>
                      <p className="mt-1 text-sm font-semibold text-gray-900">{editingWork.address}</p>
                    </div>
                  </div>
                </div>
              ) : (
                <>
                  <div className="rounded-lg border border-gray-200 p-4 space-y-3">
                    <p className="text-sm font-semibold text-gray-900">לקוח</p>
                    <p className="text-xs text-gray-500">התחילי להקליד שם/טלפון ונציע לקוחות קיימים אוטומטית.</p>
                    <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
                      <input
                        value={newCustomerFirstName}
                        onChange={(e) => {
                          setNewCustomerFirstName(e.target.value);
                          setCustomerMode('new');
                          setSelectedCustomerId('');
                          setSelectedAddress('');
                          setExistingAddressQuery('');
                        }}
                        className={`rounded-lg border px-3 py-2 text-sm text-right ${formAttempted && !newCustomerFirstName.trim() ? 'border-red-500 bg-red-50' : 'border-gray-300'}`}
                        placeholder="שם פרטי *"
                      />
                      <input
                        value={newCustomerLastName}
                        onChange={(e) => {
                          setNewCustomerLastName(e.target.value);
                          setCustomerMode('new');
                          setSelectedCustomerId('');
                          setSelectedAddress('');
                          setExistingAddressQuery('');
                        }}
                        className="rounded-lg border border-gray-300 px-3 py-2 text-sm text-right"
                        placeholder="שם משפחה (אופציונלי)"
                      />
                      <input
                        value={newCustomerPhone}
                        onChange={(e) => {
                          setNewCustomerPhone(e.target.value);
                          setCustomerMode('new');
                          setSelectedCustomerId('');
                          setSelectedAddress('');
                          setExistingAddressQuery('');
                        }}
                        className={`rounded-lg border px-3 py-2 text-sm text-right ${formAttempted && !newCustomerPhone.trim() ? 'border-red-500 bg-red-50' : 'border-gray-300'}`}
                        placeholder="טלפון *"
                      />
                      <input
                        value={newCustomerEmail}
                        onChange={(e) => setNewCustomerEmail(e.target.value)}
                        className="rounded-lg border border-gray-300 px-3 py-2 text-sm text-right"
                        placeholder="אימייל (אופציונלי)"
                      />
                    </div>
                    {customerSuggestions.length > 0 && (
                      <div className="rounded-lg border border-emerald-100 bg-emerald-50 p-2 space-y-1">
                        {customerSuggestions.map((customer) => (
                          <button
                            key={`customer-suggestion-${customer.id}`}
                            type="button"
                            onClick={() => {
                              const [first = '', ...rest] = customer.fullName.split(' ');
                              setCustomerMode('existing');
                              setSelectedCustomerId(customer.id);
                              setNewCustomerFirstName(first);
                              setNewCustomerLastName(rest.join(' '));
                              setNewCustomerPhone(customer.phone);
                              setNewCustomerEmail(customer.email);
                              setSelectedAddress(customer.addresses[0] ?? '');
                              setExistingAddressQuery(customer.addresses[0] ?? '');
                              setAddressMode('existing');
                              setNewAddressSelection(null);
                            }}
                            className="w-full rounded-md border border-emerald-200 bg-white px-3 py-1.5 text-right text-xs text-gray-700 hover:bg-emerald-100"
                          >
                            {customer.fullName} • {customer.phone}
                          </button>
                        ))}
                      </div>
                    )}
                    {customerMode === 'existing' && selectedCustomer && (
                      <div className="flex items-center justify-between rounded-md border border-blue-200 bg-blue-50 px-3 py-2">
                        <p className="text-xs text-blue-800">נבחר לקוח קיים: {selectedCustomer.fullName}</p>
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
                                className={`w-full px-3 py-2 text-right text-xs hover:bg-emerald-50 ${selectedAddress === address ? 'bg-emerald-50 text-emerald-700' : 'text-gray-700'}`}
                              >
                                {address}
                              </button>
                            ))}
                          </div>
                        )}
                      </>
                    ) : (
                      <AzureMapsAddressInput
                        value={newAddress}
                        onChange={(value) => {
                          setNewAddress(value);
                        }}
                        onSelectionChange={setNewAddressSelection}
                        className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-right"
                        placeholder="כתובת מלאה: רחוב, מספר, עיר, קומה, דירה"
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
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-gray-500">מומלץ להזין כתובת מלאה (רחוב+מספר, עיר, קומה, דירה)</span>
                      <a
                        href={`https://www.bing.com/maps?q=${encodeURIComponent((customerMode === 'existing' ? selectedAddress : newAddress) || '')}`}
                        target="_blank"
                        rel="noreferrer"
                        className="text-emerald-700 hover:text-emerald-800 underline"
                      >
                        בדיקה במפה
                      </a>
                    </div>
                    {customerMode === 'new' && newAddressSelection && (
                      <div className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-[11px] text-emerald-800">
                        כתובת מאושרת: {newAddressSelection.formattedAddress} • {newAddressSelection.latitude.toFixed(5)}, {newAddressSelection.longitude.toFixed(5)}
                      </div>
                    )}
                    {!process.env.NEXT_PUBLIC_AZURE_MAPS_KEY && (
                      <p className="text-[11px] text-amber-700">
                        כדי לאפשר בחירת כתובת אוטומטית, הגדירי NEXT_PUBLIC_AZURE_MAPS_KEY.
                      </p>
                    )}
                  </div>

                  {/* Auto-matching UI section hidden - matching happens silently in backend */}
                </>
              )}

              <div className="rounded-lg border border-gray-200 p-4 space-y-3">
                <p className="text-sm font-semibold text-gray-900">פרטי עבודה</p>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  <select value={jobType} onChange={(e) => setJobType(e.target.value as JobType)} className="rounded-lg border border-gray-300 px-3 py-2 text-sm bg-white">
                    <option value="אריזה">אריזה</option>
                    <option value="פריקה">פריקה</option>
                    <option value="סידור">סידור</option>
                  </select>
                  <input value={jobDate} onChange={(e) => setJobDate(e.target.value)} type="date" className="rounded-lg border border-gray-300 px-3 py-2 text-sm" />
                  <select value={staffingMode} onChange={(e) => setStaffingMode(e.target.value as StaffingMode)} className="rounded-lg border border-gray-300 px-3 py-2 text-sm bg-white">
                    <option value="approval">אישור מנהל</option>
                    <option value="auto">אישור אוטומטי (FCFS)</option>
                  </select>
                  <input value={startTime} onChange={(e) => setStartTime(e.target.value)} type="time" className={`rounded-lg border px-3 py-2 text-sm ${formAttempted && !startTime ? 'border-red-500 bg-red-50' : 'border-gray-300'}`} />
                  <input value={endTime} onChange={(e) => setEndTime(e.target.value)} type="time" className={`rounded-lg border px-3 py-2 text-sm ${formAttempted && !endTime ? 'border-red-500 bg-red-50' : 'border-gray-300'}`} />
                  <input value={requiredWorkers} onChange={(e) => setRequiredWorkers(Number(e.target.value))} type="number" min={1} className={`rounded-lg border px-3 py-2 text-sm ${formAttempted && (!requiredWorkers || requiredWorkers < 1) ? 'border-red-500 bg-red-50' : 'border-gray-300'}`} placeholder="כמות עובדים *" />
                </div>
                <div>
                  <label className="text-xs text-gray-600">טופס לסיום משמרת</label>
                  <select
                    value={selectedFormTemplateId ?? ''}
                    onChange={(e) => setSelectedFormTemplateId(e.target.value || null)}
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm bg-white"
                  >
                    <option value="">ללא טופס</option>
                    {formTemplates.map(t => (
                      <option key={t.id} value={t.id}>{t.title}</option>
                    ))}
                  </select>
                </div>
                <label className="inline-flex items-center gap-2 text-sm text-gray-700">
                  <input
                    type="checkbox"
                    checked={requireTeamLead}
                    onChange={(e) => setRequireTeamLead(e.target.checked)}
                    className="rounded border-gray-300"
                  />
                  חובה ראש צוות (אם נדרש צוות, אחד התקנים נשמר לראש צוות)
                </label>
                <textarea
                  value={workerVisibleNotes}
                  onChange={(e) => setWorkerVisibleNotes(e.target.value)}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-right min-h-[80px]"
                  placeholder="הערות לעובד (גלוי לעובדים)"
                />
                <div className="rounded-lg border border-gray-200 p-3 space-y-2">
                  <p className="text-xs font-semibold text-gray-800">שיבוץ עובדים למשמרת (עריך)</p>
                  <p className="text-[11px] text-gray-500">אפשר לבחור עד {requiredWorkers} עובדים למשמרת זו.</p>
                  <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                    {dashboardWorkers.map((worker) => {
                      const checked = selectedAssignedWorkerNames.includes(worker.name);
                      const disableUnchecked = !checked && selectedAssignedWorkerNames.length >= requiredWorkers;
                      return (
                        <label
                          key={`assign-${worker.id}`}
                          className={`inline-flex items-center gap-2 rounded-md border px-2 py-1.5 text-xs ${
                            checked ? 'border-emerald-300 bg-emerald-50 text-emerald-800' : 'border-gray-200 text-gray-700'
                          } ${disableUnchecked ? 'opacity-50' : ''}`}
                        >
                          <input
                            type="checkbox"
                            checked={checked}
                            disabled={disableUnchecked}
                            onChange={(e) => {
                              const nextChecked = e.target.checked;
                              setSelectedAssignedWorkerNames((prev) => {
                                if (nextChecked) return [...prev, worker.name];
                                return prev.filter((name) => name !== worker.name);
                              });
                              if (!e.target.checked && selectedActualTeamLeadName === worker.name) {
                                setSelectedActualTeamLeadName('');
                              }
                            }}
                            className="rounded border-gray-300"
                          />
                          <span>{worker.name}</span>
                        </label>
                      );
                    })}
                  </div>
                  {selectedTeamLeadOptions.length > 0 && (
                    <label className="block text-xs text-gray-700 space-y-1">
                      <span className="block">ראש צוות</span>
                      <select
                        value={selectedActualTeamLeadName}
                        onChange={(e) => setSelectedActualTeamLeadName(e.target.value)}
                        className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm bg-white"
                      >
                        <option value="">ברירת מחדל</option>
                        {selectedTeamLeadOptions.map((workerName) => (
                          <option key={`lead-option-${workerName}`} value={workerName}>
                            {workerName}
                          </option>
                        ))}
                      </select>
                    </label>
                  )}
                </div>
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={saveNewWorkFromDashboard}
                  className="px-4 py-2 text-sm rounded-lg bg-emerald-600 text-white hover:bg-emerald-700 inline-flex items-center gap-1.5"
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
              </div>

              {createMessage && (
                <p className={`text-sm ${createMessage.includes('בהצלחה') ? 'text-emerald-700' : 'text-rose-700'}`}>
                  {createMessage}
                </p>
              )}
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
                className="text-xs px-2 py-1 rounded border border-gray-300 text-gray-700 hover:bg-gray-50"
              >
                סגירה
              </button>
              <h3 className="font-semibold text-gray-900">
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
                    openWorkModal(work);
                  }}
                  className="w-full rounded-lg border border-gray-200 bg-white hover:bg-emerald-50 hover:border-emerald-300 px-3 py-2 text-right"
                >
                  <p className="text-sm font-semibold text-gray-900">{work.customerName}</p>
                  <p className="text-xs text-gray-600 mt-0.5">{work.assignedWorkers.length}/{work.requiredWorkers} משובצות</p>
                  <p
                    className={`mt-0.5 inline-flex items-center rounded-full border px-1.5 py-0.5 text-[10px] font-medium ${
                      caseStatusMeta[caseById.get(work.caseId)?.status ?? 'ACTIVE'].className
                    }`}
                  >
                    {caseStatusMeta[caseById.get(work.caseId)?.status ?? 'ACTIVE'].label}
                  </p>
                  <p className="text-xs text-gray-600 mt-0.5">
                    {work.responsibleRole === 'admin' ? 'ראש צוות' : 'בעלות'}: {work.responsibleName}
                  </p>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
      {activeWorkflowSection && (
        <div
          className="fixed inset-0 z-50 bg-black/30 flex items-start justify-center overflow-y-auto p-4 py-6"
          onMouseDown={() => setActiveSectionKey(null)}
        >
          <div
            className="w-full max-w-md rounded-lg border border-gray-200 bg-white shadow-xl max-h-[70vh] overflow-y-auto"
            onMouseDown={(e) => e.stopPropagation()}
          >
            <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
              <button
                type="button"
                onClick={() => setActiveSectionKey(null)}
                className="text-xs px-2 py-1 rounded border border-gray-300 text-gray-700 hover:bg-gray-50"
              >
                סגירה
              </button>
              <h3 className="font-semibold text-gray-900 text-sm">{activeWorkflowSection.title}</h3>
            </div>
            <div className="p-3 space-y-2">
              {activeWorkflowSection.items.map((item) => (
                <Link
                  key={item.id}
                  href={item.href}
                  onClick={() => setActiveSectionKey(null)}
                  className="block w-full rounded-lg border border-gray-200 bg-white hover:bg-emerald-50 hover:border-emerald-300 px-3 py-2 text-right text-sm text-gray-900"
                >
                  <div>{item.projectName}</div>
                  <div className="text-xs text-gray-600 mt-0.5">{item.issue}</div>
                </Link>
              ))}
              {activeWorkflowSection.items.length === 0 && (
                <p className="text-sm text-gray-500 text-center py-4">אין פריטים להצגה</p>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

'use client';

import { useEffect, useMemo, useState } from 'react';
import { Mail, MessageCircle, Plus, Search } from 'lucide-react';
import Link from 'next/link';
import type { AddressSelection } from '../../components/forms/AzureMapsAddressInput';
import { SidePanel } from '../../components/ui/SidePanel';
import { api } from '../../lib/api';
import { StatusBadge } from '../../components/ui/StatusBadge';
import type { StatusTone } from '@workforce/shared';

type CustomerAddress = {
  id: string;
  label: 'דירה ישנה' | 'דירה חדשה' | 'מחסן' | 'משרד' | 'אחר';
  fullAddress: string;
  floor?: string;
  apartment?: string;
  location?: AddressSelection;
};

type Customer = {
  id: string;
  firstName: string;
  lastName: string;
  phone: string;
  email: string;
  addresses: CustomerAddress[];
  caseName: string;
  caseStatus: 'none' | 'planned' | 'in_progress' | 'completed_unpaid' | 'completed_paid' | 'cancelled';
  notes?: string;
};

type CustomerCaseFilter = 'all' | Customer['caseStatus'] | 'not_executed';

type DeletedCaseHistoryEntry = {
  customerName: string;
  notApprovedAtDeletion?: boolean;
};

type RelatedWork = {
  id: string;
  date: string;
  jobType: 'אריזה' | 'פריקה' | 'סידור';
  address: string;
  status: 'בוצע' | 'מתוכנן' | 'בביצוע';
  rawStatus: 'RESERVATION' | 'APPROVED' | 'COMPLETED' | 'ARCHIVED';
};

type TemplateKey = 'quote' | 'summary' | 'custom';

type ApiCase = {
  id: string;
  name: string;
  status: 'DRAFT' | 'ACTIVE' | 'READY_FOR_REVIEW' | 'COMPLETED' | 'CANCELLED';
};

type ApiAddress = {
  id: string;
  label: string;
  fullAddress: string;
  floor?: string | null;
  apartment?: string | null;
};

type ApiCustomer = {
  id: string;
  firstName: string;
  lastName: string;
  phone: string;
  email: string | null;
  cases?: ApiCase[];
  addresses?: ApiAddress[];
};

type ApiJob = {
  id: string;
  date: string;
  jobType: 'PACKING' | 'UNPACKING' | 'HOME_ORGANIZATION';
  status: 'RESERVATION' | 'APPROVED' | 'COMPLETED' | 'ARCHIVED';
  address?: { fullAddress: string };
};

function mapApiCaseStatus(status: ApiCase['status']): Customer['caseStatus'] {
  if (status === 'ACTIVE' || status === 'READY_FOR_REVIEW') return 'in_progress';
  if (status === 'COMPLETED') return 'completed_paid';
  if (status === 'CANCELLED') return 'cancelled';
  return 'planned';
}

// Emails auto-generated for records without a real address are placeholders and
// should not be shown to the user.
function cleanEmail(email: string | null | undefined): string {
  if (!email) return '';
  return /@(placeholder|worker)\.local$/i.test(email) ? '' : email;
}

function mapAddressLabel(label: string): CustomerAddress['label'] {
  const map: Record<string, CustomerAddress['label']> = {
    OLD_APARTMENT: 'דירה ישנה',
    NEW_APARTMENT: 'דירה חדשה',
    STORAGE: 'מחסן',
    OFFICE: 'משרד',
  };
  return map[label] ?? 'אחר';
}

function mapApiJobTypeToUi(jobType: ApiJob['jobType']): RelatedWork['jobType'] {
  if (jobType === 'PACKING') return 'אריזה';
  if (jobType === 'UNPACKING') return 'פריקה';
  return 'סידור';
}

function mapApiJobStatus(status: ApiJob['status']): RelatedWork['status'] {
  if (status === 'COMPLETED' || status === 'ARCHIVED') return 'בוצע';
  if (status === 'APPROVED') return 'בביצוע';
  return 'מתוכנן';
}

function mapApiCustomer(apiCustomer: ApiCustomer): Customer {
  const cases = apiCustomer.cases ?? [];
  const representativeCase =
    cases.find((c) => c.status === 'ACTIVE' || c.status === 'READY_FOR_REVIEW') ??
    cases.find((c) => c.status !== 'CANCELLED') ??
    cases[0];
  return {
    id: apiCustomer.id,
    firstName: apiCustomer.firstName,
    lastName: apiCustomer.lastName,
    phone: apiCustomer.phone,
    email: cleanEmail(apiCustomer.email),
    addresses: (apiCustomer.addresses ?? []).map((addr) => ({
      id: addr.id,
      label: mapAddressLabel(addr.label),
      fullAddress: addr.fullAddress,
      floor: addr.floor ?? undefined,
      apartment: addr.apartment ?? undefined,
    })),
    caseName: representativeCase?.name ?? `${apiCustomer.firstName} ${apiCustomer.lastName} - פרוייקט`,
    caseStatus: representativeCase ? mapApiCaseStatus(representativeCase.status) : 'none',
  };
}

const caseStatusMeta: Record<Customer['caseStatus'], { label: string; helper: string; tone: StatusTone }> = {
  none: {
    label: 'ללא פרויקט',
    helper: 'ללקוח אין פרויקט פעיל (טרם נוצר פרויקט או שהפרויקט נמחק)',
    tone: 'neutral',
  },
  planned: {
    label: 'משוריין',
    helper: 'הפרוייקט נפתח וממתין לאישור ביצוע',
    tone: 'info',
  },
  in_progress: {
    label: 'מאושר לביצוע',
    helper: 'הפרוייקט מאושר ויש עבודות מתוכננות או בביצוע',
    tone: 'info',
  },
  completed_unpaid: {
    label: 'עבודה הסתיימה',
    helper: 'העבודה בוצעה וממתינה לסגירת תשלום',
    tone: 'warning',
  },
  completed_paid: {
    label: 'עבודה שולמה',
    helper: 'הפרוייקט נסגר לאחר ביצוע ותשלום מלא',
    tone: 'success',
  },
  cancelled: {
    label: 'בוטל',
    helper: 'הפרוייקט בוטל',
    tone: 'neutral',
  },
};

function normalizePhone(value: string) {
  return value.replace(/\D/g, '');
}

function isValidIsraeliPhone(value: string) {
  const normalized = normalizePhone(value);
  if (!normalized.startsWith('0')) return false;
  if (normalized.length !== 9 && normalized.length !== 10) return false;
  return /^\d+$/.test(normalized);
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

function getTemplateContent(template: TemplateKey, customerName: string, caseName?: string) {
  if (template === 'quote') {
    return {
      subject: `הצעת מחיר - ${customerName}`,
      body: `היי ${customerName},\nמצורפת הצעת המחיר לשירות.\nנשמח לאישור כדי לתאם עבודה.\nתודה,\nצוות S&O`,
    };
  }
  if (template === 'summary') {
    return {
      subject: `סיכום עבודה - ${customerName}`,
      body: `היי ${customerName},\nמצורף סיכום העבודה${caseName ? ` עבור ${caseName}` : ''}.\nנשמח לכל שאלה או המשך תיאום.\nתודה,\nצוות S&O`,
    };
  }
  return { subject: '', body: '' };
}

export default function CustomersPage() {
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [dataError, setDataError] = useState('');
  const [relatedWorks, setRelatedWorks] = useState<RelatedWork[]>([]);
  const [isLoadingWorks, setIsLoadingWorks] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<CustomerCaseFilter>('all');
  const [notExecutedCustomers, setNotExecutedCustomers] = useState<Set<string>>(new Set());
  const [openedCustomerId, setOpenedCustomerId] = useState<string | null>(null);
  const [isCreatingNew, setIsCreatingNew] = useState(false);
  const [cardTab, setCardTab] = useState<'details' | 'works' | 'communication' | 'notes' | 'reports'>('details');
  const [cardMessage, setCardMessage] = useState('');
  const [cardNotes, setCardNotes] = useState('');
  const [customerReports, setCustomerReports] = useState<{
    ready: { caseId: string; jobCount: number; latestJobDate: string | null }[];
    closed: { caseId: string; latestVersion: number; finalAmount: number | null }[];
  }>({ ready: [], closed: [] });
  const [isLoadingReports, setIsLoadingReports] = useState(false);
  const [savingCustomer, setSavingCustomer] = useState(false);

  const [cardFirstName, setCardFirstName] = useState('');
  const [cardLastName, setCardLastName] = useState('');
  const [cardPhone, setCardPhone] = useState('');
  const [cardEmail, setCardEmail] = useState('');
  const [cardCaseName, setCardCaseName] = useState('');
  const [cardAddressLabel, setCardAddressLabel] = useState<CustomerAddress['label']>('דירה חדשה');
  const [cardAddressInput, setCardAddressInput] = useState('');
  const [cardAddressFloor, setCardAddressFloor] = useState('');
  const [cardAddressApartment, setCardAddressApartment] = useState('');

  const [channel, setChannel] = useState<'email' | 'whatsapp'>('email');
  const [template, setTemplate] = useState<TemplateKey>('quote');
  const [messageSubject, setMessageSubject] = useState('');
  const [messageBody, setMessageBody] = useState('');

  useEffect(() => {
    void loadData();
  }, []);

  useEffect(() => {
    if (cardTab === 'reports' && openedCustomerId) void loadCustomerReports(openedCustomerId);
  }, [cardTab, openedCustomerId]);

  // Load the customer's jobs when the עבודות tab opens. Jobs are queried directly
  // by the customer relationship (GET /jobs?customerId=), not through legacy
  // project/case UI — so a job created via Quick Create appears immediately.
  useEffect(() => {
    if (cardTab === 'works' && openedCustomerId) void loadRelatedWorks(openedCustomerId);
  }, [cardTab, openedCustomerId]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      const raw = window.localStorage.getItem('spaceorder_deleted_case_history');
      if (!raw) return;
      const parsed = JSON.parse(raw) as DeletedCaseHistoryEntry[];
      const names = parsed
        .filter((entry) => entry.notApprovedAtDeletion && entry.customerName?.trim())
        .map((entry) => entry.customerName.trim());
      setNotExecutedCustomers(new Set(names));
    } catch (error) {
      console.error('Failed to parse deleted case history from localStorage', error);
      setNotExecutedCustomers(new Set());
    }
  }, []);

  async function loadData() {
    setIsLoading(true);
    setDataError('');
    try {
      const res = await api.get<ApiCustomer[]>('/customers');
      setCustomers(res.data.map(mapApiCustomer));
    } catch {
      setDataError('לא ניתן לטעון נתונים');
    } finally {
      setIsLoading(false);
    }
  }

  async function loadRelatedWorks(customerId: string) {
    setIsLoadingWorks(true);
    try {
      const res = await api.get<ApiJob[]>(`/jobs?customerId=${customerId}`);
      setRelatedWorks(
        res.data.map((job) => ({
          id: job.id,
          date: new Date(job.date).toLocaleDateString('he-IL'),
          jobType: mapApiJobTypeToUi(job.jobType),
          address: job.address?.fullAddress ?? '',
          status: mapApiJobStatus(job.status),
          rawStatus: job.status,
        })),
      );
    } catch {
      setRelatedWorks([]);
    } finally {
      setIsLoadingWorks(false);
    }
  }

  async function loadCustomerReports(customerId: string) {
    setIsLoadingReports(true);
    try {
      const res = await api.get<{ ready: { caseId: string; jobCount: number; latestJobDate: string | null }[]; closed: { caseId: string; latestVersion: number; finalAmount: number | null }[] }>(
        `/cases/reports-overview?customerId=${customerId}`,
      );
      setCustomerReports(res.data ?? { ready: [], closed: [] });
    } catch {
      setCustomerReports({ ready: [], closed: [] });
    } finally {
      setIsLoadingReports(false);
    }
  }

  const getCustomerFullName = (customer: Customer) => `${customer.firstName} ${customer.lastName}`.trim();

  const openedCustomer = useMemo(
    () => customers.find((customer) => customer.id === openedCustomerId) ?? null,
    [customers, openedCustomerId],
  );

  // Unsaved-changes detection for the side-panel dismissal confirmation (item 3).
  const detailsDirty = useMemo(() => {
    if (isCreatingNew) {
      return Boolean(
        cardFirstName.trim() || cardLastName.trim() || cardPhone.trim() || cardEmail.trim() || cardAddressInput.trim(),
      );
    }
    if (openedCustomer) {
      return (
        cardFirstName !== openedCustomer.firstName ||
        cardLastName !== openedCustomer.lastName ||
        cardPhone !== openedCustomer.phone ||
        cardEmail !== openedCustomer.email ||
        Boolean(cardAddressInput.trim())
      );
    }
    return false;
  }, [isCreatingNew, openedCustomer, cardFirstName, cardLastName, cardPhone, cardEmail, cardAddressInput]);

  const filteredCustomers = useMemo(() => {
    const term = searchTerm.trim().toLowerCase();
    return customers.filter((customer) => {
      const isNotExecuted = notExecutedCustomers.has(getCustomerFullName(customer));
      if (statusFilter === 'not_executed' && !isNotExecuted) return false;
      if (statusFilter !== 'all' && statusFilter !== 'not_executed' && customer.caseStatus !== statusFilter) return false;
      if (!term) return true;
      const fullName = `${customer.firstName} ${customer.lastName}`.toLowerCase();
      return (
        fullName.includes(term) ||
        normalizePhone(customer.phone).includes(normalizePhone(term)) ||
        customer.email.toLowerCase().includes(term)
      );
    });
  }, [customers, notExecutedCustomers, searchTerm, statusFilter]);

  const openCustomerCard = (customer: Customer) => {
    setOpenedCustomerId(customer.id);
    setIsCreatingNew(false);
    setCardTab('details');
    setCardMessage('');
    setCardFirstName(customer.firstName);
    setCardLastName(customer.lastName);
    setCardPhone(customer.phone);
    setCardEmail(customer.email);
    setCardAddressInput('');
    setCardAddressFloor('');
    setCardAddressApartment('');
    setCardAddressLabel('דירה חדשה');
    setChannel('email');
    setTemplate('quote');
    setCardCaseName(customer.caseName);
    setCardNotes(customer.notes ?? '');
    const quote = getTemplateContent('quote', `${customer.firstName} ${customer.lastName}`, customer.caseName);
    setMessageSubject(quote.subject);
    setMessageBody(quote.body);
  };

  const openCreateCustomerCard = () => {
    setOpenedCustomerId(null);
    setIsCreatingNew(true);
    setCardTab('details');
    setCardMessage('');
    setCardFirstName('');
    setCardLastName('');
    setCardPhone('');
    setCardEmail('');
    setCardCaseName('');
    setCardNotes('');
    setCardAddressLabel('דירה חדשה');
    setCardAddressInput('');
    setCardAddressFloor('');
    setCardAddressApartment('');
    setChannel('email');
    setTemplate('quote');
    const quote = getTemplateContent('quote', 'לקוח יקר');
    setMessageSubject(quote.subject);
    setMessageBody(quote.body);
  };

  const labelToEnum = (l: string): 'OLD_APARTMENT' | 'NEW_APARTMENT' | 'STORAGE' | 'OFFICE' | 'OTHER' => {
    switch (l) {
      case 'דירה ישנה':
        return 'OLD_APARTMENT';
      case 'דירה חדשה':
        return 'NEW_APARTMENT';
      case 'מחסן':
        return 'STORAGE';
      case 'משרד':
        return 'OFFICE';
      default:
        return 'OTHER';
    }
  };

  const saveCustomer = async () => {
    setCardMessage('');

    if (!cardFirstName.trim()) {
      setCardMessage('יש למלא שם פרטי.');
      return;
    }
    if (!isValidIsraeliPhone(cardPhone)) {
      setCardMessage('מספר הטלפון לא תקין.');
      return;
    }
    // Email is optional; only validate when provided.
    if (cardEmail.trim() && !isValidEmail(cardEmail)) {
      setCardMessage('כתובת האימייל לא תקינה.');
      return;
    }

    setSavingCustomer(true);
    try {
      const payload = {
        firstName: cardFirstName.trim(),
        lastName: cardLastName.trim(),
        phone: cardPhone.trim(),
        ...(cardEmail.trim() ? { email: cardEmail.trim() } : {}),
        ...(cardNotes.trim() ? { internalNotes: cardNotes.trim() } : {}),
      };

      const creating = isCreatingNew;
      let customerId: string | null = openedCustomerId;
      if (creating) {
        const res = await api.post<{ id: string }>('/customers', payload);
        customerId = res.data.id;
      } else if (customerId) {
        await api.patch(`/customers/${customerId}`, payload);
      }

      // Optional free-text address. Address search/geocoding is deferred (issue
      // #217), so it is stored as typed and location monitoring stays inactive
      // until the address is geocoded — no Azure Maps validation is implied.
      if (customerId && cardAddressInput.trim()) {
        await api.post('/addresses', {
          customerId,
          fullAddress: buildAddressWithUnit(cardAddressInput.trim(), cardAddressFloor, cardAddressApartment),
          label: labelToEnum(cardAddressLabel),
        });
      }

      await loadData();
      if (customerId) setOpenedCustomerId(customerId);
      setIsCreatingNew(false);
      setCardAddressInput('');
      setCardAddressFloor('');
      setCardAddressApartment('');
      setCardMessage(creating ? 'הלקוח נוצר ונשמר בהצלחה.' : 'פרטי הלקוח נשמרו בהצלחה.');
    } catch (err) {
      const data = (err as { response?: { data?: { message?: string; error?: string; correlationId?: string } } })?.response?.data;
      setCardMessage((data?.message ?? data?.error ?? 'שמירת הלקוח נכשלה.') + (data?.correlationId ? ` (מזהה: ${data.correlationId})` : ''));
    } finally {
      setSavingCustomer(false);
    }
  };

  const applyTemplate = (nextTemplate: TemplateKey) => {
    setTemplate(nextTemplate);
    if (nextTemplate === 'custom') {
      setMessageSubject('');
      setMessageBody('');
      return;
    }
    const customerName = `${cardFirstName || 'לקוח'} ${cardLastName || ''}`.trim();
    const content = getTemplateContent(nextTemplate, customerName, cardCaseName || openedCustomer?.caseName);
    setMessageSubject(content.subject);
    setMessageBody(content.body);
  };

  const sendCommunication = () => {
    if (!messageBody.trim()) {
      setCardMessage('יש להזין תוכן הודעה.');
      return;
    }
    if (channel === 'email') {
      if (!isValidEmail(cardEmail)) {
        setCardMessage('אי אפשר לשלוח אימייל - הכתובת אינה תקינה.');
        return;
      }
      setCardMessage(`האימייל נשלח ל-${cardEmail} (דמו).`);
      return;
    }

    if (!isValidIsraeliPhone(cardPhone)) {
      setCardMessage('אי אפשר לשלוח וואטסאפ - מספר הטלפון אינו תקין.');
      return;
    }
    const normalized = normalizePhone(cardPhone);
    const internationalPhone = normalized.startsWith('0') ? `972${normalized.slice(1)}` : normalized;
    const whatsappUrl = `https://wa.me/${internationalPhone}?text=${encodeURIComponent(messageBody)}`;
    window.open(whatsappUrl, '_blank', 'noopener,noreferrer');
    setCardMessage('נפתח חלון וואטסאפ לשליחת ההודעה.');
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">לקוחות</h1>
          <p className="text-gray-600 mt-1">רשימת לקוחות + פתיחת כרטיס לקוח בלחיצה ישירה על השורה</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={openCreateCustomerCard}
            className="inline-flex items-center gap-2 rounded-lg bg-primary-600 px-3 py-2 text-sm font-medium text-white hover:bg-primary-700"
          >
            <Plus className="w-4 h-4" />
            לקוח חדש
          </button>
        </div>
      </div>

      <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
        <div className="px-5 py-4 border-b border-gray-100">
          <h3 className="font-semibold text-gray-900 text-sm">ספר לקוחות</h3>
          <p className="text-xs text-gray-500 mt-1">סינון לפי סטטוסים: משוריין / מאושר לביצוע / עבודה הסתיימה / עבודה שולמה / עבודה לא בוצעה</p>
          <div className="mt-3 grid grid-cols-1 lg:grid-cols-3 gap-3">
            <div className="relative lg:col-span-2">
              <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              <input
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full rounded-lg border border-gray-300 pr-9 pl-3 py-2 text-sm text-right"
                placeholder="חיפוש לפי שם / טלפון / אימייל"
              />
            </div>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as CustomerCaseFilter)}
              className="rounded-lg border border-gray-300 px-3 py-2 text-sm bg-white"
            >
              <option value="all">כל הסטטוסים</option>
              <option value="none">ללא פרויקט</option>
              <option value="planned">משוריין</option>
              <option value="in_progress">מאושר לביצוע</option>
              <option value="completed_unpaid">עבודה הסתיימה</option>
              <option value="completed_paid">עבודה שולמה</option>
              <option value="not_executed">עבודה לא בוצעה</option>
            </select>
          </div>
        </div>

        <div className="max-h-[620px] overflow-y-auto divide-y divide-gray-100">
          {filteredCustomers.map((customer) => {
            const statusMeta = caseStatusMeta[customer.caseStatus];
            const isNotExecuted = notExecutedCustomers.has(getCustomerFullName(customer));
            return (
              <button
                key={customer.id}
                type="button"
                onClick={() => openCustomerCard(customer)}
                className="w-full text-right px-5 py-4 hover:bg-primary-50 transition-colors"
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-base font-semibold text-gray-900">{customer.firstName} {customer.lastName}</p>
                    <p className="text-sm text-gray-600 mt-1">{customer.phone}{customer.email ? ` • ${customer.email}` : ''}</p>
                    <p className="text-xs text-gray-500 mt-1">{customer.addresses.length} כתובות שמורות</p>
                    <p className="text-xs text-gray-600 mt-1">פרוייקט: {customer.caseName}</p>
                    <p className="text-xs text-gray-500 mt-1">{statusMeta.helper}</p>
                  </div>
                  <StatusBadge
                    tone={isNotExecuted ? 'error' : statusMeta.tone}
                    label={isNotExecuted ? 'עבודה לא בוצעה' : statusMeta.label}
                  />
                </div>
              </button>
            );
          })}
          {filteredCustomers.length === 0 && (
            <p className="px-5 py-5 text-sm text-gray-400">לא נמצאו לקוחות לפי החיפוש.</p>
          )}
        </div>
      </div>

      <SidePanel
        open={Boolean(openedCustomer || isCreatingNew)}
        onClose={() => {
          setOpenedCustomerId(null);
          setIsCreatingNew(false);
          setCardMessage('');
        }}
        title={isCreatingNew ? 'יצירת לקוח חדש' : 'כרטיס לקוח'}
        hasUnsavedChanges={detailsDirty}
      >
            <div className="px-6 pt-4 pb-2 border-b border-gray-100 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => {
                  setCardTab('details');
                  setCardMessage('');
                }}
                className={`px-3 py-1.5 text-xs rounded-md border ${cardTab === 'details' ? 'bg-primary-50 border-primary-300 text-primary-700' : 'border-gray-300 text-gray-700'}`}
              >
                פרטים
              </button>
              <button
                type="button"
                onClick={() => {
                  setCardTab('works');
                  setCardMessage('');
                }}
                disabled={isCreatingNew}
                className={`px-3 py-1.5 text-xs rounded-md border ${cardTab === 'works' ? 'bg-primary-50 border-primary-300 text-primary-700' : 'border-gray-300 text-gray-700'} disabled:opacity-50`}
              >
                עבודות
              </button>
              <button
                type="button"
                onClick={() => {
                  setCardTab('communication');
                  setCardMessage('');
                }}
                className={`px-3 py-1.5 text-xs rounded-md border ${cardTab === 'communication' ? 'bg-primary-50 border-primary-300 text-primary-700' : 'border-gray-300 text-gray-700'}`}
              >
                הודעות
              </button>
              <button
                type="button"
                onClick={() => {
                  setCardTab('notes');
                  setCardMessage('');
                }}
                className={`px-3 py-1.5 text-xs rounded-md border ${cardTab === 'notes' ? 'bg-primary-50 border-primary-300 text-primary-700' : 'border-gray-300 text-gray-700'}`}
              >
                הערות
              </button>
              <button
                type="button"
                onClick={() => {
                  setCardTab('reports');
                  setCardMessage('');
                }}
                disabled={isCreatingNew}
                className={`px-3 py-1.5 text-xs rounded-md border ${cardTab === 'reports' ? 'bg-primary-50 border-primary-300 text-primary-700' : 'border-gray-300 text-gray-700'} disabled:opacity-50`}
              >
                דוחות
              </button>
            </div>

            <div className="p-6 space-y-4 text-right">
              {cardTab === 'details' && (
                <>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <input value={cardFirstName} onChange={(e) => setCardFirstName(e.target.value)} className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-right" placeholder="שם פרטי" />
                    <input value={cardLastName} onChange={(e) => setCardLastName(e.target.value)} className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-right" placeholder="שם משפחה" />
                    <input value={cardPhone} onChange={(e) => setCardPhone(e.target.value)} className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-right" placeholder="טלפון" inputMode="tel" />
                    <input value={cardEmail} onChange={(e) => setCardEmail(e.target.value)} className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-right" placeholder="אימייל (אופציונלי)" inputMode="email" />
                  </div>

                  <div className="space-y-3 rounded-lg border border-gray-100 p-3">
                    <p className="text-xs font-medium text-gray-700">הוספת כתובת</p>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <select value={cardAddressLabel} onChange={(e) => setCardAddressLabel(e.target.value as CustomerAddress['label'])} className="sm:col-span-2 rounded-lg border border-gray-300 px-3 py-2 text-sm bg-white">
                        <option value="דירה ישנה">דירה ישנה</option>
                        <option value="דירה חדשה">דירה חדשה</option>
                        <option value="מחסן">מחסן</option>
                        <option value="משרד">משרד</option>
                        <option value="אחר">אחר</option>
                      </select>
                      <div className="sm:col-span-2">
                        <input
                          value={cardAddressInput}
                          onChange={(e) => setCardAddressInput(e.target.value)}
                          className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-right"
                          placeholder={isCreatingNew ? 'עיר או כתובת מלאה' : 'הוספת כתובת חדשה (אופציונלי)'}
                        />
                        <span className="mt-1 block text-[11px] text-amber-700">
                          חיפוש/אימות כתובת אינו פעיל עדיין — ניטור מיקום לא זמין עד שהכתובת תעודכן (גיאוקוד).
                        </span>
                      </div>
                      <input
                        value={cardAddressFloor}
                        onChange={(e) => setCardAddressFloor(e.target.value)}
                        className="rounded-lg border border-gray-300 px-3 py-2 text-sm text-right"
                        placeholder="קומה (אופציונלי)"
                      />
                      <input
                        value={cardAddressApartment}
                        onChange={(e) => setCardAddressApartment(e.target.value)}
                        className="rounded-lg border border-gray-300 px-3 py-2 text-sm text-right"
                        placeholder="דירה (אופציונלי)"
                      />
                    </div>
                  </div>

                  {!isCreatingNew && openedCustomer && (
                    <div>
                      <p className="text-xs text-gray-500 mb-2">כתובות שמורות</p>
                      <div className="space-y-2 max-h-[160px] overflow-y-auto">
                        {openedCustomer.addresses.map((address) => (
                          <div key={address.id} className="rounded-lg border border-gray-200 px-3 py-2">
                            <p className="text-xs text-gray-500">{address.label}</p>
                            <p className="text-sm text-gray-900">{address.fullAddress}</p>
                            {(address.floor || address.apartment) && (
                              <p className="text-[11px] text-gray-500 mt-1">
                                {address.floor ? `קומה ${address.floor}` : ''}{address.floor && address.apartment ? ' • ' : ''}{address.apartment ? `דירה ${address.apartment}` : ''}
                              </p>
                            )}
                            {address.location && (
                              <p className="text-[11px] text-gray-500 mt-1">
                                {address.location.latitude.toFixed(5)}, {address.location.longitude.toFixed(5)}
                              </p>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  <button
                    type="button"
                    onClick={() => void saveCustomer()}
                    disabled={savingCustomer}
                    className="px-4 py-2 text-sm rounded-lg bg-primary-600 text-white hover:bg-primary-700 disabled:opacity-50"
                  >
                    {savingCustomer ? 'שומר…' : isCreatingNew ? 'יצירת לקוח' : 'שמירת שינויים'}
                  </button>
                </>
              )}

              {cardTab === 'works' && openedCustomer && (
                <div className="space-y-4">
                  {isLoadingWorks ? (
                    <p className="text-sm text-gray-500">טוען עבודות…</p>
                  ) : relatedWorks.length === 0 ? (
                    <p className="text-sm text-gray-500">אין עבודות ללקוח זה כרגע.</p>
                  ) : (
                    ([
                      ['עבודות עתידיות', relatedWorks.filter((w) => w.rawStatus === 'APPROVED')],
                      ['שריונים', relatedWorks.filter((w) => w.rawStatus === 'RESERVATION')],
                      ['עבודות שהושלמו', relatedWorks.filter((w) => w.rawStatus === 'COMPLETED' || w.rawStatus === 'ARCHIVED')],
                    ] as Array<[string, RelatedWork[]]>).map(([heading, items]) => (
                      <div key={heading} className="space-y-2">
                        <p className="text-xs font-semibold text-gray-700">{heading} ({items.length})</p>
                        {items.length === 0 ? (
                          <p className="text-xs text-gray-400">—</p>
                        ) : (
                          items.map((work) => (
                            <Link
                              key={work.id}
                              href={`/jobs/${work.id}`}
                              className="block rounded-lg border border-gray-200 px-3 py-2 hover:border-primary-300"
                            >
                              <p className="text-sm font-semibold text-gray-900">{work.jobType} • {work.date}</p>
                              {work.address && <p className="text-xs text-gray-600 mt-1">{work.address}</p>}
                              <p className="text-xs text-primary-700 mt-1">סטטוס: {work.status}</p>
                            </Link>
                          ))
                        )}
                      </div>
                    ))
                  )}
                </div>
              )}

              {cardTab === 'communication' && (
                <div className="space-y-3">
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => setChannel('email')}
                      className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-md border ${channel === 'email' ? 'bg-blue-50 border-blue-300 text-blue-700' : 'border-gray-300 text-gray-700'}`}
                    >
                      <Mail className="w-3.5 h-3.5" />
                      אימייל
                    </button>
                    <button
                      type="button"
                      onClick={() => setChannel('whatsapp')}
                      className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-md border ${channel === 'whatsapp' ? 'bg-emerald-50 border-emerald-300 text-emerald-700' : 'border-gray-300 text-gray-700'}`}
                    >
                      <MessageCircle className="w-3.5 h-3.5" />
                      וואטסאפ
                    </button>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                    <select value={template} onChange={(e) => applyTemplate(e.target.value as TemplateKey)} className="rounded-lg border border-gray-300 px-3 py-2 text-sm bg-white">
                      <option value="quote">תבנית: הצעת מחיר</option>
                      <option value="summary">תבנית: סיכום עבודה</option>
                      <option value="custom">תבנית: הודעה חופשית</option>
                    </select>
                    <div className="md:col-span-2 text-xs text-gray-500 flex items-center">בחירת תבנית תטען נוסח מובנה שניתן לעריכה</div>
                  </div>

                  {channel === 'email' && (
                    <input
                      value={messageSubject}
                      onChange={(e) => setMessageSubject(e.target.value)}
                      className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-right"
                      placeholder="נושא האימייל"
                    />
                  )}

                  <textarea
                    value={messageBody}
                    onChange={(e) => setMessageBody(e.target.value)}
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-right min-h-[140px]"
                    placeholder={channel === 'email' ? 'תוכן האימייל' : 'תוכן הודעת וואטסאפ'}
                  />

                  <button
                    type="button"
                    onClick={sendCommunication}
                    className={`px-4 py-2 text-sm rounded-lg text-white ${channel === 'email' ? 'bg-blue-600 hover:bg-blue-700' : 'bg-emerald-600 hover:bg-emerald-700'}`}
                  >
                    {channel === 'email' ? 'שליחת אימייל' : 'שליחה בוואטסאפ'}
                  </button>
                </div>
              )}

              {cardTab === 'notes' && (
                <div className="space-y-2">
                  <div className="rounded-lg border border-primary-100 bg-primary-50 px-3 py-2">
                    <p className="text-xs text-primary-700">
                      הערות פנימיות ללקוח (לא נשלחות ללקוח). מתאים לרגישויות, העדפות או פרטים תפעוליים.
                    </p>
                  </div>
                  <textarea
                    value={cardNotes}
                    onChange={(e) => setCardNotes(e.target.value)}
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-right min-h-[140px]"
                    placeholder="הוספת הערה פנימית..."
                  />
                  <p className="text-xs text-gray-500">ההערה נשמרת עם לחיצה על "שמירת שינויים".</p>
                </div>
              )}

              {cardTab === 'reports' && (
                <div className="space-y-4">
                  {isLoadingReports ? (
                    <p className="text-sm text-gray-500">טוען דוחות…</p>
                  ) : (
                    <>
                      <div>
                        <h4 className="mb-1 text-xs font-semibold text-gray-700">מוכנים לדוח</h4>
                        {customerReports.ready.length === 0 ? (
                          <p className="text-sm text-gray-400">אין פרויקטים מוכנים לדוח.</p>
                        ) : (
                          <ul className="space-y-2">
                            {customerReports.ready.map((c) => (
                              <li key={c.caseId}>
                                <Link href={`/cases/${c.caseId}/customer-report`} className="flex items-center justify-between rounded-lg border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-800 hover:border-green-300">
                                  <span className="font-medium">יצירת דוח לקוחה</span>
                                  <span className="text-xs">{c.jobCount} עבודות · עד {c.latestJobDate ?? '—'}</span>
                                </Link>
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>
                      <div>
                        <h4 className="mb-1 text-xs font-semibold text-gray-700">דוחות שהופקו</h4>
                        {customerReports.closed.length === 0 ? (
                          <p className="text-sm text-gray-400">עדיין לא הופקו דוחות.</p>
                        ) : (
                          <ul className="space-y-2">
                            {customerReports.closed.map((c) => (
                              <li key={c.caseId}>
                                <Link href={`/cases/${c.caseId}/customer-report`} className="flex items-center justify-between rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-800 hover:border-primary-300">
                                  <span className="font-medium">גרסה {c.latestVersion} · היסטוריה והורדה</span>
                                  <span className="text-xs text-gray-500">{c.finalAmount == null ? '—' : `${Number(c.finalAmount).toLocaleString('he-IL')} ₪`}</span>
                                </Link>
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>
                      <p className="text-[11px] text-gray-400">כל גרסה סופית זמינה להורדה ולצפייה בהיסטוריית הגרסאות בתוך מסך הדוח.</p>
                    </>
                  )}
                </div>
              )}

              {cardMessage && (
                <p className={`text-sm ${cardMessage.includes('בהצלחה') || cardMessage.includes('נשלח') || cardMessage.includes('נפתח') ? 'text-emerald-700' : 'text-rose-700'}`}>
                  {cardMessage}
                </p>
              )}
            </div>
      </SidePanel>
    </div>
  );
}

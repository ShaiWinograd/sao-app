'use client';

import { useEffect, useMemo, useState } from 'react';
import { ArrowDown, ArrowUp, ChevronsUpDown, Contact, FileText, Mail, MessageCircle, MoreHorizontal, Plus, Search } from 'lucide-react';
import Link from 'next/link';
import AzureMapsAddressInput, { type AddressSelection } from '../../components/forms/AzureMapsAddressInput';
import { SidePanel } from '../../components/ui/SidePanel';
import { api } from '../../lib/api';
import { StatusBadge } from '../../components/ui/StatusBadge';
import { PageHeader } from '../../components/ui/PageHeader';
import type { StatusTone } from '@workforce/shared';

type CustomerAddress = {
  id: string;
  label: 'דירה ישנה' | 'דירה חדשה' | 'מחסן' | 'משרד' | 'אחר';
  fullAddress: string;
  floor?: string;
  apartment?: string;
  location?: { latitude: number; longitude: number };
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
  updatedAt?: string;
};

type CustomerCaseFilter = 'all' | Customer['caseStatus'] | 'not_executed';
type CustomerSortColumn = 'name' | 'contact' | 'address' | 'status' | 'updated';
type SortDirection = 'asc' | 'desc';

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
  internalNotes?: string | null;
  updatedAt?: string;
  identifierType?: 'ISRAELI_ID' | 'COMPANY_NUMBER' | null;
  identifierNumber?: string | null;
  cases?: ApiCase[];
  addresses?: ApiAddress[];
};

type QuoteContext = {
  customerName: string;
  email: string | null;
  phone: string;
  address: string;
  identifierType: 'ISRAELI_ID' | 'COMPANY_NUMBER' | null;
  identifierNumber: string | null;
  jobs: Array<{
    id: string;
    date: string;
    jobType: ApiJob['jobType'];
    status: ApiJob['status'];
    address: { fullAddress: string };
  }>;
};

type CustomerQuote = {
  id: string;
  customerName: string;
  customerAddress: string;
  identifierType: 'ISRAELI_ID' | 'COMPANY_NUMBER';
  identifierNumber: string;
  jobIds: string[];
  totalAmount: string | number;
  notes?: string | null;
  createdAt: string;
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

function mapApiJobStatus(status: ApiJob['status'], date: string): RelatedWork['status'] {
  if (status === 'COMPLETED' || status === 'ARCHIVED') return 'בוצע';
  if (status === 'APPROVED') {
    const jobDate = new Date(date);
    const today = new Date();
    jobDate.setHours(0, 0, 0, 0);
    today.setHours(0, 0, 0, 0);
    return jobDate.getTime() > today.getTime() ? 'מתוכנן' : 'בביצוע';
  }
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
    notes: apiCustomer.internalNotes ?? undefined,
    updatedAt: apiCustomer.updatedAt,
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

function normalizeSearchText(value: string) {
  return value
    .normalize('NFKC')
    .toLocaleLowerCase('he')
    .replace(/[^\p{L}\p{N}@.]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
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
  const [sortColumn, setSortColumn] = useState<CustomerSortColumn>('updated');
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc');
  const [notExecutedCustomers, setNotExecutedCustomers] = useState<Set<string>>(new Set());
  const [openedCustomerId, setOpenedCustomerId] = useState<string | null>(null);
  const [isCreatingNew, setIsCreatingNew] = useState(false);
  const [customerEditing, setCustomerEditing] = useState(false);
  const [cardMessage, setCardMessage] = useState('');
  const [cardNotes, setCardNotes] = useState('');
  const [customerReports, setCustomerReports] = useState<{
    ready: { caseId: string; jobCount: number; latestJobDate: string | null }[];
    closed: { caseId: string; latestVersion: number; finalAmount: number | null }[];
  }>({ ready: [], closed: [] });
  const [isLoadingReports, setIsLoadingReports] = useState(false);
  const [customerQuotes, setCustomerQuotes] = useState<CustomerQuote[]>([]);
  const [documentsOpen, setDocumentsOpen] = useState(false);
  const [addressesOpen, setAddressesOpen] = useState(false);
  const [quoteFormOpen, setQuoteFormOpen] = useState(false);
  const [quoteContext, setQuoteContext] = useState<QuoteContext | null>(null);
  const [quoteIdentifierType, setQuoteIdentifierType] = useState<'ISRAELI_ID' | 'COMPANY_NUMBER'>('ISRAELI_ID');
  const [quoteIdentifierNumber, setQuoteIdentifierNumber] = useState('');
  const [quoteJobIds, setQuoteJobIds] = useState<string[]>([]);
  const [quoteTotalAmount, setQuoteTotalAmount] = useState('');
  const [quoteNotes, setQuoteNotes] = useState('');
  const [quoteSaving, setQuoteSaving] = useState(false);
  const [savingCustomer, setSavingCustomer] = useState(false);

  const [cardFirstName, setCardFirstName] = useState('');
  const [cardLastName, setCardLastName] = useState('');
  const [cardPhone, setCardPhone] = useState('');
  const [cardEmail, setCardEmail] = useState('');
  const [cardCaseName, setCardCaseName] = useState('');
  const [cardAddressLabel, setCardAddressLabel] = useState<CustomerAddress['label']>('דירה חדשה');
  const [cardAddressInput, setCardAddressInput] = useState('');
  const [cardAddressSelection, setCardAddressSelection] = useState<AddressSelection | null>(null);
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
    if (openedCustomerId) {
      void loadCustomerReports(openedCustomerId);
      void loadCustomerQuotes(openedCustomerId);
    }
  }, [openedCustomerId]);

  // Load the customer's jobs when the עבודות tab opens. Jobs are queried directly
  // by the customer relationship (GET /jobs?customerId=), not through legacy
  // project/case UI — so a job created via Quick Create appears immediately.
  useEffect(() => {
    if (openedCustomerId) void loadRelatedWorks(openedCustomerId);
  }, [openedCustomerId]);

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
          status: mapApiJobStatus(job.status, job.date),
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

  async function loadCustomerQuotes(customerId: string) {
    try {
      const res = await api.get<CustomerQuote[]>(`/customers/${customerId}/quotes`);
      setCustomerQuotes(res.data);
    } catch {
      setCustomerQuotes([]);
    }
  }

  async function openQuoteForm(customerId: string) {
    setCardMessage('');
    try {
      const res = await api.get<QuoteContext>(`/customers/${customerId}/quote-context`);
      if (res.data.jobs.length === 0) {
        setCardMessage('אפשר ליצור הצעת מחיר לאחר שנוצרה לפחות עבודה אחת ללקוחה.');
        return;
      }
      setQuoteContext(res.data);
      setQuoteIdentifierType(res.data.identifierType ?? 'ISRAELI_ID');
      setQuoteIdentifierNumber(res.data.identifierNumber ?? '');
      setQuoteJobIds(res.data.jobs.map((job) => job.id));
      setQuoteTotalAmount('');
      setQuoteNotes('');
      setQuoteFormOpen(true);
      setDocumentsOpen(false);
    } catch {
      setCardMessage('לא ניתן לטעון את פרטי הצעת המחיר.');
    }
  }

  async function saveQuote() {
    if (!openedCustomerId || !quoteContext) return;
    if (!/^\d{9}$/.test(quoteIdentifierNumber)) {
      setCardMessage('יש להזין מספר בן 9 ספרות.');
      return;
    }
    const totalAmount = Number(quoteTotalAmount);
    if (!Number.isFinite(totalAmount) || totalAmount <= 0) {
      setCardMessage('יש להזין סכום הצעה תקין.');
      return;
    }
    if (quoteJobIds.length === 0) {
      setCardMessage('יש לבחור לפחות עבודה אחת להצעה.');
      return;
    }

    setQuoteSaving(true);
    setCardMessage('');
    try {
      await api.post(`/customers/${openedCustomerId}/quotes`, {
        identifierType: quoteIdentifierType,
        identifierNumber: quoteIdentifierNumber,
        jobIds: quoteJobIds,
        totalAmount,
        ...(quoteNotes.trim() ? { notes: quoteNotes.trim() } : {}),
      });
      await loadCustomerQuotes(openedCustomerId);
      setQuoteFormOpen(false);
      setDocumentsOpen(true);
      setCardMessage('הצעת המחיר נשמרה במסמכי הלקוחה.');
    } catch {
      setCardMessage('שמירת הצעת המחיר נכשלה.');
    } finally {
      setQuoteSaving(false);
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
    if (openedCustomer && customerEditing) {
      return (
        cardFirstName !== openedCustomer.firstName ||
        cardLastName !== openedCustomer.lastName ||
        cardPhone !== openedCustomer.phone ||
        cardEmail !== openedCustomer.email ||
        Boolean(cardAddressInput.trim())
      );
    }
    return false;
  }, [isCreatingNew, customerEditing, openedCustomer, cardFirstName, cardLastName, cardPhone, cardEmail, cardAddressInput]);

  const filteredCustomers = useMemo(() => {
    const term = normalizeSearchText(searchTerm);
    const phoneTerm = normalizePhone(searchTerm);
    const isPhoneSearch = phoneTerm.length > 0 && /^[\d\s()+.-]+$/.test(searchTerm.trim());
    const filtered = customers.filter((customer) => {
      const isNotExecuted = notExecutedCustomers.has(getCustomerFullName(customer));
      if (statusFilter === 'not_executed' && !isNotExecuted) return false;
      if (statusFilter !== 'all' && statusFilter !== 'not_executed' && customer.caseStatus !== statusFilter) return false;
      if (!term) return true;
      const fullName = normalizeSearchText(`${customer.firstName} ${customer.lastName}`);
      return (
        fullName.includes(term) ||
        (isPhoneSearch && normalizePhone(customer.phone).includes(phoneTerm)) ||
        normalizeSearchText(customer.email).includes(term) ||
        customer.addresses.some((address) => normalizeSearchText(address.fullAddress).includes(term))
      );
    });
    return filtered.sort((a, b) => {
      let result = 0;
      if (sortColumn === 'name') {
        result = getCustomerFullName(a).localeCompare(getCustomerFullName(b), 'he');
      } else if (sortColumn === 'contact') {
        result = normalizePhone(a.phone).localeCompare(normalizePhone(b.phone), 'he');
        if (result === 0) result = a.email.localeCompare(b.email, 'he');
      } else if (sortColumn === 'address') {
        result = (a.addresses[0]?.fullAddress ?? '').localeCompare(b.addresses[0]?.fullAddress ?? '', 'he');
      } else if (sortColumn === 'status') {
        result = caseStatusMeta[a.caseStatus].label.localeCompare(caseStatusMeta[b.caseStatus].label, 'he');
      } else {
        const aTime = a.updatedAt ? new Date(a.updatedAt).getTime() : 0;
        const bTime = b.updatedAt ? new Date(b.updatedAt).getTime() : 0;
        result = aTime - bTime;
      }
      return sortDirection === 'asc' ? result : -result;
    });
  }, [customers, notExecutedCustomers, searchTerm, sortColumn, sortDirection, statusFilter]);

  const requestSort = (column: CustomerSortColumn) => {
    if (sortColumn === column) {
      setSortDirection((current) => (current === 'asc' ? 'desc' : 'asc'));
      return;
    }
    setSortColumn(column);
    setSortDirection(column === 'updated' ? 'desc' : 'asc');
  };

  const sortIcon = (column: CustomerSortColumn) => {
    if (sortColumn !== column) return <ChevronsUpDown className="h-3.5 w-3.5 text-gray-400" aria-hidden="true" />;
    return sortDirection === 'asc'
      ? <ArrowUp className="h-3.5 w-3.5 text-primary-700" aria-hidden="true" />
      : <ArrowDown className="h-3.5 w-3.5 text-primary-700" aria-hidden="true" />;
  };

  const sortableHeader = (column: CustomerSortColumn, label: string) => (
    <button
      type="button"
      onClick={() => requestSort(column)}
      className="inline-flex items-center gap-1.5 py-1 font-medium text-gray-600 hover:text-gray-950"
      aria-label={`מיון לפי ${label}${sortColumn === column ? `, ${sortDirection === 'asc' ? 'עולה' : 'יורד'}` : ''}`}
    >
      <span>{label}</span>
      {sortIcon(column)}
    </button>
  );

  const openCustomerCard = (customer: Customer) => {
    setOpenedCustomerId(customer.id);
    setIsCreatingNew(false);
    setCustomerEditing(false);
    setCardMessage('');
    setDocumentsOpen(false);
    setAddressesOpen(false);
    setQuoteFormOpen(false);
    setQuoteContext(null);
    setCardFirstName(customer.firstName);
    setCardLastName(customer.lastName);
    setCardPhone(customer.phone);
    setCardEmail(customer.email);
    setCardAddressInput('');
    setCardAddressSelection(null);
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

  useEffect(() => {
    const customerId = new URLSearchParams(window.location.search).get('customerId');
    if (!customerId) return;
    const customer = customers.find((candidate) => candidate.id === customerId);
    if (!customer) return;
    openCustomerCard(customer);
    window.history.replaceState({}, '', window.location.pathname);
  }, [customers]);

  const openCreateCustomerCard = () => {
    setOpenedCustomerId(null);
    setIsCreatingNew(true);
    setCustomerEditing(true);
    setCardMessage('');
    setCardFirstName('');
    setCardLastName('');
    setCardPhone('');
    setCardEmail('');
    setCardCaseName('');
    setCardNotes('');
    setCardAddressLabel('דירה חדשה');
    setCardAddressInput('');
    setCardAddressSelection(null);
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
          ...(cardAddressSelection ? { selectionToken: cardAddressSelection.token } : {}),
        });
      }

      await loadData();
      if (customerId) setOpenedCustomerId(customerId);
      setIsCreatingNew(false);
      setCardAddressInput('');
      setCardAddressSelection(null);
      setCardAddressFloor('');
      setCardAddressApartment('');
      setCustomerEditing(false);
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
      <PageHeader
        eyebrow="HOMES, STORIES, RELATIONSHIPS"
        title="הלקוחות שלנו"
        description="פרטי קשר, כתובת עדכנית ומסמכים במקום אחד."
        icon={<Contact className="h-6 w-6" />}
        action={
          <button
            type="button"
            onClick={openCreateCustomerCard}
            className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-primary-600 px-5 py-2.5 text-sm font-semibold text-white shadow-[0_6px_16px_rgba(78,105,92,0.18)] hover:bg-primary-700"
          >
            <Plus className="w-4 h-4" />
            לקוח חדש
          </button>
        }
      />

      <div className="overflow-hidden border-y border-[var(--color-border)] bg-[var(--color-surface-muted)]">
        <div className="border-b border-[var(--color-border)] px-5 py-5">
          <h3 className="font-display text-2xl font-medium text-gray-900">ספר הלקוחות</h3>
          <div className="relative mt-4 max-w-2xl">
              <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              <input
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full border-0 border-b border-[var(--color-border-strong)] bg-transparent py-2.5 pl-3 pr-9 text-sm text-right outline-none transition-colors placeholder:text-gray-400 focus:border-primary-600"
                placeholder="חיפוש לפי שם, טלפון, אימייל או כתובת"
                aria-label="חיפוש לקוחות"
              />
          </div>
        </div>

        <div className="max-h-[620px] overflow-auto">
          <table className="w-full min-w-[900px] border-collapse text-right text-sm">
            <thead className="sticky top-0 z-10 bg-[var(--color-surface-muted)] text-xs text-gray-500">
              <tr className="border-b border-[var(--color-border-strong)]">
                <th className="px-5 py-3">{sortableHeader('name', 'לקוחה')}</th>
                <th className="px-4 py-3">{sortableHeader('contact', 'טלפון ואימייל')}</th>
                <th className="px-4 py-3">{sortableHeader('address', 'כתובת')}</th>
                <th className="px-4 py-3">
                  <div className="flex items-center gap-2">
                    {sortableHeader('status', 'סטטוס')}
                    <select
                      value={statusFilter}
                      onChange={(event) => setStatusFilter(event.target.value as CustomerCaseFilter)}
                      className="max-w-28 border-0 border-b border-[var(--color-border-strong)] bg-transparent py-1 text-[11px] text-gray-600 outline-none focus:border-primary-600"
                      aria-label="סינון לפי סטטוס"
                    >
                      <option value="all">הכול</option>
                      <option value="none">ללא פרויקט</option>
                      <option value="planned">משוריין</option>
                      <option value="in_progress">מאושר לביצוע</option>
                      <option value="completed_unpaid">עבודה הסתיימה</option>
                      <option value="completed_paid">עבודה שולמה</option>
                      <option value="not_executed">לא בוצעה</option>
                    </select>
                  </div>
                </th>
                <th className="px-5 py-3">{sortableHeader('updated', 'עודכן')}</th>
              </tr>
            </thead>
            <tbody>
              {filteredCustomers.map((customer) => {
                const statusMeta = caseStatusMeta[customer.caseStatus];
                const isNotExecuted = notExecutedCustomers.has(getCustomerFullName(customer));
                const primaryAddress = customer.addresses[0]?.fullAddress ?? '—';
                return (
                  <tr
                    key={customer.id}
                    role="button"
                    tabIndex={0}
                    onClick={() => openCustomerCard(customer)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' || event.key === ' ') openCustomerCard(customer);
                    }}
                    className="cursor-pointer border-b border-[var(--color-border)] transition-colors hover:bg-primary-50/50 focus:bg-primary-50/50 focus:outline-none"
                  >
                    <td className="px-5 py-4">
                      <span className="font-display text-lg font-medium text-gray-900">{customer.firstName} {customer.lastName}</span>
                    </td>
                    <td className="px-4 py-4 text-gray-700">
                      <span className="block">{customer.phone}</span>
                      <span className="mt-1 block text-xs text-gray-500">{customer.email || 'ללא אימייל'}</span>
                    </td>
                    <td className="max-w-64 px-4 py-4 text-gray-700">
                      <span className="line-clamp-2">{primaryAddress}</span>
                      {customer.addresses.length > 1 && <span className="mt-1 block text-xs text-gray-500">ועוד {customer.addresses.length - 1}</span>}
                    </td>
                    <td className="px-4 py-4">
                      <StatusBadge tone={isNotExecuted ? 'error' : statusMeta.tone} label={isNotExecuted ? 'עבודה לא בוצעה' : statusMeta.label} />
                    </td>
                    <td className="whitespace-nowrap px-5 py-4 text-xs text-gray-500">
                      {customer.updatedAt ? new Date(customer.updatedAt).toLocaleString('he-IL', { dateStyle: 'short', timeStyle: 'short' }) : '—'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {filteredCustomers.length === 0 && (
            <p className="px-5 py-8 text-center text-sm text-gray-400">לא נמצאו לקוחות לפי החיפוש.</p>
          )}
        </div>
      </div>

      <SidePanel
        open={Boolean(openedCustomer || isCreatingNew)}
        onClose={() => {
          setOpenedCustomerId(null);
          setIsCreatingNew(false);
          setCustomerEditing(false);
          setCardMessage('');
        }}
        title={isCreatingNew ? 'יצירת לקוח חדש' : 'כרטיס לקוח'}
        hasUnsavedChanges={detailsDirty}
        widthClassName="sm:max-w-xl"
      >
            <div className="space-y-0 p-6 text-right">
              {openedCustomer && !isCreatingNew && (
                <section className="border-y border-[var(--color-border-strong)] bg-[var(--color-surface-muted)] px-4 py-4">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-primary-700">WORK CARD</p>
                      <h2 className="mt-1 font-display text-2xl font-medium text-gray-900">{openedCustomer.firstName} {openedCustomer.lastName}</h2>
                    </div>
                    <div className="flex flex-wrap items-center justify-end gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          setDocumentsOpen((open) => !open);
                          setQuoteFormOpen(false);
                        }}
                        className="inline-flex items-center gap-1.5 rounded-md border border-[var(--color-border)] px-2.5 py-1.5 text-xs font-semibold text-gray-700 hover:border-primary-500"
                      >
                        <FileText className="h-3.5 w-3.5" />
                        מסמכים
                      </button>
                      <button
                        type="button"
                        onClick={() => void openQuoteForm(openedCustomer.id)}
                        className="rounded-md bg-primary-600 px-2.5 py-1.5 text-xs font-semibold text-white hover:bg-primary-700"
                      >
                        הצעת מחיר חדשה
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          if (customerEditing) openCustomerCard(openedCustomer);
                          else setCustomerEditing(true);
                        }}
                        className="border-b border-gray-700 px-1 py-1 text-xs font-semibold text-gray-700 hover:text-primary-700"
                      >
                        {customerEditing ? 'ביטול עריכה' : 'עריכת פרטים'}
                      </button>
                    </div>
                  </div>
                  <dl className="mt-4 grid grid-cols-2 gap-x-5 gap-y-3 border-t border-[var(--color-border)] pt-4 text-xs sm:grid-cols-3">
                    <div><dt className="text-gray-400">טלפון</dt><dd className="mt-1 font-medium text-gray-800">{openedCustomer.phone}</dd></div>
                    <div><dt className="text-gray-400">אימייל</dt><dd className="mt-1 truncate font-medium text-gray-800">{openedCustomer.email || 'ללא אימייל'}</dd></div>
                    <div><dt className="text-gray-400">סטטוס</dt><dd className="mt-1"><StatusBadge tone={caseStatusMeta[openedCustomer.caseStatus].tone} label={caseStatusMeta[openedCustomer.caseStatus].label} /></dd></div>
                    <div className="relative sm:col-span-2">
                      <dt className="flex items-center gap-1 text-gray-400">
                        כתובת עדכנית
                        {openedCustomer.addresses.length > 1 && (
                          <button
                            type="button"
                            onClick={() => setAddressesOpen((open) => !open)}
                            aria-label="הצגת כתובות נוספות"
                            className="inline-flex h-5 w-5 items-center justify-center rounded-full hover:bg-[var(--color-background)]"
                          >
                            <MoreHorizontal className="h-3.5 w-3.5" />
                          </button>
                        )}
                      </dt>
                      <dd className="mt-1 font-medium text-gray-800">{openedCustomer.addresses[0]?.fullAddress ?? 'אין כתובת שמורה'}</dd>
                      {addressesOpen && openedCustomer.addresses.length > 1 && (
                        <div className="absolute right-0 top-11 z-20 w-full max-w-sm rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] p-2 shadow-lg">
                          {openedCustomer.addresses.slice(1).map((address) => (
                            <div key={address.id} className="border-b border-[var(--color-border)] px-1 py-2 last:border-0">
                              <p className="text-[10px] text-gray-400">{address.label}</p>
                              <p className="mt-0.5 text-xs text-gray-800">{address.fullAddress}</p>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                    <div><dt className="text-gray-400">עדכון אחרון</dt><dd className="mt-1 font-medium text-gray-800">{openedCustomer.updatedAt ? new Date(openedCustomer.updatedAt).toLocaleString('he-IL', { dateStyle: 'short', timeStyle: 'short' }) : '—'}</dd></div>
                  </dl>
                </section>
              )}

              {(isCreatingNew || customerEditing) && (
                <section className="space-y-4 border-b border-[var(--color-border)] py-5">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <input value={cardFirstName} onChange={(e) => setCardFirstName(e.target.value)} className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-right" placeholder="שם פרטי" />
                    <input value={cardLastName} onChange={(e) => setCardLastName(e.target.value)} className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-right" placeholder="שם משפחה" />
                    <input value={cardPhone} onChange={(e) => setCardPhone(e.target.value)} className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-right" placeholder="טלפון" inputMode="tel" />
                    <input value={cardEmail} onChange={(e) => setCardEmail(e.target.value)} className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-right" placeholder="אימייל (אופציונלי)" inputMode="email" />
                  </div>

                  <div className="space-y-3 border-y border-[var(--color-border)] py-4">
                    <p className="text-xs font-medium text-gray-700">הוספת כתובת</p>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <select value={cardAddressLabel} onChange={(e) => setCardAddressLabel(e.target.value as CustomerAddress['label'])} className="sm:col-span-2 rounded-lg border border-gray-300 bg-[var(--color-surface)] px-3 py-2 text-sm">
                        <option value="דירה ישנה">דירה ישנה</option>
                        <option value="דירה חדשה">דירה חדשה</option>
                        <option value="מחסן">מחסן</option>
                        <option value="משרד">משרד</option>
                        <option value="אחר">אחר</option>
                      </select>
                      <div className="sm:col-span-2">
                        <AzureMapsAddressInput
                          value={cardAddressInput}
                          onChange={(value) => {
                            setCardAddressInput(value);
                            if (value !== cardAddressSelection?.displayAddress) setCardAddressSelection(null);
                          }}
                          onSelectionChange={setCardAddressSelection}
                          className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-right"
                          placeholder={isCreatingNew ? 'עיר או כתובת מלאה' : 'הוספת כתובת חדשה (אופציונלי)'}
                        />
                        <span className="mt-1 block text-[11px] text-gray-500">
                          בחירת כתובת מלאה עם עיר, רחוב ומספר בית מאמתת אותה אוטומטית.
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

                  {!isCreatingNew && (
                    <label className="block text-xs text-gray-600">
                      הערות פנימיות
                      <textarea
                        value={cardNotes}
                        onChange={(e) => setCardNotes(e.target.value)}
                        className="mt-1 min-h-28 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-right"
                        placeholder="רגישויות, העדפות או פרטים תפעוליים"
                      />
                    </label>
                  )}

                  <button
                    type="button"
                    onClick={() => void saveCustomer()}
                    disabled={savingCustomer}
                    className="px-4 py-2 text-sm rounded-lg bg-primary-600 text-white hover:bg-primary-700 disabled:opacity-50"
                  >
                    {savingCustomer ? 'שומר…' : isCreatingNew ? 'יצירת לקוח' : 'שמירת שינויים'}
                  </button>
                </section>
              )}

              {openedCustomer && quoteFormOpen && quoteContext && (
                <section className="space-y-4 border-b border-[var(--color-border)] py-5">
                  <div className="flex items-center justify-between">
                    <h3 className="text-sm font-semibold text-gray-900">הצעת מחיר חדשה</h3>
                    <button type="button" onClick={() => setQuoteFormOpen(false)} className="text-xs text-gray-500 hover:text-gray-900">
                      ביטול
                    </button>
                  </div>
                  <dl className="grid grid-cols-2 gap-3 rounded-md bg-[var(--color-surface-muted)] p-3 text-xs">
                    <div><dt className="text-gray-400">לקוחה</dt><dd className="mt-1 font-medium text-gray-900">{quoteContext.customerName}</dd></div>
                    <div><dt className="text-gray-400">טלפון</dt><dd className="mt-1 font-medium text-gray-900">{quoteContext.phone}</dd></div>
                    <div><dt className="text-gray-400">אימייל</dt><dd className="mt-1 font-medium text-gray-900">{quoteContext.email || 'ללא אימייל'}</dd></div>
                    <div><dt className="text-gray-400">כתובת</dt><dd className="mt-1 font-medium text-gray-900">{quoteContext.address || 'ללא כתובת'}</dd></div>
                  </dl>
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <label className="text-xs text-gray-600">
                      סוג מזהה
                      <select
                        value={quoteIdentifierType}
                        onChange={(event) => setQuoteIdentifierType(event.target.value as 'ISRAELI_ID' | 'COMPANY_NUMBER')}
                        className="mt-1 w-full rounded-md border border-[var(--color-border-strong)] bg-[var(--color-surface)] px-3 py-2 text-sm"
                      >
                        <option value="ISRAELI_ID">תעודת זהות</option>
                        <option value="COMPANY_NUMBER">ח.פ.</option>
                      </select>
                    </label>
                    <label className="text-xs text-gray-600">
                      {quoteIdentifierType === 'ISRAELI_ID' ? 'מספר תעודת זהות' : 'מספר חברה'}
                      <input
                        value={quoteIdentifierNumber}
                        onChange={(event) => setQuoteIdentifierNumber(event.target.value.replace(/\D/g, '').slice(0, 9))}
                        inputMode="numeric"
                        className="mt-1 w-full rounded-md border border-[var(--color-border-strong)] px-3 py-2 text-sm"
                      />
                    </label>
                  </div>
                  <div>
                    <p className="mb-2 text-xs font-medium text-gray-700">עבודות בהצעה</p>
                    <div className="space-y-1.5">
                      {quoteContext.jobs.map((job) => (
                        <label key={job.id} className="flex items-center gap-2 rounded-md border border-[var(--color-border)] px-3 py-2 text-xs text-gray-700">
                          <input
                            type="checkbox"
                            checked={quoteJobIds.includes(job.id)}
                            onChange={(event) => setQuoteJobIds((current) => (
                              event.target.checked ? [...current, job.id] : current.filter((id) => id !== job.id)
                            ))}
                          />
                          <span>{new Date(job.date).toLocaleDateString('he-IL')} · {mapApiJobTypeToUi(job.jobType)} · {job.address.fullAddress}</span>
                        </label>
                      ))}
                    </div>
                  </div>
                  <label className="block text-xs text-gray-600">
                    סכום הצעה
                    <input
                      value={quoteTotalAmount}
                      onChange={(event) => setQuoteTotalAmount(event.target.value)}
                      type="number"
                      min="1"
                      step="0.01"
                      className="mt-1 w-full rounded-md border border-[var(--color-border-strong)] px-3 py-2 text-sm"
                    />
                  </label>
                  <label className="block text-xs text-gray-600">
                    הערות
                    <textarea
                      value={quoteNotes}
                      onChange={(event) => setQuoteNotes(event.target.value)}
                      maxLength={2000}
                      className="mt-1 min-h-20 w-full rounded-md border border-[var(--color-border-strong)] px-3 py-2 text-sm"
                    />
                  </label>
                  {cardMessage && <p className="text-xs text-rose-700">{cardMessage}</p>}
                  <button
                    type="button"
                    onClick={() => void saveQuote()}
                    disabled={quoteSaving}
                    className="w-full rounded-md bg-primary-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-primary-700 disabled:opacity-50"
                  >
                    {quoteSaving ? 'שומרת…' : 'שמירת הצעת מחיר'}
                  </button>
                </section>
              )}

              {openedCustomer && documentsOpen && (
                <section className="space-y-3 border-b border-[var(--color-border)] py-5">
                  <h3 className="text-sm font-semibold text-gray-900">מסמכי הלקוחה</h3>
                  {isLoadingReports ? (
                    <p className="text-xs text-gray-400">טוענת מסמכים…</p>
                  ) : customerQuotes.length === 0 && customerReports.ready.length === 0 && customerReports.closed.length === 0 ? (
                    <p className="text-xs text-gray-400">אין מסמכים שמורים.</p>
                  ) : (
                    <div className="space-y-2">
                      {customerQuotes.map((quote) => (
                        <article key={quote.id} className="rounded-md border border-[var(--color-border)] bg-[var(--color-surface-muted)] px-3 py-2">
                          <div className="flex items-center justify-between gap-3">
                            <p className="text-xs font-semibold text-gray-900">הצעת מחיר</p>
                            <span className="text-[10px] text-gray-400">{new Date(quote.createdAt).toLocaleDateString('he-IL')}</span>
                          </div>
                          <p className="mt-1 text-xs text-gray-600">
                            {Number(quote.totalAmount).toLocaleString('he-IL')} ₪ · {quote.jobIds.length} עבודות
                          </p>
                        </article>
                      ))}
                      {customerReports.ready.map((report) => (
                        <Link key={report.caseId} href={`/cases/${report.caseId}/customer-report`} className="block rounded-md border border-[var(--color-border)] px-3 py-2 text-xs text-gray-800 hover:border-primary-400">
                          דוח לקוחה להכנה · {report.jobCount} עבודות
                        </Link>
                      ))}
                      {customerReports.closed.map((report) => (
                        <Link key={report.caseId} href={`/cases/${report.caseId}/customer-report`} className="block rounded-md border border-[var(--color-border)] px-3 py-2 text-xs text-gray-800 hover:border-primary-400">
                          דוח לקוחה גרסה {report.latestVersion}
                        </Link>
                      ))}
                    </div>
                  )}
                </section>
              )}

              {openedCustomer && (
                <details className="border-b border-[var(--color-border)] py-4">
                  <summary className="cursor-pointer text-xs font-semibold text-gray-700">
                    עבודות ({relatedWorks.length})
                  </summary>
                  <div className="mt-4 space-y-4">
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
                          {items.map((work) => (
                            <Link
                              key={work.id}
                              href={`/jobs/${work.id}`}
                              className="block border-b border-[var(--color-border)] px-1 py-2 hover:border-primary-400"
                            >
                              <p className="text-sm font-semibold text-gray-900">{work.jobType} • {work.date}</p>
                              {work.address && <p className="mt-1 text-xs text-gray-600">{work.address}</p>}
                            </Link>
                          ))}
                        </div>
                      ))
                    )}
                  </div>
                </details>
              )}

              {!isCreatingNew && (
                <details className="border-b border-[var(--color-border)] py-4">
                  <summary className="cursor-pointer text-xs font-semibold text-gray-700">תקשורת עם הלקוחה</summary>
                  <div className="mt-4 space-y-3">
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => setChannel('email')}
                      className={`inline-flex items-center gap-1.5 border-b px-2 py-1.5 text-xs ${channel === 'email' ? 'border-primary-700 text-primary-800' : 'border-gray-300 text-gray-600'}`}
                    >
                      <Mail className="w-3.5 h-3.5" />
                      אימייל
                    </button>
                    <button
                      type="button"
                      onClick={() => setChannel('whatsapp')}
                      className={`inline-flex items-center gap-1.5 border-b px-2 py-1.5 text-xs ${channel === 'whatsapp' ? 'border-primary-700 text-primary-800' : 'border-gray-300 text-gray-600'}`}
                    >
                      <MessageCircle className="w-3.5 h-3.5" />
                      וואטסאפ
                    </button>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                    <select value={template} onChange={(e) => applyTemplate(e.target.value as TemplateKey)} className="rounded-lg border border-gray-300 bg-[var(--color-surface)] px-3 py-2 text-sm">
                      <option value="quote">תבנית: הצעת מחיר</option>
                      <option value="summary">תבנית: סיכום עבודה</option>
                      <option value="custom">תבנית: הודעה חופשית</option>
                    </select>
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
                </details>
              )}

              {!isCreatingNew && openedCustomer && !customerEditing && (
                <section className="border-y border-[var(--color-border)] py-4">
                  <h3 className="text-xs font-semibold text-gray-700">הערות פנימיות</h3>
                  <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-gray-700">{openedCustomer.notes || 'אין הערות פנימיות.'}</p>
                </section>
              )}

              {!quoteFormOpen && cardMessage && (
                <p className={`text-sm ${cardMessage.includes('בהצלחה') || cardMessage.includes('נשמר') || cardMessage.includes('נשלח') || cardMessage.includes('נפתח') ? 'text-emerald-700' : 'text-rose-700'}`}>
                  {cardMessage}
                </p>
              )}
            </div>
      </SidePanel>
    </div>
  );
}

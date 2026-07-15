'use client';

import { useEffect, useMemo, useState } from 'react';
import { Mail, MessageCircle, Plus, Search } from 'lucide-react';
import AzureMapsAddressInput, { type AddressSelection } from '../../components/forms/AzureMapsAddressInput';
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
  caseStatus: 'planned' | 'in_progress' | 'completed_unpaid' | 'completed_paid' | 'cancelled';
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
  email: string;
  cases?: ApiCase[];
  addresses?: ApiAddress[];
};

type ApiJob = {
  id: string;
  date: string;
  jobType: 'PACKING' | 'UNPACKING' | 'HOME_ORGANIZATION';
  status: 'DRAFT' | 'PUBLISHED' | 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED';
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
function cleanEmail(email: string): string {
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
  if (status === 'COMPLETED' || status === 'CANCELLED') return 'בוצע';
  if (status === 'IN_PROGRESS') return 'בביצוע';
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
    caseStatus: representativeCase ? mapApiCaseStatus(representativeCase.status) : 'planned',
  };
}

const caseStatusMeta: Record<Customer['caseStatus'], { label: string; helper: string; tone: StatusTone }> = {
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
  const [cardTab, setCardTab] = useState<'details' | 'works' | 'communication' | 'notes'>('details');
  const [cardMessage, setCardMessage] = useState('');
  const [cardNotes, setCardNotes] = useState('');

  const [cardFirstName, setCardFirstName] = useState('');
  const [cardLastName, setCardLastName] = useState('');
  const [cardPhone, setCardPhone] = useState('');
  const [cardEmail, setCardEmail] = useState('');
  const [cardCaseName, setCardCaseName] = useState('');
  const [cardCaseStatus, setCardCaseStatus] = useState<Customer['caseStatus']>('planned');
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
        })),
      );
    } catch {
      setRelatedWorks([]);
    } finally {
      setIsLoadingWorks(false);
    }
  }

  const getCustomerFullName = (customer: Customer) => `${customer.firstName} ${customer.lastName}`.trim();

  const openedCustomer = useMemo(
    () => customers.find((customer) => customer.id === openedCustomerId) ?? null,
    [customers, openedCustomerId],
  );

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
    setCardAddressSelection(null);
    setCardAddressFloor('');
    setCardAddressApartment('');
    setCardAddressLabel('דירה חדשה');
    setChannel('email');
    setTemplate('quote');
    setCardCaseName(customer.caseName);
    setCardCaseStatus(customer.caseStatus);
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
    setCardCaseStatus('planned');
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

  const saveCustomer = () => {
    setCardMessage('');

    if (!cardFirstName.trim() || !cardLastName.trim()) {
      setCardMessage('יש למלא שם פרטי ושם משפחה.');
      return;
    }
    if (!isValidIsraeliPhone(cardPhone)) {
      setCardMessage('מספר הטלפון לא תקין.');
      return;
    }
    if (!isValidEmail(cardEmail)) {
      setCardMessage('כתובת האימייל לא תקינה.');
      return;
    }

    if (isCreatingNew) {
      const duplicate = customers.find(
        (customer) =>
          normalizePhone(customer.phone) === normalizePhone(cardPhone) || customer.email.trim().toLowerCase() === cardEmail.trim().toLowerCase(),
      );
      if (duplicate) {
        setCardMessage('נמצא לקוח קיים עם טלפון/אימייל דומה. מומלץ לבחור אותו מהרשימה.');
        return;
      }
      if (!cardAddressInput.trim()) {
        setCardMessage('ביצירת לקוח חדש יש להזין לפחות כתובת אחת.');
        return;
      }
      if (!cardAddressSelection) {
        setCardMessage('יש לבחור כתובת מתוך תוצאות Azure Maps (לא טקסט חופשי בלבד).');
        return;
      }

      const created: Customer = {
        id: `c-${Date.now()}`,
        firstName: cardFirstName.trim(),
        lastName: cardLastName.trim(),
        phone: cardPhone.trim(),
        email: cardEmail.trim(),
        caseName: cardCaseName.trim() || `${cardFirstName.trim()} ${cardLastName.trim()} - פרוייקט חדש`,
        caseStatus: cardCaseStatus,
        notes: cardNotes.trim() || undefined,
        addresses: [{
          id: `a-${Date.now()}`,
          label: cardAddressLabel,
          fullAddress: buildAddressWithUnit(cardAddressSelection.formattedAddress, cardAddressFloor, cardAddressApartment),
          floor: cardAddressFloor.trim() || undefined,
          apartment: cardAddressApartment.trim() || undefined,
          location: cardAddressSelection,
        }],
      };
      setCustomers((prev) => [created, ...prev]);
      setOpenedCustomerId(created.id);
      setIsCreatingNew(false);
      setCardAddressInput('');
      setCardAddressFloor('');
      setCardAddressApartment('');
      setCardMessage('הלקוח נוצר בהצלחה.');
      return;
    }

    if (cardAddressInput.trim() && !cardAddressSelection) {
      setCardMessage('כדי להוסיף כתובת חדשה יש לבחור אותה מתוצאות Azure Maps.');
      return;
    }

    setCustomers((prev) =>
      prev.map((customer) =>
        customer.id === openedCustomerId
          ? {
              ...customer,
              firstName: cardFirstName.trim(),
              lastName: cardLastName.trim(),
              phone: cardPhone.trim(),
              email: cardEmail.trim(),
              caseName: cardCaseName.trim() || customer.caseName,
              caseStatus: cardCaseStatus,
              notes: cardNotes.trim() || undefined,
              addresses:
                cardAddressInput.trim()
                  ? [
                      ...customer.addresses,
                      {
                        id: `a-${Date.now()}`,
                        label: cardAddressLabel,
                        fullAddress: buildAddressWithUnit(
                          cardAddressSelection?.formattedAddress ?? cardAddressInput.trim(),
                          cardAddressFloor,
                          cardAddressApartment,
                        ),
                        floor: cardAddressFloor.trim() || undefined,
                        apartment: cardAddressApartment.trim() || undefined,
                        location: cardAddressSelection ?? undefined,
                      },
                    ]
                  : customer.addresses,
            }
          : customer,
      ),
    );
    setCardAddressInput('');
    setCardAddressSelection(null);
    setCardAddressFloor('');
    setCardAddressApartment('');
    setCardMessage('פרטי הלקוח נשמרו בהצלחה.');
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

      {(openedCustomer || isCreatingNew) && (
        <div className="fixed inset-0 z-50 bg-black/30 flex items-start justify-center overflow-y-auto p-4 py-6">
          <div className="w-full max-w-xl rounded-lg border border-gray-200 bg-white shadow-xl max-h-[84vh] overflow-y-auto">
            <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
              <button
                type="button"
                onClick={() => {
                  setOpenedCustomerId(null);
                  setIsCreatingNew(false);
                  setCardMessage('');
                }}
                className="text-xs px-2 py-1 rounded border border-gray-300 text-gray-700 hover:bg-gray-50"
              >
                סגירה
              </button>
              <h3 className="font-semibold text-gray-900">{isCreatingNew ? 'יצירת לקוח חדש' : 'כרטיס לקוח'}</h3>
            </div>

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
                פרויקטים
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
            </div>

            <div className="p-6 space-y-4 text-right">
              {cardTab === 'details' && (
                <>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <input value={cardFirstName} onChange={(e) => setCardFirstName(e.target.value)} className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-right" placeholder="שם פרטי" />
                    <input value={cardLastName} onChange={(e) => setCardLastName(e.target.value)} className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-right" placeholder="שם משפחה" />
                    <input value={cardPhone} onChange={(e) => setCardPhone(e.target.value)} className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-right" placeholder="טלפון" />
                    <input value={cardEmail} onChange={(e) => setCardEmail(e.target.value)} className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-right" placeholder="אימייל" />
                    <input value={cardCaseName} onChange={(e) => setCardCaseName(e.target.value)} className="md:col-span-2 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-right" placeholder="שם פרוייקט" />
                    <select value={cardCaseStatus} onChange={(e) => setCardCaseStatus(e.target.value as Customer['caseStatus'])} className="md:col-span-2 rounded-lg border border-gray-300 px-3 py-2 text-sm bg-white">
                      <option value="planned">סטטוס פרוייקט: משוריין</option>
                      <option value="in_progress">סטטוס פרוייקט: מאושר לביצוע</option>
                      <option value="completed_unpaid">סטטוס פרוייקט: עבודה הסתיימה</option>
                      <option value="completed_paid">סטטוס פרוייקט: עבודה שולמה</option>
                    </select>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
                    <select value={cardAddressLabel} onChange={(e) => setCardAddressLabel(e.target.value as CustomerAddress['label'])} className="rounded-lg border border-gray-300 px-3 py-2 text-sm bg-white">
                      <option value="דירה ישנה">דירה ישנה</option>
                      <option value="דירה חדשה">דירה חדשה</option>
                      <option value="מחסן">מחסן</option>
                      <option value="משרד">משרד</option>
                      <option value="אחר">אחר</option>
                    </select>
                    <AzureMapsAddressInput
                      value={cardAddressInput}
                      onChange={setCardAddressInput}
                      onSelectionChange={setCardAddressSelection}
                      className="md:col-span-3 rounded-lg border border-gray-300 px-3 py-2 text-sm text-right"
                      placeholder={isCreatingNew ? 'כתובת ראשית (חובה)' : 'הוספת כתובת חדשה (אופציונלי)'}
                    />
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
                  {cardAddressSelection && (
                    <p className="text-[11px] text-emerald-700">
                      כתובת מאושרת: {cardAddressSelection.formattedAddress} • {cardAddressSelection.latitude.toFixed(5)}, {cardAddressSelection.longitude.toFixed(5)}
                    </p>
                  )}
                  {!process.env.NEXT_PUBLIC_AZURE_MAPS_KEY && (
                    <p className="text-[11px] text-amber-700">
                      כדי לאפשר בחירת כתובת אוטומטית, הגדירי NEXT_PUBLIC_AZURE_MAPS_KEY.
                    </p>
                  )}

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

                  <button type="button" onClick={saveCustomer} className="px-4 py-2 text-sm rounded-lg bg-primary-600 text-white hover:bg-primary-700">
                    {isCreatingNew ? 'יצירת לקוח' : 'שמירת שינויים'}
                  </button>
                </>
              )}

              {cardTab === 'works' && openedCustomer && (
                <div className="space-y-2">
                  <div className="rounded-lg border border-primary-100 bg-primary-50 px-3 py-2">
                    <p className="text-xs text-primary-700">
                      עבודות קשורות הן ימי עבודה בתוך הפרוייקט. סטטוס הפרוייקט מייצג את מצב הלקוח הכולל (משוריין/מאושר לביצוע/עבודה הסתיימה/עבודה שולמה).
                    </p>
                  </div>
                  {relatedWorks.length === 0 ? (
                    <p className="text-sm text-gray-500">אין עבודות קשורות ללקוח זה כרגע.</p>
                  ) : (
                    relatedWorks.map((work) => (
                      <div key={work.id} className="rounded-lg border border-gray-200 px-3 py-2">
                        <p className="text-sm font-semibold text-gray-900">{work.jobType} • {work.date}</p>
                        <p className="text-xs text-gray-600 mt-1">{work.address}</p>
                        <p className="text-xs text-primary-700 mt-1">סטטוס: {work.status}</p>
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

              {(openedCustomer || !isCreatingNew) && cardCaseName && (
                <div className="text-xs">
                  <p className="text-gray-600">פרוייקט נוכחי: <span className="font-medium text-gray-900">{cardCaseName}</span></p>
                  <p className="text-gray-600 mt-1">סטטוס: <span className="font-medium">{caseStatusMeta[cardCaseStatus].label}</span></p>
                </div>
              )}
              {cardMessage && (
                <p className={`text-sm ${cardMessage.includes('בהצלחה') || cardMessage.includes('נשלח') || cardMessage.includes('נפתח') ? 'text-emerald-700' : 'text-rose-700'}`}>
                  {cardMessage}
                </p>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

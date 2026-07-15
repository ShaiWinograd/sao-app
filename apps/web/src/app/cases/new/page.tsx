'use client';

import { useCallback, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@clerk/nextjs';
import { ArrowLeft, ArrowRight, Check, Loader2 } from 'lucide-react';
import {
  estimateWorkerHours,
  plannedComponentsForServiceSelection,
  type ServiceSelection,
  type ServiceType,
} from '@workforce/shared';
import { api, authHeaders } from '../../../lib/api';
import AzureMapsAddressInput, { type AddressSelection } from '../../../components/forms/AzureMapsAddressInput';

type TimingChoice = 'all_known' | 'partial' | 'none';
type FinishAction = 'lead' | 'quote' | 'schedule';

const SERVICE_CARDS: Array<{ value: ServiceSelection; label: string; hint: string }> = [
  { value: 'PACKING', label: 'אריזה', hint: 'ימי אריזה בלבד' },
  { value: 'UNPACKING', label: 'פריקה', hint: 'ימי פריקה בלבד' },
  { value: 'ORGANIZATION', label: 'סידור', hint: 'ארגון וסידור הבית' },
  { value: 'MOVING', label: 'מעבר דירה', hint: 'אריזה + פריקה' },
];

const SERVICE_TYPE_LABELS: Record<ServiceType, string> = {
  PACKING: 'אריזה',
  UNPACKING: 'פריקה',
  HOME_ORGANIZATION: 'סידור',
};

const TIMING_TO_PRECISION: Record<TimingChoice, 'EXACT_DATE' | 'DATE_RANGE' | 'UNKNOWN'> = {
  all_known: 'EXACT_DATE',
  partial: 'DATE_RANGE',
  none: 'UNKNOWN',
};

const TOTAL_STEPS = 6;

type ComponentEstimate = {
  estimatedWorkdays: string;
  workersPerDay: string;
  hoursPerDay: string;
  requiresManager: boolean;
};

function emptyEstimate(): ComponentEstimate {
  return { estimatedWorkdays: '1', workersPerDay: '4', hoursPerDay: '5', requiresManager: true };
}

type AddressLabel = 'NEW_APARTMENT' | 'OLD_APARTMENT' | 'STORAGE' | 'OFFICE' | 'OTHER';

const ADDRESS_LABELS: Record<AddressLabel, string> = {
  NEW_APARTMENT: 'דירה חדשה',
  OLD_APARTMENT: 'דירה נוכחית',
  STORAGE: 'מחסן',
  OFFICE: 'משרד',
  OTHER: 'אחר',
};

type AddressEntry = {
  label: AddressLabel;
  raw: string;
  selection: AddressSelection | null;
  floor: string;
  apartment: string;
};

function emptyAddress(): AddressEntry {
  return { label: 'NEW_APARTMENT', raw: '', selection: null, floor: '', apartment: '' };
}

// Which addresses matter for each service type: a move needs current + new,
// packing needs the current home, unpacking/organization need a single address.
function defaultAddressesForSelection(sel: ServiceSelection): AddressEntry[] {
  const make = (label: AddressLabel): AddressEntry => ({ ...emptyAddress(), label });
  switch (sel) {
    case 'MOVING':
      return [make('OLD_APARTMENT'), make('NEW_APARTMENT')];
    case 'PACKING':
      return [make('OLD_APARTMENT')];
    case 'UNPACKING':
      return [make('NEW_APARTMENT')];
    case 'ORGANIZATION':
      return [make('OTHER')];
    default:
      return [emptyAddress()];
  }
}

function buildFullAddress(entry: AddressEntry): string {
  const base = entry.selection?.formattedAddress ?? entry.raw.trim();
  const parts = [base];
  if (entry.floor.trim()) parts.push(`קומה ${entry.floor.trim()}`);
  if (entry.apartment.trim()) parts.push(`דירה ${entry.apartment.trim()}`);
  return parts.join(', ');
}

function addHoursToTime(start: string, hours: number): string {
  const [h, m] = start.split(':').map(Number);
  const total = h * 60 + m + Math.round((Number.isFinite(hours) ? hours : 0) * 60);
  const safe = ((total % 1440) + 1440) % 1440;
  return `${String(Math.floor(safe / 60)).padStart(2, '0')}:${String(safe % 60).padStart(2, '0')}`;
}

export default function NewProjectWizard() {
  const router = useRouter();
  const { getToken } = useAuth();

  const [step, setStep] = useState(1);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Step 1 — customer
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [customerNotes, setCustomerNotes] = useState('');

  // Step 1 — addresses
  const [addresses, setAddresses] = useState<AddressEntry[]>([]);
  const setAddressField = useCallback(
    (index: number, patch: Partial<AddressEntry>) =>
      setAddresses((prev) => prev.map((a, i) => (i === index ? { ...a, ...patch } : a))),
    [],
  );

  // Step 2 — service
  const [selection, setSelection] = useState<ServiceSelection | null>(null);
  // Selecting a service also seeds the relevant address slots for that service.
  const selectService = useCallback(
    (value: ServiceSelection) => {
      setSelection((prev) => {
        if (prev !== value) setAddresses(defaultAddressesForSelection(value));
        return value;
      });
    },
    [],
  );

  // Step 3 — timing
  const [timing, setTiming] = useState<TimingChoice>('all_known');

  // Step 4 — estimates per planned component
  const components = useMemo<ServiceType[]>(
    () => (selection ? plannedComponentsForServiceSelection(selection) : []),
    [selection],
  );
  const [estimates, setEstimates] = useState<Record<string, ComponentEstimate>>({});

  // Step 4 — specific job dates per component (used when timing is known)
  const [datesByType, setDatesByType] = useState<Record<string, string[]>>({});
  const [dateError, setDateError] = useState('');
  const addDateFor = useCallback(
    (type: ServiceType, date: string) => {
      if (!date) return;
      const todayKey = new Date().toLocaleDateString('en-CA');
      if (date < todayKey) {
        setDateError('לא ניתן לבחור תאריך בעבר.');
        return;
      }
      // Moving-project rule: unpacking must be at least a day after the last
      // packing day (and a packing day cannot fall on/after an unpacking day).
      if (type === 'UNPACKING') {
        const packingDates = datesByType['PACKING'] ?? [];
        if (packingDates.length > 0 && date <= packingDates.reduce((a, b) => (a > b ? a : b))) {
          setDateError('תאריך הפריקה חייב להיות לפחות יום אחרי יום האריזה האחרון.');
          return;
        }
      }
      if (type === 'PACKING') {
        const unpackingDates = datesByType['UNPACKING'] ?? [];
        if (unpackingDates.length > 0 && date >= unpackingDates.reduce((a, b) => (a < b ? a : b))) {
          setDateError('יום האריזה חייב להיות לפני יום הפריקה.');
          return;
        }
      }
      setDateError('');
      setDatesByType((prev) => {
        const existing = prev[type] ?? [];
        if (existing.includes(date)) return prev;
        return { ...prev, [type]: [...existing, date].sort() };
      });
    },
    [datesByType],
  );
  const removeDateFor = useCallback(
    (type: ServiceType, date: string) =>
      setDatesByType((prev) => ({ ...prev, [type]: (prev[type] ?? []).filter((d) => d !== date) })),
    [],
  );

  const getEstimate = useCallback(
    (type: ServiceType) => estimates[type] ?? emptyEstimate(),
    [estimates],
  );
  const setEstimateField = useCallback(
    (type: ServiceType, field: keyof ComponentEstimate, value: string | boolean) => {
      setEstimates((prev) => ({
        ...prev,
        [type]: { ...(prev[type] ?? emptyEstimate()), [field]: value },
      }));
    },
    [],
  );

  const [internalNotes, setInternalNotes] = useState('');

  // Step 5 — pricing
  const [pricingModel, setPricingModel] = useState<'HOURLY' | 'FIXED' | 'DAILY'>('HOURLY');
  const [pricingAmount, setPricingAmount] = useState('');
  const [hourlyRate, setHourlyRate] = useState('175');

  const totalEstimatedHours = useMemo(
    () =>
      components.reduce((sum, type) => {
        const estimate = getEstimate(type);
        return (
          sum +
          estimateWorkerHours({
            estimatedWorkdays: Number(estimate.estimatedWorkdays) || 0,
            workersPerDay: Number(estimate.workersPerDay) || 0,
            hoursPerDay: Number(estimate.hoursPerDay) || 0,
          })
        );
      }, 0),
    [components, getEstimate],
  );

  const customerName = `${firstName} ${lastName}`.trim();
  const serviceLabel = selection ? SERVICE_CARDS.find((c) => c.value === selection)?.label ?? '' : '';

  const HOURLY_RATE_OPTIONS = [150, 175, 200, 225, 250];
  const computedPrice = useMemo(() => {
    if (pricingModel === 'HOURLY') return totalEstimatedHours * (Number(hourlyRate) || 0);
    return Number(pricingAmount) || 0;
  }, [pricingModel, totalEstimatedHours, hourlyRate, pricingAmount]);

  const canContinue = useMemo(() => {
    if (step === 1) return firstName.trim() && phone.trim().length >= 9;
    if (step === 2) return Boolean(selection);
    return true;
  }, [step, firstName, phone, selection]);

  const finish = useCallback(
    async (action: FinishAction) => {
      if (!selection) return;
      setSubmitting(true);
      setError(null);
      try {
        const auth = await authHeaders(getToken);
        // Reuse an existing customer with the same phone instead of creating a duplicate.
        const normalizedPhone = phone.replace(/\D/g, '');
        let customerId: string;
        const existing = await api.get<Array<{ id: string; phone: string }>>(
          `/customers?search=${encodeURIComponent(phone.trim())}`,
          auth,
        );
        const match = existing.data.find((c) => c.phone.replace(/\D/g, '') === normalizedPhone);
        if (match) {
          customerId = match.id;
        } else {
          const customerRes = await api.post<{ id: string }>(
            '/customers',
            {
              firstName: firstName.trim(),
              lastName: lastName.trim(),
              phone: phone.trim(),
              email: email.trim() || `${phone.trim()}@placeholder.local`,
              ...(customerNotes.trim() ? { notes: customerNotes.trim() } : {}),
            },
            auth,
          );
          customerId = customerRes.data.id;
        }

        // Create validated addresses (Azure Maps selection required to persist).
        const createdAddressIds: string[] = [];
        for (const entry of addresses) {
          if (!entry.selection && !entry.raw.trim()) continue;
          const addrRes = await api.post<{ id: string }>(
            '/addresses',
            {
              customerId,
              fullAddress: buildFullAddress(entry),
              label: entry.label,
              ...(entry.apartment.trim() ? { apartmentDetails: entry.apartment.trim() } : {}),
            },
            auth,
          );
          createdAddressIds.push(addrRes.data.id);
        }
        const primaryAddressId = createdAddressIds[0];

        const status = action === 'lead' ? 'LEAD' : 'QUOTATION_DRAFT';
        const caseRes = await api.post<{ id: string }>(
          '/cases',
          {
            customerId,
            name: `${serviceLabel} – ${customerName}`.trim(),
            status,
            ...(internalNotes.trim()
              ? { internalNotes: internalNotes.trim() }
              : {}),
          },
          auth,
        );
        const caseId = caseRes.data.id;

        for (const type of components) {
          const estimate = getEstimate(type);
          await api.post(
            '/planned-services',
            {
              caseId,
              serviceType: type,
              timingPrecision: TIMING_TO_PRECISION[timing],
              estimatedWorkdays: Number(estimate.estimatedWorkdays) || undefined,
              workersPerDay: Number(estimate.workersPerDay) || undefined,
              hoursPerDay: Number(estimate.hoursPerDay) || undefined,
              requiresManager: estimate.requiresManager,
              reservedManagerPositions: estimate.requiresManager ? 1 : 0,
            },
            auth,
          );
        }

        // Create scheduled jobs for any dates the user added (needs an address).
        if (primaryAddressId) {
          for (const type of components) {
            const dates = datesByType[type] ?? [];
            if (dates.length === 0) continue;
            const estimate = getEstimate(type);
            const workers = Number(estimate.workersPerDay) || 1;
            const start = '09:00';
            const end = addHoursToTime(start, Number(estimate.hoursPerDay) || 5);
            for (const date of dates) {
              await api.post(
                '/jobs',
                {
                  caseId,
                  customerId,
                  addressId: primaryAddressId,
                  jobType: type,
                  date: `${date}T00:00:00.000Z`,
                  plannedStart: `${date}T${start}:00.000Z`,
                  plannedEnd: `${date}T${end}:00.000Z`,
                  requiredWorkerCount: workers,
                  staffingMode: 'MANAGER_APPROVAL',
                  workerSlots: [
                    ...(estimate.requiresManager ? [{ requiredSkill: 'SHIFT_LEADER' as const }] : []),
                    ...Array.from({ length: workers }, () => ({})),
                  ],
                },
                auth,
              );
            }
          }
        }

        router.push(`/cases/${caseId}`);
      } catch (err) {
        const isNetwork =
          typeof err === 'object' && err !== null && 'message' in err && String((err as { message?: string }).message).includes('Network');
        setError(
          isNetwork
            ? 'לא ניתן להתחבר לשרת. ודאי שה-API פועל (localhost:3001) ונסי שוב.'
            : 'יצירת הפרויקט נכשלה. נסי שוב.',
        );
        setSubmitting(false);
      }
    },
    [
      selection,
      getToken,
      firstName,
      lastName,
      phone,
      email,
      customerNotes,
      addresses,
      serviceLabel,
      customerName,
      internalNotes,
      components,
      getEstimate,
      timing,
      datesByType,
      router,
    ],
  );

  const STEP_TITLES = [
    'למי הפרויקט?',
    'איזה שירות הלקוח צריך?',
    'מה כבר ידוע לגבי התאריכים?',
    'הערכת עבודה',
    'תמחור',
    'סקירה וסיום',
  ];

  return (
    <div className="p-6 max-w-3xl mx-auto" dir="rtl">
      <button
        onClick={() => router.push('/cases/board')}
        className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700 mb-3"
      >
        <ArrowRight className="w-4 h-4" />
        חזרה לפרויקטים
      </button>

      <h1 className="text-2xl font-bold text-gray-900">יצירת פרויקט חדש</h1>
      <p className="text-sm text-gray-500 mt-1">
        שלב {step} מתוך {TOTAL_STEPS} · {STEP_TITLES[step - 1]}
      </p>

      {/* Progress bar */}
      <div className="mt-3 flex gap-1">
        {Array.from({ length: TOTAL_STEPS }).map((_, index) => (
          <div
            key={index}
            className={`h-1.5 flex-1 rounded-full ${index < step ? 'bg-primary-600' : 'bg-gray-200'}`}
          />
        ))}
      </div>

      {error && (
        <div className="mt-4 rounded-lg bg-danger-bg border border-danger/30 text-danger text-sm px-4 py-3">
          {error}
        </div>
      )}

      <div className="mt-5 rounded-xl border border-gray-200 bg-white p-5 shadow-sm space-y-4">
        {step === 1 && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <label className="text-sm">
              <span className="text-gray-600">שם פרטי *</span>
              <input value={firstName} onChange={(e) => setFirstName(e.target.value)} className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2" />
            </label>
            <label className="text-sm">
              <span className="text-gray-600">שם משפחה</span>
              <input value={lastName} onChange={(e) => setLastName(e.target.value)} className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2" />
            </label>
            <label className="text-sm">
              <span className="text-gray-600">טלפון *</span>
              <input value={phone} onChange={(e) => setPhone(e.target.value)} className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2" />
            </label>
            <label className="text-sm">
              <span className="text-gray-600">אימייל</span>
              <input value={email} onChange={(e) => setEmail(e.target.value)} className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2" />
            </label>
            <label className="text-sm md:col-span-2">
              <span className="text-gray-600">הערות</span>
              <textarea value={customerNotes} onChange={(e) => setCustomerNotes(e.target.value)} rows={2} className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2" />
            </label>
          </div>
        )}

        {step === 2 && (
          <div className="space-y-5">
            <div className="grid grid-cols-2 gap-3">
              {SERVICE_CARDS.map((card) => (
                <button
                  key={card.value}
                  onClick={() => selectService(card.value)}
                  className={`rounded-xl border p-4 text-right transition-colors ${
                    selection === card.value
                      ? 'border-primary-500 bg-primary-50 ring-2 ring-primary-200'
                      : 'border-gray-200 hover:border-primary-300 hover:bg-primary-50/40'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="text-base font-semibold text-gray-900">{card.label}</span>
                    {selection === card.value && <Check className="w-4 h-4 text-primary-600" />}
                  </div>
                  <p className="text-xs text-gray-500 mt-1">{card.hint}</p>
                </button>
              ))}
            </div>

            {selection && (
              <div className="border-t border-gray-100 pt-4">
                <div className="flex items-center justify-between mb-2">
                  <h3 className="text-sm font-semibold text-gray-900">כתובות</h3>
                  <span className="text-[11px] text-gray-400">
                    {selection === 'MOVING' ? 'מעבר דירה: כתובת נוכחית + כתובת חדשה' : 'כתובת אחת לשירות זה'}
                  </span>
                </div>
                <div className="space-y-3">
                  {addresses.map((entry, index) => (
                    <div key={index} className="rounded-lg border border-gray-200 p-3 space-y-2">
                      <div className="flex items-center gap-2">
                        <select
                          value={entry.label}
                          onChange={(e) => setAddressField(index, { label: e.target.value as AddressLabel })}
                          aria-label="סוג כתובת"
                          className="rounded-lg border border-gray-200 px-2 py-1.5 text-sm bg-white"
                        >
                          {(Object.keys(ADDRESS_LABELS) as AddressLabel[]).map((key) => (
                            <option key={key} value={key}>{ADDRESS_LABELS[key]}</option>
                          ))}
                        </select>
                        {addresses.length > 1 && (
                          <button
                            type="button"
                            onClick={() => setAddresses((prev) => prev.filter((_, i) => i !== index))}
                            className="ms-auto text-xs text-rose-600 hover:text-rose-700"
                          >
                            הסרה
                          </button>
                        )}
                      </div>
                      <AzureMapsAddressInput
                        value={entry.raw}
                        onChange={(v) => setAddressField(index, { raw: v })}
                        onSelectionChange={(sel) => setAddressField(index, { selection: sel })}
                        placeholder="חיפוש כתובת או הקלדה ידנית…"
                        className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm"
                      />
                      <div className="grid grid-cols-2 gap-2">
                        <input
                          value={entry.floor}
                          onChange={(e) => setAddressField(index, { floor: e.target.value })}
                          placeholder="קומה"
                          className="rounded-lg border border-gray-200 px-3 py-2 text-sm"
                        />
                        <input
                          value={entry.apartment}
                          onChange={(e) => setAddressField(index, { apartment: e.target.value })}
                          placeholder="דירה"
                          className="rounded-lg border border-gray-200 px-3 py-2 text-sm"
                        />
                      </div>
                    </div>
                  ))}
                  <button
                    type="button"
                    onClick={() => setAddresses((prev) => [...prev, emptyAddress()])}
                    className="text-xs text-primary-700 hover:text-primary-800"
                  >
                    + הוספת כתובת
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {step === 3 && (
          <div className="space-y-2">
            {(
              [
                { value: 'all_known', label: 'כל התאריכים ידועים' },
                { value: 'partial', label: 'חלק מהתאריכים ידועים' },
                { value: 'none', label: 'עדיין לא נקבעו תאריכים' },
              ] as Array<{ value: TimingChoice; label: string }>
            ).map((option) => (
              <label
                key={option.value}
                className={`flex items-center gap-2 rounded-lg border px-3 py-2.5 cursor-pointer ${
                  timing === option.value ? 'border-primary-400 bg-primary-50' : 'border-gray-200'
                }`}
              >
                <input
                  type="radio"
                  name="timing"
                  checked={timing === option.value}
                  onChange={() => setTiming(option.value)}
                />
                <span className="text-sm text-gray-800">{option.label}</span>
              </label>
            ))}
          </div>
        )}

        {step === 4 && (
          <div className="space-y-4">
            {dateError && (
              <div className="rounded-lg bg-danger-bg border border-danger/30 text-danger text-xs px-3 py-2">
                {dateError}
              </div>
            )}
            {components.map((type) => {
              const estimate = getEstimate(type);
              const hours = estimateWorkerHours({
                estimatedWorkdays: Number(estimate.estimatedWorkdays) || 0,
                workersPerDay: Number(estimate.workersPerDay) || 0,
                hoursPerDay: Number(estimate.hoursPerDay) || 0,
              });
              return (
                <div key={type} className="rounded-lg border border-gray-200 p-4">
                  <h3 className="text-sm font-semibold text-gray-900 mb-2">{SERVICE_TYPE_LABELS[type]}</h3>
                  <div className="grid grid-cols-3 gap-2">
                    <label className="text-xs text-gray-600">
                      ימי עבודה
                      <input type="number" min={0} value={estimate.estimatedWorkdays} onChange={(e) => setEstimateField(type, 'estimatedWorkdays', e.target.value)} className="mt-1 w-full rounded-lg border border-gray-200 px-2 py-1.5 text-sm" />
                    </label>
                    <label className="text-xs text-gray-600">
                      עובדים/יום
                      <input type="number" min={0} value={estimate.workersPerDay} onChange={(e) => setEstimateField(type, 'workersPerDay', e.target.value)} className="mt-1 w-full rounded-lg border border-gray-200 px-2 py-1.5 text-sm" />
                    </label>
                    <label className="text-xs text-gray-600">
                      שעות/יום
                      <input type="number" min={0} value={estimate.hoursPerDay} onChange={(e) => setEstimateField(type, 'hoursPerDay', e.target.value)} className="mt-1 w-full rounded-lg border border-gray-200 px-2 py-1.5 text-sm" />
                    </label>
                  </div>
                  <label className="mt-3 flex items-center gap-2 text-sm text-gray-700">
                    <input type="checkbox" checked={estimate.requiresManager} onChange={(e) => setEstimateField(type, 'requiresManager', e.target.checked)} />
                    ראש צוות
                  </label>
                  {timing !== 'none' && (
                    <div className="mt-3">
                      <span className="text-xs text-gray-600">תאריכי עבודה</span>
                      <div className="mt-1 flex flex-wrap items-center gap-1.5">
                        {(datesByType[type] ?? []).map((d) => (
                          <span key={d} className="inline-flex items-center gap-1 rounded-full bg-primary-50 border border-primary-200 px-2 py-0.5 text-[11px] text-primary-700">
                            {d}
                            <button type="button" onClick={() => removeDateFor(type, d)} aria-label="הסרת תאריך" className="text-primary-500 hover:text-primary-700">✕</button>
                          </span>
                        ))}
                        <input
                          type="date"
                          min={new Date().toLocaleDateString('en-CA')}
                          onChange={(e) => {
                            addDateFor(type, e.target.value);
                            e.target.value = '';
                          }}
                          aria-label="הוספת תאריך עבודה"
                          className="rounded-lg border border-gray-200 px-2 py-1 text-xs"
                        />
                      </div>
                      <p className="mt-1 text-[11px] text-gray-400">הוספת תאריכים תיצור עבודות מתוזמנות (דורש כתובת אחת לפחות)</p>
                    </div>
                  )}
                  <p className="mt-2 text-xs text-gray-500">
                    סה״כ משוער: <span className="font-semibold text-gray-800">{hours} שעות עבודה</span>
                  </p>
                </div>
              );
            })}
            <label className="text-sm block">
              <span className="text-gray-600">הערות פנימיות (לא נשלח ללקוח)</span>
              <textarea value={internalNotes} onChange={(e) => setInternalNotes(e.target.value)} rows={2} className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2" />
            </label>
          </div>
        )}

        {step === 5 && (
          <div className="space-y-3">
            <label className="text-sm block">
              <span className="text-gray-600">מודל תמחור</span>
              <select value={pricingModel} onChange={(e) => setPricingModel(e.target.value as typeof pricingModel)} className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2">
                <option value="HOURLY">שעתי ללקוח</option>
                <option value="FIXED">סכום פרויקט קבוע</option>
                <option value="DAILY">סכום יומי קבוע</option>
              </select>
            </label>
            {pricingModel === 'HOURLY' ? (
              <>
                <label className="text-sm block">
                  <span className="text-gray-600">תעריף לשעה (₪)</span>
                  <select value={hourlyRate} onChange={(e) => setHourlyRate(e.target.value)} className="mt-1 w-40 rounded-lg border border-gray-200 px-3 py-2 bg-white">
                    {HOURLY_RATE_OPTIONS.map((rate) => (
                      <option key={rate} value={String(rate)}>₪{rate}</option>
                    ))}
                  </select>
                </label>
                <div className="rounded-lg border border-primary-200 bg-primary-50 px-3 py-2.5">
                  <p className="text-xs text-primary-700">
                    {totalEstimatedHours} שעות × ₪{Number(hourlyRate) || 0} לשעה
                  </p>
                  <p className="text-lg font-bold text-gray-900 mt-0.5">סה״כ משוער: ₪{computedPrice.toLocaleString()}</p>
                </div>
              </>
            ) : (
              <label className="text-sm block">
                <span className="text-gray-600">סכום (₪)</span>
                <input type="number" min={0} value={pricingAmount} onChange={(e) => setPricingAmount(e.target.value)} className="mt-1 w-40 rounded-lg border border-gray-200 px-3 py-2" />
              </label>
            )}
            <p className="text-xs text-gray-500">סה״כ שעות עבודה משוערות: <span className="font-semibold text-gray-800">{totalEstimatedHours}</span></p>
          </div>
        )}

        {step === 6 && (
          <div className="space-y-3 text-sm">
            <dl className="grid grid-cols-2 gap-y-2">
              <dt className="text-gray-500">לקוח</dt>
              <dd className="text-gray-900">{customerName || '—'}</dd>
              <dt className="text-gray-500">סוג פרויקט</dt>
              <dd className="text-gray-900">{serviceLabel || '—'}</dd>
              <dt className="text-gray-500">תאריכים</dt>
              <dd className="text-gray-900">
                {timing === 'all_known' ? 'ידועים' : timing === 'partial' ? 'חלקית' : 'טרם נקבעו'}
              </dd>
              <dt className="text-gray-500">שעות משוערות</dt>
              <dd className="text-gray-900">{totalEstimatedHours}</dd>
              <dt className="text-gray-500">תמחור</dt>
              <dd className="text-gray-900">{computedPrice > 0 ? `₪${computedPrice.toLocaleString()}` : '—'}</dd>
            </dl>
            <div className="flex flex-wrap gap-2 pt-2">
              <button
                onClick={() => void finish('quote')}
                disabled={submitting}
                className="inline-flex items-center gap-1.5 px-4 py-2 text-sm rounded-lg bg-primary-600 text-white hover:bg-primary-700 disabled:opacity-50"
              >
                {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                שמירה והכנת הצעת מחיר
              </button>
              <button
                onClick={() => void finish('lead')}
                disabled={submitting}
                className="inline-flex items-center gap-1.5 px-4 py-2 text-sm rounded-lg border border-gray-200 text-gray-700 hover:bg-gray-50 disabled:opacity-50"
              >
                שמירה כליד
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Nav buttons */}
      <div className="mt-4 flex items-center justify-between">
        <button
          onClick={() => setStep((s) => Math.max(1, s - 1))}
          disabled={step === 1 || submitting}
          className="inline-flex items-center gap-1.5 px-4 py-2 text-sm rounded-lg border border-gray-200 text-gray-700 hover:bg-gray-50 disabled:opacity-40"
        >
          <ArrowRight className="w-4 h-4" />
          חזרה
        </button>
        {step < TOTAL_STEPS && (
          <button
            onClick={() => setStep((s) => Math.min(TOTAL_STEPS, s + 1))}
            disabled={!canContinue}
            className="inline-flex items-center gap-1.5 px-4 py-2 text-sm rounded-lg bg-primary-600 text-white hover:bg-primary-700 disabled:opacity-50"
          >
            הבא
            <ArrowLeft className="w-4 h-4" />
          </button>
        )}
      </div>
    </div>
  );
}

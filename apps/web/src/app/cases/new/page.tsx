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

const TOTAL_STEPS = 7;

type ComponentEstimate = {
  estimatedWorkdays: string;
  workersPerDay: string;
  hoursPerDay: string;
  requiresManager: boolean;
};

function emptyEstimate(): ComponentEstimate {
  return { estimatedWorkdays: '1', workersPerDay: '4', hoursPerDay: '5', requiresManager: true };
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

  // Step 2 — service
  const [selection, setSelection] = useState<ServiceSelection | null>(null);

  // Step 3 — timing
  const [timing, setTiming] = useState<TimingChoice>('all_known');

  // Step 4 — estimates per planned component
  const components = useMemo<ServiceType[]>(
    () => (selection ? plannedComponentsForServiceSelection(selection) : []),
    [selection],
  );
  const [estimates, setEstimates] = useState<Record<string, ComponentEstimate>>({});

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

  // Step 5 — forms & requirements
  const [reserveManager, setReserveManager] = useState(true);
  const [packingSuppliesForm, setPackingSuppliesForm] = useState(true);
  const [workerEndForm, setWorkerEndForm] = useState(true);
  const [internalNotes, setInternalNotes] = useState('');

  // Step 6 — pricing
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
        const customerId = customerRes.data.id;

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
              reservedManagerPositions: reserveManager ? 1 : 0,
            },
            auth,
          );
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
      serviceLabel,
      customerName,
      internalNotes,
      components,
      getEstimate,
      timing,
      reserveManager,
      router,
    ],
  );

  const STEP_TITLES = [
    'למי הפרויקט?',
    'איזה שירות הלקוח צריך?',
    'מה כבר ידוע לגבי התאריכים?',
    'הערכת עבודה',
    'טפסים ודרישות',
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
          <div className="grid grid-cols-2 gap-3">
            {SERVICE_CARDS.map((card) => (
              <button
                key={card.value}
                onClick={() => setSelection(card.value)}
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
                  <p className="mt-2 text-xs text-gray-500">
                    סה״כ משוער: <span className="font-semibold text-gray-800">{hours} שעות עבודה</span>
                  </p>
                </div>
              );
            })}
          </div>
        )}

        {step === 5 && (
          <div className="space-y-4">
            <label className="flex items-center gap-2.5 text-sm text-gray-800">
              <input type="checkbox" checked={reserveManager} onChange={(e) => setReserveManager(e.target.checked)} />
              שמירת עמדת ראש צוות (עד 1)
            </label>
            <label className="flex items-center gap-2.5 text-sm text-gray-800">
              <input type="checkbox" checked={packingSuppliesForm} onChange={(e) => setPackingSuppliesForm(e.target.checked)} />
              טופס ציוד לאריזה
            </label>
            <label className="flex items-center gap-2.5 text-sm text-gray-800">
              <input type="checkbox" checked={workerEndForm} onChange={(e) => setWorkerEndForm(e.target.checked)} />
              טופס סיום עבודה לעובד (ברירת מחדל)
            </label>
            <label className="text-sm block">
              <span className="text-gray-600">הערות פנימיות</span>
              <textarea value={internalNotes} onChange={(e) => setInternalNotes(e.target.value)} rows={2} className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2" />
            </label>
          </div>
        )}

        {step === 6 && (
          <div className="space-y-3">
            <label className="text-sm block">
              <span className="text-gray-600">מודל תמחור</span>
              <select value={pricingModel} onChange={(e) => setPricingModel(e.target.value as typeof pricingModel)} className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2">
                <option value="HOURLY">שעתי ללקוח</option>
                <option value="FIXED">סכום פרויקט קבוע</option>
                <option value="DAILY">סכום יומי קבוע</option>
              </select>
            </label>
            <label className="text-sm block">
              <span className="text-gray-600">סכום (₪)</span>
              <input type="number" min={0} value={pricingAmount} onChange={(e) => setPricingAmount(e.target.value)} className="mt-1 w-40 rounded-lg border border-gray-200 px-3 py-2" />
            </label>
            <p className="text-xs text-gray-500">סה״כ שעות עבודה משוערות: <span className="font-semibold text-gray-800">{totalEstimatedHours}</span></p>
          </div>
        )}

        {step === 7 && (
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

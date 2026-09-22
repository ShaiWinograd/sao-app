'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from '@clerk/nextjs';
import Link from 'next/link';
import { Loader2, AlertTriangle, CheckCircle2 } from 'lucide-react';
import { api, authHeaders } from '../../lib/api';
import AzureMapsAddressInput, { type AddressSelection } from '../forms/AzureMapsAddressInput';

function makeIdemKey(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return `idem-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

// Job-first Quick Create (spec §8). Intentionally exposes NO project/CustomerCase
// selection — the backend auto-resolves or creates the internal case on save
// (POST /jobs/quick). Reused by the /jobs/new page and the Home side panel.

type CustomerMatch = { id: string; firstName: string; lastName: string; phone: string };
type WorkerCandidate = { id: string; name: string; available: boolean; reason?: string };
type FieldName =
  | 'customerFirst'
  | 'customerPhone'
  | 'date'
  | 'time'
  | 'address'
  | 'workerCount'
  | 'traineeName'
  | 'traineeWage';

export type QuickCreateCapacity = { warning: boolean; available: number };

const JOB_TYPES: Array<{ value: string; label: string }> = [
  { value: 'PACKING', label: 'אריזה' },
  { value: 'UNPACKING', label: 'פריקה' },
  { value: 'HOME_ORGANIZATION', label: 'סידור' },
];

export function todayKey(): string {
  return new Date().toLocaleDateString('en-CA');
}

export function QuickCreateForm({
  initialDate,
  onCreated,
  onCancel,
}: {
  initialDate?: string;
  onCreated: (jobId: string, capacity: QuickCreateCapacity) => void;
  onCancel: () => void;
}) {
  const { getToken } = useAuth();

  // Job-first customer form: a normal customer-details form (no existing/new mode
  // switch). As the owner types any field we surface matching existing customers;
  // they may select one or keep the typed values to create a new customer. A
  // customer is never auto-selected or auto-merged. "General reservation" is an
  // explicit opt-in for reserving workers before a real customer exists.
  const [custFirst, setCustFirst] = useState('');
  const [custLast, setCustLast] = useState('');
  const [custPhone, setCustPhone] = useState('');
  const [custEmail, setCustEmail] = useState('');
  const [selectedCustomerId, setSelectedCustomerId] = useState<string | null>(null);
  const [matches, setMatches] = useState<CustomerMatch[]>([]);
  const [generalReservation, setGeneralReservation] = useState(false);

  const [jobType, setJobType] = useState('PACKING');
  const [date, setDate] = useState(initialDate || todayKey());
  const [startTime, setStartTime] = useState('09:00');
  const [endTime, setEndTime] = useState('14:00');
  const [cityOrAddress, setCityOrAddress] = useState('');
  const [addressSelection, setAddressSelection] = useState<AddressSelection | null>(null);
  const [manualAddressConfirmed, setManualAddressConfirmed] = useState(false);
  const [workerCount, setWorkerCount] = useState('2');
  const [requiresTeamLeader, setRequiresTeamLeader] = useState(true);
  const [notes, setNotes] = useState('');
  const [selectedWorkerIds, setSelectedWorkerIds] = useState<string[]>([]);
  const [workerCandidates, setWorkerCandidates] = useState<WorkerCandidate[]>([]);
  const [hasTrainee, setHasTrainee] = useState(false);
  const [traineeName, setTraineeName] = useState('');
  const [traineeHourlyWage, setTraineeHourlyWage] = useState('50');

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<FieldName, string>>>({});
  // One idempotency key per opened form so a repeated/retried submit cannot
  // create a second job. Regenerated after a successful create.
  const idemKeyRef = useRef<string>(makeIdemKey());
  const [createdJobId, setCreatedJobId] = useState<string | null>(null);

  const calendarDays = useMemo(() => {
    const anchor = new Date(`${date}T00:00:00`);
    return Array.from({ length: 14 }, (_, index) => {
      const value = new Date(anchor);
      value.setDate(anchor.getDate() + index - 3);
      return value;
    });
  }, [date]);

  useEffect(() => {
    void (async () => {
      try {
        const auth = await authHeaders(getToken);
        const res = await api.get<WorkerCandidate[]>(
          `/workers/availability?date=${date}&requiresManager=${requiresTeamLeader}`,
          auth,
        );
        setWorkerCandidates(res.data ?? []);
        setSelectedWorkerIds((ids) => ids.filter((id) => res.data.some((candidate) => candidate.id === id && candidate.available)));
      } catch {
        setWorkerCandidates([]);
      }
    })();
  }, [date, requiresTeamLeader, getToken]);

  const searchCustomers = useCallback(
    async (term: string) => {
      if (term.trim().length < 2) {
        setMatches([]);
        return;
      }
      try {
        const auth = await authHeaders(getToken);
        const res = await api.get<CustomerMatch[]>(`/customers?search=${encodeURIComponent(term.trim())}`, auth);
        setMatches(res.data.filter((c) => c.id !== 'general-reservation').slice(0, 8));
      } catch {
        setMatches([]);
      }
    },
    [getToken],
  );

  // Any edit to a customer field means the owner is no longer pointing at a
  // previously-selected existing customer.
  const onCustomerFieldChange = useCallback(
    (setter: (v: string) => void, value: string) => {
      setter(value);
      setSelectedCustomerId(null);
      void searchCustomers(value);
    },
    [searchCustomers],
  );

  const selectExistingCustomer = useCallback((c: CustomerMatch) => {
    setSelectedCustomerId(c.id);
    setCustFirst(c.firstName);
    setCustLast(c.lastName);
    setCustPhone(c.phone);
    setMatches([]);
    setFieldErrors((current) => {
      const next = { ...current };
      delete next.customerFirst;
      delete next.customerPhone;
      return next;
    });
  }, []);

  const clearFieldError = useCallback((field: FieldName) => {
    setFieldErrors((current) => {
      if (!current[field]) return current;
      const next = { ...current };
      delete next[field];
      return next;
    });
  }, []);

  const submit = useCallback(async (status: 'RESERVATION' | 'APPROVED') => {
    setError(null);
    const nextFieldErrors: Partial<Record<FieldName, string>> = {};
    if (!generalReservation && !selectedCustomerId) {
      if (!custFirst.trim()) {
        nextFieldErrors.customerFirst = 'יש להזין שם פרטי, לבחור לקוח קיים או לסמן שריון כללי.';
      }
      if (!custPhone.trim()) {
        nextFieldErrors.customerPhone = 'יש להזין טלפון ללקוח חדש.';
      }
    }
    if (!date || date < todayKey()) {
      nextFieldErrors.date = 'יש לבחור תאריך מהיום והלאה.';
    }
    if (!startTime || !endTime || endTime <= startTime) {
      nextFieldErrors.time = 'שעת הסיום חייבת להיות אחרי שעת ההתחלה.';
    }
    if (!cityOrAddress.trim()) {
      nextFieldErrors.address = 'יש להזין עיר או כתובת.';
    } else if (!addressSelection && !manualAddressConfirmed) {
      nextFieldErrors.address = 'יש לבחור כתובת מהרשימה או לאשר שמירה ידנית.';
    }
    if (!Number.isFinite(Number(workerCount)) || Number(workerCount) < 1) {
      nextFieldErrors.workerCount = 'יש להזין לפחות עובדת אחת.';
    }
    if (hasTrainee && !traineeName.trim()) {
      nextFieldErrors.traineeName = 'יש להזין שם מלא למתלמדת.';
    }
    if (hasTrainee && (!traineeHourlyWage.trim() || Number(traineeHourlyWage) < 0)) {
      nextFieldErrors.traineeWage = 'יש להזין שכר שעתי תקין.';
    }
    setFieldErrors(nextFieldErrors);
    if (Object.keys(nextFieldErrors).length > 0) {
      return;
    }
    setBusy(true);
    try {
      const auth = await authHeaders(getToken);
      const customerPart = generalReservation
        ? { generalReservation: true }
        : selectedCustomerId
          ? { customerId: selectedCustomerId }
          : {
              newCustomer: {
                firstName: custFirst.trim(),
                lastName: custLast.trim(),
                phone: custPhone.trim(),
                ...(custEmail.trim() ? { email: custEmail.trim() } : {}),
              },
            };
      const payload = {
        ...customerPart,
        jobType,
        date,
        startTime,
        endTime,
        address: addressSelection
          ? { mode: 'selected' as const, token: addressSelection.token }
          : { mode: 'manual' as const, text: cityOrAddress.trim(), confirmedUnresolved: true as const },
        requiredWorkerCount: Math.max(1, Number(workerCount) || 1),
        requiresTeamLeader,
        initialStatus: status,
        notes: notes.trim() || undefined,
        selectedWorkerIds: status === 'APPROVED' ? selectedWorkerIds : [],
        ...(hasTrainee
          ? { traineeName: traineeName.trim(), traineeHourlyWage: Number(traineeHourlyWage) || 0 }
          : {}),
        idempotencyKey: idemKeyRef.current,
      };
      const res = await api.post<{
        job: { id: string };
        capacityWarning: boolean;
        availableWorkers: number;
        assignmentFailures?: Array<{ workerId: string; error: string }>;
      }>(
        '/jobs/quick',
        payload,
        auth,
      );
      // Show a durable success + link so a slow/failed view refresh never invites
      // a second submission; regenerate the key so the next job is distinct.
      setCreatedJobId(res.data.job.id);
      idemKeyRef.current = makeIdemKey();
      if (res.data.assignmentFailures?.length) {
        setError('העבודה נוצרה, אך חלק מהעובדות לא שובצו כי זמינותן השתנתה.');
      }
      onCreated(res.data.job.id, { warning: res.data.capacityWarning, available: res.data.availableWorkers });
    } catch (err) {
      const data = (err as { response?: { data?: { error?: string; message?: string; correlationId?: string } } })?.response?.data;
      const base = data?.message ?? data?.error ?? 'יצירת העבודה נכשלה.';
      setError(base + (data?.correlationId ? ` (מזהה: ${data.correlationId})` : ''));
    } finally {
      setBusy(false);
    }
  }, [generalReservation, selectedCustomerId, custFirst, custLast, custPhone, custEmail, jobType, date, startTime, endTime, cityOrAddress, addressSelection, manualAddressConfirmed, workerCount, requiresTeamLeader, notes, selectedWorkerIds, hasTrainee, traineeName, traineeHourlyWage, getToken, onCreated]);

  return (
    <div className="quick-create-form space-y-0" dir="rtl">
      {createdJobId && (
        <div className="flex items-center justify-between gap-2 border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-800">
          <span className="inline-flex items-center gap-2"><CheckCircle2 className="w-4 h-4" /> העבודה נוצרה בהצלחה.</span>
          <Link href={`/jobs/${createdJobId}`} className="font-medium underline">מעבר לעבודה</Link>
        </div>
      )}

      {/* Customer (job-first: a normal customer form with live suggestions) */}
      <section className="border-b border-[var(--color-border)] py-6">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-gray-900">לקוח</h2>
          <label className="inline-flex items-center gap-2 text-xs text-gray-600">
            <input
              type="checkbox"
              checked={generalReservation}
              onChange={(e) => {
                setGeneralReservation(e.target.checked);
                if (e.target.checked) {
                  setSelectedCustomerId(null);
                  setMatches([]);
                  setFieldErrors((current) => {
                    const next = { ...current };
                    delete next.customerFirst;
                    delete next.customerPhone;
                    return next;
                  });
                }
              }}
            />
            שריון כללי (ללא לקוח)
          </label>
        </div>

        {generalReservation ? (
          <p className="text-sm text-gray-500">העבודה תשויך לשריון כללי. ניתן לשייך ללקוח אמיתי מאוחר יותר.</p>
        ) : (
          <div className="space-y-3">
            {selectedCustomerId && (
              <div className="flex items-center justify-between border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
                <span>לקוח קיים נבחר: {custFirst} {custLast}{custPhone ? ` · ${custPhone}` : ''}</span>
                <button
                  type="button"
                  onClick={() => setSelectedCustomerId(null)}
                  className="text-xs underline text-emerald-700"
                >
                  ניקוי בחירה
                </button>
              </div>
            )}
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <label>
                <input
                  value={custFirst}
                  onChange={(e) => {
                    clearFieldError('customerFirst');
                    onCustomerFieldChange(setCustFirst, e.target.value);
                  }}
                  placeholder="שם פרטי"
                  aria-invalid={Boolean(fieldErrors.customerFirst)}
                  className={`w-full rounded-lg border px-3 py-2 text-sm ${fieldErrors.customerFirst ? 'border-danger' : 'border-gray-300'}`}
                />
                {fieldErrors.customerFirst && <span className="mt-1 block text-xs text-danger">{fieldErrors.customerFirst}</span>}
              </label>
              <input value={custLast} onChange={(e) => onCustomerFieldChange(setCustLast, e.target.value)} placeholder="שם משפחה" className="rounded-lg border border-gray-300 px-3 py-2 text-sm" />
              <label>
                <input
                  value={custPhone}
                  onChange={(e) => {
                    clearFieldError('customerPhone');
                    onCustomerFieldChange(setCustPhone, e.target.value);
                  }}
                  placeholder="טלפון"
                  inputMode="tel"
                  aria-invalid={Boolean(fieldErrors.customerPhone)}
                  className={`w-full rounded-lg border px-3 py-2 text-sm ${fieldErrors.customerPhone ? 'border-danger' : 'border-gray-300'}`}
                />
                {fieldErrors.customerPhone && <span className="mt-1 block text-xs text-danger">{fieldErrors.customerPhone}</span>}
              </label>
              <input value={custEmail} onChange={(e) => setCustEmail(e.target.value)} placeholder="אימייל (אופציונלי)" inputMode="email" className="rounded-lg border border-gray-300 px-3 py-2 text-sm" />
            </div>
            {!selectedCustomerId && matches.length > 0 && (
              <div className="max-h-44 overflow-auto border border-[var(--color-border)]">
                <p className="px-3 py-1.5 text-[11px] text-gray-500 bg-gray-50">לקוחות קיימים תואמים — לבחירה, או המשיכו ליצירת לקוח חדש</p>
                {matches.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => selectExistingCustomer(c)}
                    className="block w-full px-3 py-2 text-right text-sm hover:bg-gray-50"
                  >
                    {c.firstName} {c.lastName} · {c.phone}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </section>

      {/* Job details */}
      <section className="grid grid-cols-1 gap-4 border-b border-[var(--color-border)] py-6 sm:grid-cols-2">
        <label className="text-sm">
          <span className="block text-gray-600 mb-1">סוג עבודה</span>
          <select value={jobType} onChange={(e) => setJobType(e.target.value)} className="w-full rounded-none border border-gray-300 bg-[var(--color-surface)] px-2.5 py-2">
            {JOB_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
          </select>
        </label>
        <label className="text-sm">
          <span className="block text-gray-600 mb-1">תאריך</span>
          <input
            type="date"
            value={date}
            min={todayKey()}
            onChange={(e) => {
              clearFieldError('date');
              setDate(e.target.value);
            }}
            aria-invalid={Boolean(fieldErrors.date)}
            className={`w-full rounded-lg border px-2.5 py-2 ${fieldErrors.date ? 'border-danger' : 'border-gray-300'}`}
          />
          {fieldErrors.date && <span className="mt-1 block text-xs text-danger">{fieldErrors.date}</span>}
        </label>
        <div className="sm:col-span-2">
          <p className="mb-2 text-xs font-medium text-gray-600">בחירה מהירה מהיומן</p>
          <div className="flex gap-2 overflow-x-auto border-y border-[var(--color-border)] py-2">
            {calendarDays.map((calendarDate) => {
              const key = calendarDate.toLocaleDateString('en-CA');
              const active = key === date;
              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => {
                    clearFieldError('date');
                    setDate(key);
                  }}
                  className={`min-w-14 px-2 py-2 text-center ${active ? 'bg-primary-700 text-white' : 'text-gray-600 hover:bg-primary-50'}`}
                >
                  <span className="block text-[10px]">{calendarDate.toLocaleDateString('he-IL', { weekday: 'short' })}</span>
                  <span className="font-display block text-xl">{calendarDate.getDate()}</span>
                </button>
              );
            })}
          </div>
        </div>
        <label className="text-sm">
          <span className="block text-gray-600 mb-1">שעת התחלה</span>
          <input type="time" value={startTime} onChange={(e) => { clearFieldError('time'); setStartTime(e.target.value); }} aria-invalid={Boolean(fieldErrors.time)} className={`w-full rounded-lg border px-2.5 py-2 ${fieldErrors.time ? 'border-danger' : 'border-gray-300'}`} />
          {fieldErrors.time && <span className="mt-1 block text-xs text-danger">{fieldErrors.time}</span>}
        </label>
        <label className="text-sm">
          <span className="block text-gray-600 mb-1">שעת סיום</span>
          <input type="time" value={endTime} onChange={(e) => { clearFieldError('time'); setEndTime(e.target.value); }} aria-invalid={Boolean(fieldErrors.time)} className={`w-full rounded-lg border px-2.5 py-2 ${fieldErrors.time ? 'border-danger' : 'border-gray-300'}`} />
        </label>
        <label className="text-sm sm:col-span-2">
          <span className="mb-1 block text-gray-600">כתובת מלאה</span>
          <AzureMapsAddressInput
            value={cityOrAddress}
            onChange={(value) => {
              clearFieldError('address');
              setCityOrAddress(value);
              setAddressSelection(null);
              setManualAddressConfirmed(false);
            }}
            onSelectionChange={(selection) => {
              setAddressSelection(selection);
              if (selection) setManualAddressConfirmed(false);
            }}
            placeholder="רחוב, מספר ועיר"
            className={`w-full rounded-lg border px-2.5 py-2 ${fieldErrors.address ? 'border-danger' : 'border-gray-300'}`}
            invalid={Boolean(fieldErrors.address)}
          />
          {fieldErrors.address && <span className="mt-1 block text-xs text-danger">{fieldErrors.address}</span>}
          {addressSelection ? (
            <span className="mt-1 flex items-center gap-1 text-[11px] text-emerald-700">
              <CheckCircle2 className="h-3.5 w-3.5" />
              הכתובת אומתה ותאפשר ניטור מיקום במשמרת.
            </span>
          ) : cityOrAddress.trim() ? (
            <label className="mt-2 flex items-start gap-2 text-[11px] text-amber-800">
              <input
                type="checkbox"
                checked={manualAddressConfirmed}
                onChange={(event) => {
                  clearFieldError('address');
                  setManualAddressConfirmed(event.target.checked);
                }}
              />
              <span>לא מצאתי כתובת מדויקת. שמירה ידנית תשבית ניטור מיקום לעבודה זו עד לאימות הכתובת.</span>
            </label>
          ) : null}
        </label>
        <label className="text-sm">
          <span className="block text-gray-600 mb-1">מספר עובדים</span>
          <input type="number" min={1} value={workerCount} onChange={(e) => { clearFieldError('workerCount'); setWorkerCount(e.target.value); }} aria-invalid={Boolean(fieldErrors.workerCount)} className={`w-full rounded-lg border px-2.5 py-2 ${fieldErrors.workerCount ? 'border-danger' : 'border-gray-300'}`} />
          {fieldErrors.workerCount && <span className="mt-1 block text-xs text-danger">{fieldErrors.workerCount}</span>}
        </label>
        <label className="text-sm flex items-end gap-2 pb-2">
          <input type="checkbox" checked={requiresTeamLeader} onChange={(e) => setRequiresTeamLeader(e.target.checked)} />
          <span className="text-gray-700">דרוש ראש צוות</span>
        </label>
        <label className="text-sm sm:col-span-2">
          <span className="block text-gray-600 mb-1">הערות (אופציונלי)</span>
          <input value={notes} onChange={(e) => setNotes(e.target.value)} className="w-full rounded-lg border border-gray-300 px-2.5 py-2" />
        </label>
      </section>

      <section className="border-b border-[var(--color-border)] py-6">
        <h2 className="text-sm font-semibold text-gray-900">הזמנת עובדות זמינות</h2>
        <p className="mt-1 text-xs text-gray-500">העובדות שתבחרי יקבלו שיבוץ רק אם העבודה תאושר.</p>
        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          {workerCandidates.map((candidate) => (
            <label
              key={candidate.id}
              className={`flex items-center justify-between border px-3 py-2 text-sm ${
                candidate.available ? 'border-[var(--color-border)]' : 'border-gray-200 text-gray-400'
              }`}
            >
              <span>{candidate.name}{candidate.available ? '' : ' · לא זמינה'}</span>
              <input
                type="checkbox"
                disabled={!candidate.available}
                checked={selectedWorkerIds.includes(candidate.id)}
                onChange={(event) =>
                  setSelectedWorkerIds((ids) =>
                    event.target.checked ? [...ids, candidate.id] : ids.filter((id) => id !== candidate.id),
                  )
                }
              />
            </label>
          ))}
          {workerCandidates.length === 0 && <p className="text-xs text-gray-500">לא נמצאו עובדות זמינות לתאריך זה.</p>}
        </div>
      </section>

      <section className="border-b border-[var(--color-border)] py-6">
        <label className="flex items-center justify-between text-sm font-medium text-gray-800">
          <span>מתלמדת</span>
          <input type="checkbox" checked={hasTrainee} onChange={(event) => setHasTrainee(event.target.checked)} />
        </label>
        {hasTrainee && (
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <label className="text-sm">
              <span className="mb-1 block text-gray-600">שם מלא</span>
              <input
                value={traineeName}
                onChange={(event) => { clearFieldError('traineeName'); setTraineeName(event.target.value); }}
                required
                aria-invalid={Boolean(fieldErrors.traineeName)}
                className={`w-full border bg-[var(--color-surface)] px-3 py-2 ${fieldErrors.traineeName ? 'border-danger' : 'border-[var(--color-border-strong)]'}`}
              />
              {fieldErrors.traineeName && <span className="mt-1 block text-xs text-danger">{fieldErrors.traineeName}</span>}
            </label>
            <label className="text-sm">
              <span className="mb-1 block text-gray-600">שכר שעתי</span>
              <input
                type="number"
                min={0}
                value={traineeHourlyWage}
                onChange={(event) => { clearFieldError('traineeWage'); setTraineeHourlyWage(event.target.value); }}
                required
                aria-invalid={Boolean(fieldErrors.traineeWage)}
                className={`w-full border bg-[var(--color-surface)] px-3 py-2 ${fieldErrors.traineeWage ? 'border-danger' : 'border-[var(--color-border-strong)]'}`}
              />
              {fieldErrors.traineeWage && <span className="mt-1 block text-xs text-danger">{fieldErrors.traineeWage}</span>}
            </label>
            <p className="text-xs text-gray-500 sm:col-span-2">
              שעות המתלמדת יוזנו ידנית לאחר העבודה ויופיעו רק בעלויות השכר, לא בחיוב הלקוח.
            </p>
          </div>
        )}
      </section>

      <div className="pt-5">
        {error && (
          <div className="mb-3 flex items-center gap-2 border border-danger/30 bg-danger-bg px-4 py-3 text-sm text-danger">
            <AlertTriangle className="h-4 w-4 shrink-0" />
            {error}
          </div>
        )}
        <div className="flex flex-wrap justify-end gap-3">
          <button type="button" onClick={onCancel} className="px-2 py-2 text-sm text-[var(--color-calendar-sage)] underline decoration-[var(--color-border-strong)] underline-offset-4 hover:decoration-[var(--color-calendar-sage)]">
            ביטול
          </button>
          <button
            type="button"
            onClick={() => void submit('RESERVATION')}
            disabled={busy}
            className="inline-flex min-h-11 flex-1 items-center justify-center gap-1.5 border border-[var(--color-calendar-sage)] px-5 py-2.5 text-sm font-medium text-[var(--color-calendar-sage)] hover:bg-[var(--color-calendar-sage-soft)] disabled:opacity-50 sm:flex-none"
          >
            {busy && <Loader2 className="h-4 w-4 animate-spin" />}
            שריון
          </button>
          <button
            type="button"
            onClick={() => void submit('APPROVED')}
            disabled={busy || generalReservation}
            title={generalReservation ? 'לא ניתן לאשר עבודה בשריון כללי' : ''}
            className="inline-flex min-h-11 flex-1 items-center justify-center gap-1.5 bg-[var(--color-calendar-sage)] px-5 py-2.5 text-sm font-medium text-[var(--color-background)] hover:bg-primary-700 disabled:opacity-40 sm:flex-none"
          >
            {busy && <Loader2 className="h-4 w-4 animate-spin" />}
            אושר
          </button>
        </div>
      </div>
    </div>
  );
}

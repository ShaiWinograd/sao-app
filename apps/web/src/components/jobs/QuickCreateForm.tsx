'use client';

import { useCallback, useRef, useState } from 'react';
import { useAuth } from '@clerk/nextjs';
import Link from 'next/link';
import { Loader2, Plus, AlertTriangle, CheckCircle2 } from 'lucide-react';
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
  const [initialStatus, setInitialStatus] = useState<'RESERVATION' | 'APPROVED'>('RESERVATION');
  const [notes, setNotes] = useState('');

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // One idempotency key per opened form so a repeated/retried submit cannot
  // create a second job. Regenerated after a successful create.
  const idemKeyRef = useRef<string>(makeIdemKey());
  const [createdJobId, setCreatedJobId] = useState<string | null>(null);

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
  }, []);

  const submit = useCallback(async () => {
    setError(null);
    if (!generalReservation && !selectedCustomerId) {
      if (!custFirst.trim()) {
        setError('יש להזין שם פרטי של הלקוח, לבחור לקוח קיים, או לסמן שריון כללי.');
        return;
      }
      if (!custPhone.trim()) {
        setError('יש להזין טלפון ללקוח חדש.');
        return;
      }
    }
    if (!cityOrAddress.trim()) {
      setError('יש להזין עיר או כתובת.');
      return;
    }
    if (!addressSelection && !manualAddressConfirmed) {
      setError('יש לבחור כתובת מדויקת מהרשימה או לאשר שמירה ידנית ללא ניטור מיקום.');
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
        initialStatus,
        notes: notes.trim() || undefined,
        idempotencyKey: idemKeyRef.current,
      };
      const res = await api.post<{ job: { id: string }; capacityWarning: boolean; availableWorkers: number }>(
        '/jobs/quick',
        payload,
        auth,
      );
      // Show a durable success + link so a slow/failed view refresh never invites
      // a second submission; regenerate the key so the next job is distinct.
      setCreatedJobId(res.data.job.id);
      idemKeyRef.current = makeIdemKey();
      onCreated(res.data.job.id, { warning: res.data.capacityWarning, available: res.data.availableWorkers });
    } catch (err) {
      const data = (err as { response?: { data?: { error?: string; message?: string; correlationId?: string } } })?.response?.data;
      const base = data?.message ?? data?.error ?? 'יצירת העבודה נכשלה.';
      setError(base + (data?.correlationId ? ` (מזהה: ${data.correlationId})` : ''));
    } finally {
      setBusy(false);
    }
  }, [generalReservation, selectedCustomerId, custFirst, custLast, custPhone, custEmail, jobType, date, startTime, endTime, cityOrAddress, addressSelection, manualAddressConfirmed, workerCount, requiresTeamLeader, initialStatus, notes, getToken, onCreated]);

  return (
    <div className="space-y-5" dir="rtl">
      {error && (
        <div className="flex items-center gap-2 rounded-lg bg-danger-bg border border-danger/30 text-danger text-sm px-4 py-3">
          <AlertTriangle className="w-4 h-4 shrink-0" />
          {error}
        </div>
      )}

      {createdJobId && (
        <div className="flex items-center justify-between gap-2 rounded-lg bg-green-50 border border-green-200 text-green-800 text-sm px-4 py-3">
          <span className="inline-flex items-center gap-2"><CheckCircle2 className="w-4 h-4" /> העבודה נוצרה בהצלחה.</span>
          <Link href={`/jobs/${createdJobId}`} className="font-medium underline">מעבר לעבודה</Link>
        </div>
      )}

      {/* Customer (job-first: a normal customer form with live suggestions) */}
      <section className="rounded-2xl border border-[#e7e3dc] bg-white p-4 shadow-[0_2px_8px_rgba(38,38,38,0.04)] sm:p-5">
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
                  setInitialStatus('RESERVATION');
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
              <div className="flex items-center justify-between rounded-lg bg-emerald-50 border border-emerald-200 px-3 py-2 text-sm text-emerald-800">
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
              <input value={custFirst} onChange={(e) => onCustomerFieldChange(setCustFirst, e.target.value)} placeholder="שם פרטי" className="rounded-lg border border-gray-300 px-3 py-2 text-sm" />
              <input value={custLast} onChange={(e) => onCustomerFieldChange(setCustLast, e.target.value)} placeholder="שם משפחה" className="rounded-lg border border-gray-300 px-3 py-2 text-sm" />
              <input value={custPhone} onChange={(e) => onCustomerFieldChange(setCustPhone, e.target.value)} placeholder="טלפון" inputMode="tel" className="rounded-lg border border-gray-300 px-3 py-2 text-sm" />
              <input value={custEmail} onChange={(e) => setCustEmail(e.target.value)} placeholder="אימייל (אופציונלי)" inputMode="email" className="rounded-lg border border-gray-300 px-3 py-2 text-sm" />
            </div>
            {!selectedCustomerId && matches.length > 0 && (
              <div className="max-h-44 overflow-auto rounded-lg border border-gray-100">
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
      <section className="grid grid-cols-1 gap-3 rounded-2xl border border-[#e7e3dc] bg-white p-4 shadow-[0_2px_8px_rgba(38,38,38,0.04)] sm:grid-cols-2 sm:p-5">
        <label className="text-sm">
          <span className="block text-gray-600 mb-1">סוג עבודה</span>
          <select value={jobType} onChange={(e) => setJobType(e.target.value)} className="w-full rounded-lg border border-gray-300 px-2.5 py-2 bg-white">
            {JOB_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
          </select>
        </label>
        <label className="text-sm">
          <span className="block text-gray-600 mb-1">תאריך</span>
          <input type="date" value={date} min={todayKey()} onChange={(e) => setDate(e.target.value)} className="w-full rounded-lg border border-gray-300 px-2.5 py-2" />
        </label>
        <label className="text-sm">
          <span className="block text-gray-600 mb-1">שעת התחלה</span>
          <input type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} className="w-full rounded-lg border border-gray-300 px-2.5 py-2" />
        </label>
        <label className="text-sm">
          <span className="block text-gray-600 mb-1">שעת סיום</span>
          <input type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)} className="w-full rounded-lg border border-gray-300 px-2.5 py-2" />
        </label>
        <label className="text-sm sm:col-span-2">
          <span className="mb-1 block text-gray-600">כתובת מלאה</span>
          <AzureMapsAddressInput
            value={cityOrAddress}
            onChange={(value) => {
              setCityOrAddress(value);
              setAddressSelection(null);
              setManualAddressConfirmed(false);
            }}
            onSelectionChange={(selection) => {
              setAddressSelection(selection);
              if (selection) setManualAddressConfirmed(false);
            }}
            placeholder="רחוב, מספר ועיר"
            className="w-full rounded-lg border border-gray-300 px-2.5 py-2"
          />
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
                onChange={(event) => setManualAddressConfirmed(event.target.checked)}
              />
              <span>לא מצאתי כתובת מדויקת. שמירה ידנית תשבית ניטור מיקום לעבודה זו עד לאימות הכתובת.</span>
            </label>
          ) : null}
        </label>
        <label className="text-sm">
          <span className="block text-gray-600 mb-1">מספר עובדים</span>
          <input type="number" min={1} value={workerCount} onChange={(e) => setWorkerCount(e.target.value)} className="w-full rounded-lg border border-gray-300 px-2.5 py-2" />
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

      {/* Status */}
      <section className="rounded-2xl border border-[#e7e3dc] bg-white p-4 shadow-[0_2px_8px_rgba(38,38,38,0.04)] sm:p-5">
        <h2 className="text-sm font-semibold text-gray-900 mb-3">סטטוס התחלתי</h2>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => setInitialStatus('RESERVATION')}
            className={`rounded-lg px-3 py-1.5 text-sm font-medium ${initialStatus === 'RESERVATION' ? 'bg-primary-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
          >
            שריון
          </button>
          <button
            type="button"
            onClick={() => setInitialStatus('APPROVED')}
            disabled={generalReservation}
            title={generalReservation ? 'לא ניתן לאשר עבודה בשריון כללי' : ''}
            className={`rounded-lg px-3 py-1.5 text-sm font-medium disabled:opacity-40 ${initialStatus === 'APPROVED' ? 'bg-emerald-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
          >
            אושר
          </button>
        </div>
      </section>

      <div className="flex justify-end gap-2">
        <button type="button" onClick={onCancel} className="rounded-lg border border-gray-200 px-4 py-2 text-sm text-gray-600 hover:bg-gray-50">
          ביטול
        </button>
        <button
          onClick={() => void submit()}
          disabled={busy}
          className="inline-flex min-h-11 flex-1 items-center justify-center gap-1.5 rounded-xl bg-primary-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-primary-700 disabled:opacity-50 sm:flex-none"
        >
          {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
          יצירת העבודה
        </button>
      </div>
    </div>
  );
}

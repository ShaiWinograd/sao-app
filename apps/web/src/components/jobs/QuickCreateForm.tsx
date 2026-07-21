'use client';

import { useCallback, useRef, useState } from 'react';
import { useAuth } from '@clerk/nextjs';
import Link from 'next/link';
import { Loader2, Plus, AlertTriangle, CheckCircle2 } from 'lucide-react';
import { api, authHeaders } from '../../lib/api';

function makeIdemKey(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return `idem-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

// Job-first Quick Create (spec §8). Intentionally exposes NO project/CustomerCase
// selection — the backend auto-resolves or creates the internal case on save
// (POST /jobs/quick). Reused by the /jobs/new page and the Home side panel.

type CustomerMode = 'EXISTING' | 'NEW' | 'GENERAL_RESERVATION';
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

  const [customerMode, setCustomerMode] = useState<CustomerMode>('GENERAL_RESERVATION');
  const [search, setSearch] = useState('');
  const [matches, setMatches] = useState<CustomerMatch[]>([]);
  const [selectedCustomer, setSelectedCustomer] = useState<CustomerMatch | null>(null);
  const [newFirst, setNewFirst] = useState('');
  const [newLast, setNewLast] = useState('');
  const [newPhone, setNewPhone] = useState('');

  const [jobType, setJobType] = useState('PACKING');
  const [date, setDate] = useState(initialDate || todayKey());
  const [startTime, setStartTime] = useState('09:00');
  const [endTime, setEndTime] = useState('14:00');
  const [cityOrAddress, setCityOrAddress] = useState('');
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

  const runSearch = useCallback(
    async (term: string) => {
      setSearch(term);
      setSelectedCustomer(null);
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

  const submit = useCallback(async () => {
    setError(null);
    if (customerMode === 'EXISTING' && !selectedCustomer) {
      setError('יש לבחור לקוח קיים.');
      return;
    }
    if (customerMode === 'NEW' && !newFirst.trim()) {
      setError('יש להזין שם לקוח.');
      return;
    }
    if (!cityOrAddress.trim()) {
      setError('יש להזין עיר או כתובת.');
      return;
    }
    setBusy(true);
    try {
      const auth = await authHeaders(getToken);
      const payload = {
        customerMode,
        ...(customerMode === 'EXISTING' ? { customerId: selectedCustomer!.id } : {}),
        ...(customerMode === 'NEW'
          ? { newCustomer: { firstName: newFirst.trim(), lastName: newLast.trim(), phone: newPhone.trim() } }
          : {}),
        jobType,
        date,
        startTime,
        endTime,
        cityOrAddress: cityOrAddress.trim(),
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
  }, [customerMode, selectedCustomer, newFirst, newLast, newPhone, jobType, date, startTime, endTime, cityOrAddress, workerCount, requiresTeamLeader, initialStatus, notes, getToken, onCreated]);

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

      {/* Customer */}
      <section className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
        <h2 className="text-sm font-semibold text-gray-900 mb-3">לקוח</h2>
        <div className="flex flex-wrap gap-2 mb-3">
          {([
            ['GENERAL_RESERVATION', 'שריון כללי'],
            ['EXISTING', 'לקוח קיים'],
            ['NEW', 'לקוח חדש'],
          ] as Array<[CustomerMode, string]>).map(([mode, label]) => (
            <button
              key={mode}
              type="button"
              onClick={() => setCustomerMode(mode)}
              className={`rounded-lg px-3 py-1.5 text-sm font-medium ${customerMode === mode ? 'bg-primary-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
            >
              {label}
            </button>
          ))}
        </div>

        {customerMode === 'GENERAL_RESERVATION' && (
          <p className="text-sm text-gray-500">העבודה תשויך לשריון כללי. ניתן לשייך ללקוח אמיתי מאוחר יותר.</p>
        )}

        {customerMode === 'EXISTING' && (
          <div>
            <input
              value={search}
              onChange={(e) => void runSearch(e.target.value)}
              placeholder="חיפוש לפי שם או טלפון…"
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
            />
            {selectedCustomer ? (
              <p className="mt-2 text-sm text-emerald-700">נבחר: {selectedCustomer.firstName} {selectedCustomer.lastName} · {selectedCustomer.phone}</p>
            ) : (
              matches.length > 0 && (
                <div className="mt-2 max-h-44 overflow-auto rounded-lg border border-gray-100">
                  {matches.map((c) => (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => { setSelectedCustomer(c); setMatches([]); }}
                      className="block w-full px-3 py-2 text-right text-sm hover:bg-gray-50"
                    >
                      {c.firstName} {c.lastName} · {c.phone}
                    </button>
                  ))}
                </div>
              )
            )}
          </div>
        )}

        {customerMode === 'NEW' && (
          <div className="grid grid-cols-3 gap-2">
            <input value={newFirst} onChange={(e) => setNewFirst(e.target.value)} placeholder="שם פרטי" className="rounded-lg border border-gray-300 px-3 py-2 text-sm" />
            <input value={newLast} onChange={(e) => setNewLast(e.target.value)} placeholder="שם משפחה" className="rounded-lg border border-gray-300 px-3 py-2 text-sm" />
            <input value={newPhone} onChange={(e) => setNewPhone(e.target.value)} placeholder="טלפון" inputMode="tel" className="rounded-lg border border-gray-300 px-3 py-2 text-sm" />
          </div>
        )}
      </section>

      {/* Job details */}
      <section className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm grid grid-cols-2 gap-3">
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
        <label className="text-sm col-span-2">
          <span className="block text-gray-600 mb-1">עיר או כתובת</span>
          <input value={cityOrAddress} onChange={(e) => setCityOrAddress(e.target.value)} placeholder="לדוגמה: תל אביב, או הרצל 10 תל אביב" className="w-full rounded-lg border border-gray-300 px-2.5 py-2" />
          <span className="mt-1 block text-[11px] text-amber-700">חיפוש/אימות כתובת אינו פעיל עדיין — ניטור מיקום לא זמין עד שהכתובת תעודכן (גיאוקוד).</span>
        </label>
        <label className="text-sm">
          <span className="block text-gray-600 mb-1">מספר עובדים</span>
          <input type="number" min={1} value={workerCount} onChange={(e) => setWorkerCount(e.target.value)} className="w-full rounded-lg border border-gray-300 px-2.5 py-2" />
        </label>
        <label className="text-sm flex items-end gap-2 pb-2">
          <input type="checkbox" checked={requiresTeamLeader} onChange={(e) => setRequiresTeamLeader(e.target.checked)} />
          <span className="text-gray-700">דרוש ראש צוות</span>
        </label>
        <label className="text-sm col-span-2">
          <span className="block text-gray-600 mb-1">הערות (אופציונלי)</span>
          <input value={notes} onChange={(e) => setNotes(e.target.value)} className="w-full rounded-lg border border-gray-300 px-2.5 py-2" />
        </label>
      </section>

      {/* Status */}
      <section className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
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
            disabled={customerMode === 'GENERAL_RESERVATION'}
            title={customerMode === 'GENERAL_RESERVATION' ? 'לא ניתן לאשר עבודה בשריון כללי' : ''}
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
          className="inline-flex items-center gap-1.5 rounded-lg bg-primary-600 px-5 py-2 text-sm font-semibold text-white hover:bg-primary-700 disabled:opacity-50"
        >
          {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
          יצירת העבודה
        </button>
      </div>
    </div>
  );
}

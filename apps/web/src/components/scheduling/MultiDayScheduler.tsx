'use client';

import { useMemo, useState } from 'react';
import { Plus, Trash2, CalendarPlus } from 'lucide-react';
import { api, authHeaders } from '../../lib/api';

type ServiceType = 'PACKING' | 'UNPACKING' | 'HOME_ORGANIZATION';

const SERVICE_LABELS: Record<ServiceType, string> = {
  PACKING: 'אריזה',
  UNPACKING: 'פריקה',
  HOME_ORGANIZATION: 'סידור',
};

type Row = {
  key: string;
  date: string;
  start: string;
  end: string;
  workers: number;
  requiresManager: boolean;
};

type Props = {
  caseId: string;
  customerId: string;
  addresses: Array<{ id: string; fullAddress: string }>;
  getToken: () => Promise<string | null>;
  onCreated: () => void | Promise<void>;
};

function newRow(): Row {
  return { key: `r-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, date: '', start: '09:00', end: '14:00', workers: 4, requiresManager: true };
}

// §6 "Schedule several days" editable table — bulk-creates draft jobs.
export default function MultiDayScheduler({ caseId, customerId, addresses, getToken, onCreated }: Props) {
  const [jobType, setJobType] = useState<ServiceType>('PACKING');
  const [addressId, setAddressId] = useState(addresses[0]?.id ?? '');
  const [rows, setRows] = useState<Row[]>([newRow()]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [offerUnpacking, setOfferUnpacking] = useState(false);

  const canSave = useMemo(
    () => Boolean(addressId) && rows.some((r) => r.date && r.start && r.end && r.workers > 0),
    [addressId, rows],
  );

  const updateRow = (key: string, patch: Partial<Row>) =>
    setRows((prev) => prev.map((r) => (r.key === key ? { ...r, ...patch } : r)));

  const saveAll = async () => {
    setBusy(true);
    setMessage('');
    const validRows = rows.filter((r) => r.date && r.start && r.end && r.workers > 0);
    let created = 0;
    try {
      const auth = await authHeaders(getToken);
      for (const row of validRows) {
        await api.post(
          '/jobs',
          {
            caseId,
            customerId,
            addressId,
            jobType,
            date: `${row.date}T00:00:00.000Z`,
            plannedStart: `${row.date}T${row.start}:00.000Z`,
            plannedEnd: `${row.date}T${row.end}:00.000Z`,
            requiredWorkerCount: row.workers,
            staffingMode: 'MANAGER_APPROVAL',
            workerSlots: [
              ...(row.requiresManager ? [{ requiredSkill: 'SHIFT_LEADER' as const }] : []),
              ...Array.from({ length: row.workers }, () => ({})),
            ],
          },
          auth,
        );
        created += 1;
      }
      setMessage(`${created} ימי עבודה נשמרו כטיוטה.`);
      setRows([newRow()]);
      // §6/§12: after saving packing days, offer to schedule unpacking too.
      if (jobType === 'PACKING' && created > 0) {
        setOfferUnpacking(true);
      }
      await onCreated();
    } catch {
      setMessage(`נשמרו ${created} מתוך ${validRows.length} ימים. חלק מהימים נכשלו — ודאי שהתאריכים תקינים.`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
      <div className="flex items-center gap-2 mb-3">
        <CalendarPlus className="w-4 h-4 text-primary-600" />
        <h2 className="text-sm font-semibold text-gray-900">תזמון מספר ימי עבודה</h2>
      </div>
      {offerUnpacking && (
        <div className="mb-3 rounded-lg border border-primary-200 bg-primary-50 p-3">
          <p className="text-sm text-gray-900">ימי האריזה נשמרו.</p>
          <p className="text-xs text-gray-600 mt-0.5">האם תרצי לקבוע עכשיו גם את ימי הפריקה?</p>
          <div className="mt-2 flex items-center gap-2">
            <button
              type="button"
              onClick={() => {
                setJobType('UNPACKING');
                setRows([newRow()]);
                setOfferUnpacking(false);
                setMessage('');
              }}
              className="px-3 py-1.5 text-xs rounded-lg bg-primary-600 text-white hover:bg-primary-700"
            >
              קביעת פריקה
            </button>
            <button
              type="button"
              onClick={() => setOfferUnpacking(false)}
              className="px-3 py-1.5 text-xs rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50"
            >
              אחר כך
            </button>
          </div>
        </div>
      )}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-3">
        <label className="text-sm">
          <span className="text-gray-600">סוג עבודה</span>
          <select
            value={jobType}
            onChange={(e) => setJobType(e.target.value as ServiceType)}
            aria-label="סוג עבודה"
            className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm bg-white"
          >
            {(Object.keys(SERVICE_LABELS) as ServiceType[]).map((s) => (
              <option key={s} value={s}>{SERVICE_LABELS[s]}</option>
            ))}
          </select>
        </label>
        <label className="text-sm">
          <span className="text-gray-600">כתובת</span>
          <select
            value={addressId}
            onChange={(e) => setAddressId(e.target.value)}
            aria-label="כתובת"
            className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm bg-white"
          >
            {addresses.length === 0 && <option value="">אין כתובת זמינה</option>}
            {addresses.map((a) => (
              <option key={a.id} value={a.id}>{a.fullAddress}</option>
            ))}
          </select>
        </label>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-xs text-gray-500 border-b border-gray-100">
              <th className="text-right font-medium py-2">תאריך</th>
              <th className="text-right font-medium py-2">התחלה</th>
              <th className="text-right font-medium py-2">סיום</th>
              <th className="text-right font-medium py-2">עובדים</th>
              <th className="text-right font-medium py-2">מנהל</th>
              <th className="py-2" />
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.key} className="border-b border-gray-50">
                <td className="py-2 pe-2">
                  <input type="date" value={row.date} onChange={(e) => updateRow(row.key, { date: e.target.value })} aria-label="תאריך" className="rounded-md border border-gray-300 px-2 py-1 text-xs" />
                </td>
                <td className="py-2 pe-2">
                  <input type="time" value={row.start} onChange={(e) => updateRow(row.key, { start: e.target.value })} aria-label="שעת התחלה" className="rounded-md border border-gray-300 px-2 py-1 text-xs" />
                </td>
                <td className="py-2 pe-2">
                  <input type="time" value={row.end} onChange={(e) => updateRow(row.key, { end: e.target.value })} aria-label="שעת סיום" className="rounded-md border border-gray-300 px-2 py-1 text-xs" />
                </td>
                <td className="py-2 pe-2">
                  <input type="number" min={1} value={row.workers} onChange={(e) => updateRow(row.key, { workers: Number(e.target.value) })} aria-label="מספר עובדים" className="w-16 rounded-md border border-gray-300 px-2 py-1 text-xs" />
                </td>
                <td className="py-2 pe-2">
                  <input type="checkbox" checked={row.requiresManager} onChange={(e) => updateRow(row.key, { requiresManager: e.target.checked })} aria-label="נדרש ראש צוות" className="h-4 w-4" />
                </td>
                <td className="py-2">
                  <button
                    type="button"
                    onClick={() => setRows((prev) => (prev.length > 1 ? prev.filter((r) => r.key !== row.key) : prev))}
                    disabled={rows.length === 1}
                    aria-label="הסרת שורה"
                    className="text-gray-400 hover:text-rose-600 disabled:opacity-30"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => setRows((prev) => [...prev, newRow()])}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg border border-gray-200 text-gray-700 hover:bg-gray-50"
        >
          <Plus className="w-3.5 h-3.5" />
          הוספת יום
        </button>
        <button
          type="button"
          onClick={() => void saveAll()}
          disabled={busy || !canSave}
          className="inline-flex items-center gap-1.5 px-4 py-1.5 text-xs rounded-lg bg-primary-600 text-white hover:bg-primary-700 disabled:opacity-50"
        >
          שמירת ימי העבודה
        </button>
        {message && <span className="text-xs text-gray-600">{message}</span>}
      </div>
    </section>
  );
}

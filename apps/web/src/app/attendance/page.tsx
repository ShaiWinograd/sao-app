'use client';

import { Fragment, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, Clock3, MapPin, ShieldAlert } from 'lucide-react';
import { api } from '../../lib/api';

type AttendanceStatus = 'תקין' | 'חריגה' | 'מחכה לאישור' | 'תוקן ידנית';
type ExceptionType =
  | 'שכחתי להתחיל משמרת'
  | 'שכחתי לסיים משמרת'
  | 'בעיית הרשאת מיקום'
  | 'כתובת לא נכונה'
  | 'יציאה זמנית למשימה'
  | 'איסוף ציוד';

type AttendanceRecord = {
  id: string;
  workerName: string;
  customerName: string;
  date: string;
  startTime: string;
  endTime: string;
  startDistanceMeters: number;
  endDistanceMeters: number;
  status: AttendanceStatus;
  method: 'ידני' | 'אוטומטי' | 'תיקון אדמין';
};

type AttendanceException = {
  id: string;
  workerName: string;
  jobLabel: string;
  submittedAt: string;
  type: ExceptionType;
  note: string;
  status: 'ממתין' | 'אושר' | 'נדחה';
};

type ApiShift = {
  id: string;
  scheduledStart: string;
  scheduledEnd: string;
  actualStart?: string | null;
  actualEnd?: string | null;
  clockInDistanceMeters?: number | null;
  clockOutDistanceMeters?: number | null;
  attendanceStatus: string;
  clockInMethod?: string | null;
  requiresReview: boolean;
  worker: { id: string; firstName: string; lastName: string };
  job: { date: string; jobType: string };
};

function mapApiStatusToUi(status: string): AttendanceStatus {
  if (status === 'CLOCKED_OUT') return 'תקין';
  if (status === 'CORRECTED') return 'תוקן ידנית';
  if (status === 'CLOCKED_IN' || status === 'SCHEDULED') return 'מחכה לאישור';
  return 'חריגה';
}

function mapApiMethodToUi(method?: string | null): 'ידני' | 'אוטומטי' | 'תיקון אדמין' {
  if (method === 'ADMIN_CORRECTED') return 'תיקון אדמין';
  if (method === 'NORMAL') return 'ידני';
  return 'אוטומטי';
}

function formatTimeFromIso(iso?: string | null): string {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

function formatDateFromIso(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleDateString('he-IL', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

function mapApiShiftToRecord(shift: ApiShift): AttendanceRecord {
  return {
    id: shift.id,
    workerName: `${shift.worker.firstName} ${shift.worker.lastName}`.trim(),
    customerName: '—',
    date: formatDateFromIso(shift.job.date),
    startTime: formatTimeFromIso(shift.actualStart ?? shift.scheduledStart),
    endTime: formatTimeFromIso(shift.actualEnd ?? shift.scheduledEnd),
    startDistanceMeters: shift.clockInDistanceMeters ?? 0,
    endDistanceMeters: shift.clockOutDistanceMeters ?? 0,
    status: mapApiStatusToUi(shift.attendanceStatus),
    method: mapApiMethodToUi(shift.clockInMethod),
  };
}

function badgeClass(status: AttendanceStatus) {
  if (status === 'תקין') return 'bg-emerald-50 text-emerald-700 border-emerald-200';
  if (status === 'חריגה') return 'bg-red-50 text-red-700 border-red-200';
  if (status === 'מחכה לאישור') return 'bg-amber-50 text-amber-700 border-amber-200';
  return 'bg-blue-50 text-blue-700 border-blue-200';
}

export default function AttendancePage() {
  const [records, setRecords] = useState<AttendanceRecord[]>([]);
  const [exceptions, setExceptions] = useState<AttendanceException[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [dataError, setDataError] = useState('');
  const [radiusMeters, setRadiusMeters] = useState(500);
  const [graceMinutes, setGraceMinutes] = useState(12);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | AttendanceStatus>('all');
  const [message, setMessage] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editClockIn, setEditClockIn] = useState('');
  const [editClockOut, setEditClockOut] = useState('');
  const [editReason, setEditReason] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);

  const approveRecord = async (shiftId: string) => {
    setBusyId(shiftId);
    try {
      await api.post('/attendance/correct', { shiftId, reason: 'אושר על ידי אדמין' });
      setMessage('הנוכחות אושרה.');
      await loadData();
    } catch {
      setMessage('אישור הנוכחות נכשל. נסי שוב.');
    } finally {
      setBusyId(null);
    }
  };

  const saveCorrection = async (shiftId: string) => {
    setBusyId(shiftId);
    try {
      await api.post('/attendance/correct', {
        shiftId,
        ...(editClockIn ? { clockIn: editClockIn } : {}),
        ...(editClockOut ? { clockOut: editClockOut } : {}),
        reason: editReason.trim() || 'תיקון ידני',
      });
      setEditingId(null);
      setEditClockIn('');
      setEditClockOut('');
      setEditReason('');
      setMessage('התיקון נשמר.');
      await loadData();
    } catch {
      setMessage('שמירת התיקון נכשלה. נסי שוב.');
    } finally {
      setBusyId(null);
    }
  };

  useEffect(() => {
    void loadData();
  }, []);

  async function loadData() {
    setIsLoading(true);
    setDataError('');
    try {
      const res = await api.get<ApiShift[]>('/attendance/needs-review');
      setRecords(res.data.map(mapApiShiftToRecord));
    } catch {
      setDataError('לא ניתן לטעון נתוני נוכחות. בדקי שה-API זמין ושיש לך הרשאות אדמין.');
    } finally {
      setIsLoading(false);
    }
  }

  const filteredRecords = useMemo(() => {
    const term = search.trim().toLowerCase();
    return records.filter((record) => {
      const matchStatus = statusFilter === 'all' || record.status === statusFilter;
      const matchSearch =
        !term ||
        record.workerName.toLowerCase().includes(term) ||
        record.customerName.toLowerCase().includes(term) ||
        record.date.includes(term);
      return matchStatus && matchSearch;
    });
  }, [records, search, statusFilter]);

  const pendingExceptions = exceptions.filter((item) => item.status === 'ממתין');
  const outOfRadiusCount = records.filter(
    (record) => record.startDistanceMeters > radiusMeters || record.endDistanceMeters > radiusMeters,
  ).length;

  const updateException = async (id: string, status: 'אושר' | 'נדחה') => {
    setExceptions((prev) => prev.map((item) => (item.id === id ? { ...item, status } : item)));
    if (status === 'אושר') {
      try {
        await api.post('/attendance/correct', {
          shiftId: id,
          reason: 'אושר על ידי אדמין',
        });
        setMessage('בקשת החריגה אושרה ותוקן ידנית.');
        setRecords((prev) =>
          prev.map((record) =>
            record.id === id
              ? { ...record, status: 'תוקן ידנית' as AttendanceStatus, method: 'תיקון אדמין' as const }
              : record,
          ),
        );
      } catch {
        setMessage('אישור החריגה נכשל. נסי שוב.');
      }
    } else {
      setMessage('בקשת החריגה נדחתה.');
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 mb-1">ניהול נוכחות ומיקום</h1>
          <p className="text-sm text-gray-500">בדיקות מיקום בתחילת משמרת, כל 15 דקות, ובסיום — לפי מדיניות רדיוס.</p>
        </div>
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          <div className="font-semibold">נדרש טיפול: {pendingExceptions.length}</div>
          <div>חריגות רדיוס: {outOfRadiusCount}</div>
        </div>
      </div>

      {dataError && (
        <div className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{dataError}</div>
      )}

      <section className="grid gap-4 md:grid-cols-3">
        <article className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
          <div className="flex items-center gap-2 text-sm text-gray-600 mb-2">
            <MapPin className="w-4 h-4" />
            רדיוס ברירת מחדל
          </div>
          <input
            type="number"
            min={100}
            max={2000}
            value={radiusMeters}
            onChange={(event) => setRadiusMeters(Number(event.target.value))}
            className="w-full rounded-xl border border-gray-300 px-3 py-2 text-sm"
          />
          <p className="text-xs text-gray-500 mt-2">מטרים מהכתובת. ניתן לשנות פר-עבודה במסך עבודות.</p>
        </article>

        <article className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
          <div className="flex items-center gap-2 text-sm text-gray-600 mb-2">
            <Clock3 className="w-4 h-4" />
            זמן חסד לאזהרת יציאה
          </div>
          <input
            type="number"
            min={5}
            max={30}
            value={graceMinutes}
            onChange={(event) => setGraceMinutes(Number(event.target.value))}
            className="w-full rounded-xl border border-gray-300 px-3 py-2 text-sm"
          />
          <p className="text-xs text-gray-500 mt-2">אם אין תגובה בזמן זה, מבוצע סיום משמרת אוטומטי.</p>
        </article>

        <article className="rounded-2xl border border-red-200 bg-red-50 p-4 shadow-sm">
          <div className="flex items-center gap-2 text-sm text-red-700 mb-2">
            <ShieldAlert className="w-4 h-4" />
            תזכורת פרטיות
          </div>
          <p className="text-xs text-red-700">
            נתוני מיקום מוצגים רק לבעלים ולאדמין מורשה. אין מעקב רציף — רק באירועי נוכחות.
          </p>
        </article>
      </section>

      <section className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="חיפוש לפי עובדת / לקוח / תאריך"
            className="w-full max-w-xs rounded-xl border border-gray-300 px-3 py-2 text-sm"
          />
          <select
            value={statusFilter}
            onChange={(event) => setStatusFilter(event.target.value as 'all' | AttendanceStatus)}
            className="rounded-xl border border-gray-300 px-3 py-2 text-sm"
          >
            <option value="all">כל הסטטוסים</option>
            <option value="תקין">תקין</option>
            <option value="חריגה">חריגה</option>
            <option value="מחכה לאישור">מחכה לאישור</option>
            <option value="תוקן ידנית">תוקן ידנית</option>
          </select>
        </div>

        {isLoading ? (
          <div className="py-6 text-center text-sm text-gray-500">טוען נתוני נוכחות...</div>
        ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-right text-gray-500 border-b border-gray-100">
                <th className="px-2 py-2 font-medium">עובדת</th>
                <th className="px-2 py-2 font-medium">לקוח</th>
                <th className="px-2 py-2 font-medium">תאריך</th>
                <th className="px-2 py-2 font-medium">שעות</th>
                <th className="px-2 py-2 font-medium">מרחק התחלה / סיום</th>
                <th className="px-2 py-2 font-medium">שיטה</th>
                <th className="px-2 py-2 font-medium">סטטוס</th>
                <th className="px-2 py-2 font-medium">פעולות</th>
              </tr>
            </thead>
            <tbody>
              {filteredRecords.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-2 py-6 text-center text-sm text-gray-500">אין רשומות נוכחות הדורשות בדיקה כרגע.</td>
                </tr>
              ) : filteredRecords.map((record) => (
                <Fragment key={record.id}>
                <tr className="border-b border-gray-50 last:border-b-0">
                  <td className="px-2 py-2">{record.workerName}</td>
                  <td className="px-2 py-2">{record.customerName}</td>
                  <td className="px-2 py-2">{record.date}</td>
                  <td className="px-2 py-2">
                    {record.startTime} - {record.endTime}
                  </td>
                  <td className="px-2 py-2">
                    {record.startDistanceMeters}m / {record.endDistanceMeters}m
                  </td>
                  <td className="px-2 py-2">{record.method}</td>
                  <td className="px-2 py-2">
                    <span className={`inline-flex items-center rounded-full border px-2 py-1 text-xs ${badgeClass(record.status)}`}>
                      {record.status}
                    </span>
                  </td>
                  <td className="px-2 py-2">
                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => void approveRecord(record.id)}
                        disabled={busyId === record.id}
                        className="px-2 py-1 text-[11px] rounded-lg bg-primary-600 text-white hover:bg-primary-700 disabled:opacity-50"
                      >
                        אישור
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setEditingId(editingId === record.id ? null : record.id);
                          setEditClockIn('');
                          setEditClockOut('');
                          setEditReason('');
                        }}
                        className="px-2 py-1 text-[11px] rounded-lg border border-gray-200 text-gray-700 hover:bg-gray-50"
                      >
                        תיקון
                      </button>
                    </div>
                  </td>
                </tr>
                {editingId === record.id && (
                  <tr className="bg-gray-50/60">
                    <td colSpan={8} className="px-3 py-3">
                      <div className="flex flex-wrap items-end gap-3">
                        <label className="text-xs text-gray-600">
                          <span className="block mb-1">כניסה מתוקנת</span>
                          <input type="datetime-local" value={editClockIn} onChange={(e) => setEditClockIn(e.target.value)} className="rounded-lg border border-gray-300 px-2 py-1.5 text-sm" />
                        </label>
                        <label className="text-xs text-gray-600">
                          <span className="block mb-1">יציאה מתוקנת</span>
                          <input type="datetime-local" value={editClockOut} onChange={(e) => setEditClockOut(e.target.value)} className="rounded-lg border border-gray-300 px-2 py-1.5 text-sm" />
                        </label>
                        <label className="text-xs text-gray-600 flex-1 min-w-[200px]">
                          <span className="block mb-1">סיבת התיקון</span>
                          <input value={editReason} onChange={(e) => setEditReason(e.target.value)} placeholder="למשל: העובד שכח להחתים יציאה" className="w-full rounded-lg border border-gray-300 px-2 py-1.5 text-sm" />
                        </label>
                        <button
                          type="button"
                          onClick={() => void saveCorrection(record.id)}
                          disabled={busyId === record.id}
                          className="px-3 py-2 text-sm rounded-lg bg-primary-600 text-white hover:bg-primary-700 disabled:opacity-50"
                        >
                          שמירת תיקון
                        </button>
                      </div>
                    </td>
                  </tr>
                )}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
        )}
      </section>

      <section className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
        <h2 className="text-lg font-semibold mb-3">בקשות חריגה ותיקוני נוכחות</h2>
        <div className="space-y-3">
          {exceptions.map((item) => (
            <article key={item.id} className="rounded-xl border border-gray-200 p-3">
              <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
                <div className="text-sm font-semibold text-gray-900">
                  {item.workerName} • {item.jobLabel}
                </div>
                <span className="text-xs text-gray-500">{item.submittedAt}</span>
              </div>
              <div className="text-sm text-gray-700 mb-1">סוג חריגה: {item.type}</div>
              <div className="text-sm text-gray-600 mb-3">{item.note}</div>
              <div className="flex items-center gap-2">
                {item.status === 'ממתין' ? (
                  <>
                    <button
                      type="button"
                      onClick={() => updateException(item.id, 'אושר')}
                      className="inline-flex items-center gap-1 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-700"
                    >
                      <CheckCircle2 className="w-3.5 h-3.5" />
                      אישור
                    </button>
                    <button
                      type="button"
                      onClick={() => updateException(item.id, 'נדחה')}
                      className="inline-flex items-center gap-1 rounded-lg bg-red-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-red-700"
                    >
                      <AlertTriangle className="w-3.5 h-3.5" />
                      דחייה
                    </button>
                  </>
                ) : (
                  <span className="rounded-full border border-gray-200 bg-gray-50 px-2 py-1 text-xs text-gray-700">
                    סטטוס: {item.status}
                  </span>
                )}
              </div>
            </article>
          ))}
        </div>
      </section>

      {message ? <div className="rounded-xl border border-blue-200 bg-blue-50 px-3 py-2 text-sm text-blue-700">{message}</div> : null}
    </div>
  );
}

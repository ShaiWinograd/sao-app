'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAuth } from '@clerk/nextjs';
import { ChevronRight, ChevronLeft, CalendarDays, Clock, Wallet, CheckCircle2, MessageSquareWarning, MessageSquarePlus, Trash2, Download } from 'lucide-react';
import { api, authHeaders } from '../../../lib/api';

type EarningsLine = { shiftId: string; date: string; customerName: string; approvedHours: number; pay: number };
type Adjustment = { id: string; amount: number; reason: string; category: string };
type Payment = { id: string; amount: number; paymentDate: string; method: string };
type ReportNote = { id: string; shiftId: string | null; type: string; message: string; createdAt: string };
type Earnings = {
  month: number;
  year: number;
  status: string;
  version: number | null;
  isPublished: boolean;
  workerNote: string | null;
  shifts: EarningsLine[];
  adjustments: Adjustment[];
  payments: Payment[];
  notes: ReportNote[];
  summary: {
    shiftsCount: number;
    totalApprovedHours: number;
    hourlyPay: number;
    dailyPay: number;
    adjustmentTotal: number;
    totalDue: number;
    totalPaid: number;
    outstanding: number;
  };
};

const MONTHS = ['ינואר', 'פברואר', 'מרץ', 'אפריל', 'מאי', 'יוני', 'יולי', 'אוגוסט', 'ספטמבר', 'אוקטובר', 'נובמבר', 'דצמבר'];

const STATUS_LABEL: Record<string, string> = {
  DRAFT: 'טרם פורסם',
  PUBLISHED: 'פורסם – ממתין לאישורך',
  REVISED: 'עודכן – ממתין לאישורך',
  CORRECTION_REQUESTED: 'בקשת תיקון',
  WORKER_APPROVED: 'אושר',
  PAID: 'שולם',
};

const STATUS_CLASS: Record<string, string> = {
  DRAFT: 'border-gray-200 bg-gray-50 text-gray-500',
  PUBLISHED: 'border-amber-200 bg-amber-50 text-amber-700',
  REVISED: 'border-amber-200 bg-amber-50 text-amber-700',
  CORRECTION_REQUESTED: 'border-rose-200 bg-rose-50 text-rose-700',
  WORKER_APPROVED: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  PAID: 'border-primary-200 bg-primary-50 text-primary-700',
};

function ils(n: number): string {
  return `₪${(n ?? 0).toLocaleString('he-IL', { maximumFractionDigits: 2 })}`;
}

function fmtDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString('he-IL', { day: '2-digit', month: '2-digit' });
  } catch {
    return '';
  }
}

export default function WorkerReportsPage() {
  const { getToken } = useAuth();
  const now = new Date();
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [year, setYear] = useState(now.getFullYear());
  const [data, setData] = useState<Earnings | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [disputeOpen, setDisputeOpen] = useState(false);
  const [disputeNote, setDisputeNote] = useState('');
  const [approvalBusy, setApprovalBusy] = useState(false);
  const [noteBusy, setNoteBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(false);
    try {
      const auth = await authHeaders(getToken);
      const res = await api.get<Earnings>(`/payroll/me?month=${month}&year=${year}`, auth);
      setData(res.data);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, [getToken, month, year]);

  useEffect(() => {
    void load();
  }, [load]);

  const step = useCallback(
    (delta: number) => {
      setData(null);
      setDisputeOpen(false);
      setDisputeNote('');
      const next = new Date(year, month - 1 + delta, 1);
      setMonth(next.getMonth() + 1);
      setYear(next.getFullYear());
    },
    [month, year],
  );

  const submitApproval = useCallback(
    async (action: 'APPROVE' | 'REQUEST_CHANGES', note?: string) => {
      setApprovalBusy(true);
      try {
        const auth = await authHeaders(getToken);
        await api.post('/payroll/me/approval', { month, year, action, note }, auth);
        setDisputeOpen(false);
        setDisputeNote('');
        await load();
      } catch {
        /* surfaced by reload */
      } finally {
        setApprovalBusy(false);
      }
    },
    [getToken, month, year, load],
  );

  const downloadPdf = useCallback(async () => {
    try {
      const auth = await authHeaders(getToken);
      const res = await api.get(`/payroll/me/report.pdf?month=${month}&year=${year}`, { ...auth, responseType: 'blob' });
      const url = URL.createObjectURL(res.data as Blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `worker-report-${year}-${String(month).padStart(2, '0')}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch {
      /* ignore */
    }
  }, [getToken, month, year]);

  const isCurrentOrFuture = useMemo(() => {
    const first = new Date(year, month - 1, 1);
    const thisMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    return first >= thisMonth;
  }, [month, year, now]);

  const addNote = useCallback(
    async (type: 'COMMENT' | 'MISSING_SHIFT', message: string, shiftId?: string) => {
      setNoteBusy(true);
      try {
        const auth = await authHeaders(getToken);
        await api.post('/payroll/me/notes', { month, year, type, message, shiftId }, auth);
        await load();
      } catch {
        /* surfaced by reload */
      } finally {
        setNoteBusy(false);
      }
    },
    [getToken, month, year, load],
  );

  const removeNote = useCallback(
    async (id: string) => {
      try {
        const auth = await authHeaders(getToken);
        await api.delete(`/payroll/me/notes/${id}`, auth);
        await load();
      } catch {
        /* surfaced by reload */
      }
    },
    [getToken, load],
  );

  return (
    <div className="space-y-4 max-w-2xl">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-gray-900">הדוחות שלי</h1>
        {data && !loading && !error && (
          <button
            type="button"
            onClick={() => window.print()}
            className="no-print inline-flex items-center gap-1.5 rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50"
          >
            <Download className="w-3.5 h-3.5" />
            הורדת PDF
          </button>
        )}
      </div>

      {/* Print-only report header */}
      <div className="print-only">
        <p className="text-lg font-bold text-gray-900">דוח חודשי · {MONTHS[month - 1]} {year}</p>
      </div>

      {/* Month navigation */}
      <div className="no-print flex items-center justify-between rounded-xl border border-gray-200 bg-white px-3 py-2">
        <button type="button" onClick={() => step(-1)} aria-label="חודש קודם" className="rounded-lg p-1.5 text-gray-500 hover:bg-gray-50">
          <ChevronRight className="w-4 h-4" />
        </button>
        <span className="flex items-center gap-2 text-sm font-semibold text-gray-900">
          <CalendarDays className="w-4 h-4 text-gray-400" />
          {MONTHS[month - 1]} {year}
        </span>
        <button
          type="button"
          onClick={() => step(1)}
          disabled={isCurrentOrFuture}
          aria-label="חודש הבא"
          className="rounded-lg p-1.5 text-gray-500 hover:bg-gray-50 disabled:opacity-30"
        >
          <ChevronLeft className="w-4 h-4" />
        </button>
      </div>

      {loading ? (
        <p className="text-sm text-gray-400">טוען…</p>
      ) : error || !data ? (
        <p className="rounded-xl border border-gray-200 bg-white p-4 text-sm text-gray-500">לא נמצא פרופיל עובד/ת לחשבון זה.</p>
      ) : (
        <>
          {/* Summary */}
          <div className="rounded-xl border border-gray-200 bg-white p-4 space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="flex items-center gap-2 text-sm font-semibold text-gray-900">
                <Wallet className="w-4 h-4 text-gray-400" />
                סיכום חודשי
              </h2>
              <div className="flex items-center gap-2">
                {data.isPublished && (
                  <button
                    type="button"
                    onClick={() => void downloadPdf()}
                    className="inline-flex items-center gap-1 rounded-lg border border-gray-200 px-2 py-0.5 text-[11px] text-gray-600 hover:bg-gray-50"
                  >
                    <Download className="w-3.5 h-3.5" />
                    PDF
                  </button>
                )}
                <span className={`rounded-full border px-2.5 py-0.5 text-[11px] font-medium ${STATUS_CLASS[data.status] ?? STATUS_CLASS.DRAFT}`}>
                  {STATUS_LABEL[data.status] ?? data.status}
                  {data.version ? ` · v${data.version}` : ''}
                </span>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3 text-sm">
              <Stat label="משמרות" value={String(data.summary.shiftsCount)} />
              <Stat label="שעות מאושרות" value={`${data.summary.totalApprovedHours}`} icon={<Clock className="w-3.5 h-3.5" />} />
              <Stat label="תשלום שעתי" value={ils(data.summary.hourlyPay)} />
              <Stat label="תשלום יומי" value={ils(data.summary.dailyPay)} />
              {data.summary.adjustmentTotal !== 0 && <Stat label="התאמות" value={ils(data.summary.adjustmentTotal)} />}
              <Stat label="סה״כ מגיע" value={ils(data.summary.totalDue)} strong />
              <Stat label="שולם" value={ils(data.summary.totalPaid)} />
              <Stat label="יתרה לתשלום" value={ils(data.summary.outstanding)} strong />
            </div>
          </div>

          {/* Report approval */}
          {data.summary.shiftsCount > 0 && (
            <div className="no-print">
              <ApprovalCard
                status={data.status}
                isPublished={data.isPublished}
                workerNote={data.workerNote}
                busy={approvalBusy}
                disputeOpen={disputeOpen}
                disputeNote={disputeNote}
                setDisputeOpen={setDisputeOpen}
                setDisputeNote={setDisputeNote}
                onApprove={() => void submitApproval('APPROVE')}
                onRequestChanges={() => void submitApproval('REQUEST_CHANGES', disputeNote.trim())}
              />
            </div>
          )}

          {/* Shifts */}
          <section>
            <h2 className="text-sm font-semibold text-gray-900 mb-2">משמרות</h2>
            {data.shifts.length === 0 ? (
              <p className="rounded-xl border border-gray-200 bg-white p-4 text-sm text-gray-500">אין משמרות שהושלמו בחודש זה.</p>
            ) : (
              <div className="space-y-2">
                {data.shifts.map((s) => (
                  <div key={s.shiftId} className="flex items-center justify-between gap-2 rounded-xl border border-gray-200 bg-white px-3 py-2.5">
                    <div>
                      <p className="text-sm font-medium text-gray-900">{s.customerName || 'לקוח/ה'}</p>
                      <p className="text-xs text-gray-500 mt-0.5">{fmtDate(s.date)} · {s.approvedHours} שעות</p>
                    </div>
                    <span className="text-sm font-semibold text-gray-900">{ils(s.pay)}</span>
                  </div>
                ))}
              </div>
            )}
          </section>

          {/* Adjustments */}
          {data.adjustments.length > 0 && (
            <section>
              <h2 className="text-sm font-semibold text-gray-900 mb-2">התאמות</h2>
              <div className="space-y-2">
                {data.adjustments.map((a) => (
                  <div key={a.id} className="flex items-center justify-between gap-2 rounded-xl border border-gray-200 bg-white px-3 py-2.5">
                    <p className="text-sm text-gray-700">{a.reason}</p>
                    <span className={`text-sm font-semibold ${a.amount < 0 ? 'text-rose-600' : 'text-primary-700'}`}>{ils(a.amount)}</span>
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* Payments */}
          {data.payments.length > 0 && (
            <section>
              <h2 className="text-sm font-semibold text-gray-900 mb-2">תשלומים שהתקבלו</h2>
              <div className="space-y-2">
                {data.payments.map((p) => (
                  <div key={p.id} className="flex items-center justify-between gap-2 rounded-xl border border-gray-200 bg-white px-3 py-2.5">
                    <p className="text-xs text-gray-500">{fmtDate(p.paymentDate)}</p>
                    <span className="text-sm font-semibold text-primary-700">{ils(p.amount)}</span>
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* Comments & missing-shift reports */}
          <div className="no-print">
            <NotesSection
              notes={data.notes}
              shifts={data.shifts}
              busy={noteBusy}
              onAdd={addNote}
              onDelete={removeNote}
            />
          </div>
        </>
      )}
    </div>
  );
}

function Stat({ label, value, icon, strong }: { label: string; value: string; icon?: React.ReactNode; strong?: boolean }) {
  return (
    <div className="rounded-lg bg-gray-50 px-3 py-2">
      <p className="flex items-center gap-1 text-[11px] text-gray-500">
        {icon}
        {label}
      </p>
      <p className={`mt-0.5 ${strong ? 'text-base font-bold text-gray-900' : 'text-sm font-medium text-gray-800'}`}>{value}</p>
    </div>
  );
}

function ApprovalCard({
  status,
  isPublished,
  workerNote,
  busy,
  disputeOpen,
  disputeNote,
  setDisputeOpen,
  setDisputeNote,
  onApprove,
  onRequestChanges,
}: {
  status: string;
  isPublished: boolean;
  workerNote: string | null;
  busy: boolean;
  disputeOpen: boolean;
  disputeNote: string;
  setDisputeOpen: (v: boolean) => void;
  setDisputeNote: (v: string) => void;
  onApprove: () => void;
  onRequestChanges: () => void;
}) {
  if (!isPublished) {
    return (
      <div className="rounded-xl border border-gray-200 bg-gray-50 p-4">
        <p className="text-sm text-gray-600">הדוח החודשי טרם פורסם על ידי בעל/ת העסק.</p>
      </div>
    );
  }
  if (status === 'PAID') {
    return (
      <div className="rounded-xl border border-primary-200 bg-primary-50 p-4">
        <p className="flex items-center gap-2 text-sm font-semibold text-primary-800">
          <CheckCircle2 className="w-4 h-4" />
          הדוח סומן כשולם
        </p>
      </div>
    );
  }
  if (status === 'WORKER_APPROVED') {
    return (
      <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4">
        <p className="flex items-center gap-2 text-sm font-semibold text-emerald-800">
          <CheckCircle2 className="w-4 h-4" />
          אישרת את הדוח החודשי
        </p>
        <p className="mt-1 text-xs text-emerald-700">אם תפורסם גרסה מעודכנת, תתבקשי לאשר אותה מחדש.</p>
      </div>
    );
  }
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4 space-y-3">
      <div>
        <h2 className="text-sm font-semibold text-gray-900">אישור הדוח החודשי</h2>
        <p className="text-xs text-gray-500 mt-0.5">בדקי את הנתונים ואשרי, או בקשי תיקון.</p>
      </div>
      {status === 'CORRECTION_REQUESTED' && (
        <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2">
          <p className="flex items-center gap-1.5 text-xs font-medium text-rose-800">
            <MessageSquareWarning className="w-3.5 h-3.5" />
            ביקשת תיקון — ממתין לגרסה מעודכנת מבעל/ת העסק
          </p>
          {workerNote && <p className="mt-1 text-xs text-rose-700">{workerNote}</p>}
        </div>
      )}
      {status !== 'CORRECTION_REQUESTED' && (disputeOpen ? (
        <div className="space-y-2">
          <textarea
            value={disputeNote}
            onChange={(e) => setDisputeNote(e.target.value)}
            rows={3}
            placeholder="מה צריך לתקן בדוח?"
            className="block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
          />
          <div className="flex gap-2">
            <button
              type="button"
              onClick={onRequestChanges}
              disabled={busy || !disputeNote.trim()}
              className="rounded-lg bg-amber-600 px-3 py-2 text-xs font-semibold text-white hover:bg-amber-700 disabled:opacity-50"
            >
              שליחת בקשת תיקון
            </button>
            <button
              type="button"
              onClick={() => setDisputeOpen(false)}
              disabled={busy}
              className="rounded-lg border border-gray-300 px-3 py-2 text-xs text-gray-700 hover:bg-gray-50"
            >
              ביטול
            </button>
          </div>
        </div>
      ) : (
        <div className="flex gap-2">
          <button
            type="button"
            onClick={onApprove}
            disabled={busy}
            className="inline-flex items-center gap-1.5 rounded-lg bg-primary-600 px-3 py-2 text-xs font-semibold text-white hover:bg-primary-700 disabled:opacity-50"
          >
            <CheckCircle2 className="w-3.5 h-3.5" />
            אישור הדוח
          </button>
          <button
            type="button"
            onClick={() => setDisputeOpen(true)}
            disabled={busy}
            className="rounded-lg border border-gray-300 px-3 py-2 text-xs font-medium text-gray-700 hover:bg-gray-50"
          >
            בקשת תיקון
          </button>
        </div>
      ))}
    </div>
  );
}

function NotesSection({
  notes,
  shifts,
  busy,
  onAdd,
  onDelete,
}: {
  notes: ReportNote[];
  shifts: EarningsLine[];
  busy: boolean;
  onAdd: (type: 'COMMENT' | 'MISSING_SHIFT', message: string, shiftId?: string) => void;
  onDelete: (id: string) => void;
}) {
  const [commentShiftId, setCommentShiftId] = useState('');
  const [commentText, setCommentText] = useState('');
  const [missingText, setMissingText] = useState('');

  const shiftLabel = (id: string | null) => {
    if (!id) return null;
    const s = shifts.find((x) => x.shiftId === id);
    return s ? `${fmtDate(s.date)} · ${s.customerName || 'לקוח/ה'}` : null;
  };

  return (
    <section className="space-y-3">
      <h2 className="text-sm font-semibold text-gray-900">הערות ודיווחים</h2>

      {notes.length > 0 && (
        <div className="space-y-2">
          {notes.map((n) => (
            <div key={n.id} className="flex items-start justify-between gap-2 rounded-xl border border-gray-200 bg-white px-3 py-2.5">
              <div>
                <p className="flex items-center gap-1.5 text-[11px] font-medium text-gray-500">
                  {n.type === 'MISSING_SHIFT' ? (
                    <>
                      <MessageSquareWarning className="w-3.5 h-3.5 text-amber-500" /> דיווח על משמרת חסרה
                    </>
                  ) : (
                    <>
                      <MessageSquarePlus className="w-3.5 h-3.5 text-primary-500" /> הערה{shiftLabel(n.shiftId) ? ` · ${shiftLabel(n.shiftId)}` : ''}
                    </>
                  )}
                </p>
                <p className="mt-0.5 text-sm text-gray-800">{n.message}</p>
              </div>
              <button
                type="button"
                onClick={() => onDelete(n.id)}
                aria-label="מחיקה"
                className="rounded-lg p-1.5 text-gray-400 hover:bg-rose-50 hover:text-rose-600"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Add a comment on a shift */}
      <div className="rounded-xl border border-gray-200 bg-white p-3 space-y-2">
        <p className="text-xs font-semibold text-gray-700">הוספת הערה על משמרת</p>
        {shifts.length === 0 ? (
          <p className="text-xs text-gray-400">אין משמרות בחודש זה.</p>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-2">
              <select
                value={commentShiftId}
                onChange={(e) => setCommentShiftId(e.target.value)}
                className="rounded-lg border border-gray-300 px-2 py-1.5 text-xs bg-white"
              >
                <option value="">בחירת משמרת…</option>
                {shifts.map((s) => (
                  <option key={s.shiftId} value={s.shiftId}>
                    {fmtDate(s.date)} · {s.customerName || 'לקוח/ה'}
                  </option>
                ))}
              </select>
            </div>
            <textarea
              value={commentText}
              onChange={(e) => setCommentText(e.target.value)}
              rows={2}
              placeholder="ההערה שלך"
              className="block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
            />
            <button
              type="button"
              onClick={() => {
                onAdd('COMMENT', commentText.trim(), commentShiftId || undefined);
                setCommentText('');
                setCommentShiftId('');
              }}
              disabled={busy || !commentShiftId || !commentText.trim()}
              className="rounded-lg bg-primary-600 px-3 py-2 text-xs font-semibold text-white hover:bg-primary-700 disabled:opacity-50"
            >
              הוספת הערה
            </button>
          </>
        )}
      </div>

      {/* Report a missing shift */}
      <div className="rounded-xl border border-gray-200 bg-white p-3 space-y-2">
        <p className="text-xs font-semibold text-gray-700">דיווח על משמרת חסרה</p>
        <p className="text-[11px] text-gray-500">עבדת ביום שלא מופיע בדוח? כתבי את התאריך והפרטים.</p>
        <textarea
          value={missingText}
          onChange={(e) => setMissingText(e.target.value)}
          rows={2}
          placeholder="למשל: עבדתי ב-12.8 אצל משפחת כהן ולא מופיע"
          className="block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
        />
        <button
          type="button"
          onClick={() => {
            onAdd('MISSING_SHIFT', missingText.trim());
            setMissingText('');
          }}
          disabled={busy || !missingText.trim()}
          className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-800 hover:bg-amber-100 disabled:opacity-50"
        >
          שליחת דיווח
        </button>
      </div>
    </section>
  );
}

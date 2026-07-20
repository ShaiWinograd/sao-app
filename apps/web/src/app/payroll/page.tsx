'use client';

import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '@clerk/nextjs';
import { ChevronRight, ChevronLeft, Loader2, Send, FileText } from 'lucide-react';
import { api, authHeaders } from '../../lib/api';

const MONTHS = ['ינואר', 'פברואר', 'מרץ', 'אפריל', 'מאי', 'יוני', 'יולי', 'אוגוסט', 'ספטמבר', 'אוקטובר', 'נובמבר', 'דצמבר'];

const STATUS_LABEL: Record<string, string> = {
  DRAFT: 'טרם פורסם',
  PUBLISHED: 'פורסם – ממתין לאישור',
  REVISED: 'עודכן – ממתין לאישור',
  CORRECTION_REQUESTED: 'בקשת תיקון',
  WORKER_APPROVED: 'אושר',
};

const STATUS_CLASS: Record<string, string> = {
  DRAFT: 'border-gray-200 bg-gray-50 text-gray-500',
  PUBLISHED: 'border-amber-200 bg-amber-50 text-amber-700',
  REVISED: 'border-amber-200 bg-amber-50 text-amber-700',
  CORRECTION_REQUESTED: 'border-rose-200 bg-rose-50 text-rose-700',
  WORKER_APPROVED: 'border-emerald-200 bg-emerald-50 text-emerald-700',
};

type ReportSummary = {
  shiftsCount: number;
  totalApprovedHours: number;
  hourlyPay: number;
  dailyPay: number;
  total: number;
};

type SummaryRow = {
  id: string;
  firstName: string;
  lastName: string;
  summary: ReportSummary;
  reportStatus: string;
  version: number | null;
};

type ReportLine = { shiftId: string; date: string; customerName: string; approvedHours: number; pay: number };
type ReportVersion = { id: string; version: number; status: string; publishedAt: string; workerApprovedAt: string | null };
type WorkerReport = {
  workerId: string;
  shifts: ReportLine[];
  summary: ReportSummary;
  reportStatus: string;
  version: number | null;
  versions: ReportVersion[];
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

export default function OwnerWorkerReportsPage() {
  const { getToken } = useAuth();
  const now = new Date();
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [year, setYear] = useState(now.getFullYear());
  const [rows, setRows] = useState<SummaryRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [detail, setDetail] = useState<WorkerReport | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadSummary = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const auth = await authHeaders(getToken);
      const res = await api.get<{ workers: SummaryRow[] }>(`/payroll/summary?month=${month}&year=${year}`, auth);
      setRows(res.data.workers ?? []);
    } catch {
      setError('טעינת הדוחות נכשלה.');
    } finally {
      setLoading(false);
    }
  }, [getToken, month, year]);

  const loadDetail = useCallback(
    async (workerId: string) => {
      setDetailLoading(true);
      try {
        const auth = await authHeaders(getToken);
        const res = await api.get<WorkerReport>(`/payroll/worker/${workerId}?month=${month}&year=${year}`, auth);
        setDetail(res.data);
      } catch {
        setDetail(null);
      } finally {
        setDetailLoading(false);
      }
    },
    [getToken, month, year],
  );

  useEffect(() => {
    void loadSummary();
    setSelected(null);
    setDetail(null);
  }, [loadSummary]);

  useEffect(() => {
    if (selected) void loadDetail(selected);
  }, [selected, loadDetail]);

  const publish = useCallback(async () => {
    if (!selected) return;
    setPublishing(true);
    try {
      const auth = await authHeaders(getToken);
      await api.post(`/payroll/worker/${selected}/publish`, { month, year }, auth);
      await loadDetail(selected);
      await loadSummary();
    } catch {
      setError('פרסום הדוח נכשל.');
    } finally {
      setPublishing(false);
    }
  }, [selected, getToken, month, year, loadDetail, loadSummary]);

  function shiftMonth(delta: number) {
    let m = month + delta;
    let y = year;
    if (m < 1) {
      m = 12;
      y -= 1;
    } else if (m > 12) {
      m = 1;
      y += 1;
    }
    setMonth(m);
    setYear(y);
  }

  return (
    <div className="mx-auto max-w-5xl space-y-4 p-4">
      <header className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-gray-900">דוחות חודשיים לעובדות</h1>
        <div className="flex items-center gap-2">
          <button onClick={() => shiftMonth(-1)} className="rounded-lg border border-gray-200 p-1.5 hover:bg-gray-50" aria-label="חודש קודם">
            <ChevronRight className="h-4 w-4" />
          </button>
          <span className="min-w-[120px] text-center text-sm font-semibold text-gray-700">
            {MONTHS[month - 1]} {year}
          </span>
          <button onClick={() => shiftMonth(1)} className="rounded-lg border border-gray-200 p-1.5 hover:bg-gray-50" aria-label="חודש הבא">
            <ChevronLeft className="h-4 w-4" />
          </button>
        </div>
      </header>

      {error && <p className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p>}

      <div className="grid gap-4 lg:grid-cols-2">
        <section className="rounded-2xl border border-gray-200 bg-white p-3 shadow-sm">
          {loading ? (
            <div className="flex items-center justify-center py-10 text-gray-400">
              <Loader2 className="h-5 w-5 animate-spin" />
            </div>
          ) : rows.length === 0 ? (
            <p className="p-4 text-sm text-gray-500">אין עובדות פעילות לחודש זה.</p>
          ) : (
            <ul className="divide-y divide-gray-100">
              {rows.map((row) => (
                <li key={row.id}>
                  <button
                    onClick={() => setSelected(row.id)}
                    className={`flex w-full items-center justify-between gap-2 px-2 py-3 text-right hover:bg-gray-50 ${selected === row.id ? 'bg-primary-50' : ''}`}
                  >
                    <div>
                      <p className="text-sm font-medium text-gray-900">
                        {row.firstName} {row.lastName}
                      </p>
                      <p className="mt-0.5 text-xs text-gray-500">
                        {row.summary.shiftsCount} משמרות · {row.summary.totalApprovedHours} שעות
                      </p>
                    </div>
                    <div className="flex flex-col items-end gap-1">
                      <span className="text-sm font-semibold text-gray-900">{ils(row.summary.total)}</span>
                      <span className={`rounded-full border px-2 py-0.5 text-[11px] font-medium ${STATUS_CLASS[row.reportStatus] ?? STATUS_CLASS.DRAFT}`}>
                        {STATUS_LABEL[row.reportStatus] ?? row.reportStatus}
                      </span>
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
          {!selected ? (
            <p className="flex items-center gap-2 py-10 text-sm text-gray-400">
              <FileText className="h-4 w-4" /> בחרי עובדת כדי לצפות בדוח ולפרסם
            </p>
          ) : detailLoading || !detail ? (
            <div className="flex items-center justify-center py-10 text-gray-400">
              <Loader2 className="h-5 w-5 animate-spin" />
            </div>
          ) : (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <span className={`rounded-full border px-2.5 py-0.5 text-xs font-medium ${STATUS_CLASS[detail.reportStatus] ?? STATUS_CLASS.DRAFT}`}>
                  {STATUS_LABEL[detail.reportStatus] ?? detail.reportStatus}
                  {detail.version ? ` · גרסה ${detail.version}` : ''}
                </span>
                <button
                  onClick={() => void publish()}
                  disabled={publishing || detail.summary.shiftsCount === 0}
                  className="inline-flex items-center gap-1.5 rounded-xl bg-primary-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-primary-700 disabled:opacity-50"
                >
                  {publishing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                  {detail.version ? 'פרסום גרסה מעודכנת' : 'פרסום הדוח'}
                </button>
              </div>

              <div className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
                <Stat label="משמרות" value={String(detail.summary.shiftsCount)} />
                <Stat label="שעות" value={String(detail.summary.totalApprovedHours)} />
                <Stat label="שעתי" value={ils(detail.summary.hourlyPay)} />
                <Stat label="סה״כ" value={ils(detail.summary.total)} strong />
              </div>

              <div className="space-y-2">
                {detail.shifts.length === 0 ? (
                  <p className="rounded-xl border border-gray-200 bg-gray-50 p-3 text-sm text-gray-500">אין משמרות שהושלמו בחודש זה.</p>
                ) : (
                  detail.shifts.map((s) => (
                    <div key={s.shiftId} className="flex items-center justify-between gap-2 rounded-xl border border-gray-200 px-3 py-2">
                      <div>
                        <p className="text-sm font-medium text-gray-900">{s.customerName || 'לקוח/ה'}</p>
                        <p className="mt-0.5 text-xs text-gray-500">
                          {fmtDate(s.date)} · {s.approvedHours} שעות
                        </p>
                      </div>
                      <span className="text-sm font-semibold text-gray-900">{ils(s.pay)}</span>
                    </div>
                  ))
                )}
              </div>

              {detail.versions.length > 0 && (
                <div>
                  <h3 className="mb-1 text-xs font-semibold text-gray-500">היסטוריית גרסאות</h3>
                  <ul className="space-y-1 text-xs text-gray-600">
                    {detail.versions.map((v) => (
                      <li key={v.id} className="flex items-center justify-between">
                        <span>
                          גרסה {v.version} · {STATUS_LABEL[v.status] ?? v.status}
                        </span>
                        <span>{fmtDate(v.publishedAt)}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

function Stat({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="rounded-xl border border-gray-200 bg-gray-50 px-3 py-2">
      <p className="text-[11px] text-gray-500">{label}</p>
      <p className={`mt-0.5 ${strong ? 'text-base font-bold text-gray-900' : 'text-sm font-semibold text-gray-800'}`}>{value}</p>
    </div>
  );
}

'use client';

import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '@clerk/nextjs';
import { ChevronRight, ChevronLeft, Loader2, Send, FileText, Download } from 'lucide-react';
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
  totalPaidHours: number | null;
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

type ReportLine = { shiftId: string; date: string; customerName: string; shiftLabel?: string; jobTypeLabel?: string; roleLabel?: string; clockIn?: string | null; clockOut?: string | null; approvedHours: number; paidHours: number | null; pay?: number; dayTotal?: number };
type ReportVersion = { id: string; version: number; status: string; publishedAt: string; workerApprovedAt: string | null };
type WorkerReport = {
  workerId: string;
  shifts: ReportLine[];
  summary: ReportSummary;
  reportStatus: string;
  version: number | null;
  versions: ReportVersion[];
};

type VersionView = {
  versionId: string;
  version: number;
  status: string;
  publishedAt: string;
  shifts: ReportLine[];
  summary: { workdays: number; totalApprovedHours: number; totalPaidHours: number | null; total: number };
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
  const [versionView, setVersionView] = useState<VersionView | null>(null);
  const [versionBusy, setVersionBusy] = useState<string | null>(null);

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
    setVersionView(null);
  }, [loadSummary]);

  useEffect(() => {
    setVersionView(null);
    if (selected) void loadDetail(selected);
  }, [selected, loadDetail]);

  const publish = useCallback(async () => {
    if (!selected) return;
    setPublishing(true);
    setError(null);
    try {
      const auth = await authHeaders(getToken);
      await api.post(`/payroll/worker/${selected}/publish`, { month, year }, auth);
      await loadDetail(selected);
      await loadSummary();
    } catch (e) {
      setError((e as { response?: { data?: { error?: string } } })?.response?.data?.error ?? 'פרסום הדוח נכשל.');
    } finally {
      setPublishing(false);
    }
  }, [selected, getToken, month, year, loadDetail, loadSummary]);

  const openVersion = useCallback(
    async (versionId: string) => {
      if (!selected) return;
      setVersionBusy(versionId);
      try {
        const auth = await authHeaders(getToken);
        const res = await api.get<VersionView & { version: number; publishedAt: string; status: string }>(
          `/payroll/worker/${selected}/version/${versionId}`,
          auth,
        );
        setVersionView({ ...res.data, versionId });
      } catch {
        setError('טעינת הגרסה נכשלה.');
      } finally {
        setVersionBusy(null);
      }
    },
    [selected, getToken],
  );

  const closeVersion = useCallback(() => setVersionView(null), []);

  const downloadVersionPdf = useCallback(
    async (versionId: string, version: number) => {
      if (!selected) return;
      setVersionBusy(versionId);
      try {
        const auth = await authHeaders(getToken);
        const res = await api.get(`/payroll/worker/${selected}/version/${versionId}/report.pdf`, { ...auth, responseType: 'blob' });
        const url = URL.createObjectURL(res.data as Blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `worker-report-${year}-${String(month).padStart(2, '0')}-v${version}.pdf`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
      } catch {
        setError('הורדת הדוח נכשלה.');
      } finally {
        setVersionBusy(null);
      }
    },
    [selected, getToken, month, year],
  );

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
          ) : versionView ? (
            <VersionViewPanel
              view={versionView}
              onClose={closeVersion}
              onDownload={() => void downloadVersionPdf(versionView.versionId, versionView.version)}
              busy={versionBusy === versionView.versionId}
            />
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
                <Stat label="שעות נוכחות" value={String(detail.summary.totalApprovedHours)} />
                <Stat label="שעות לתשלום" value={detail.summary.totalPaidHours != null ? String(detail.summary.totalPaidHours) : '—'} />
                <Stat label="סה״כ" value={ils(detail.summary.total)} strong />
              </div>

              <div className="space-y-2">
                {detail.shifts.length === 0 ? (
                  <p className="rounded-xl border border-gray-200 bg-gray-50 p-3 text-sm text-gray-500">אין משמרות שהושלמו בחודש זה.</p>
                ) : (
                  detail.shifts.map((s) => <ReportLineRow key={s.shiftId} s={s} />)
                )}
              </div>

              {detail.versions.length > 0 && (
                <div>
                  <h3 className="mb-1 text-xs font-semibold text-gray-500">היסטוריית גרסאות</h3>
                  <ul className="space-y-1.5 text-xs text-gray-600">
                    {detail.versions.map((v) => (
                      <li key={v.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-gray-100 px-2.5 py-1.5">
                        <span className="text-gray-700">
                          גרסה {v.version} · {STATUS_LABEL[v.status] ?? v.status} · {fmtDate(v.publishedAt)}
                        </span>
                        <span className="flex items-center gap-2">
                          <button onClick={() => void openVersion(v.id)} disabled={versionBusy === v.id} className="inline-flex items-center gap-1 rounded-md border border-gray-200 px-2 py-0.5 text-[11px] text-gray-700 hover:bg-gray-50 disabled:opacity-50">
                            <FileText className="h-3 w-3" /> צפייה בדוח
                          </button>
                          <button onClick={() => void downloadVersionPdf(v.id, v.version)} disabled={versionBusy === v.id} className="inline-flex items-center gap-1 rounded-md border border-gray-200 px-2 py-0.5 text-[11px] text-gray-700 hover:bg-gray-50 disabled:opacity-50">
                            <Download className="h-3 w-3" /> הורדת PDF
                          </button>
                        </span>
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

// One work line: customer · job type · role, approved clock-in/out, exact +
// paid hours, and the day amount. Shared by the live draft and version views.
function ReportLineRow({ s }: { s: ReportLine }) {
  const label = s.shiftLabel ?? s.jobTypeLabel;
  return (
    <div className="flex items-center justify-between gap-2 rounded-xl border border-gray-200 px-3 py-2">
      <div>
        <p className="text-sm font-medium text-gray-900">
          {s.customerName || 'לקוח/ה'}
          {label ? <span className="mr-1 text-xs font-normal text-gray-500">· {label}</span> : null}
          {s.roleLabel ? <span className="mr-1 text-xs font-normal text-gray-400">· {s.roleLabel}</span> : null}
        </p>
        <p className="mt-0.5 text-xs text-gray-500">
          {fmtDate(s.date)}
          {s.clockIn && s.clockOut ? ` · כניסה ${s.clockIn} · יציאה ${s.clockOut}` : ''}
        </p>
        <p className="mt-0.5 text-xs text-gray-500">
          שעות נוכחות {s.approvedHours}
          {s.paidHours != null ? ` · שעות לתשלום ${s.paidHours}` : ''}
        </p>
      </div>
      <span className="text-sm font-semibold text-gray-900">{ils((s.pay ?? s.dayTotal ?? 0) as number)}</span>
    </div>
  );
}

// Read-only view of a published version, rendered from its immutable stored
// snapshot (never the live draft).
function VersionViewPanel({
  view,
  onClose,
  onDownload,
  busy,
}: {
  view: VersionView;
  onClose: () => void;
  onDownload: () => void;
  busy: boolean;
}) {
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="rounded-full border border-gray-200 bg-gray-50 px-2.5 py-0.5 text-xs font-medium text-gray-700">
          גרסה {view.version} · פורסם {fmtDate(view.publishedAt)}
        </span>
        <div className="flex items-center gap-2">
          <button
            onClick={onDownload}
            disabled={busy}
            className="inline-flex items-center gap-1 rounded-lg border border-gray-200 px-2.5 py-1 text-xs text-gray-700 hover:bg-gray-50 disabled:opacity-50"
          >
            <Download className="h-3.5 w-3.5" /> הורדת PDF
          </button>
          <button onClick={onClose} className="rounded-lg border border-gray-200 px-2.5 py-1 text-xs text-gray-700 hover:bg-gray-50">
            חזרה לטיוטה
          </button>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
        <Stat label="משמרות" value={String(view.summary.workdays)} />
        <Stat label="שעות נוכחות" value={String(view.summary.totalApprovedHours)} />
        <Stat label="שעות לתשלום" value={view.summary.totalPaidHours != null ? String(view.summary.totalPaidHours) : '—'} />
        <Stat label="סה״כ" value={ils(Number(view.summary.total))} strong />
      </div>
      <div className="space-y-2">
        {view.shifts.length === 0 ? (
          <p className="rounded-xl border border-gray-200 bg-gray-50 p-3 text-sm text-gray-500">אין משמרות בגרסה זו.</p>
        ) : (
          view.shifts.map((s) => <ReportLineRow key={s.shiftId} s={s} />)
        )}
      </div>
    </div>
  );
}

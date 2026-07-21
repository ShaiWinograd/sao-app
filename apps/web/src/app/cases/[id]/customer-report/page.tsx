'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { useAuth } from '@clerk/nextjs';
import { ArrowRight, Download, FileText, Loader2, Plus, Trash2, AlertTriangle, History } from 'lucide-react';
import { api, authHeaders } from '../../../../lib/api';

type PricingMode = 'HOURLY' | 'GLOBAL';
type Addition = { description: string; amount: string };

type ReportableJob = { jobId: string; date: string; jobType: string; workerCount: number; actualHours: number; billableHours: number; included: boolean };
type ReportLine = { jobId: string; date: string; jobType: string; workerCount: number; actualHours: number; billableHours: number };
type Preview = {
  versionNumber: number;
  customerName: string;
  caseName: string;
  caseStatus: 'ACTIVE' | 'CLOSED' | string;
  reportableJobs: ReportableJob[];
  report: {
    jobs: ReportLine[];
    totalActualHours: number;
    totalBillableHours: number;
    mode: PricingMode;
    hourlyRate?: number;
    additions: { description: string; amount: number }[];
    additionsTotal: number;
    finalAmount: number;
  };
  readiness: { ready: boolean; reasons: string[] };
};
type Version = { id: string; versionNumber: number; status: string; createdAt: string; finalAmount: number | null; isCurrent: boolean };

const JOB_TYPE_LABEL: Record<string, string> = { PACKING: 'אריזה', UNPACKING: 'פריקה', HOME_ORGANIZATION: 'סידור' };
const money = (n: number | null | undefined) => (n == null ? '—' : `${Number(n).toLocaleString('he-IL')} ₪`);

export default function CustomerReportPage() {
  const params = useParams<{ id: string }>();
  const caseId = params?.id;
  const { getToken } = useAuth();

  const [mode, setMode] = useState<PricingMode>('HOURLY');
  const [hourlyRate, setHourlyRate] = useState('175');
  const [globalAmount, setGlobalAmount] = useState('0');
  const [additions, setAdditions] = useState<Addition[]>([]);
  const [excluded, setExcluded] = useState<Record<string, boolean>>({});
  const [jobNotes, setJobNotes] = useState<Record<string, string>>({});

  const [preview, setPreview] = useState<Preview | null>(null);
  const [versions, setVersions] = useState<Version[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const isClosed = preview?.caseStatus === 'CLOSED';

  const pricingBody = useCallback(() => {
    if (mode === 'GLOBAL') return { mode: 'GLOBAL' as const, globalAmount: Number(globalAmount) || 0 };
    return {
      mode: 'HOURLY' as const,
      hourlyRate: Number(hourlyRate) || 0,
      additions: additions.map((a) => ({ description: a.description, amount: Number(a.amount) || 0 })),
    };
  }, [mode, hourlyRate, globalAmount, additions]);

  const includedJobIds = useCallback(
    (reportable: ReportableJob[]) => reportable.filter((j) => !excluded[j.jobId]).map((j) => j.jobId),
    [excluded],
  );

  const loadPreview = useCallback(async () => {
    if (!caseId) return;
    setBusy(true);
    setError(null);
    try {
      const auth = await authHeaders(getToken);
      const discovered = preview?.reportableJobs;
      const body = {
        pricing: pricingBody(),
        ...(discovered ? { includedJobIds: includedJobIds(discovered) } : {}),
        jobNotes,
      };
      const res = await api.post<Preview>(`/cases/${caseId}/customer-report/preview`, body, auth);
      setPreview(res.data);
    } catch {
      setError('טעינת התצוגה המקדימה נכשלה');
    } finally {
      setBusy(false);
    }
  }, [caseId, getToken, pricingBody, includedJobIds, jobNotes, preview?.reportableJobs]);

  const loadVersions = useCallback(async () => {
    if (!caseId) return;
    try {
      const auth = await authHeaders(getToken);
      const res = await api.get<Version[]>(`/cases/${caseId}/customer-report/versions`, auth);
      setVersions(res.data ?? []);
    } catch {
      setVersions([]);
    }
  }, [caseId, getToken]);

  useEffect(() => {
    void loadPreview();
    void loadVersions();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [caseId]);

  // Live-recompute when pricing/inclusion inputs change.
  useEffect(() => {
    if (!preview) return;
    const t = setTimeout(() => void loadPreview(), 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, hourlyRate, globalAmount, additions, excluded, jobNotes]);

  const toggleJob = (jobId: string) => setExcluded((prev) => ({ ...prev, [jobId]: !prev[jobId] }));

  const finalize = useCallback(async () => {
    if (!caseId || !preview) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const auth = await authHeaders(getToken);
      const body = { pricing: pricingBody(), includedJobIds: includedJobIds(preview.reportableJobs), jobNotes };
      const path = isClosed ? `/cases/${caseId}/customer-report/versions` : `/cases/${caseId}/customer-report/finalize`;
      const res = await api.post<{ versionNumber: number }>(path, body, auth);
      setNotice(isClosed ? `נוצרה גרסה מתוקנת (${res.data.versionNumber})` : `הדוח הופק (גרסה ${res.data.versionNumber})`);
      await loadPreview();
      await loadVersions();
    } catch (e) {
      const msg = (e as { response?: { data?: { message?: string; error?: string } } })?.response?.data;
      setError(msg?.message || msg?.error || 'הפקת הדוח נכשלה');
    } finally {
      setBusy(false);
    }
  }, [caseId, preview, getToken, pricingBody, includedJobIds, jobNotes, isClosed, loadPreview, loadVersions]);

  const downloadVersion = useCallback(
    async (versionId: string, versionNumber: number) => {
      if (!caseId) return;
      try {
        const auth = await authHeaders(getToken);
        const res = await api.get(`/cases/${caseId}/customer-report/versions/${versionId}/pdf`, { ...auth, responseType: 'blob' });
        const url = URL.createObjectURL(res.data as Blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `customer-report-${caseId}-v${versionNumber}.pdf`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
      } catch {
        setError('הורדת ה-PDF נכשלה');
      }
    },
    [caseId, getToken],
  );

  const excludedCount = useMemo(
    () => (preview ? preview.reportableJobs.filter((j) => excluded[j.jobId]).length : 0),
    [preview, excluded],
  );

  const canFinalize = isClosed || (preview?.readiness.ready ?? false);

  return (
    <div className="p-6 max-w-3xl" dir="rtl">
      <Link href="/reports/customer" className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700 mb-3">
        <ArrowRight className="w-4 h-4" />
        חזרה לדוחות
      </Link>

      <h1 className="text-2xl font-bold text-gray-900 mb-1 flex items-center gap-2">
        <FileText className="w-6 h-6 text-primary-600" />
        דוח לקוחה{preview ? ` — ${preview.customerName}` : ''}
      </h1>

      {isClosed && (
        <p className="mb-3 rounded-md bg-blue-50 px-3 py-2 text-sm text-blue-800">
          הדוח כבר הופק. ניתן ליצור גרסה מתוקנת — כל הגרסאות נשמרות.
        </p>
      )}

      {preview && !isClosed && !preview.readiness.ready && (
        <div className="mb-3 rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800">
          <div className="flex items-center gap-1 font-medium"><AlertTriangle className="w-4 h-4" /> הפרויקט עדיין לא מוכן לדוח</div>
          <ul className="mt-1 list-disc pr-5">{preview.readiness.reasons.map((r) => <li key={r}>{r}</li>)}</ul>
        </div>
      )}

      {error && <div className="mb-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}
      {notice && <div className="mb-3 rounded-md bg-green-50 px-3 py-2 text-sm text-green-700">{notice}</div>}

      {/* Included jobs */}
      <section className="mb-5">
        <h2 className="text-sm font-semibold text-gray-700 mb-2">עבודות בדוח</h2>
        {excludedCount > 0 && (
          <p className="mb-2 rounded bg-amber-50 px-2 py-1 text-xs text-amber-800">
            {excludedCount} עבודות הוסרו מהדוח. עבודות שהוסרו יישארו זמינות לדוח אחר ולא יסומנו כדווחו.
          </p>
        )}
        <div className="space-y-2">
          {preview?.reportableJobs.map((j) => {
            const off = !!excluded[j.jobId];
            return (
              <div key={j.jobId} className={`rounded-lg border px-3 py-2 ${off ? 'border-gray-200 bg-gray-50 opacity-60' : 'border-gray-200 bg-white'}`}>
                <div className="flex items-center justify-between">
                  <div className="text-sm text-gray-900">
                    {j.date} · {JOB_TYPE_LABEL[j.jobType] ?? j.jobType} · {j.workerCount} עובדים · {j.billableHours} שעות לחיוב
                  </div>
                  {!isClosed && (
                    <button
                      type="button"
                      onClick={() => toggleJob(j.jobId)}
                      className={`text-xs ${off ? 'text-primary-600' : 'text-red-600'} hover:underline`}
                    >
                      {off ? 'החזרה לדוח' : 'הסרה'}
                    </button>
                  )}
                </div>
                {!off && (
                  <input
                    value={jobNotes[j.jobId] ?? ''}
                    onChange={(e) => setJobNotes((p) => ({ ...p, [j.jobId]: e.target.value }))}
                    placeholder="הערה פנימית (לא מוצגת ללקוח)"
                    className="mt-2 w-full rounded border border-gray-200 px-2 py-1 text-xs"
                  />
                )}
              </div>
            );
          })}
          {preview && preview.reportableJobs.length === 0 && <p className="text-sm text-gray-400">אין עבודות זמינות לדוח.</p>}
        </div>
      </section>

      {/* Billing */}
      <section className="mb-5">
        <h2 className="text-sm font-semibold text-gray-700 mb-2">שיטת חיוב</h2>
        <div className="mb-3 flex gap-2">
          <button type="button" onClick={() => setMode('HOURLY')} className={`rounded-md px-3 py-1.5 text-sm ${mode === 'HOURLY' ? 'bg-primary-600 text-white' : 'bg-gray-100 text-gray-700'}`}>לפי שעה</button>
          <button type="button" onClick={() => setMode('GLOBAL')} className={`rounded-md px-3 py-1.5 text-sm ${mode === 'GLOBAL' ? 'bg-primary-600 text-white' : 'bg-gray-100 text-gray-700'}`}>סכום גלובלי</button>
        </div>

        {mode === 'HOURLY' ? (
          <div className="space-y-3">
            <label className="block text-sm">
              <span className="text-gray-600">תעריף שעתי (לפרויקט)</span>
              <input type="number" value={hourlyRate} onChange={(e) => setHourlyRate(e.target.value)} className="mt-1 block w-40 rounded border border-gray-300 px-2 py-1" />
            </label>
            <div>
              <div className="mb-1 flex items-center justify-between">
                <span className="text-sm text-gray-600">תוספות</span>
                <button type="button" onClick={() => setAdditions((a) => [...a, { description: '', amount: '' }])} className="inline-flex items-center gap-1 text-xs text-primary-600 hover:underline">
                  <Plus className="w-3 h-3" /> הוספת שורה
                </button>
              </div>
              {additions.map((add, i) => (
                <div key={i} className="mb-2 flex gap-2">
                  <input value={add.description} onChange={(e) => setAdditions((a) => a.map((x, xi) => (xi === i ? { ...x, description: e.target.value } : x)))} placeholder="תיאור" className="flex-1 rounded border border-gray-300 px-2 py-1 text-sm" />
                  <input type="number" value={add.amount} onChange={(e) => setAdditions((a) => a.map((x, xi) => (xi === i ? { ...x, amount: e.target.value } : x)))} placeholder="₪" className="w-28 rounded border border-gray-300 px-2 py-1 text-sm" />
                  <button type="button" onClick={() => setAdditions((a) => a.filter((_, xi) => xi !== i))} className="text-red-500"><Trash2 className="w-4 h-4" /></button>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <label className="block text-sm">
            <span className="text-gray-600">סכום כולל</span>
            <input type="number" value={globalAmount} onChange={(e) => setGlobalAmount(e.target.value)} className="mt-1 block w-40 rounded border border-gray-300 px-2 py-1" />
            <span className="mt-1 block text-xs text-gray-400">שעות עבודה בפועל מוצגות ללקוח; תעריף שעתי אינו מוצג.</span>
          </label>
        )}
      </section>

      {/* Totals */}
      {preview && (
        <section className="mb-5 rounded-lg border border-gray-200 bg-gray-50 p-4 text-sm">
          <div className="flex justify-between"><span>סך שעות לחיוב</span><span className="font-medium">{preview.report.totalBillableHours}</span></div>
          {preview.report.mode === 'HOURLY' && (
            <>
              <div className="flex justify-between"><span>תעריף שעתי</span><span>{money(preview.report.hourlyRate)}</span></div>
              {preview.report.additions.map((a, i) => (
                <div key={i} className="flex justify-between text-gray-500"><span>תוספת · {a.description || 'ללא תיאור'}</span><span>{money(a.amount)}</span></div>
              ))}
            </>
          )}
          <div className="mt-2 flex justify-between border-t border-gray-200 pt-2 text-base font-semibold"><span>סכום סופי</span><span>{money(preview.report.finalAmount)}</span></div>
        </section>
      )}

      <div className="flex items-center gap-3">
        <button onClick={() => void loadPreview()} disabled={busy} className="inline-flex items-center gap-1.5 rounded-md border border-gray-300 px-4 py-2 text-sm text-gray-700 disabled:opacity-50">
          {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileText className="w-4 h-4" />}
          רענון תצוגה
        </button>
        <button onClick={() => void finalize()} disabled={busy || !canFinalize} className="rounded-md bg-primary-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50">
          {isClosed ? 'יצירת גרסה מתוקנת' : 'הפקת דוח'}
        </button>
      </div>

      {/* Version history */}
      {versions.length > 0 && (
        <section className="mt-8">
          <h2 className="text-sm font-semibold text-gray-700 mb-2 flex items-center gap-1"><History className="w-4 h-4" /> היסטוריית גרסאות</h2>
          <ul className="space-y-2">
            {versions.map((v) => (
              <li key={v.id} className="flex items-center justify-between rounded-lg border border-gray-200 bg-white px-4 py-2 text-sm">
                <span>גרסה {v.versionNumber}{v.isCurrent ? ' (נוכחית)' : ''} · {money(v.finalAmount)} · {new Date(v.createdAt).toLocaleDateString('he-IL')}</span>
                <button onClick={() => void downloadVersion(v.id, v.versionNumber)} className="inline-flex items-center gap-1 text-primary-600 hover:underline">
                  <Download className="w-4 h-4" /> PDF
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

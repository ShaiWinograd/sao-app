'use client';

import { useCallback, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { useAuth } from '@clerk/nextjs';
import { ArrowRight, Download, FileText, Loader2 } from 'lucide-react';
import { api, authHeaders } from '../../../../lib/api';

type PricingMode = 'HOURLY' | 'GLOBAL';

type ReportJobLine = {
  jobId: string;
  date: string;
  jobType: string;
  workerCount: number;
  actualHours: number;
};

type CustomerReportPayload = {
  customerName: string;
  projectName: string;
  generatedAt: string;
  allJobsCompleted: boolean;
  report: {
    jobs: ReportJobLine[];
    totalActualHours: number;
    mode: PricingMode;
    hourlyRate?: number;
    manualAdditions: number;
    discount: number;
    finalAmount: number;
  };
};

const JOB_TYPE_LABEL: Record<string, string> = {
  PACKING: 'אריזה',
  UNPACKING: 'פריקה',
  HOME_ORGANIZATION: 'סידור',
};

function money(n: number): string {
  return `${Number(n).toLocaleString('he-IL')} ₪`;
}

function pricingBody(mode: PricingMode, hourlyRate: string, additions: string, discount: string, globalAmount: string) {
  if (mode === 'GLOBAL') {
    return { mode: 'GLOBAL' as const, globalAmount: Number(globalAmount) || 0 };
  }
  return {
    mode: 'HOURLY' as const,
    hourlyRate: Number(hourlyRate) || 0,
    manualAdditions: Number(additions) || 0,
    discount: Number(discount) || 0,
  };
}

export default function CustomerReportPage() {
  const params = useParams<{ id: string }>();
  const caseId = params?.id;
  const { getToken } = useAuth();

  const [mode, setMode] = useState<PricingMode>('HOURLY');
  const [hourlyRate, setHourlyRate] = useState('175');
  const [additions, setAdditions] = useState('0');
  const [discount, setDiscount] = useState('0');
  const [globalAmount, setGlobalAmount] = useState('0');

  const [preview, setPreview] = useState<CustomerReportPayload | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadPreview = useCallback(async () => {
    if (!caseId) return;
    setBusy(true);
    setError(null);
    try {
      const auth = await authHeaders(getToken);
      const body = pricingBody(mode, hourlyRate, additions, discount, globalAmount);
      const res = await api.post<CustomerReportPayload>(`/cases/${caseId}/customer-report`, body, auth);
      setPreview(res.data);
    } catch {
      setError('יצירת התצוגה המקדימה נכשלה');
    } finally {
      setBusy(false);
    }
  }, [caseId, getToken, mode, hourlyRate, additions, discount, globalAmount]);

  const downloadPdf = useCallback(async () => {
    if (!caseId) return;
    setBusy(true);
    setError(null);
    try {
      const auth = await authHeaders(getToken);
      const body = pricingBody(mode, hourlyRate, additions, discount, globalAmount);
      const res = await api.post(`/cases/${caseId}/customer-report.pdf`, body, { ...auth, responseType: 'blob' });
      const url = URL.createObjectURL(res.data as Blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `customer-report-${caseId}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch {
      setError('הורדת ה-PDF נכשלה');
    } finally {
      setBusy(false);
    }
  }, [caseId, getToken, mode, hourlyRate, additions, discount, globalAmount]);

  return (
    <div className="p-6 max-w-3xl" dir="rtl">
      <Link href={`/cases/${caseId}`} className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700 mb-3">
        <ArrowRight className="w-4 h-4" />
        חזרה לפרויקט
      </Link>

      <h1 className="text-2xl font-bold text-gray-900 mb-4 flex items-center gap-2">
        <FileText className="w-6 h-6 text-primary-600" />
        דוח לקוח
      </h1>

      {error && (
        <div className="mb-4 rounded-lg bg-danger-bg border border-danger/30 text-danger text-sm px-4 py-3">{error}</div>
      )}

      <section className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm mb-5">
        <h2 className="text-sm font-semibold text-gray-900 mb-3">תמחור</h2>
        <div className="flex gap-2 mb-4">
          <button
            onClick={() => setMode('HOURLY')}
            className={`rounded-lg px-3 py-1.5 text-sm font-medium ${mode === 'HOURLY' ? 'bg-primary-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
          >
            לפי שעה
          </button>
          <button
            onClick={() => setMode('GLOBAL')}
            className={`rounded-lg px-3 py-1.5 text-sm font-medium ${mode === 'GLOBAL' ? 'bg-primary-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
          >
            סכום גלובלי
          </button>
        </div>

        {mode === 'HOURLY' ? (
          <div className="grid grid-cols-3 gap-3">
            <label className="text-sm">
              <span className="block text-gray-600 mb-1">תעריף שעתי (₪)</span>
              <input value={hourlyRate} onChange={(e) => setHourlyRate(e.target.value)} inputMode="decimal" className="w-full rounded-lg border border-gray-300 px-2.5 py-1.5" />
            </label>
            <label className="text-sm">
              <span className="block text-gray-600 mb-1">תוספות (₪)</span>
              <input value={additions} onChange={(e) => setAdditions(e.target.value)} inputMode="decimal" className="w-full rounded-lg border border-gray-300 px-2.5 py-1.5" />
            </label>
            <label className="text-sm">
              <span className="block text-gray-600 mb-1">הנחה (₪)</span>
              <input value={discount} onChange={(e) => setDiscount(e.target.value)} inputMode="decimal" className="w-full rounded-lg border border-gray-300 px-2.5 py-1.5" />
            </label>
          </div>
        ) : (
          <label className="text-sm block max-w-xs">
            <span className="block text-gray-600 mb-1">סכום סופי (₪)</span>
            <input value={globalAmount} onChange={(e) => setGlobalAmount(e.target.value)} inputMode="decimal" className="w-full rounded-lg border border-gray-300 px-2.5 py-1.5" />
          </label>
        )}

        <div className="mt-4 flex gap-2">
          <button
            onClick={() => void loadPreview()}
            disabled={busy}
            className="inline-flex items-center gap-1.5 rounded-lg bg-primary-600 px-4 py-2 text-sm font-semibold text-white hover:bg-primary-700 disabled:opacity-50"
          >
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileText className="w-4 h-4" />}
            תצוגה מקדימה
          </button>
          <button
            onClick={() => void downloadPdf()}
            disabled={busy || !preview}
            className="inline-flex items-center gap-1.5 rounded-lg border border-gray-300 px-4 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-50"
          >
            <Download className="w-4 h-4" />
            הורדת PDF
          </button>
        </div>
      </section>

      {preview && (
        <section className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
          <div className="flex items-center justify-between mb-3">
            <div>
              <p className="text-sm text-gray-500">לקוח</p>
              <p className="text-base font-semibold text-gray-900">{preview.customerName}</p>
            </div>
            <div className="text-left">
              <p className="text-sm text-gray-500">פרויקט</p>
              <p className="text-base font-semibold text-gray-900">{preview.projectName}</p>
            </div>
          </div>

          {!preview.allJobsCompleted && (
            <div className="mb-3 rounded-lg bg-amber-50 border border-amber-200 text-amber-800 text-xs px-3 py-2">
              לא כל העבודות בפרויקט הושלמו. ניתן להפיק דוח, אך ייתכן שהנתונים אינם סופיים.
            </div>
          )}

          <table className="w-full text-sm">
            <thead>
              <tr className="text-gray-500 border-b border-gray-100">
                <th className="text-right py-1.5 font-medium">תאריך</th>
                <th className="text-right py-1.5 font-medium">סוג</th>
                <th className="text-right py-1.5 font-medium">עובדים</th>
                <th className="text-right py-1.5 font-medium">שעות בפועל</th>
              </tr>
            </thead>
            <tbody>
              {preview.report.jobs.map((job) => (
                <tr key={job.jobId} className="border-b border-gray-50">
                  <td className="py-1.5 text-gray-800">{job.date}</td>
                  <td className="py-1.5 text-gray-800">{JOB_TYPE_LABEL[job.jobType] ?? job.jobType}</td>
                  <td className="py-1.5 text-gray-800">{job.workerCount}</td>
                  <td className="py-1.5 text-gray-800">{job.actualHours}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <dl className="mt-4 space-y-1.5 text-sm">
            <div className="flex justify-between">
              <dt className="text-gray-600">סך שעות עבודה בפועל</dt>
              <dd className="font-medium text-gray-900">{preview.report.totalActualHours}</dd>
            </div>
            {preview.report.mode === 'HOURLY' && (
              <>
                <div className="flex justify-between">
                  <dt className="text-gray-600">תעריף שעתי</dt>
                  <dd className="text-gray-900">{money(preview.report.hourlyRate ?? 0)}</dd>
                </div>
                {preview.report.manualAdditions > 0 && (
                  <div className="flex justify-between">
                    <dt className="text-gray-600">תוספות</dt>
                    <dd className="text-gray-900">{money(preview.report.manualAdditions)}</dd>
                  </div>
                )}
                {preview.report.discount > 0 && (
                  <div className="flex justify-between">
                    <dt className="text-gray-600">הנחה</dt>
                    <dd className="text-gray-900">−{money(preview.report.discount)}</dd>
                  </div>
                )}
              </>
            )}
            <div className="flex justify-between border-t border-gray-100 pt-2 mt-2">
              <dt className="font-semibold text-gray-900">סכום סופי</dt>
              <dd className="font-bold text-primary-700 text-base">{money(preview.report.finalAmount)}</dd>
            </div>
          </dl>
        </section>
      )}
    </div>
  );
}

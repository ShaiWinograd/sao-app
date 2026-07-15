'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { CalendarRange, Download, FileSpreadsheet, TrendingUp } from 'lucide-react';
import { api } from '../../lib/api';
import { canViewReports } from '../../lib/viewer-access';
import { useViewerRole } from '../../lib/use-viewer-role';

type ReportingBasis = 'accrual' | 'cash';
type ManagementPeriod = 'monthly' | 'yearly';

type ReportSummary = {
  workVolume: {
    completedJobs: number;
    cancelledJobs: number;
    totalJobs: number;
    totalApprovedHours: string;
    activeCases: number;
  };
  revenue: {
    total: string;
    invoiced: string;
    collected: string;
    outstanding: string;
  };
  labourCost: {
    hourlyPay: string;
    dailyPayments: string;
    total: string;
  };
  jobExpenses: string;
  overheadExpenses: string;
  profitability: {
    grossRevenue: string;
    grossProfit: string;
    netProfit: string;
    marginPct: string;
  };
};

type MonthlyManagementReport = ReportSummary & {
  period: { month: number; year: number };
  basis: 'ACCRUAL' | 'CASH';
};

type YearlyManagementReport = ReportSummary & {
  period: { year: number };
  basis: 'ACCRUAL' | 'CASH';
  monthlyBreakdown: Array<ReportSummary & { month: number; label: string }>;
};

function formatCurrency(value: number) {
  return new Intl.NumberFormat('he-IL', { style: 'currency', currency: 'ILS', maximumFractionDigits: 0 }).format(value);
}

function toNumber(value: string | number | null | undefined) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

export default function ReportsPage() {
  const viewerRole = useViewerRole();
  const hasReportsAccess = canViewReports(viewerRole);
  const now = useMemo(() => new Date(), []);
  const [period, setPeriod] = useState<ManagementPeriod>('monthly');
  const [selectedMonth, setSelectedMonth] = useState(
    `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`,
  );
  const [selectedYear, setSelectedYear] = useState(String(now.getFullYear()));
  const [basis, setBasis] = useState<ReportingBasis>('accrual');
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [monthlyReport, setMonthlyReport] = useState<MonthlyManagementReport | null>(null);
  const [yearlyReport, setYearlyReport] = useState<YearlyManagementReport | null>(null);

  const loadReport = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      if (period === 'monthly') {
        const [year, month] = selectedMonth.split('-');
        const response = await api.get<MonthlyManagementReport>('/reports/monthly', {
          params: {
            month,
            year,
            basis: basis.toUpperCase(),
          },
        });
        setMonthlyReport(response.data);
        setYearlyReport(null);
        return;
      }

      const response = await api.get<YearlyManagementReport>('/reports/yearly', {
        params: {
          year: selectedYear,
          basis: basis.toUpperCase(),
        },
      });
      setYearlyReport(response.data);
      setMonthlyReport(null);
    } catch {
      setError('לא ניתן לטעון את הדוח הניהולי כרגע. נסי שוב בעוד רגע.');
      setMonthlyReport(null);
      setYearlyReport(null);
    } finally {
      setIsLoading(false);
    }
  }, [basis, period, selectedMonth, selectedYear]);

  useEffect(() => {
    void loadReport();
  }, [loadReport]);

  const activeSummary = period === 'monthly' ? monthlyReport : yearlyReport;
  const yearlyRows = yearlyReport?.monthlyBreakdown ?? [];

  const summary = useMemo(() => {
    if (!activeSummary) {
      return {
        grossRevenue: 0,
        grossProfit: 0,
        netProfit: 0,
        profitMargin: 0,
        collected: 0,
        outstanding: 0,
        labor: 0,
        directExpenses: 0,
        overhead: 0,
        activeCases: 0,
        completedJobs: 0,
      };
    }

    return {
      grossRevenue: toNumber(activeSummary.profitability.grossRevenue),
      grossProfit: toNumber(activeSummary.profitability.grossProfit),
      netProfit: toNumber(activeSummary.profitability.netProfit),
      profitMargin: toNumber(activeSummary.profitability.marginPct),
      collected: toNumber(activeSummary.revenue.collected),
      outstanding: toNumber(activeSummary.revenue.outstanding),
      labor: toNumber(activeSummary.labourCost.total),
      directExpenses: toNumber(activeSummary.jobExpenses),
      overhead: toNumber(activeSummary.overheadExpenses),
      activeCases: activeSummary.workVolume.activeCases,
      completedJobs: activeSummary.workVolume.completedJobs,
    };
  }, [activeSummary]);

  if (!hasReportsAccess) {
    return (
      <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
        אזור הדוחות זמין לבעלים בלבד.
      </div>
    );
  }

  const handleExport = useCallback(
    async (format: 'pdf' | 'csv') => {
      setMessage(null);
      setError(null);
      setIsExporting(true);
      try {
        const endpoint =
          period === 'monthly'
            ? `/reports/export/monthly.${format}`
            : `/reports/export/yearly.${format}`;

        const params =
          period === 'monthly'
            ? {
                month: selectedMonth.split('-')[1],
                year: selectedMonth.split('-')[0],
                basis: basis.toUpperCase(),
              }
            : {
                year: selectedYear,
                basis: basis.toUpperCase(),
              };

        const response = await api.get(endpoint, {
          params,
          responseType: 'blob',
        });

        const fallbackFileName =
          period === 'monthly'
            ? `management-report-${selectedMonth}.${format}`
            : `management-report-${selectedYear}.${format}`;
        const fileName = fallbackFileName;

        const blob = new Blob([response.data], {
          type: format === 'pdf' ? 'application/pdf' : 'text/csv;charset=utf-8',
        });
        const url = URL.createObjectURL(blob);
        const anchor = document.createElement('a');
        anchor.href = url;
        anchor.download = fileName;
        document.body.appendChild(anchor);
        anchor.click();
        anchor.remove();
        URL.revokeObjectURL(url);
        setMessage(`הקובץ יורד כעת: ${fileName}`);
      } catch {
        setError('ייצוא הדוח נכשל כרגע. נסי שוב בעוד רגע.');
      } finally {
        setIsExporting(false);
      }
    },
    [basis, period, selectedMonth, selectedYear],
  );

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 mb-1">דוחות ניהול</h1>
          <p className="text-sm text-gray-500">דשבורד ניהולי לסוף חודש וסוף שנה: הכנסות, עלויות, רווחיות ונפח פעילות.</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => void handleExport('pdf')}
            disabled={isExporting}
            className="inline-flex items-center gap-1 rounded-lg border border-gray-300 bg-white px-3 py-2 text-xs"
          >
            <Download className="w-3.5 h-3.5" />
            {isExporting ? 'מייצא...' : 'ייצוא PDF'}
          </button>
          <button
            type="button"
            onClick={() => void handleExport('csv')}
            disabled={isExporting}
            className="inline-flex items-center gap-1 rounded-lg border border-gray-300 bg-white px-3 py-2 text-xs"
          >
            <FileSpreadsheet className="w-3.5 h-3.5" />
            ייצוא CSV
          </button>
        </div>
      </div>

      <section className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
        <div className="flex flex-wrap items-center gap-2">
          <select
            value={period}
            onChange={(event) => setPeriod(event.target.value as ManagementPeriod)}
            className="rounded-xl border border-gray-300 px-3 py-2 text-sm"
          >
            <option value="monthly">דוח סוף חודש</option>
            <option value="yearly">דוח סוף שנה</option>
          </select>
          {period === 'monthly' ? (
            <input
              type="month"
              value={selectedMonth}
              onChange={(event) => setSelectedMonth(event.target.value)}
              className="rounded-xl border border-gray-300 px-3 py-2 text-sm"
            />
          ) : (
            <input
              type="number"
              min={2024}
              max={2035}
              value={selectedYear}
              onChange={(event) => setSelectedYear(event.target.value)}
              className="w-28 rounded-xl border border-gray-300 px-3 py-2 text-sm"
            />
          )}
          <select value={basis} onChange={(event) => setBasis(event.target.value as ReportingBasis)} className="rounded-xl border border-gray-300 px-3 py-2 text-sm">
            <option value="accrual">בסיס מצטבר (חשבוניות)</option>
            <option value="cash">בסיס מזומן (תשלומים)</option>
          </select>
          <button
            type="button"
            onClick={() => void loadReport()}
            className="rounded-xl border border-gray-300 px-3 py-2 text-sm hover:bg-gray-50"
          >
            רענון נתונים
          </button>
        </div>
      </section>

      {isLoading ? (
        <div className="rounded-xl border border-blue-200 bg-blue-50 px-3 py-2 text-sm text-blue-700">טוען נתוני דוח...</div>
      ) : null}
      {error ? (
        <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>
      ) : null}

      <section className="grid gap-4 md:grid-cols-4">
        <article className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
          <div className="text-sm text-gray-500">הכנסה ברוטו</div>
          <div className="text-xl font-bold text-gray-900 mt-1">{formatCurrency(summary.grossRevenue)}</div>
        </article>
        <article className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
          <div className="text-sm text-gray-500">רווח גולמי</div>
          <div className="text-xl font-bold text-emerald-700 mt-1">{formatCurrency(summary.grossProfit)}</div>
        </article>
        <article className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
          <div className="text-sm text-gray-500">רווח נקי</div>
          <div className="text-xl font-bold text-primary-700 mt-1">{formatCurrency(summary.netProfit)}</div>
        </article>
        <article className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
          <div className="text-sm text-gray-500">שולי רווח</div>
          <div className="text-xl font-bold text-gray-900 mt-1">{summary.profitMargin.toFixed(1)}%</div>
        </article>
      </section>

      <section className="grid gap-4 lg:grid-cols-2">
        <article className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
          <h2 className="text-lg font-semibold mb-3">נפח עבודה</h2>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-xl border border-gray-200 p-3">
              <div className="text-xs text-gray-500">תיקים פעילים</div>
              <div className="text-xl font-semibold text-gray-900 mt-1">{summary.activeCases}</div>
            </div>
            <div className="rounded-xl border border-gray-200 p-3">
              <div className="text-xs text-gray-500">עבודות שהושלמו</div>
              <div className="text-xl font-semibold text-gray-900 mt-1">{summary.completedJobs}</div>
            </div>
          </div>
        </article>

        <article className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
          <h2 className="text-lg font-semibold mb-3">פירוט פיננסי</h2>
          <div className="space-y-2 text-sm">
            <div className="flex items-center justify-between rounded-lg border border-gray-200 px-3 py-2">
              <span>תשלומים שהתקבלו</span>
              <span className="font-semibold">{formatCurrency(summary.collected)}</span>
            </div>
            <div className="flex items-center justify-between rounded-lg border border-gray-200 px-3 py-2">
              <span>יתרת לקוחות פתוחה</span>
              <span className="font-semibold text-amber-700">{formatCurrency(summary.outstanding)}</span>
            </div>
            <div className="flex items-center justify-between rounded-lg border border-gray-200 px-3 py-2">
              <span>עלות שכר ישירה</span>
              <span className="font-semibold">{formatCurrency(summary.labor)}</span>
            </div>
            <div className="flex items-center justify-between rounded-lg border border-gray-200 px-3 py-2">
              <span>הוצאות ישירות</span>
              <span className="font-semibold">{formatCurrency(summary.directExpenses)}</span>
            </div>
            <div className="flex items-center justify-between rounded-lg border border-gray-200 px-3 py-2">
              <span>הוצאות תקורה</span>
              <span className="font-semibold">{formatCurrency(summary.overhead)}</span>
            </div>
          </div>
        </article>
      </section>

      <div className="rounded-xl border border-blue-200 bg-blue-50 p-3 text-sm text-blue-800 inline-flex items-center gap-2">
        <CalendarRange className="w-4 h-4" />
        עמוד זה מיועד לדוחות ניהול בלבד. דוחות תיק לקוח ודוחות שכר מפורטים מנוהלים מתוך דפי התיק והשכר.
      </div>

      <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800 inline-flex items-center gap-2">
        <TrendingUp className="w-4 h-4" />
        ניתן לעבור בין בסיס מצטבר לבסיס מזומן כדי לראות השפעה על הרווחיות.
      </div>

      {period === 'yearly' ? (
        <section className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm overflow-x-auto">
          <h2 className="text-lg font-semibold mb-3">פירוט חודשי שנתי</h2>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-right text-gray-500 border-b border-gray-100">
                <th className="px-2 py-2 font-medium">חודש</th>
                <th className="px-2 py-2 font-medium">הכנסה ברוטו</th>
                <th className="px-2 py-2 font-medium">רווח נקי</th>
                <th className="px-2 py-2 font-medium">שולי רווח</th>
                <th className="px-2 py-2 font-medium">תיקים פעילים</th>
                <th className="px-2 py-2 font-medium">עבודות שהושלמו</th>
              </tr>
            </thead>
            <tbody>
              {yearlyRows.map((row) => (
                <tr key={row.month} className="border-b border-gray-50 last:border-b-0">
                  <td className="px-2 py-2 font-medium">{row.label}</td>
                  <td className="px-2 py-2">{formatCurrency(toNumber(row.profitability.grossRevenue))}</td>
                  <td className="px-2 py-2">{formatCurrency(toNumber(row.profitability.netProfit))}</td>
                  <td className="px-2 py-2">{toNumber(row.profitability.marginPct).toFixed(1)}%</td>
                  <td className="px-2 py-2">{row.workVolume.activeCases}</td>
                  <td className="px-2 py-2">{row.workVolume.completedJobs}</td>
                </tr>
              ))}
              {yearlyRows.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-2 py-5 text-center text-gray-500">
                    לא נמצאו נתוני שנה לתצוגה.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </section>
      ) : null}

      {message ? <div className="rounded-xl border border-blue-200 bg-blue-50 px-3 py-2 text-sm text-blue-700">{message}</div> : null}
    </div>
  );
}

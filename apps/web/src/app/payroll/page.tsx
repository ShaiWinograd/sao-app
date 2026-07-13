'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { CalendarDays, ChevronLeft, ChevronRight, Coins, CreditCard, FileText, Plus, RefreshCw, TrendingUp } from 'lucide-react';
import { useUser } from '@clerk/nextjs';
import { api } from '../../lib/api';
import { canViewSensitiveFinancials, resolveAppViewerRole } from '../../lib/viewer-access';

type AdjustmentCategory = 'בונוס ראש צוות' | 'החזר נסיעות' | 'תיקון' | 'קנס' | 'הבאת לקוח';
type PaymentStatus = 'NOT_PREPARED' | 'READY_FOR_PAYMENT' | 'PARTIALLY_PAID' | 'PAID';

type PayrollWorker = {
  id: string;
  firstName: string;
  lastName: string;
};

type WorkerShift = {
  id: string;
  date: string;
  caseName: string;
  shiftLabel: string;
  startTime: string;
  endTime: string;
  approvedHours: number;
};

type WorkerAdjustment = {
  id: string;
  amount: number;
  category: string;
  reason: string;
};

type WorkerPayment = {
  id: string;
  amount: number;
  paymentDate: string;
  method: string;
  notes: string | null;
};

type WorkerPayrollSummary = {
  workerId: string;
  month: number;
  year: number;
  shifts: WorkerShift[];
  adjustments: WorkerAdjustment[];
  payments: WorkerPayment[];
  summary: {
    shiftsCount: number;
    totalApprovedHours: string;
    hourlyPay: string;
    dailyPay: string;
    adjustmentTotal: string;
    totalDue: string;
    totalPaid: string;
    outstanding: string;
    status: PaymentStatus;
  };
};

type MonthStatus = { isClosed: boolean; closedAt: string | null } | null;

const adjustmentCategoryMap: Record<AdjustmentCategory, string> = {
  'בונוס ראש צוות': 'SHIFT_LEADER_BONUS',
  'החזר נסיעות': 'TRAVEL_REIMBURSEMENT',
  'תיקון': 'CORRECTION',
  'קנס': 'DEDUCTION',
  'הבאת לקוח': 'CUSTOMER_REFERRAL',
};

const paymentMethodOptions = [
  { value: 'BANK_TRANSFER', label: 'העברה בנקאית' },
  { value: 'CASH', label: 'מזומן' },
  { value: 'BIT', label: 'ביט' },
  { value: 'CHECK', label: "צ'ק" },
  { value: 'OTHER', label: 'אחר' },
];

function formatCurrency(value: number) {
  return new Intl.NumberFormat('he-IL', { style: 'currency', currency: 'ILS', maximumFractionDigits: 0 }).format(value);
}

function toNumber(value: string | number | null | undefined) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function formatStatus(status: PaymentStatus) {
  switch (status) {
    case 'PAID':
      return 'שולם';
    case 'PARTIALLY_PAID':
      return 'שולם חלקית';
    case 'READY_FOR_PAYMENT':
      return 'מוכן לתשלום';
    default:
      return 'לא מוכן';
  }
}

export default function PayrollPage() {
  const { user } = useUser();
  const canSeeFinancials = canViewSensitiveFinancials(resolveAppViewerRole(user));
  const now = useMemo(() => new Date(), []);
  const [monthYear, setMonthYear] = useState(`${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`);
  const [workers, setWorkers] = useState<PayrollWorker[]>([]);
  const [summaries, setSummaries] = useState<Record<string, WorkerPayrollSummary>>({});
  const [monthStatus, setMonthStatus] = useState<MonthStatus>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [selectedWorkerId, setSelectedWorkerId] = useState<string | null>(null);
  const [reportApproval, setReportApproval] = useState<Record<string, boolean>>({});

  const [adjustmentWorkerId, setAdjustmentWorkerId] = useState('');
  const [adjustmentCategory, setAdjustmentCategory] = useState<AdjustmentCategory>('תיקון');
  const [adjustmentAmount, setAdjustmentAmount] = useState(0);
  const [adjustmentReason, setAdjustmentReason] = useState('');

  const [paymentWorkerId, setPaymentWorkerId] = useState('');
  const [paymentAmount, setPaymentAmount] = useState(0);
  const [paymentMethod, setPaymentMethod] = useState('BANK_TRANSFER');


  const loadPayroll = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [year, month] = monthYear.split('-');
      const [summaryResponse, statusResponse] = await Promise.all([
        api.get<{ workers: PayrollWorker[] }>('/payroll/summary', { params: { month, year } }),
        api.get('/reports/month-status', { params: { month, year } }),
      ]);

      const nextWorkers = summaryResponse.data.workers;
      const detailResponses = await Promise.all(
        nextWorkers.map((worker) =>
          api.get<WorkerPayrollSummary>(`/payroll/worker/${worker.id}`, { params: { month, year } }),
        ),
      );

      const nextSummaries = detailResponses.reduce<Record<string, WorkerPayrollSummary>>((acc, response) => {
        acc[response.data.workerId] = response.data;
        return acc;
      }, {});

      setWorkers(nextWorkers);
      setSummaries(nextSummaries);
      setMonthStatus({ isClosed: Boolean(statusResponse.data.isClosed), closedAt: statusResponse.data.closedAt ?? null });
      setSelectedWorkerId((current) => current ?? nextWorkers[0]?.id ?? null);
      setAdjustmentWorkerId((current) => current || nextWorkers[0]?.id || '');
      setPaymentWorkerId((current) => current || nextWorkers[0]?.id || '');
    } catch {
      setError('לא ניתן לטעון את נתוני השכר כרגע.');
    } finally {
      setLoading(false);
    }
  }, [monthYear]);

  useEffect(() => {
    void loadPayroll();
  }, [loadPayroll]);

  const selectedSummary = selectedWorkerId ? summaries[selectedWorkerId] ?? null : null;
  const selectedWorker = useMemo(
    () => workers.find((worker) => worker.id === selectedWorkerId) ?? null,
    [workers, selectedWorkerId],
  );

  const totals = useMemo(() => {
    const rows = Object.values(summaries);
    return {
      totalDue: rows.reduce((sum, row) => sum + toNumber(row.summary.totalDue), 0),
      totalPaid: rows.reduce((sum, row) => sum + toNumber(row.summary.totalPaid), 0),
    };
  }, [summaries]);

  const moveMonth = (direction: 'next' | 'prev') => {
    const [year, month] = monthYear.split('-').map(Number);
    const next = new Date(year, month - 1, 1);
    next.setMonth(next.getMonth() + (direction === 'next' ? 1 : -1));
    setMonthYear(`${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, '0')}`);
  };

  const jumpToCurrentMonth = () => {
    setMonthYear(`${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`);
  };

  const handleAddAdjustment = async () => {
    if (!canSeeFinancials) {
      setMessage('סכומי שכר מוסתרים למשתמש זה.');
      return;
    }
    if (!adjustmentWorkerId) {
      setMessage('יש לבחור עובדת.');
      return;
    }
    if (!adjustmentReason.trim()) {
      setMessage('יש להזין סיבה להתאמה.');
      return;
    }
    if (adjustmentAmount === 0) {
      setMessage('סכום ההתאמה חייב להיות שונה מאפס.');
      return;
    }
    const [year, month] = monthYear.split('-').map(Number);
    setSaving(true);
    try {
      await api.post('/payroll/adjustments', {
        workerId: adjustmentWorkerId,
        amount: adjustmentAmount,
        category: adjustmentCategoryMap[adjustmentCategory],
        reason: adjustmentReason.trim(),
        payrollMonth: month,
        payrollYear: year,
        isIncluded: true,
      });
      setAdjustmentAmount(0);
      setAdjustmentReason('');
      setMessage('ההתאמה נשמרה ונכללה בדוח השכר.');
      await loadPayroll();
    } catch {
      setMessage('שמירת ההתאמה נכשלה. ייתכן שהחודש כבר סגור.');
    } finally {
      setSaving(false);
    }
  };

  const handleMarkAsPaid = async () => {
    if (!canSeeFinancials) {
      setMessage('סכומי שכר מוסתרים למשתמש זה.');
      return;
    }
    if (!paymentWorkerId) {
      setMessage('יש לבחור עובדת.');
      return;
    }
    const summary = summaries[paymentWorkerId];
    if (!summary) return;
    const amount = paymentAmount > 0 ? paymentAmount : toNumber(summary.summary.outstanding);
    if (amount <= 0) {
      setMessage('אין יתרה לתשלום.');
      return;
    }
    const [year, month] = monthYear.split('-').map(Number);
    setSaving(true);
    try {
      await api.post('/payroll/payments', {
        workerId: paymentWorkerId,
        month,
        year,
        amount,
        paymentDate: new Date().toISOString(),
        method: paymentMethod,
        notes: `תשלום שכר לחודש ${monthYear}`,
      });
      setPaymentAmount(0);
      setMessage('התשלום נשמר בהצלחה.');
      await loadPayroll();
    } catch {
      setMessage('שמירת התשלום נכשלה. ייתכן שהחודש כבר סגור.');
    } finally {
      setSaving(false);
    }
  };

  const isClosed = monthStatus?.isClosed ?? false;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 mb-1">שכר עובדים</h1>
          <p className="text-sm text-gray-500">לפני תשלום שכר ניתן להפיק לכל עובדת דוח חודשי מלא עם כל המשמרות, השעות והסכום לתשלום לצורך אישור.</p>
        </div>
        <div className="flex items-center gap-2">
          <button type="button" onClick={() => moveMonth('prev')} className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-gray-300 text-gray-700 hover:bg-gray-50" aria-label="חודש קודם">
            <ChevronRight className="h-4 w-4" />
          </button>
          <button type="button" onClick={() => moveMonth('next')} className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-gray-300 text-gray-700 hover:bg-gray-50" aria-label="חודש הבא">
            <ChevronLeft className="h-4 w-4" />
          </button>
          <button type="button" onClick={jumpToCurrentMonth} className="inline-flex items-center gap-1 rounded-lg border border-primary-200 bg-primary-50 px-3 py-2 text-xs font-medium text-primary-700 hover:bg-primary-100">
            <CalendarDays className="w-4 h-4" />
            החודש
          </button>
          <input type="month" value={monthYear} onChange={(event) => setMonthYear(event.target.value)} className="rounded-xl border border-gray-300 px-3 py-2 text-sm" />
          <button type="button" onClick={() => void loadPayroll()} className="inline-flex items-center gap-2 rounded-lg border border-gray-300 px-3 py-2 text-xs text-gray-700 hover:bg-gray-50">
            <RefreshCw className="w-3.5 h-3.5" />
            רענון
          </button>
        </div>
      </div>

      {isClosed ? (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
          חודש זה סגור. לא ניתן להוסיף התאמות או תשלומים עד לפתיחה מחדש.
        </div>
      ) : null}

      {loading ? (
        <div className="rounded-xl border border-blue-200 bg-blue-50 px-3 py-2 text-sm text-blue-700">טוען נתוני שכר...</div>
      ) : null}
      {error ? (
        <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>
      ) : null}

      <section className="grid gap-4 md:grid-cols-3">
        <article className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
          <div className="text-sm text-gray-500">סה״כ לתשלום</div>
          <div className="text-xl font-bold text-gray-900 mt-1">{canSeeFinancials ? formatCurrency(totals.totalDue) : 'מוסתר'}</div>
        </article>
        <article className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
          <div className="text-sm text-gray-500">שולם בפועל</div>
          <div className="text-xl font-bold text-emerald-700 mt-1">{canSeeFinancials ? formatCurrency(totals.totalPaid) : 'מוסתר'}</div>
        </article>
        <article className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
          <div className="text-sm text-gray-500">עובדות פעילות</div>
          <div className="text-xl font-bold text-amber-700 mt-1">{workers.length}</div>
        </article>
      </section>

      <section className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-right text-gray-500 border-b border-gray-100">
              <th className="px-2 py-2 font-medium">עובדת</th>
              <th className="px-2 py-2 font-medium">שעות</th>
              <th className="px-2 py-2 font-medium">תוספות / ניכויים</th>
              <th className="px-2 py-2 font-medium">סה״כ לתשלום</th>
              <th className="px-2 py-2 font-medium">שולם</th>
              <th className="px-2 py-2 font-medium">סטטוס</th>
              <th className="px-2 py-2 font-medium">דוח חודשי</th>
              <th className="px-2 py-2 font-medium">פעולות</th>
            </tr>
          </thead>
          <tbody>
            {workers.map((worker) => {
              const row = summaries[worker.id];
              if (!row) return null;
              const fullName = `${worker.firstName} ${worker.lastName}`;
              const adjustmentTotal = toNumber(row.summary.adjustmentTotal);
              const outstanding = toNumber(row.summary.outstanding);
              return (
                <tr key={worker.id} className="border-b border-gray-50 last:border-b-0">
                  <td className="px-2 py-2 font-medium">{fullName}</td>
                  <td className="px-2 py-2">{row.summary.totalApprovedHours}</td>
                  <td className="px-2 py-2">
                    {canSeeFinancials ? (
                      <>
                        <div className="text-emerald-700">+ {formatCurrency(Math.max(adjustmentTotal, 0))}</div>
                        <div className="text-red-700">- {formatCurrency(Math.abs(Math.min(adjustmentTotal, 0)))}</div>
                      </>
                    ) : (
                      <div className="text-gray-500">מוסתר</div>
                    )}
                  </td>
                  <td className="px-2 py-2 font-semibold">{canSeeFinancials ? formatCurrency(toNumber(row.summary.totalDue)) : 'מוסתר'}</td>
                  <td className="px-2 py-2">{canSeeFinancials ? formatCurrency(toNumber(row.summary.totalPaid)) : 'מוסתר'}</td>
                  <td className="px-2 py-2">{formatStatus(row.summary.status)}</td>
                  <td className="px-2 py-2">
                    <button
                      type="button"
                      onClick={() => setSelectedWorkerId(worker.id)}
                      className="inline-flex items-center gap-1 rounded-lg border border-gray-300 px-2 py-1 text-xs hover:bg-gray-50"
                    >
                      <FileText className="w-3.5 h-3.5" />
                      הפקה ואישור
                    </button>
                  </td>
                  <td className="px-2 py-2">
                    <button
                      type="button"
                      onClick={() => {
                        setPaymentWorkerId(worker.id);
                        setPaymentAmount(outstanding);
                      }}
                      disabled={isClosed || !canSeeFinancials}
                      className="rounded-lg border border-gray-300 px-2 py-1 text-xs disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      סמן כשולם
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>

      <section className="grid gap-4 lg:grid-cols-2">
        <article className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
          <h2 className="text-lg font-semibold mb-3">הוספת תוספת/ניכוי</h2>
          <div className="grid gap-2 md:grid-cols-2">
            <select value={adjustmentWorkerId} onChange={(event) => setAdjustmentWorkerId(event.target.value)} className="rounded-xl border border-gray-300 px-3 py-2 text-sm">
              {workers.map((worker) => (
                <option key={worker.id} value={worker.id}>
                  {worker.firstName} {worker.lastName}
                </option>
              ))}
            </select>
            <select value={adjustmentCategory} onChange={(event) => setAdjustmentCategory(event.target.value as AdjustmentCategory)} className="rounded-xl border border-gray-300 px-3 py-2 text-sm">
              <option value="בונוס ראש צוות">בונוס ראש צוות</option>
              <option value="החזר נסיעות">החזר נסיעות</option>
              <option value="תיקון">תיקון</option>
              <option value="קנס">קנס</option>
              <option value="הבאת לקוח">הבאת לקוח</option>
            </select>
            <input type="number" value={adjustmentAmount} onChange={(event) => setAdjustmentAmount(Number(event.target.value))} disabled={!canSeeFinancials} className="rounded-xl border border-gray-300 px-3 py-2 text-sm disabled:bg-gray-100" placeholder={canSeeFinancials ? 'סכום (חיובי/שלילי)' : 'סכום מוסתר'} />
            <input value={adjustmentReason} onChange={(event) => setAdjustmentReason(event.target.value)} className="rounded-xl border border-gray-300 px-3 py-2 text-sm" placeholder="סיבה/הערה" />
          </div>
          <button type="button" onClick={() => void handleAddAdjustment()} disabled={saving || isClosed || !canSeeFinancials} className="mt-3 inline-flex items-center gap-1 rounded-lg bg-primary-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-primary-700 disabled:opacity-50">
            <Plus className="w-3.5 h-3.5" />
            הוספת התאמה
          </button>
        </article>

        <article className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
          <h2 className="text-lg font-semibold mb-3">תשלום לעובדת</h2>
          <div className="grid gap-2 md:grid-cols-2">
            <select value={paymentWorkerId} onChange={(event) => setPaymentWorkerId(event.target.value)} className="rounded-xl border border-gray-300 px-3 py-2 text-sm">
              {workers.map((worker) => (
                <option key={worker.id} value={worker.id}>
                  {worker.firstName} {worker.lastName}
                </option>
              ))}
            </select>
            <input type="number" value={paymentAmount} onChange={(event) => setPaymentAmount(Number(event.target.value))} disabled={!canSeeFinancials} className="rounded-xl border border-gray-300 px-3 py-2 text-sm disabled:bg-gray-100" placeholder={canSeeFinancials ? 'סכום לתשלום' : 'סכום מוסתר'} />
            <select value={paymentMethod} onChange={(event) => setPaymentMethod(event.target.value)} className="rounded-xl border border-gray-300 px-3 py-2 text-sm">
              {paymentMethodOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>
          <button type="button" onClick={() => void handleMarkAsPaid()} disabled={saving || isClosed || !canSeeFinancials} className="mt-3 inline-flex items-center gap-1 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-700 disabled:opacity-50">
            <CreditCard className="w-3.5 h-3.5" />
            שמירת תשלום
          </button>
        </article>
      </section>

      {selectedSummary && selectedWorker ? (
        <div className="fixed inset-0 z-50 bg-black/30 flex items-center justify-center p-4">
          <div className="w-full max-w-3xl rounded-lg border border-gray-200 bg-white shadow-xl overflow-hidden">
            <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
              <button type="button" onClick={() => setSelectedWorkerId(null)} className="text-xs px-2 py-1 rounded border border-gray-300 text-gray-700 hover:bg-gray-50">
                סגירה
              </button>
              <h3 className="text-sm font-semibold text-gray-900">דוח שכר חודשי לעובדת: {selectedWorker.firstName} {selectedWorker.lastName}</h3>
            </div>
            <div className="p-5 space-y-4">
              <div className="flex items-center gap-2">
                <label className="text-xs text-gray-600">חודש דוח</label>
                <input type="month" value={monthYear} onChange={(event) => setMonthYear(event.target.value)} className="rounded-lg border border-gray-300 px-2 py-1 text-xs" />
                <button type="button" onClick={() => void loadPayroll()} className="rounded-lg border border-gray-300 px-2 py-1 text-xs hover:bg-gray-50">
                  רענון דוח
                </button>
              </div>

              <div className="rounded-lg border border-gray-200 p-3 text-xs text-gray-700 bg-gray-50">
                סיכום: {selectedSummary.summary.shiftsCount} משמרות • {selectedSummary.summary.totalApprovedHours} שעות מאושרות • לתשלום{' '}
                <span className="font-semibold text-gray-900">{canSeeFinancials ? formatCurrency(toNumber(selectedSummary.summary.totalDue)) : 'מוסתר'}</span>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-right text-gray-500 border-b border-gray-100">
                      <th className="px-2 py-2 font-medium">תאריך</th>
                      <th className="px-2 py-2 font-medium">פרוייקט</th>
                      <th className="px-2 py-2 font-medium">סוג משמרת</th>
                      <th className="px-2 py-2 font-medium">שעות</th>
                      <th className="px-2 py-2 font-medium">שעות מאושרות</th>
                    </tr>
                  </thead>
                  <tbody>
                    {selectedSummary.shifts.map((shift) => (
                      <tr key={shift.id} className="border-b border-gray-50 last:border-b-0">
                        <td className="px-2 py-2">{shift.date}</td>
                        <td className="px-2 py-2">{shift.caseName}</td>
                        <td className="px-2 py-2">{shift.shiftLabel}</td>
                        <td className="px-2 py-2">
                          {shift.startTime} - {shift.endTime}
                        </td>
                        <td className="px-2 py-2">{shift.approvedHours}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="grid gap-3 md:grid-cols-2">
                <div className="rounded-lg border border-gray-200 p-3">
                  <h4 className="text-sm font-semibold text-gray-900 mb-2">התאמות</h4>
                  <div className="space-y-2">
                    {selectedSummary.adjustments.map((adj) => (
                      <div key={adj.id} className="rounded-lg border border-gray-100 px-3 py-2 text-xs">
                        <div className="font-medium text-gray-900">{adj.reason}</div>
                        <div className="text-gray-500">{adj.category}</div>
                        <div className={adj.amount >= 0 ? 'text-emerald-700' : 'text-red-700'}>{canSeeFinancials ? formatCurrency(adj.amount) : 'מוסתר'}</div>
                      </div>
                    ))}
                  </div>
                </div>
                <div className="rounded-lg border border-gray-200 p-3">
                  <h4 className="text-sm font-semibold text-gray-900 mb-2">תשלומים</h4>
                  <div className="space-y-2">
                    {selectedSummary.payments.map((payment) => (
                      <div key={payment.id} className="rounded-lg border border-gray-100 px-3 py-2 text-xs">
                        <div className="font-medium text-gray-900">{new Date(payment.paymentDate).toLocaleDateString('he-IL')}</div>
                        <div className="text-gray-500">{payment.method}</div>
                        <div className="text-emerald-700">{canSeeFinancials ? formatCurrency(payment.amount) : 'מוסתר'}</div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              <label className="inline-flex items-center gap-2 text-sm text-gray-700">
                <input
                  type="checkbox"
                  checked={reportApproval[`${selectedWorker.id}|${monthYear}`] ?? false}
                  onChange={(event) => setReportApproval((prev) => ({ ...prev, [`${selectedWorker.id}|${monthYear}`]: event.target.checked }))}
                />
                העובדת אישרה את הדוח החודשי לפני תשלום
              </label>
            </div>
          </div>
        </div>
      ) : null}

      <section className="grid gap-3 md:grid-cols-3">
        <div className="rounded-xl border border-blue-200 bg-blue-50 p-3 text-sm text-blue-800 inline-flex items-center gap-2">
          <Coins className="w-4 h-4" />
          תשלום יומי מחושב רק למשמרות עם כניסה בפועל.
        </div>
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800 inline-flex items-center gap-2">
          <TrendingUp className="w-4 h-4" />
          כל התאמה משתקפת גם בדוח רווחיות פרוייקט.
        </div>
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800 inline-flex items-center gap-2">
          <CreditCard className="w-4 h-4" />
          סטטוס תשלום נרשם לפי תשלום חלקי/מלא.
        </div>
      </section>

      {message ? <div className="rounded-xl border border-blue-200 bg-blue-50 px-3 py-2 text-sm text-blue-700">{message}</div> : null}
    </div>
  );
}

'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { CreditCard, FileText, RefreshCw, Wallet } from 'lucide-react';
import { useUser } from '@clerk/nextjs';
import Link from 'next/link';
import { api } from '../../lib/api';
import { canViewSensitiveFinancials, resolveAppViewerRole } from '../../lib/viewer-access';
import { invoiceStatusTone } from '@workforce/shared';
import { StatusBadge } from '../../components/ui/StatusBadge';

type InvoiceStatus = 'DRAFT' | 'SENT' | 'PARTIALLY_PAID' | 'PAID' | 'VOID';
type PaymentMethod = 'BANK_TRANSFER' | 'CASH' | 'BIT' | 'CHECK' | 'OTHER';

type InvoicePayment = {
  id: string;
  amount: number | string;
  paymentDate: string;
  method: PaymentMethod;
  notes?: string | null;
};

type InvoiceItem = {
  id: string;
  description: string;
  quantity: number;
  unitPrice: number | string;
  total: number | string;
};

type InvoiceSummary = {
  id: string;
  invoiceNumber: string;
  issueDate?: string | null;
  dueDate?: string | null;
  status: InvoiceStatus;
  subtotal: number | string;
  vatAmount: number | string;
  total: number | string;
  customer?: { firstName?: string | null; lastName?: string | null } | null;
  case?: { name?: string | null } | null;
  payments?: InvoicePayment[];
};

type InvoiceDetail = InvoiceSummary & {
  notes?: string | null;
  items?: InvoiceItem[];
};

const statusLabels: Record<InvoiceStatus, string> = {
  DRAFT: 'טיוטה',
  SENT: 'נשלחה',
  PARTIALLY_PAID: 'שולם חלקית',
  PAID: 'שולם',
  VOID: 'בוטלה',
};

const paymentMethodLabels: Record<PaymentMethod, string> = {
  BANK_TRANSFER: 'העברה בנקאית',
  CASH: 'מזומן',
  BIT: 'ביט',
  CHECK: "צ'ק",
  OTHER: 'אחר',
};

function toNumber(value: string | number | null | undefined) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function formatCurrency(value: number) {
  return new Intl.NumberFormat('he-IL', {
    style: 'currency',
    currency: 'ILS',
    maximumFractionDigits: 0,
  }).format(value);
}

function formatDate(value?: string | null) {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString('he-IL');
}

function customerName(invoice: InvoiceSummary | InvoiceDetail) {
  const first = invoice.customer?.firstName?.trim() ?? '';
  const last = invoice.customer?.lastName?.trim() ?? '';
  const full = `${first} ${last}`.trim();
  return full || 'ללא לקוח';
}

export default function InvoicesPage() {
  return (
    <div className="rounded-lg border border-amber-200 bg-amber-50 p-6 text-right">
      <h1 className="text-xl font-bold text-amber-900">חשבוניות אינן פעילות במערכת זו</h1>
      <p className="mt-2 text-sm text-amber-800">
        לפי תהליך העבודה, חיוב והפקת חשבוניות מתבצעים במערכת חיצונית. ניהול הפרוייקטים והצעות המחיר נשאר במסכי הפרוייקטים.
      </p>
      <Link
        href="/cases"
        className="mt-4 inline-flex rounded-lg border border-amber-300 bg-white px-3 py-2 text-xs font-medium text-amber-900 hover:bg-amber-100"
      >
        מעבר לפרוייקטים
      </Link>
    </div>
  );
}

function InvoicesPageLegacy() {
  const { user } = useUser();
  const canSeeFinancials = canViewSensitiveFinancials(resolveAppViewerRole(user));
  const now = useMemo(() => new Date(), []);
  const [statusFilter, setStatusFilter] = useState<'ALL' | InvoiceStatus>('ALL');
  const [invoices, setInvoices] = useState<InvoiceSummary[]>([]);
  const [selectedInvoiceId, setSelectedInvoiceId] = useState<string | null>(null);
  const [selectedInvoice, setSelectedInvoice] = useState<InvoiceDetail | null>(null);
  const [loadingList, setLoadingList] = useState(true);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [savingPayment, setSavingPayment] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [paymentAmount, setPaymentAmount] = useState(0);
  const [paymentDate, setPaymentDate] = useState(`${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`);
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('BANK_TRANSFER');
  const [paymentNotes, setPaymentNotes] = useState('');

  const loadInvoices = useCallback(async () => {
    setLoadingList(true);
    setError('');
    try {
      const response = await api.get<InvoiceSummary[]>('/invoices', {
        params: statusFilter === 'ALL' ? undefined : { status: statusFilter },
      });
      setInvoices(response.data);
      setSelectedInvoiceId((current) => current ?? response.data[0]?.id ?? null);
      if (response.data.length === 0) {
        setSelectedInvoiceId(null);
        setSelectedInvoice(null);
      }
    } catch {
      setInvoices([]);
      setSelectedInvoiceId(null);
      setSelectedInvoice(null);
      setError('לא ניתן לטעון את החשבוניות כרגע. ודאי שלשרת ה-API יש הרשאות אדמין ונסי שוב.');
    } finally {
      setLoadingList(false);
    }
  }, [statusFilter]);

  const loadInvoiceDetail = useCallback(async (invoiceId: string) => {
    setLoadingDetail(true);
    try {
      const response = await api.get<InvoiceDetail>(`/invoices/${invoiceId}`);
      setSelectedInvoice(response.data);
    } catch {
      setSelectedInvoice(null);
      setError('לא ניתן לטעון את פרטי החשבונית שנבחרה.');
    } finally {
      setLoadingDetail(false);
    }
  }, []);

  useEffect(() => {
    void loadInvoices();
  }, [loadInvoices]);

  useEffect(() => {
    if (!selectedInvoiceId) return;
    void loadInvoiceDetail(selectedInvoiceId);
  }, [loadInvoiceDetail, selectedInvoiceId]);

  const totals = useMemo(() => ({
    count: invoices.length,
    total: invoices.reduce((sum, invoice) => sum + toNumber(invoice.total), 0),
    paid: invoices.filter((invoice) => invoice.status === 'PAID').length,
  }), [invoices]);

  const handlePayment = async () => {
    setMessage('');
    setError('');
    if (!canSeeFinancials) {
      setMessage('סכומי חיוב מוסתרים למשתמש זה.');
      return;
    }
    if (!selectedInvoiceId) {
      setMessage('יש לבחור חשבונית לפני רישום תשלום.');
      return;
    }
    if (paymentAmount <= 0) {
      setMessage('יש להזין סכום תשלום גדול מאפס.');
      return;
    }

    setSavingPayment(true);
    try {
      await api.post(`/invoices/${selectedInvoiceId}/payments`, {
        amount: paymentAmount,
        paymentDate,
        method: paymentMethod,
        notes: paymentNotes.trim() || undefined,
      });
      setPaymentAmount(0);
      setPaymentNotes('');
      setMessage('התשלום נרשם בהצלחה.');
      await loadInvoices();
      await loadInvoiceDetail(selectedInvoiceId);
    } catch {
      setError('רישום התשלום נכשל. ודאי שה-API זמין ושהחשבונית קיימת.');
    } finally {
      setSavingPayment(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">חשבוניות לקוח</h1>
          <p className="mt-1 text-sm text-gray-500">מעקב חיוב, סטטוס גבייה ורישום תשלומי לקוחות מתוך ה-API.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as 'ALL' | InvoiceStatus)} className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-xs font-medium text-gray-700">
            <option value="ALL">כל הסטטוסים</option>
            {Object.entries(statusLabels).map(([value, label]) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </select>
          <button type="button" onClick={() => void loadInvoices()} className="inline-flex items-center gap-1 rounded-lg border border-gray-300 bg-white px-3 py-2 text-xs font-medium text-gray-700">
            <RefreshCw className="h-3.5 w-3.5" />
            רענון
          </button>
        </div>
      </div>

      {(message || error) && (
        <div className={`rounded-xl border px-3 py-2 text-sm ${error ? 'border-rose-200 bg-rose-50 text-rose-700' : 'border-emerald-200 bg-emerald-50 text-emerald-700'}`}>
          {error || message}
        </div>
      )}

      <div className="grid gap-3 md:grid-cols-3">
        <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
          <p className="text-xs text-gray-500">חשבוניות בטווח</p>
          <p className="mt-2 text-2xl font-bold text-gray-900">{totals.count}</p>
        </div>
        <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
          <p className="text-xs text-gray-500">סה״כ לחיוב</p>
          <p className="mt-2 text-2xl font-bold text-gray-900">{canSeeFinancials ? formatCurrency(totals.total) : 'מוסתר'}</p>
        </div>
        <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
          <div className="flex items-center gap-2 text-xs text-gray-500">
            <Wallet className="h-4 w-4" />
            חשבוניות ששולמו במלואן
          </div>
          <p className="mt-2 text-2xl font-bold text-gray-900">{totals.paid}</p>
        </div>
      </div>

      <div className="grid gap-4 xl:grid-cols-[380px_minmax(0,1fr)]">
        <section className="rounded-2xl border border-gray-200 bg-white shadow-sm overflow-hidden">
          <div className="border-b border-gray-100 px-4 py-3">
            <h2 className="text-lg font-semibold text-gray-900">רשימת חשבוניות</h2>
            <p className="mt-1 text-xs text-gray-500">בחרי חשבונית כדי לצפות בפרטים ולרשום תשלום.</p>
          </div>

          {loadingList ? (
            <div className="p-6 text-sm text-gray-500">טוען חשבוניות...</div>
          ) : invoices.length === 0 ? (
            <div className="p-6 text-sm text-gray-500">לא נמצאו חשבוניות לפי הסינון שנבחר.</div>
          ) : (
            <div className="divide-y divide-gray-100">
              {invoices.map((invoice) => {
                const active = invoice.id === selectedInvoiceId;
                return (
                  <button
                    key={invoice.id}
                    type="button"
                    onClick={() => setSelectedInvoiceId(invoice.id)}
                    className={`w-full px-4 py-3 text-right hover:bg-primary-50 ${active ? 'bg-primary-50' : 'bg-white'}`}
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <p className="text-sm font-semibold text-gray-900">{invoice.invoiceNumber}</p>
                        <p className="mt-0.5 text-xs text-gray-500">{customerName(invoice)}</p>
                      </div>
                      <StatusBadge tone={invoiceStatusTone(invoice.status)} label={statusLabels[invoice.status] ?? invoice.status} />
                    </div>
                    <div className="mt-2 flex items-center justify-between text-xs text-gray-500">
                      <span>{invoice.case?.name || 'ללא פרוייקט'}</span>
                      <span>{canSeeFinancials ? formatCurrency(toNumber(invoice.total)) : 'מוסתר'}</span>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </section>

        <section className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm space-y-4">
          {!selectedInvoiceId ? (
            <div className="text-sm text-gray-500">בחרי חשבונית מהרשימה כדי לצפות בפרטים.</div>
          ) : loadingDetail || !selectedInvoice ? (
            <div className="text-sm text-gray-500">טוען פרטי חשבונית...</div>
          ) : (
            <>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="inline-flex items-center gap-2 rounded-full bg-primary-100 px-2.5 py-1 text-xs font-medium text-primary-700">
                    <FileText className="h-3.5 w-3.5" />
                    {selectedInvoice.invoiceNumber}
                  </div>
                  <h2 className="mt-2 text-xl font-semibold text-gray-900">{customerName(selectedInvoice)}</h2>
                  <p className="mt-1 text-sm text-gray-500">פרוייקט: {selectedInvoice.case?.name || 'לא משויך'} • סטטוס: {statusLabels[selectedInvoice.status] ?? selectedInvoice.status}</p>
                </div>
                <div className="text-left">
                  <p className="text-xs text-gray-500">סה״כ</p>
                  <p className="text-2xl font-bold text-gray-900">{canSeeFinancials ? formatCurrency(toNumber(selectedInvoice.total)) : 'מוסתר'}</p>
                </div>
              </div>

              <div className="grid gap-3 md:grid-cols-3">
                <div className="rounded-xl border border-gray-200 bg-gray-50 p-3">
                  <p className="text-xs text-gray-500">תאריך הנפקה</p>
                  <p className="mt-1 text-sm font-semibold text-gray-900">{formatDate(selectedInvoice.issueDate)}</p>
                </div>
                <div className="rounded-xl border border-gray-200 bg-gray-50 p-3">
                  <p className="text-xs text-gray-500">תאריך יעד</p>
                  <p className="mt-1 text-sm font-semibold text-gray-900">{formatDate(selectedInvoice.dueDate)}</p>
                </div>
                <div className="rounded-xl border border-gray-200 bg-gray-50 p-3">
                  <p className="text-xs text-gray-500">מע״מ</p>
                  <p className="mt-1 text-sm font-semibold text-gray-900">{canSeeFinancials ? formatCurrency(toNumber(selectedInvoice.vatAmount)) : 'מוסתר'}</p>
                </div>
              </div>

              <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
                <div className="space-y-4">
                  <div>
                    <h3 className="text-sm font-semibold text-gray-900">שורות חשבונית</h3>
                    <div className="mt-2 overflow-x-auto rounded-xl border border-gray-200">
                      <table className="min-w-full divide-y divide-gray-200 text-right text-sm">
                        <thead className="bg-gray-50 text-xs text-gray-500">
                          <tr>
                            <th className="px-3 py-2 font-medium">תיאור</th>
                            <th className="px-3 py-2 font-medium">כמות</th>
                            <th className="px-3 py-2 font-medium">מחיר יחידה</th>
                            <th className="px-3 py-2 font-medium">סה״כ</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100 bg-white">
                          {(selectedInvoice.items ?? []).map((item) => (
                            <tr key={item.id}>
                              <td className="px-3 py-2 text-gray-700">{item.description}</td>
                              <td className="px-3 py-2 text-gray-700">{item.quantity}</td>
                              <td className="px-3 py-2 text-gray-700">{canSeeFinancials ? formatCurrency(toNumber(item.unitPrice)) : 'מוסתר'}</td>
                              <td className="px-3 py-2 font-semibold text-gray-900">{canSeeFinancials ? formatCurrency(toNumber(item.total)) : 'מוסתר'}</td>
                            </tr>
                          ))}
                          {(selectedInvoice.items ?? []).length === 0 && (
                            <tr>
                              <td colSpan={4} className="px-3 py-4 text-center text-sm text-gray-500">אין שורות מפורטות לחשבונית זו.</td>
                            </tr>
                          )}
                        </tbody>
                      </table>
                    </div>
                  </div>

                  <div>
                    <h3 className="text-sm font-semibold text-gray-900">תשלומים שנרשמו</h3>
                    {canSeeFinancials && (() => {
                      const paidTotal = (selectedInvoice.payments ?? []).reduce((sum, p) => sum + toNumber(p.amount), 0);
                      const remaining = Math.max(0, toNumber(selectedInvoice.total) - paidTotal);
                      const isPartial = paidTotal > 0 && remaining > 0;
                      const isMismatch = paidTotal > toNumber(selectedInvoice.total) + 0.5;
                      return (
                        <div className="mt-2 grid grid-cols-2 gap-2">
                          <div className="rounded-xl border border-gray-200 bg-white p-3">
                            <p className="text-xs text-gray-500">שולם עד כה</p>
                            <p className="mt-1 text-sm font-semibold text-gray-900">{formatCurrency(paidTotal)}</p>
                          </div>
                          <div className="rounded-xl border border-gray-200 bg-white p-3">
                            <p className="text-xs text-gray-500">יתרה לתשלום</p>
                            <p className={`mt-1 text-sm font-semibold ${remaining > 0 ? 'text-warning' : 'text-success'}`}>{formatCurrency(remaining)}</p>
                          </div>
                          {isPartial && (
                            <p className="col-span-2 rounded-lg border border-warning/40 bg-warning-bg px-3 py-1.5 text-xs text-warning">תשלום חלקי — נותרה יתרה לגבייה</p>
                          )}
                          {isMismatch && (
                            <p className="col-span-2 rounded-lg border border-danger/40 bg-danger-bg px-3 py-1.5 text-xs text-danger">אי-התאמה בסכום — סך התשלומים גבוה מסכום החשבונית</p>
                          )}
                        </div>
                      );
                    })()}
                    <div className="mt-2 space-y-2">
                      {(selectedInvoice.payments ?? []).length === 0 ? (
                        <div className="rounded-xl border border-dashed border-gray-200 px-3 py-4 text-sm text-gray-500">עדיין לא נרשמו תשלומים לחשבונית זו.</div>
                      ) : (
                        (selectedInvoice.payments ?? []).map((payment) => (
                          <div key={payment.id} className="rounded-xl border border-gray-200 px-3 py-3">
                            <div className="flex items-center justify-between gap-3">
                              <div>
                                <p className="text-sm font-semibold text-gray-900">{canSeeFinancials ? formatCurrency(toNumber(payment.amount)) : 'מוסתר'}</p>
                                <p className="mt-0.5 text-xs text-gray-500">{formatDate(payment.paymentDate)} • {paymentMethodLabels[payment.method] ?? payment.method}</p>
                              </div>
                              <CreditCard className="h-4 w-4 text-gray-400" />
                            </div>
                            {payment.notes && <p className="mt-2 text-xs text-gray-500">{payment.notes}</p>}
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                </div>

                <aside className="rounded-2xl border border-gray-200 bg-gray-50 p-4 space-y-3">
                  <h3 className="text-sm font-semibold text-gray-900">רישום תשלום</h3>
                  <p className="text-xs text-gray-500">עדכון מהיר של תשלום לקוח על החשבונית הנבחרת.</p>

                  <label className="block text-sm text-gray-700">
                    סכום
                    <input type="number" min="0" value={paymentAmount} onChange={(event) => setPaymentAmount(Number(event.target.value))} disabled={!canSeeFinancials} className="mt-1 w-full rounded-xl border border-gray-300 bg-white px-3 py-2 text-sm disabled:bg-gray-100" />
                  </label>

                  <label className="block text-sm text-gray-700">
                    תאריך תשלום
                    <input type="date" value={paymentDate} onChange={(event) => setPaymentDate(event.target.value)} className="mt-1 w-full rounded-xl border border-gray-300 bg-white px-3 py-2 text-sm" />
                  </label>

                  <label className="block text-sm text-gray-700">
                    אמצעי תשלום
                    <select value={paymentMethod} onChange={(event) => setPaymentMethod(event.target.value as PaymentMethod)} className="mt-1 w-full rounded-xl border border-gray-300 bg-white px-3 py-2 text-sm">
                      {Object.entries(paymentMethodLabels).map(([value, label]) => (
                        <option key={value} value={value}>{label}</option>
                      ))}
                    </select>
                  </label>

                  <label className="block text-sm text-gray-700">
                    הערות
                    <textarea value={paymentNotes} onChange={(event) => setPaymentNotes(event.target.value)} rows={4} className="mt-1 w-full rounded-xl border border-gray-300 bg-white px-3 py-2 text-sm" placeholder="אסמכתא, פירוט העברה, הערת גבייה..." />
                  </label>

                  <button type="button" onClick={() => void handlePayment()} disabled={savingPayment || !canSeeFinancials} className="w-full rounded-xl bg-primary-600 px-3 py-2 text-sm font-semibold text-white hover:bg-primary-700 disabled:cursor-not-allowed disabled:bg-primary-300">
                    {savingPayment ? 'שומר...' : 'רישום תשלום'}
                  </button>
                </aside>
              </div>
            </>
          )}
        </section>
      </div>
    </div>
  );
}

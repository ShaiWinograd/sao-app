'use client';

import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { CheckCircle2, FileText, Loader2, XCircle } from 'lucide-react';
import { api } from '../../../lib/api';

type PublicQuotation = {
  id: string;
  caseName: string;
  customerFirstName: string;
  status: 'DRAFT' | 'SENT' | 'APPROVED' | 'REJECTED' | 'EXPIRED';
  versionNumber: number;
  estimatedTotal: number | string;
  includedServices: string[];
  datePrecision: string;
  timingNote: string | null;
  validUntil: string | null;
};

function formatCurrency(value: number | string): string {
  const num = typeof value === 'string' ? Number(value) : value;
  if (!Number.isFinite(num)) return '—';
  return `₪${num.toLocaleString('he-IL')}`;
}

function formatDate(value: string | null): string {
  if (!value) return '';
  try {
    return new Date(value).toLocaleDateString('he-IL', { day: 'numeric', month: 'long', year: 'numeric' });
  } catch {
    return '';
  }
}

export default function PublicQuotationPage() {
  const params = useParams();
  const id = typeof params?.id === 'string' ? params.id : Array.isArray(params?.id) ? params.id[0] : '';

  const [quote, setQuote] = useState<PublicQuotation | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [approving, setApproving] = useState(false);
  const [approveError, setApproveError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!id) return;
    setIsLoading(true);
    setNotFound(false);
    try {
      const res = await api.get<PublicQuotation>(`/quotations/${id}/public`);
      setQuote(res.data);
    } catch {
      setNotFound(true);
    } finally {
      setIsLoading(false);
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  const handleApprove = useCallback(async () => {
    if (!quote) return;
    setApproving(true);
    setApproveError(null);
    try {
      await api.post(`/quotations/${quote.id}/public-approve`, {});
      setQuote({ ...quote, status: 'APPROVED' });
    } catch {
      setApproveError('אישור ההצעה נכשל. נסו שוב או צרו קשר עם העסק.');
    } finally {
      setApproving(false);
    }
  }, [quote]);

  return (
    <main dir="rtl" className="min-h-screen bg-[var(--color-background)] flex flex-col items-center px-4 py-10">
      <div className="w-full max-w-lg">
        <div className="mb-6 text-center">
          <div className="inline-flex items-center gap-2 text-primary-700 font-bold text-lg">
            <FileText className="w-5 h-5" />
            Space &amp; Order
          </div>
          <p className="mt-1 text-xs text-gray-500">ארגון ומעבר דירה</p>
        </div>

        {isLoading ? (
          <div className="flex justify-center py-20 text-gray-400">
            <Loader2 className="w-6 h-6 animate-spin" />
          </div>
        ) : notFound || !quote ? (
          <div className="rounded-xl border border-gray-200 bg-white p-8 text-center shadow-sm">
            <XCircle className="mx-auto w-8 h-8 text-gray-300" />
            <p className="mt-3 text-sm font-medium text-gray-700">הצעת המחיר לא נמצאה</p>
            <p className="mt-1 text-xs text-gray-500">ייתכן שהקישור שגוי או שפג תוקפו. אנא צרו קשר עם העסק.</p>
          </div>
        ) : (
          <div className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
            <p className="text-sm text-gray-600">שלום {quote.customerFirstName},</p>
            <h1 className="mt-1 text-xl font-bold text-gray-900">הצעת מחיר עבור {quote.caseName}</h1>

            <div className="mt-5 rounded-xl bg-primary-50 border border-primary-100 px-4 py-4 text-center">
              <p className="text-xs text-primary-700">סכום משוער</p>
              <p className="mt-1 text-3xl font-bold text-primary-800">{formatCurrency(quote.estimatedTotal)}</p>
            </div>

            {quote.includedServices.length > 0 && (
              <div className="mt-5">
                <p className="text-xs font-semibold text-gray-500 mb-2">שירותים כלולים</p>
                <ul className="space-y-1.5">
                  {quote.includedServices.map((service, index) => (
                    <li key={index} className="flex items-start gap-2 text-sm text-gray-800">
                      <CheckCircle2 className="w-4 h-4 text-primary-600 mt-0.5 shrink-0" />
                      <span>{service}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {quote.timingNote && (
              <p className="mt-4 text-sm text-gray-600">
                <span className="font-semibold text-gray-700">מועד: </span>
                {quote.timingNote}
              </p>
            )}
            {quote.validUntil && (
              <p className="mt-1 text-xs text-gray-500">בתוקף עד {formatDate(quote.validUntil)}</p>
            )}

            <div className="mt-6 border-t border-gray-100 pt-5">
              {quote.status === 'APPROVED' ? (
                <div className="flex items-center justify-center gap-2 rounded-lg bg-green-50 border border-green-200 px-4 py-3 text-sm font-medium text-green-800">
                  <CheckCircle2 className="w-5 h-5" />
                  ההצעה אושרה — תודה! ניצור איתכם קשר בהקדם.
                </div>
              ) : quote.status === 'SENT' ? (
                <>
                  <button
                    onClick={() => void handleApprove()}
                    disabled={approving}
                    className="w-full inline-flex items-center justify-center gap-2 rounded-lg bg-primary-600 px-4 py-3 text-sm font-semibold text-white hover:bg-primary-700 disabled:opacity-50"
                  >
                    {approving ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
                    אישור הצעת המחיר
                  </button>
                  {approveError && <p className="mt-2 text-xs text-red-600 text-center">{approveError}</p>}
                  <p className="mt-3 text-center text-xs text-gray-400">לשאלות ותיאומים ניתן להשיב להודעה שקיבלתם.</p>
                </>
              ) : quote.status === 'REJECTED' ? (
                <p className="text-center text-sm text-gray-500">הצעת מחיר זו סומנה כנדחתה.</p>
              ) : quote.status === 'EXPIRED' ? (
                <p className="text-center text-sm text-gray-500">פג תוקפה של הצעת מחיר זו. אנא צרו קשר עם העסק.</p>
              ) : (
                <p className="text-center text-sm text-gray-500">הצעת המחיר עדיין אינה זמינה לצפייה.</p>
              )}
            </div>
          </div>
        )}
      </div>
    </main>
  );
}

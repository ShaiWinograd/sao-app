'use client';

import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { CheckCircle2, Copy, Download, Loader2, XCircle } from 'lucide-react';
import { BUSINESS_PROFILE, type QuotationDetails } from '@workforce/shared';
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
  details: QuotationDetails | null;
};

function formatCurrency(value: number | string | undefined | null): string {
  if (value === undefined || value === null || value === '') return '—';
  const num = typeof value === 'string' ? Number(value) : value;
  if (!Number.isFinite(num)) return '—';
  return `₪${num.toLocaleString('he-IL')}`;
}

function formatDate(value: string | null | undefined): string {
  if (!value) return '';
  try {
    return new Date(value).toLocaleDateString('he-IL', { day: 'numeric', month: 'long', year: 'numeric' });
  } catch {
    return '';
  }
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-6">
      <h2 className="text-sm font-bold text-primary-800 mb-2">{title}</h2>
      {children}
    </section>
  );
}

export default function PublicQuotationPage() {
  const params = useParams();
  const id = typeof params?.id === 'string' ? params.id : Array.isArray(params?.id) ? params.id[0] : '';

  const [quote, setQuote] = useState<PublicQuotation | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [approving, setApproving] = useState(false);
  const [approveError, setApproveError] = useState<string | null>(null);
  const [showBankModal, setShowBankModal] = useState(false);
  const [copied, setCopied] = useState(false);

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
      setShowBankModal(true);
    } catch {
      setApproveError('אישור ההצעה נכשל. נסו שוב או צרו קשר עם העסק.');
    } finally {
      setApproving(false);
    }
  }, [quote]);

  const details = quote?.details ?? null;
  const lineItems = details?.lineItems ?? [];
  const hasDateRange = Boolean(details?.projectStartDate || details?.projectEndDate);

  return (
    <main dir="rtl" className="min-h-screen bg-[var(--color-background)] flex flex-col items-center px-4 py-10">
      <div className="w-full max-w-2xl">
        <div className="mb-6 text-center">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/so-logo.jpg" alt={BUSINESS_PROFILE.name} className="mx-auto h-16 w-auto rounded-lg object-contain" />
          <p className="mt-2 text-xs text-gray-500">{BUSINESS_PROFILE.tagline}</p>
        </div>

        {!isLoading && quote && (
          <div className="mb-4 flex justify-center print:hidden">
            <button
              onClick={() => window.print()}
              className="inline-flex items-center gap-1.5 rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50"
            >
              <Download className="w-3.5 h-3.5" />
              הורדה כ-PDF
            </button>
          </div>
        )}

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
          <div className="rounded-2xl border border-gray-200 bg-white p-6 md:p-8 shadow-sm">
            <p className="text-sm text-gray-600">שלום {quote.customerFirstName},</p>
            <h1 className="mt-1 text-xl font-bold text-gray-900">הצעת מחיר — {quote.caseName}</h1>

            <Section title="עלינו">
              <p className="text-sm leading-relaxed text-gray-600" dir="auto">{BUSINESS_PROFILE.about}</p>
            </Section>

            {details?.scopeOfWork && (
              <Section title="היקף העבודה">
                <p className="text-sm text-gray-800" dir="auto">{details.scopeOfWork}</p>
              </Section>
            )}

            {(hasDateRange || quote.timingNote) && (
              <Section title="מועדים">
                {hasDateRange ? (
                  <p className="text-sm text-gray-800">
                    {details?.projectStartDate ? `תחילת הפרויקט: ${formatDate(details.projectStartDate)}` : ''}
                    {details?.projectStartDate && details?.projectEndDate ? ' · ' : ''}
                    {details?.projectEndDate ? `סיום עד: ${formatDate(details.projectEndDate)}` : ''}
                  </p>
                ) : (
                  <p className="text-sm text-gray-800" dir="auto">{quote.timingNote}</p>
                )}
              </Section>
            )}

            <Section title="פירוט הצעת המחיר">
              {lineItems.length > 0 ? (
                <div className="overflow-hidden rounded-lg border border-gray-200">
                  <table className="w-full text-sm">
                    <thead className="bg-gray-50 text-gray-500">
                      <tr>
                        <th className="text-right font-medium px-3 py-2">תיאור</th>
                        <th className="text-right font-medium px-3 py-2 whitespace-nowrap">שעות</th>
                        <th className="text-right font-medium px-3 py-2 whitespace-nowrap">מחיר (₪, כולל מע״מ)</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {lineItems.map((item, index) => (
                        <tr key={index} className="align-top">
                          <td className="px-3 py-2.5 text-gray-800" dir="auto">
                            <div className="font-medium">{item.description}</div>
                            {item.detail && <div className="mt-0.5 text-xs text-gray-500">{item.detail}</div>}
                          </td>
                          <td className="px-3 py-2.5 text-gray-700 whitespace-nowrap">{item.hours || '—'}</td>
                          <td className="px-3 py-2.5 text-gray-900 font-medium whitespace-nowrap">
                            {item.price !== undefined ? formatCurrency(item.price) : '—'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <ul className="space-y-1.5">
                  {quote.includedServices.map((service, index) => (
                    <li key={index} className="flex items-start gap-2 text-sm text-gray-800" dir="auto">
                      <CheckCircle2 className="w-4 h-4 text-primary-600 mt-0.5 shrink-0" />
                      <span>{service}</span>
                    </li>
                  ))}
                </ul>
              )}

              <div className="mt-4 flex items-center justify-between rounded-xl bg-primary-50 border border-primary-100 px-4 py-3">
                <span className="text-sm font-semibold text-primary-800">סכום כולל משוער</span>
                <span className="text-2xl font-bold text-primary-800">{formatCurrency(quote.estimatedTotal)}</span>
              </div>
              {quote.validUntil && (
                <p className="mt-1.5 text-xs text-gray-500">בתוקף עד {formatDate(quote.validUntil)}</p>
              )}
            </Section>

            {details?.depositAmount !== undefined && (
              <Section title="מקדמה">
                <p className="text-sm text-gray-800">
                  יש להעביר מקדמה בסך {formatCurrency(details.depositAmount)}
                  {details.depositDueDate ? ` עד ${formatDate(details.depositDueDate)}` : ''}.
                </p>
              </Section>
            )}

            <Section title="פרטי חשבון להעברה">
              <dl className="text-sm text-gray-800 space-y-0.5" dir="auto">
                <div className="flex gap-2"><dt className="text-gray-500 w-28">על שם</dt><dd>{BUSINESS_PROFILE.bank.accountName}</dd></div>
                <div className="flex gap-2"><dt className="text-gray-500 w-28">בנק</dt><dd>{BUSINESS_PROFILE.bank.bankName}</dd></div>
                <div className="flex gap-2"><dt className="text-gray-500 w-28">סניף</dt><dd>{BUSINESS_PROFILE.bank.branch}</dd></div>
                <div className="flex gap-2"><dt className="text-gray-500 w-28">מספר חשבון</dt><dd>{BUSINESS_PROFILE.bank.accountNumber}</dd></div>
              </dl>
            </Section>

            <Section title="תהליך העבודה">
              <ol className="list-decimal pr-5 space-y-1 text-sm text-gray-700">
                {BUSINESS_PROFILE.workProcess.map((step, index) => (
                  <li key={index}>{step}</li>
                ))}
              </ol>
            </Section>

            <Section title="מידע חשוב">
              <ul className="space-y-1.5 text-xs leading-relaxed text-gray-600">
                {BUSINESS_PROFILE.terms.map((term, index) => (
                  <li key={index} className="flex gap-2">
                    <span className="text-primary-400">•</span>
                    <span>{term}</span>
                  </li>
                ))}
              </ul>
            </Section>

            {details?.notes && (
              <Section title="הערות">
                <p className="text-sm text-gray-700 whitespace-pre-line" dir="auto">{details.notes}</p>
              </Section>
            )}

            <div className="mt-8 border-t border-gray-100 pt-5 print:hidden">
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

      {showBankModal && quote && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4"
          onClick={() => setShowBankModal(false)}
        >
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center gap-2 text-green-700">
              <CheckCircle2 className="w-6 h-6" />
              <h2 className="text-lg font-bold">ההצעה אושרה — תודה!</h2>
            </div>
            <p className="mt-2 text-sm text-gray-600">
              {details?.depositAmount !== undefined
                ? `להבטחת התאריכים יש להעביר מקדמה בסך ${formatCurrency(details.depositAmount)}${details.depositDueDate ? ` עד ${formatDate(details.depositDueDate)}` : ''}.`
                : 'להבטחת התאריכים יש להעביר את המקדמה בהתאם להצעה.'}
            </p>
            <div className="mt-4 rounded-xl border border-gray-200 bg-gray-50 p-4 text-sm">
              <p className="font-semibold text-gray-800 mb-2">פרטי חשבון להעברה</p>
              <dl className="space-y-1 text-gray-700" dir="auto">
                <div className="flex justify-between"><dt className="text-gray-500">על שם</dt><dd>{BUSINESS_PROFILE.bank.accountName}</dd></div>
                <div className="flex justify-between"><dt className="text-gray-500">בנק</dt><dd>{BUSINESS_PROFILE.bank.bankName}</dd></div>
                <div className="flex justify-between"><dt className="text-gray-500">סניף</dt><dd>{BUSINESS_PROFILE.bank.branch}</dd></div>
                <div className="flex justify-between"><dt className="text-gray-500">מספר חשבון</dt><dd className="font-mono">{BUSINESS_PROFILE.bank.accountNumber}</dd></div>
              </dl>
            </div>
            <button
              onClick={() => {
                const text = `${BUSINESS_PROFILE.bank.accountName}\n${BUSINESS_PROFILE.bank.bankName} סניף ${BUSINESS_PROFILE.bank.branch}\nחשבון ${BUSINESS_PROFILE.bank.accountNumber}`;
                void navigator.clipboard?.writeText(text).then(() => {
                  setCopied(true);
                  setTimeout(() => setCopied(false), 2000);
                });
              }}
              className="mt-3 w-full inline-flex items-center justify-center gap-2 rounded-lg bg-primary-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-primary-700"
            >
              <Copy className="w-4 h-4" />
              {copied ? 'הפרטים הועתקו' : 'העתקת פרטי החשבון'}
            </button>
            <button
              onClick={() => setShowBankModal(false)}
              className="mt-2 w-full rounded-lg border border-gray-200 px-4 py-2 text-sm text-gray-600 hover:bg-gray-50"
            >
              סגירה
            </button>
          </div>
        </div>
      )}
    </main>
  );
}

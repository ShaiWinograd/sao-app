'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAuth } from '@clerk/nextjs';
import { CheckCircle2, Clock, FileText, Plus, RefreshCw, Send, XCircle } from 'lucide-react';
import {
  getCurrentQuotationVersion,
  quotationStatusTone,
  type QuotationStatus,
} from '@workforce/shared';
import { api, authHeaders } from '../../lib/api';
import { StatusBadge } from '../../components/ui/StatusBadge';

type DatePrecision = 'EXACT' | 'PARTIAL' | 'EXPECTED_MONTH' | 'DATE_RANGE' | 'TO_BE_DETERMINED';
type SendChannel = 'WHATSAPP' | 'EMAIL' | 'MANUAL';
type ApprovalMethod = 'DIGITAL' | 'SIGNED_DOCUMENT' | 'WHATSAPP' | 'EMAIL' | 'VERBAL' | 'MANUAL';

type ApiQuotationSend = {
  id: string;
  channel: SendChannel;
  recipient: string;
  versionNumberSnapshot: number;
  createdAt: string;
};

type ApiQuotationVersion = {
  id: string;
  versionNumber: number;
  status: QuotationStatus;
  estimatedTotal: number | string;
  datePrecision: DatePrecision;
  includedServices: string[];
  timingNote: string | null;
  validUntil: string | null;
  notes: string | null;
  isAddendum: boolean;
  sentAt: string | null;
  approvedAt: string | null;
  approvalMethod: ApprovalMethod | null;
  sends: ApiQuotationSend[];
};

type ApiQuotation = {
  id: string;
  status: QuotationStatus;
  createdAt: string;
  updatedAt: string;
  case: { id: string; name: string; customerId: string };
  versions: ApiQuotationVersion[];
};

type ApiCaseOption = {
  id: string;
  name: string;
  customer: { firstName: string; lastName: string };
};

const STATUS_LABELS: Record<QuotationStatus, string> = {
  DRAFT: 'טיוטה',
  SENT: 'נשלחה',
  APPROVED: 'מאושרת',
  REJECTED: 'נדחתה',
  EXPIRED: 'פג תוקף',
};

const DATE_PRECISION_LABELS: Record<DatePrecision, string> = {
  EXACT: 'תאריכים מדויקים',
  PARTIAL: 'תאריכים חלקיים',
  EXPECTED_MONTH: 'חודש משוער',
  DATE_RANGE: 'טווח תאריכים',
  TO_BE_DETERMINED: 'טרם נקבע',
};

const CHANNEL_LABELS: Record<SendChannel, string> = {
  WHATSAPP: 'וואטסאפ',
  EMAIL: 'אימייל',
  MANUAL: 'הורדה/שיתוף ידני',
};

const APPROVAL_METHOD_LABELS: Record<ApprovalMethod, string> = {
  DIGITAL: 'אישור דיגיטלי',
  SIGNED_DOCUMENT: 'מסמך חתום',
  WHATSAPP: 'וואטסאפ',
  EMAIL: 'אימייל',
  VERBAL: 'אישור בעל פה',
  MANUAL: 'הזנה ידנית',
};

function formatCurrency(value: number | string): string {
  const amount = typeof value === 'string' ? Number(value) : value;
  if (Number.isNaN(amount)) return '—';
  return `₪${amount.toLocaleString('he-IL', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
}

function formatDate(value: string | null): string {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleDateString('he-IL');
}

export default function QuotationsPage() {
  const { getToken } = useAuth();

  const [quotations, setQuotations] = useState<ApiQuotation[]>([]);
  const [cases, setCases] = useState<ApiCaseOption[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [busyAction, setBusyAction] = useState(false);

  const [form, setForm] = useState({
    caseId: '',
    estimatedTotal: '',
    includedServices: '',
    datePrecision: 'TO_BE_DETERMINED' as DatePrecision,
    timingNote: '',
    validUntil: '',
    notes: '',
  });

  const loadQuotations = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const auth = await authHeaders(getToken);
      const [quotationsRes, casesRes] = await Promise.all([
        api.get<ApiQuotation[]>('/quotations', auth),
        api.get<ApiCaseOption[]>('/cases', auth),
      ]);
      setQuotations(quotationsRes.data);
      setCases(casesRes.data);
      setSelectedId((prev) => prev ?? quotationsRes.data[0]?.id ?? null);
    } catch {
      setError('טעינת הצעות המחיר נכשלה');
    } finally {
      setIsLoading(false);
    }
  }, [getToken]);

  useEffect(() => {
    void loadQuotations();
  }, [loadQuotations]);

  const selected = useMemo(
    () => quotations.find((quotation) => quotation.id === selectedId) ?? null,
    [quotations, selectedId],
  );

  const currentVersion = useMemo(
    () => (selected ? getCurrentQuotationVersion(selected.versions) : undefined),
    [selected],
  );

  const refreshAfterMutation = useCallback(
    async (keepSelected: string) => {
      const auth = await authHeaders(getToken);
      const res = await api.get<ApiQuotation[]>('/quotations', auth);
      setQuotations(res.data);
      setSelectedId(keepSelected);
    },
    [getToken],
  );

  const handleCreate = useCallback(async () => {
    if (!form.caseId || !form.estimatedTotal || !form.includedServices.trim()) {
      setError('יש למלא פרוייקט, סכום משוער ולפחות שירות אחד');
      return;
    }
    setBusyAction(true);
    setError(null);
    try {
      const auth = await authHeaders(getToken);
      const created = await api.post<ApiQuotation>(
        '/quotations',
        {
          caseId: form.caseId,
          estimatedTotal: Number(form.estimatedTotal),
          includedServices: form.includedServices
            .split('\n')
            .map((line) => line.trim())
            .filter(Boolean),
          datePrecision: form.datePrecision,
          timingNote: form.timingNote.trim() || undefined,
          validUntil: form.validUntil || undefined,
          notes: form.notes.trim() || undefined,
        },
        auth,
      );
      await refreshAfterMutation(created.data.id);
      setIsCreating(false);
      setForm({
        caseId: '',
        estimatedTotal: '',
        includedServices: '',
        datePrecision: 'TO_BE_DETERMINED',
        timingNote: '',
        validUntil: '',
        notes: '',
      });
    } catch {
      setError('יצירת הצעת המחיר נכשלה');
    } finally {
      setBusyAction(false);
    }
  }, [form, getToken, refreshAfterMutation]);

  const runAction = useCallback(
    async (action: () => Promise<unknown>, failureMessage: string) => {
      if (!selected) return;
      setBusyAction(true);
      setError(null);
      try {
        await action();
        await refreshAfterMutation(selected.id);
      } catch {
        setError(failureMessage);
      } finally {
        setBusyAction(false);
      }
    },
    [selected, refreshAfterMutation],
  );

  const handleSend = useCallback(
    (channel: SendChannel) =>
      runAction(async () => {
        if (!selected) return;
        const auth = await authHeaders(getToken);
        await api.post(`/quotations/${selected.id}/send`, { channel, recipient: '—' }, auth);
      }, 'רישום שליחת הצעת המחיר נכשל'),
    [selected, getToken, runAction],
  );

  const handleApprove = useCallback(
    (approvalMethod: ApprovalMethod) =>
      runAction(async () => {
        if (!selected) return;
        const auth = await authHeaders(getToken);
        await api.post(`/quotations/${selected.id}/approve`, { approvalMethod }, auth);
      }, 'תיעוד אישור הלקוח נכשל'),
    [selected, getToken, runAction],
  );

  const handleReject = useCallback(
    () =>
      runAction(async () => {
        if (!selected) return;
        const auth = await authHeaders(getToken);
        await api.post(`/quotations/${selected.id}/reject`, {}, auth);
      }, 'סימון הצעת המחיר כנדחתה נכשל'),
    [selected, getToken, runAction],
  );

  const handleNewVersion = useCallback(
    () =>
      runAction(async () => {
        if (!selected || !currentVersion) return;
        const auth = await authHeaders(getToken);
        await api.post(
          `/quotations/${selected.id}/versions`,
          {
            estimatedTotal: Number(currentVersion.estimatedTotal),
            includedServices: currentVersion.includedServices,
            datePrecision: currentVersion.datePrecision,
          },
          auth,
        );
      }, 'יצירת גרסה חדשה נכשלה'),
    [selected, currentVersion, getToken, runAction],
  );

  const canEditCurrent = currentVersion?.status === 'DRAFT';
  const isApproved = currentVersion?.status === 'APPROVED';

  return (
    <div className="p-6" dir="rtl">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">הצעות מחיר</h1>
          <p className="text-sm text-gray-500 mt-1">ניהול הצעות מחיר, גרסאות ואישורי לקוח לכל פרוייקט</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => void loadQuotations()}
            className="inline-flex items-center gap-2 px-3 py-2 text-sm rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50"
          >
            <RefreshCw className="w-4 h-4" />
            רענון
          </button>
          <button
            onClick={() => setIsCreating((prev) => !prev)}
            className="inline-flex items-center gap-2 px-3 py-2 text-sm rounded-lg bg-primary-600 text-white hover:bg-primary-700"
          >
            <Plus className="w-4 h-4" />
            הצעת מחיר חדשה
          </button>
        </div>
      </div>

      {error && (
        <div className="mb-4 rounded-lg bg-rose-50 border border-rose-200 text-rose-700 text-sm px-4 py-3">
          {error}
        </div>
      )}

      {isCreating && (
        <div className="mb-6 rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">הצעת מחיר חדשה</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <label className="text-sm">
              <span className="text-gray-600">פרוייקט</span>
              <select
                value={form.caseId}
                onChange={(event) => setForm((prev) => ({ ...prev, caseId: event.target.value }))}
                className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2"
              >
                <option value="">בחר פרוייקט</option>
                {cases.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.name} — {option.customer.firstName} {option.customer.lastName}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-sm">
              <span className="text-gray-600">סכום משוער (₪)</span>
              <input
                type="number"
                min={0}
                value={form.estimatedTotal}
                onChange={(event) => setForm((prev) => ({ ...prev, estimatedTotal: event.target.value }))}
                className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2"
              />
            </label>
            <label className="text-sm">
              <span className="text-gray-600">דיוק תאריכים</span>
              <select
                value={form.datePrecision}
                onChange={(event) =>
                  setForm((prev) => ({ ...prev, datePrecision: event.target.value as DatePrecision }))
                }
                className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2"
              >
                {(Object.keys(DATE_PRECISION_LABELS) as DatePrecision[]).map((precision) => (
                  <option key={precision} value={precision}>
                    {DATE_PRECISION_LABELS[precision]}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-sm">
              <span className="text-gray-600">בתוקף עד</span>
              <input
                type="date"
                value={form.validUntil}
                onChange={(event) => setForm((prev) => ({ ...prev, validUntil: event.target.value }))}
                className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2"
              />
            </label>
            <label className="text-sm md:col-span-2">
              <span className="text-gray-600">שירותים כלולים (שורה לכל שירות)</span>
              <textarea
                value={form.includedServices}
                onChange={(event) => setForm((prev) => ({ ...prev, includedServices: event.target.value }))}
                rows={3}
                className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2"
                placeholder={'אריזת דירה 4 חדרים\nפריקה וסידור'}
              />
            </label>
            <label className="text-sm md:col-span-2">
              <span className="text-gray-600">הערת תזמון</span>
              <input
                value={form.timingNote}
                onChange={(event) => setForm((prev) => ({ ...prev, timingNote: event.target.value }))}
                className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2"
                placeholder="המועדים המדויקים יתואמו בהמשך ובהתאם לזמינות."
              />
            </label>
          </div>
          <div className="mt-4 flex items-center gap-2">
            <button
              onClick={() => void handleCreate()}
              disabled={busyAction}
              className="px-4 py-2 text-sm rounded-lg bg-primary-600 text-white hover:bg-primary-700 disabled:opacity-50"
            >
              צור הצעת מחיר
            </button>
            <button
              onClick={() => setIsCreating(false)}
              className="px-4 py-2 text-sm rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50"
            >
              ביטול
            </button>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-1">
          <div className="rounded-xl border border-gray-200 bg-white shadow-sm overflow-hidden">
            {isLoading ? (
              <div className="p-6 text-sm text-gray-500">טוען…</div>
            ) : quotations.length === 0 ? (
              <div className="p-6 text-sm text-gray-500">אין הצעות מחיר עדיין</div>
            ) : (
              <ul className="divide-y divide-gray-100">
                {quotations.map((quotation) => {
                  const version = getCurrentQuotationVersion(quotation.versions);
                  const isActive = quotation.id === selectedId;
                  return (
                    <li key={quotation.id}>
                      <button
                        onClick={() => setSelectedId(quotation.id)}
                        className={`w-full text-right px-4 py-3 hover:bg-gray-50 ${isActive ? 'bg-primary-50' : ''}`}
                      >
                        <div className="flex items-center justify-between">
                          <span className="text-sm font-semibold text-gray-900">{quotation.case.name}</span>
                          <StatusBadge tone={quotationStatusTone(quotation.status)} label={STATUS_LABELS[quotation.status]} />
                        </div>
                        <div className="mt-1 flex items-center justify-between text-xs text-gray-500">
                          <span>גרסה {version?.versionNumber ?? 1}</span>
                          <span>{version ? formatCurrency(version.estimatedTotal) : '—'}</span>
                        </div>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>

        <div className="lg:col-span-2">
          {!selected || !currentVersion ? (
            <div className="rounded-xl border border-dashed border-gray-200 bg-white p-10 text-center text-sm text-gray-500">
              בחר הצעת מחיר כדי לראות פרטים
            </div>
          ) : (
            <div className="space-y-6">
              <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
                <div className="flex items-start justify-between">
                  <div>
                    <h2 className="text-lg font-bold text-gray-900">{selected.case.name}</h2>
                    <p className="text-sm text-gray-500 mt-0.5">
                      גרסה נוכחית {currentVersion.versionNumber}
                      {currentVersion.isAddendum ? ' · תוספת' : ''}
                    </p>
                  </div>
                  <StatusBadge tone={quotationStatusTone(currentVersion.status)} label={STATUS_LABELS[currentVersion.status]} />
                </div>

                <dl className="mt-4 grid grid-cols-2 gap-x-6 gap-y-3 text-sm">
                  <div>
                    <dt className="text-gray-500">סכום משוער</dt>
                    <dd className="font-semibold text-gray-900">{formatCurrency(currentVersion.estimatedTotal)}</dd>
                  </div>
                  <div>
                    <dt className="text-gray-500">דיוק תאריכים</dt>
                    <dd className="text-gray-900">{DATE_PRECISION_LABELS[currentVersion.datePrecision]}</dd>
                  </div>
                  <div>
                    <dt className="text-gray-500">בתוקף עד</dt>
                    <dd className="text-gray-900">{formatDate(currentVersion.validUntil)}</dd>
                  </div>
                  <div>
                    <dt className="text-gray-500">תאריך אישור</dt>
                    <dd className="text-gray-900">{formatDate(currentVersion.approvedAt)}</dd>
                  </div>
                  <div className="col-span-2">
                    <dt className="text-gray-500">שירותים כלולים</dt>
                    <dd className="text-gray-900">
                      <ul className="list-disc pr-5 mt-1 space-y-0.5">
                        {currentVersion.includedServices.map((service, index) => (
                          <li key={index}>{service}</li>
                        ))}
                      </ul>
                    </dd>
                  </div>
                  {currentVersion.timingNote && (
                    <div className="col-span-2">
                      <dt className="text-gray-500">הערת תזמון</dt>
                      <dd className="text-gray-900">{currentVersion.timingNote}</dd>
                    </div>
                  )}
                </dl>

                {currentVersion.datePrecision !== 'EXACT' && (
                  <p className="mt-3 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                    המועדים אינם סופיים — יתואמו בהמשך ובהתאם לזמינות.
                  </p>
                )}

                <div className="mt-5 flex flex-wrap items-center gap-2">
                  <button
                    onClick={() => void handleSend('WHATSAPP')}
                    disabled={busyAction || isApproved}
                    className="inline-flex items-center gap-1.5 px-3 py-2 text-sm rounded-lg border border-gray-200 text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                  >
                    <Send className="w-4 h-4" />
                    שלח בוואטסאפ
                  </button>
                  <button
                    onClick={() => void handleSend('EMAIL')}
                    disabled={busyAction || isApproved}
                    className="inline-flex items-center gap-1.5 px-3 py-2 text-sm rounded-lg border border-gray-200 text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                  >
                    <Send className="w-4 h-4" />
                    שלח באימייל
                  </button>
                  <button
                    onClick={() => void handleApprove('MANUAL')}
                    disabled={busyAction || isApproved}
                    className="inline-flex items-center gap-1.5 px-3 py-2 text-sm rounded-lg bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-50"
                  >
                    <CheckCircle2 className="w-4 h-4" />
                    תיעוד אישור לקוח
                  </button>
                  <button
                    onClick={() => void handleReject()}
                    disabled={busyAction || isApproved}
                    className="inline-flex items-center gap-1.5 px-3 py-2 text-sm rounded-lg border border-rose-200 text-rose-700 hover:bg-rose-50 disabled:opacity-50"
                  >
                    <XCircle className="w-4 h-4" />
                    סמן כנדחתה
                  </button>
                  <button
                    onClick={() => void handleNewVersion()}
                    disabled={busyAction}
                    className="inline-flex items-center gap-1.5 px-3 py-2 text-sm rounded-lg border border-gray-200 text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                  >
                    <FileText className="w-4 h-4" />
                    גרסה חדשה
                  </button>
                </div>
                {canEditCurrent && (
                  <p className="mt-2 text-xs text-gray-400">גרסת טיוטה — ניתן לשלוח, לאשר או ליצור גרסה חדשה.</p>
                )}
              </div>

              <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
                <h3 className="text-sm font-semibold text-gray-900 mb-3">היסטוריית גרסאות</h3>
                <ul className="space-y-3">
                  {[...selected.versions]
                    .sort((a, b) => b.versionNumber - a.versionNumber)
                    .map((version) => (
                      <li
                        key={version.id}
                        className="flex items-start justify-between rounded-lg border border-gray-100 px-3 py-2"
                      >
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-medium text-gray-900">
                              גרסה {version.versionNumber}
                              {version.isAddendum ? ' · תוספת' : ''}
                            </span>
                            <StatusBadge tone={quotationStatusTone(version.status)} label={STATUS_LABELS[version.status]} />
                          </div>
                          <div className="mt-1 text-xs text-gray-500">
                            {formatCurrency(version.estimatedTotal)} · {DATE_PRECISION_LABELS[version.datePrecision]}
                          </div>
                          {version.sends.length > 0 && (
                            <div className="mt-1 text-[11px] text-gray-400">
                              נשלח: {version.sends.map((send) => CHANNEL_LABELS[send.channel]).join(', ')}
                            </div>
                          )}
                          {version.approvalMethod && (
                            <div className="mt-1 text-[11px] text-emerald-600">
                              אושר: {APPROVAL_METHOD_LABELS[version.approvalMethod]}
                            </div>
                          )}
                        </div>
                        <div className="text-[11px] text-gray-400 flex items-center gap-1">
                          <Clock className="w-3 h-3" />
                          {formatDate(version.sentAt ?? version.approvedAt)}
                        </div>
                      </li>
                    ))}
                </ul>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

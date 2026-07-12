'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAuth } from '@clerk/nextjs';
import { RefreshCw } from 'lucide-react';
import { getAllowedCaseTransitions, type CaseStatusValue } from '@workforce/shared';
import { api, authHeaders } from '../../../lib/api';

type BoardCaseJob = {
  id: string;
  date: string;
  jobType: 'PACKING' | 'UNPACKING' | 'HOME_ORGANIZATION';
  status: string;
};

type BoardCase = {
  id: string;
  name: string;
  status: CaseStatusValue;
  latestActivityDate: string | null;
  updatedAt: string;
  customer: { firstName: string; lastName: string };
  jobs: BoardCaseJob[];
};

type BoardColumn = { key: string; title: string; items: BoardCase[] };
type BoardTab = { key: string; title: string; columns: BoardColumn[] };
type BoardResult = { tabs: BoardTab[]; unplaced: BoardCase[] };

const STATUS_LABELS: Record<CaseStatusValue, string> = {
  DRAFT: 'טיוטה',
  ACTIVE: 'פעיל',
  READY_FOR_REVIEW: 'לבדיקה',
  COMPLETED: 'הושלם',
  CANCELLED: 'בוטל',
  LEAD: 'ליד חדש',
  QUOTATION_DRAFT: 'בהכנת הצעת מחיר',
  AWAITING_APPROVAL: 'מחכה לאישור',
  RESERVED: 'משוריין',
  APPROVED_NO_DATES: 'מאושר – ללא תאריכים',
  PARTIALLY_SCHEDULED: 'תזמון חלקי',
  READY_FOR_EXECUTION: 'מאושר לביצוע',
  IN_PROGRESS: 'בביצוע',
  AWAITING_COMPLETION: 'מחכה להשלמות',
  AWAITING_BILLING: 'מחכה לחיוב',
  AWAITING_PAYMENT: 'מחכה לתשלום',
  PAID: 'שולם',
};

function formatDate(value: string | null | undefined): string {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleDateString('he-IL');
}

function nextJobDate(jobs: BoardCaseJob[]): string {
  if (jobs.length === 0) return 'טרם נקבעו עבודות';
  const sorted = [...jobs].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
  return formatDate(sorted[0].date);
}

export default function ProjectBoardPage() {
  const { getToken } = useAuth();

  const [board, setBoard] = useState<BoardResult | null>(null);
  const [activeTab, setActiveTab] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const loadBoard = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const auth = await authHeaders(getToken);
      const res = await api.get<BoardResult>('/cases/board', auth);
      setBoard(res.data);
    } catch {
      setError('טעינת לוח הפרוייקטים נכשלה');
    } finally {
      setIsLoading(false);
    }
  }, [getToken]);

  useEffect(() => {
    void loadBoard();
  }, [loadBoard]);

  const changeStatus = useCallback(
    async (caseId: string, status: CaseStatusValue) => {
      setBusyId(caseId);
      setError(null);
      try {
        const auth = await authHeaders(getToken);
        await api.patch(`/cases/${caseId}`, { status }, auth);
        await loadBoard();
      } catch {
        setError('שינוי הסטטוס נדחה על ידי כללי מחזור החיים');
      } finally {
        setBusyId(null);
      }
    },
    [getToken, loadBoard],
  );

  const tab = useMemo(() => board?.tabs[activeTab], [board, activeTab]);

  return (
    <div className="p-6" dir="rtl">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">לוח פרוייקטים</h1>
          <p className="text-sm text-gray-500 mt-1">מעקב אחר פרוייקטים לאורך מחזור החיים</p>
        </div>
        <button
          onClick={() => void loadBoard()}
          className="inline-flex items-center gap-2 px-3 py-2 text-sm rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50"
        >
          <RefreshCw className="w-4 h-4" />
          רענון
        </button>
      </div>

      {error && (
        <div className="mb-4 rounded-lg bg-rose-50 border border-rose-200 text-rose-700 text-sm px-4 py-3">
          {error}
        </div>
      )}

      {board && (
        <div className="mb-5 flex gap-2" role="tablist">
          {board.tabs.map((t, index) => (
            <button
              key={t.key}
              role="tab"
              aria-selected={index === activeTab}
              onClick={() => setActiveTab(index)}
              className={`px-4 py-2 text-sm rounded-lg font-medium transition-colors ${
                index === activeTab
                  ? 'bg-purple-600 text-white'
                  : 'bg-white border border-gray-200 text-gray-600 hover:bg-gray-50'
              }`}
            >
              {t.title}
            </button>
          ))}
        </div>
      )}

      {isLoading ? (
        <div className="text-sm text-gray-500">טוען…</div>
      ) : !tab ? (
        <div className="text-sm text-gray-500">אין נתונים להצגה</div>
      ) : (
        <div className="grid grid-flow-col auto-cols-[minmax(240px,1fr)] gap-4 overflow-x-auto pb-4">
          {tab.columns.map((column) => (
            <section
              key={column.key}
              data-testid={`board-column-${column.key}`}
              className="rounded-xl border border-gray-200 bg-gray-50/60 flex flex-col"
            >
              <header className="px-3 py-2 border-b border-gray-200 flex items-center justify-between">
                <span className="text-sm font-semibold text-gray-800">{column.title}</span>
                <span className="text-xs text-gray-500 bg-white rounded-full px-2 py-0.5 border border-gray-200">
                  {column.items.length}
                </span>
              </header>

              <div className="p-2 space-y-2 min-h-[80px]">
                {column.items.length === 0 ? (
                  <p className="text-xs text-gray-400 text-center py-4">אין פרוייקטים</p>
                ) : (
                  column.items.map((kase) => {
                    const transitions = getAllowedCaseTransitions(kase.status);
                    return (
                      <article
                        key={kase.id}
                        className="rounded-lg border border-gray-200 bg-white p-3 shadow-sm"
                      >
                        <h3 className="text-sm font-semibold text-gray-900">{kase.name}</h3>
                        <p className="text-xs text-gray-500 mt-0.5">
                          {kase.customer.firstName} {kase.customer.lastName}
                        </p>
                        <div className="mt-2 flex items-center justify-between text-[11px] text-gray-500">
                          <span>עבודה קרובה: {nextJobDate(kase.jobs)}</span>
                          <span>{kase.jobs.length} עבודות</span>
                        </div>
                        <div className="mt-2">
                          <label className="text-[11px] text-gray-500">שינוי סטטוס</label>
                          <select
                            aria-label={`שינוי סטטוס ל${kase.name}`}
                            disabled={busyId === kase.id || transitions.length === 0}
                            value=""
                            onChange={(event) => {
                              const next = event.target.value as CaseStatusValue;
                              if (next) void changeStatus(kase.id, next);
                            }}
                            className="mt-1 w-full rounded-lg border border-gray-200 px-2 py-1.5 text-xs disabled:opacity-50"
                          >
                            <option value="">
                              {STATUS_LABELS[kase.status]} · העבר ל…
                            </option>
                            {transitions.map((target) => (
                              <option key={target} value={target}>
                                {STATUS_LABELS[target]}
                              </option>
                            ))}
                          </select>
                        </div>
                      </article>
                    );
                  })
                )}
              </div>
            </section>
          ))}
        </div>
      )}

      {board && board.unplaced.length > 0 && (
        <p className="mt-4 text-xs text-gray-400">
          {board.unplaced.length} פרוייקטים מבוטלים אינם מוצגים בלוח.
        </p>
      )}
    </div>
  );
}

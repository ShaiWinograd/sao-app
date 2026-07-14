'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useAuth } from '@clerk/nextjs';
import { RefreshCw, Plus } from 'lucide-react';
import { caseStatusTone, getAllowedCaseTransitions, getCaseNextAction, type CaseStatusValue } from '@workforce/shared';
import { api, authHeaders } from '../../../lib/api';
import { StatusBadge } from '../../../components/ui/StatusBadge';

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
  const [view, setView] = useState<'board' | 'list'>('board');
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'ALL' | CaseStatusValue>('ALL');

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const savedView = window.localStorage.getItem('projectsView');
    if (savedView === 'list' || savedView === 'board') setView(savedView);
  }, []);

  useEffect(() => {
    if (typeof window !== 'undefined') window.localStorage.setItem('projectsView', view);
  }, [view]);

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
      if (
        status === 'CANCELLED' &&
        typeof window !== 'undefined' &&
        !window.confirm('ביטול הפרויקט יעצור את כל הפעילות הקשורה אליו ויוציא אותו מהלוח הפעיל. להמשיך?')
      ) {
        return;
      }
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

  const allCases = useMemo(() => {
    if (!board) return [] as BoardCase[];
    const byId = new Map<string, BoardCase>();
    for (const boardTab of board.tabs) {
      for (const column of boardTab.columns) {
        for (const kase of column.items) byId.set(kase.id, kase);
      }
    }
    for (const kase of board.unplaced ?? []) byId.set(kase.id, kase);
    return [...byId.values()];
  }, [board]);

  const filteredCases = useMemo(() => {
    const query = search.trim().toLowerCase();
    return allCases
      .filter((kase) => {
        if (statusFilter !== 'ALL' && kase.status !== statusFilter) return false;
        if (!query) return true;
        const haystack = `${kase.name} ${kase.customer.firstName} ${kase.customer.lastName}`.toLowerCase();
        return haystack.includes(query);
      })
      .sort((a, b) => a.name.localeCompare(b.name, 'he'));
  }, [allCases, search, statusFilter]);

  return (
    <div className="p-6" dir="rtl">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">לוח פרוייקטים</h1>
          <p className="text-sm text-gray-500 mt-1">מעקב אחר פרוייקטים לאורך מחזור החיים</p>
        </div>
        <div className="flex items-center gap-2">
          <Link
            href="/cases/new"
            className="inline-flex items-center gap-2 px-4 py-2 text-sm rounded-lg bg-primary-600 text-white hover:bg-primary-700"
          >
            <Plus className="w-4 h-4" />
            יצירת פרויקט חדש
          </Link>
          <button
            onClick={() => void loadBoard()}
            className="inline-flex items-center gap-2 px-3 py-2 text-sm rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50"
          >
            <RefreshCw className="w-4 h-4" />
            רענון
          </button>
        </div>
      </div>

      {error && (
        <div className="mb-4 rounded-lg bg-rose-50 border border-rose-200 text-rose-700 text-sm px-4 py-3">
          {error}
        </div>
      )}

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="inline-flex rounded-lg border border-gray-200 bg-gray-50 p-0.5">
          {(['board', 'list'] as const).map((option) => (
            <button
              key={option}
              type="button"
              onClick={() => setView(option)}
              className={`px-3 py-1.5 text-xs font-medium rounded-md ${view === option ? 'bg-primary-600 text-white' : 'text-gray-600 hover:bg-white'}`}
            >
              {option === 'board' ? 'לוח' : 'רשימה'}
            </button>
          ))}
        </div>
        <input
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="חיפוש לפי שם פרויקט או לקוח"
          className="rounded-lg border border-gray-200 px-3 py-2 text-sm min-w-[240px]"
        />
        <select
          aria-label="סינון לפי סטטוס"
          value={statusFilter}
          onChange={(event) => setStatusFilter(event.target.value as 'ALL' | CaseStatusValue)}
          className="rounded-lg border border-gray-200 px-3 py-2 text-sm"
        >
          <option value="ALL">כל הסטטוסים</option>
          {(Object.keys(STATUS_LABELS) as CaseStatusValue[]).map((statusValue) => (
            <option key={statusValue} value={statusValue}>
              {STATUS_LABELS[statusValue]}
            </option>
          ))}
        </select>
      </div>

      {view === 'board' && board && (
        <div className="mb-5 flex gap-2" role="tablist">
          {board.tabs.map((t, index) => (
            <button
              key={t.key}
              role="tab"
              aria-selected={index === activeTab}
              onClick={() => setActiveTab(index)}
              className={`px-4 py-2 text-sm rounded-lg font-medium transition-colors ${
                index === activeTab
                  ? 'bg-primary-600 text-white'
                  : 'bg-white border border-gray-200 text-gray-600 hover:bg-gray-50'
              }`}
            >
              {t.title}
            </button>
          ))}
        </div>
      )}

      {view === 'board' &&
        (isLoading ? (
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
                        <Link
                          href={`/cases/${kase.id}`}
                          className="text-sm font-semibold text-gray-900 hover:text-primary-600"
                        >
                          {kase.name}
                        </Link>
                        <p className="text-xs text-gray-500 mt-0.5">
                          {kase.customer.firstName} {kase.customer.lastName}
                        </p>
                        <div className="mt-1.5">
                          <StatusBadge tone={caseStatusTone(kase.status)} label={STATUS_LABELS[kase.status]} />
                        </div>
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
        ))}

      {view === 'list' &&
        (isLoading ? (
          <div className="text-sm text-gray-500">טוען…</div>
        ) : (
          <div className="rounded-xl border border-gray-200 bg-white overflow-x-auto" data-testid="projects-list">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-xs text-gray-500 border-b border-gray-200 bg-gray-50">
                  <th className="text-right font-medium px-4 py-2">פרויקט</th>
                  <th className="text-right font-medium px-4 py-2">לקוח</th>
                  <th className="text-right font-medium px-4 py-2">סטטוס</th>
                  <th className="text-right font-medium px-4 py-2">עבודה קרובה</th>
                  <th className="text-right font-medium px-4 py-2">עבודות</th>
                  <th className="text-right font-medium px-4 py-2">הפעולה הבאה</th>
                </tr>
              </thead>
              <tbody>
                {filteredCases.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-4 py-6 text-center text-gray-400">לא נמצאו פרויקטים</td>
                  </tr>
                ) : (
                  filteredCases.map((kase) => (
                    <tr key={kase.id} className="border-b border-gray-50 hover:bg-gray-50">
                      <td className="px-4 py-2.5">
                        <Link href={`/cases/${kase.id}`} className="font-medium text-gray-900 hover:text-primary-600">
                          {kase.name}
                        </Link>
                      </td>
                      <td className="px-4 py-2.5 text-gray-600">{kase.customer.firstName} {kase.customer.lastName}</td>
                      <td className="px-4 py-2.5"><StatusBadge tone={caseStatusTone(kase.status)} label={STATUS_LABELS[kase.status]} /></td>
                      <td className="px-4 py-2.5 text-gray-600">{nextJobDate(kase.jobs)}</td>
                      <td className="px-4 py-2.5 text-gray-600">{kase.jobs.length}</td>
                      <td className="px-4 py-2.5 text-gray-600">{getCaseNextAction(kase.status)?.title ?? '—'}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        ))}

      {board && board.unplaced.length > 0 && (
        <p className="mt-4 text-xs text-gray-400">
          {board.unplaced.length} פרוייקטים מבוטלים אינם מוצגים בלוח.
        </p>
      )}
    </div>
  );
}

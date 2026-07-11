'use client';

import { useEffect, useMemo, useState } from 'react';
import { Filter, History, Shield } from 'lucide-react';
import { api } from '../../lib/api';

type AuditEntry = {
  id: string;
  createdAt: string;
  action: string;
  entityType: string;
  entityId: string;
  reason: string | null;
  previousValue: unknown;
  newValue: unknown;
  performedBy: { id: string; firstName: string; lastName: string; role: string } | null;
};

function toDisplayAction(action: string) {
  const map: Record<string, string> = {
    CREATE: 'יצירה',
    UPDATE: 'עדכון',
    DELETE: 'מחיקה',
    APPROVE: 'אישור',
    REJECT: 'דחייה',
    CLOCK_IN: 'כניסה',
    CLOCK_OUT: 'יציאה',
    AUTO_CLOCK_OUT: 'יציאה אוטומטית',
    CORRECTION: 'תיקון',
    MONTH_CLOSE: 'סגירת חודש',
    MONTH_REOPEN: 'פתיחת חודש',
    PERMISSION_CHANGE: 'שינוי הרשאה',
  };
  return map[action] ?? action;
}

export default function AuditPage() {
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [search, setSearch] = useState('');
  const [actionFilter, setActionFilter] = useState<'all' | string>('all');
  const [actorFilter, setActorFilter] = useState<'all' | string>('all');
  const [message, setMessage] = useState('');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const response = await api.get<AuditEntry[]>('/audit', { params: { page: 1 } });
        if (!cancelled) setEntries(response.data);
      } catch {
        if (!cancelled) setMessage('לא ניתן לטעון את יומן הפעולות כרגע.');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const uniqueActors = useMemo(
    () =>
      Array.from(
        new Set(
          entries.map((entry) =>
            entry.performedBy ? `${entry.performedBy.firstName} ${entry.performedBy.lastName}` : 'לא ידוע',
          ),
        ),
      ),
    [entries],
  );

  const uniqueActions = useMemo(() => Array.from(new Set(entries.map((entry) => entry.action))), [entries]);

  const filteredEntries = useMemo(() => {
    const term = search.trim().toLowerCase();
    return entries.filter((entry) => {
      const actorName = entry.performedBy ? `${entry.performedBy.firstName} ${entry.performedBy.lastName}` : 'לא ידוע';
      const matchAction = actionFilter === 'all' || entry.action === actionFilter;
      const matchActor = actorFilter === 'all' || actorName === actorFilter;
      const matchSearch =
        !term ||
        actorName.toLowerCase().includes(term) ||
        entry.action.toLowerCase().includes(term) ||
        entry.entityType.toLowerCase().includes(term) ||
        entry.entityId.toLowerCase().includes(term) ||
        String(entry.reason ?? '').toLowerCase().includes(term);
      return matchAction && matchActor && matchSearch;
    });
  }, [entries, search, actionFilter, actorFilter]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900 mb-1">יומן פעולות</h1>
        <p className="text-sm text-gray-500">תיעוד מלא של פעולות רגישות במערכת: תפעול, נוכחות, פיננסים, וסגירת חודשים.</p>
      </div>

      <section className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm space-y-3">
        <div className="flex items-center gap-2 text-sm text-gray-700">
          <Filter className="w-4 h-4" />
          סינונים
        </div>
        <div className="grid gap-2 md:grid-cols-3">
          <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="חיפוש חופשי" className="rounded-xl border border-gray-300 px-3 py-2 text-sm" />
          <select value={actionFilter} onChange={(event) => setActionFilter(event.target.value)} className="rounded-xl border border-gray-300 px-3 py-2 text-sm">
            <option value="all">כל סוגי הפעולות</option>
            {uniqueActions.map((action) => (
              <option key={action} value={action}>
                {toDisplayAction(action)}
              </option>
            ))}
          </select>
          <select value={actorFilter} onChange={(event) => setActorFilter(event.target.value)} className="rounded-xl border border-gray-300 px-3 py-2 text-sm">
            <option value="all">כל המשתמשים</option>
            {uniqueActors.map((actor) => (
              <option key={actor} value={actor}>
                {actor}
              </option>
            ))}
          </select>
        </div>
      </section>

      <section className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-right text-gray-500 border-b border-gray-100">
              <th className="px-2 py-2 font-medium">תאריך</th>
              <th className="px-2 py-2 font-medium">משתמש</th>
              <th className="px-2 py-2 font-medium">פעולה</th>
              <th className="px-2 py-2 font-medium">יישות</th>
              <th className="px-2 py-2 font-medium">ערך קודם</th>
              <th className="px-2 py-2 font-medium">ערך חדש</th>
              <th className="px-2 py-2 font-medium">הערה</th>
            </tr>
          </thead>
          <tbody>
            {filteredEntries.map((entry) => {
              const actorName = entry.performedBy ? `${entry.performedBy.firstName} ${entry.performedBy.lastName}` : 'לא ידוע';
              return (
                <tr key={entry.id} className="border-b border-gray-50 last:border-b-0">
                  <td className="px-2 py-2">{new Date(entry.createdAt).toLocaleString('he-IL')}</td>
                  <td className="px-2 py-2">{actorName}</td>
                  <td className="px-2 py-2">{toDisplayAction(entry.action)}</td>
                  <td className="px-2 py-2">{entry.entityType} / {entry.entityId}</td>
                  <td className="px-2 py-2 text-xs">{JSON.stringify(entry.previousValue ?? '-')}</td>
                  <td className="px-2 py-2 text-xs">{JSON.stringify(entry.newValue ?? '-')}</td>
                  <td className="px-2 py-2">{entry.reason ?? '-'}</td>
                </tr>
              );
            })}
            {filteredEntries.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-2 py-6 text-center text-gray-500">
                  לא נמצאו פעולות מתאימות.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </section>

      <section className="grid gap-3 md:grid-cols-2">
        <div className="rounded-xl border border-blue-200 bg-blue-50 p-3 text-sm text-blue-800 inline-flex items-center gap-2">
          <History className="w-4 h-4" />
          פעולות חודש שנפתח מחדש מסומנות לשקיפות פיננסית.
        </div>
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800 inline-flex items-center gap-2">
          <Shield className="w-4 h-4" />
          לוגים נשמרים עם ערך קודם וחדש — ללא מחיקה שקטה.
        </div>
      </section>

      {message ? <div className="rounded-xl border border-blue-200 bg-blue-50 px-3 py-2 text-sm text-blue-700">{message}</div> : null}
    </div>
  );
}

'use client';

import { useCallback, useState } from 'react';
import { useAuth } from '@clerk/nextjs';
import { CalendarSearch } from 'lucide-react';
import { api, authHeaders } from '../../lib/api';
import { StatusBadge } from '../ui/StatusBadge';

type CandidateDate = {
  date: string;
  availableWorkers: number;
  availableManagers: number;
  suitable: boolean;
};

function formatDate(value: string): string {
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString('he-IL');
}

export function DateFinder({ defaultStart = '' }: { defaultStart?: string }) {
  const { getToken } = useAuth();
  const [start, setStart] = useState(defaultStart);
  const [end, setEnd] = useState('');
  const [requiredWorkers, setRequiredWorkers] = useState('4');
  const [requiresManager, setRequiresManager] = useState(true);
  const [results, setResults] = useState<CandidateDate[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const search = useCallback(async () => {
    if (!start || !end) {
      setError('יש לבחור טווח תאריכים');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const auth = await authHeaders(getToken);
      const params = new URLSearchParams({
        start,
        end,
        requiredWorkers,
        requiresManager: requiresManager ? 'true' : 'false',
      });
      const res = await api.get<CandidateDate[]>(`/workers/available-dates?${params.toString()}`, auth);
      setResults(res.data);
    } catch {
      setError('חיפוש התאריכים הפנויים נכשל');
      setResults(null);
    } finally {
      setLoading(false);
    }
  }, [start, end, requiredWorkers, requiresManager, getToken]);

  return (
    <section className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm" data-testid="date-finder">
      <h2 className="text-sm font-semibold text-gray-900 mb-3">מציאת תאריך פנוי</h2>
      <div className="flex flex-wrap items-end gap-3">
        <label className="text-xs text-gray-600">
          <span className="block mb-1">מתאריך</span>
          <input type="date" value={start} onChange={(e) => setStart(e.target.value)} className="rounded-lg border border-gray-200 px-3 py-2 text-sm" />
        </label>
        <label className="text-xs text-gray-600">
          <span className="block mb-1">עד תאריך</span>
          <input type="date" value={end} onChange={(e) => setEnd(e.target.value)} className="rounded-lg border border-gray-200 px-3 py-2 text-sm" />
        </label>
        <label className="text-xs text-gray-600">
          <span className="block mb-1">עובדים נדרשים</span>
          <input type="number" min={1} value={requiredWorkers} onChange={(e) => setRequiredWorkers(e.target.value)} className="w-24 rounded-lg border border-gray-200 px-3 py-2 text-sm" />
        </label>
        <label className="inline-flex items-center gap-2 text-xs text-gray-700 pb-2">
          <input type="checkbox" checked={requiresManager} onChange={(e) => setRequiresManager(e.target.checked)} />
          דרוש מנהל עבודה
        </label>
        <button
          onClick={() => void search()}
          disabled={loading}
          className="inline-flex items-center gap-1.5 px-4 py-2 text-sm rounded-lg bg-primary-600 text-white hover:bg-primary-700 disabled:opacity-50"
        >
          <CalendarSearch className="w-4 h-4" />
          חיפוש
        </button>
      </div>

      {error && <p className="mt-3 text-sm text-danger">{error}</p>}

      {results && (
        <div className="mt-4">
          {results.length === 0 ? (
            <p className="text-sm text-gray-400">לא נמצאו תאריכים בטווח שנבחר</p>
          ) : (
            <ul className="space-y-2">
              {results.slice(0, 12).map((candidate) => (
                <li
                  key={candidate.date}
                  className="flex items-center justify-between gap-3 rounded-lg border border-gray-100 px-3 py-2"
                >
                  <div>
                    <p className="text-sm font-medium text-gray-900">{formatDate(candidate.date)}</p>
                    <p className="text-[11px] text-gray-500">
                      {candidate.availableWorkers} עובדים זמינים · {candidate.availableManagers} מנהלי עבודה
                    </p>
                  </div>
                  <StatusBadge
                    tone={candidate.suitable ? 'success' : 'warning'}
                    label={candidate.suitable ? 'מתאים' : 'לא מתאים'}
                  />
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}

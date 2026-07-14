'use client';

import { useCallback, useState } from 'react';
import { useAuth } from '@clerk/nextjs';
import { Search, UserCheck } from 'lucide-react';
import { api, authHeaders } from '../../lib/api';
import { StatusBadge } from '../ui/StatusBadge';

type RankedCandidate = {
  id: string;
  name: string;
  available: boolean;
  hasRequiredSkill: boolean;
  isManagerCapable: boolean;
  score: number;
  reasons: string[];
};

const SKILL_OPTIONS: Array<{ value: string; label: string }> = [
  { value: '', label: 'כל כישור' },
  { value: 'SHIFT_LEADER', label: 'מנהל עבודה' },
  { value: 'PACKING_SPECIALIST', label: 'מומחה אריזה' },
  { value: 'UNPACKING_SPECIALIST', label: 'מומחה פריקה' },
  { value: 'ORGANIZATION_SPECIALIST', label: 'מומחה סידור' },
  { value: 'DRIVER', label: 'נהג' },
  { value: 'GENERAL_WORKER', label: 'עובד כללי' },
];

export function AvailabilityFinder({ defaultDate = '' }: { defaultDate?: string }) {
  const { getToken } = useAuth();
  const [date, setDate] = useState(defaultDate);
  const [skill, setSkill] = useState('');
  const [requiresManager, setRequiresManager] = useState(false);
  const [results, setResults] = useState<RankedCandidate[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const search = useCallback(async () => {
    if (!date) {
      setError('יש לבחור תאריך');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const auth = await authHeaders(getToken);
      const params = new URLSearchParams({ date });
      if (skill) params.set('skill', skill);
      if (requiresManager) params.set('requiresManager', 'true');
      const res = await api.get<RankedCandidate[]>(`/workers/availability?${params.toString()}`, auth);
      setResults(res.data);
    } catch {
      setError('חיפוש העובדים הזמינים נכשל');
      setResults(null);
    } finally {
      setLoading(false);
    }
  }, [date, skill, requiresManager, getToken]);

  return (
    <section className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm" data-testid="availability-finder">
      <h2 className="text-sm font-semibold text-gray-900 mb-3">מציאת עובדים זמינים</h2>
      <div className="flex flex-wrap items-end gap-3">
        <label className="text-xs text-gray-600">
          <span className="block mb-1">תאריך</span>
          <input
            type="date"
            value={date}
            onChange={(event) => setDate(event.target.value)}
            className="rounded-lg border border-gray-200 px-3 py-2 text-sm"
          />
        </label>
        <label className="text-xs text-gray-600">
          <span className="block mb-1">כישור נדרש</span>
          <select
            value={skill}
            onChange={(event) => setSkill(event.target.value)}
            className="rounded-lg border border-gray-200 px-3 py-2 text-sm"
          >
            {SKILL_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <label className="inline-flex items-center gap-2 text-xs text-gray-700 pb-2">
          <input
            type="checkbox"
            checked={requiresManager}
            onChange={(event) => setRequiresManager(event.target.checked)}
          />
          דרוש מנהל עבודה
        </label>
        <button
          onClick={() => void search()}
          disabled={loading}
          className="inline-flex items-center gap-1.5 px-4 py-2 text-sm rounded-lg bg-primary-600 text-white hover:bg-primary-700 disabled:opacity-50"
        >
          <Search className="w-4 h-4" />
          חיפוש
        </button>
      </div>

      {error && <p className="mt-3 text-sm text-danger">{error}</p>}

      {results && (
        <div className="mt-4">
          {results.length === 0 ? (
            <p className="text-sm text-gray-400">לא נמצאו עובדים פעילים</p>
          ) : (
            <ul className="space-y-2">
              {results.map((candidate) => (
                <li
                  key={candidate.id}
                  className="flex items-center justify-between gap-3 rounded-lg border border-gray-100 px-3 py-2"
                >
                  <div>
                    <div className="flex items-center gap-2">
                      <UserCheck className="w-4 h-4 text-gray-400" />
                      <span className="text-sm font-medium text-gray-900">{candidate.name}</span>
                    </div>
                    {candidate.reasons.length > 0 && (
                      <p className="mt-0.5 text-[11px] text-gray-500">{candidate.reasons.join(' · ')}</p>
                    )}
                  </div>
                  <StatusBadge
                    tone={candidate.available ? 'success' : 'warning'}
                    label={candidate.available ? 'זמין' : 'עמוס'}
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

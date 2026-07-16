'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useAuth } from '@clerk/nextjs';
import { History, MapPin, Clock, LogIn, LogOut, FileText, ChevronLeft } from 'lucide-react';
import { api, authHeaders } from '../../../lib/api';
import {
  type WorkerShift,
  jobTypeLabel,
  jobTypeClasses,
  formatFullDate,
  formatTime,
  formatDuration,
  formStatusLabel,
  customerName,
  attendanceBadge,
  dateKey,
} from '../../../lib/worker';

type Period = 'all' | 'thisMonth' | 'lastMonth' | 'thisYear';

const PERIOD_LABEL: Record<Period, string> = {
  all: 'הכל',
  thisMonth: 'החודש',
  lastMonth: 'החודש הקודם',
  thisYear: 'השנה',
};

function periodRange(period: Period): { from: Date; to: Date } | null {
  const now = new Date();
  if (period === 'thisMonth') return { from: new Date(now.getFullYear(), now.getMonth(), 1), to: new Date(now.getFullYear(), now.getMonth() + 1, 1) };
  if (period === 'lastMonth') return { from: new Date(now.getFullYear(), now.getMonth() - 1, 1), to: new Date(now.getFullYear(), now.getMonth(), 1) };
  if (period === 'thisYear') return { from: new Date(now.getFullYear(), 0, 1), to: new Date(now.getFullYear() + 1, 0, 1) };
  return null;
}

export default function WorkerHistoryPage() {
  const { getToken } = useAuth();
  const [shifts, setShifts] = useState<WorkerShift[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [period, setPeriod] = useState<Period>('all');

  const load = useCallback(async () => {
    try {
      const auth = await authHeaders(getToken);
      const res = await api.get<WorkerShift[]>('/shifts/mine', auth);
      setShifts(res.data ?? []);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, [getToken]);

  useEffect(() => {
    void load();
  }, [load]);

  // Past, confirmed shifts in reverse chronological order (API returns desc).
  const past = useMemo(() => {
    const now = Date.now();
    const range = periodRange(period);
    return shifts.filter((s) => {
      if (s.joinRequestStatus !== 'APPROVED') return false;
      const start = new Date(s.scheduledStart).getTime();
      const isDone = ['CLOCKED_OUT', 'CORRECTED', 'AUTO_CLOCKED_OUT', 'NO_SHOW'].includes(s.attendanceStatus);
      if (!(isDone || start < now)) return false;
      if (range) {
        const d = new Date(s.scheduledStart);
        if (d < range.from || d >= range.to) return false;
      }
      return true;
    });
  }, [shifts, period]);

  const summary = useMemo(() => {
    const days = new Set(past.map((s) => dateKey(s.scheduledStart)));
    const hours = past.reduce((sum, s) => sum + (Number(s.approvedHours) || 0), 0);
    const missingForms = past.filter(
      (s) => ['CLOCKED_OUT', 'CORRECTED', 'AUTO_CLOCKED_OUT'].includes(s.attendanceStatus) && s.formStatus === 'NOT_SUBMITTED',
    ).length;
    return { count: past.length, days: days.size, hours: Math.round(hours * 100) / 100, missingForms };
  }, [past]);

  if (loading) return <p className="text-sm text-gray-400">טוען…</p>;

  return (
    <div className="space-y-4 max-w-2xl">
      <div>
        <h1 className="text-xl font-bold text-gray-900">היסטוריית עבודות</h1>
        <p className="text-sm text-gray-500 mt-0.5">כל המשמרות שביצעת, כולל שעות הנוכחות המאושרות.</p>
      </div>

      {/* Period filter */}
      <div className="flex flex-wrap gap-1.5">
        {(Object.keys(PERIOD_LABEL) as Period[]).map((p) => (
          <button
            key={p}
            type="button"
            onClick={() => setPeriod(p)}
            className={`rounded-lg px-3 py-1.5 text-xs font-medium ${
              period === p ? 'bg-primary-600 text-white' : 'border border-gray-200 bg-white text-gray-600 hover:bg-gray-50'
            }`}
          >
            {PERIOD_LABEL[p]}
          </button>
        ))}
      </div>

      {error ? (
        <p className="rounded-xl border border-gray-200 bg-white p-4 text-sm text-gray-500">לא נמצא פרופיל עובד/ת לחשבון זה.</p>
      ) : (
        <>
          {/* Summary */}
          <div className="grid grid-cols-3 gap-2">
            <SummaryStat label="משמרות" value={String(summary.count)} />
            <SummaryStat label="ימי עבודה" value={String(summary.days)} />
            <SummaryStat label="שעות מאושרות" value={String(summary.hours)} />
          </div>
          {summary.missingForms > 0 && (
            <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700">
              {summary.missingForms} משמרות ללא טופס סיום.
            </p>
          )}

          {/* List */}
          {past.length === 0 ? (
            <div className="rounded-xl border border-gray-200 bg-white p-6 text-center">
              <History className="mx-auto w-6 h-6 text-gray-300" />
              <p className="mt-1.5 text-sm text-gray-500">אין משמרות בתקופה זו.</p>
            </div>
          ) : (
            <div className="space-y-2.5">
              {past.map((s) => {
                const att = attendanceBadge(s.attendanceStatus);
                const address = s.job.address?.fullAddress ?? '';
                return (
                  <Link
                    key={s.id}
                    href={`/worker/shifts/${s.id}`}
                    className="block rounded-xl border border-gray-200 bg-white p-3.5 hover:border-primary-300 transition-colors"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium ${jobTypeClasses(s.job.jobType)}`}>
                        {jobTypeLabel(s.job.jobType)}
                      </span>
                      <span className="text-xs font-semibold text-gray-900">{formatFullDate(s.scheduledStart)}</span>
                    </div>

                    <p className="mt-2 text-sm font-semibold text-gray-900">{customerName(s.job.customer)}</p>
                    {address && (
                      <p className="mt-0.5 flex items-center gap-1 text-xs text-gray-600">
                        <MapPin className="w-3.5 h-3.5 shrink-0" />
                        {address}
                      </p>
                    )}

                    <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-xs text-gray-600">
                      <span className="flex items-center gap-1">
                        <Clock className="w-3.5 h-3.5 text-gray-400" />
                        מתוכנן: {formatTime(s.scheduledStart)}–{formatTime(s.scheduledEnd)}
                      </span>
                      <span className="flex items-center gap-1">
                        <FileText className="w-3.5 h-3.5 text-gray-400" />
                        טופס: {formStatusLabel(s.formStatus)}
                      </span>
                      {s.actualStart && (
                        <span className="flex items-center gap-1">
                          <LogIn className="w-3.5 h-3.5 text-gray-400" />
                          כניסה: {formatTime(s.actualStart)}
                        </span>
                      )}
                      {s.actualEnd && (
                        <span className="flex items-center gap-1">
                          <LogOut className="w-3.5 h-3.5 text-gray-400" />
                          יציאה: {formatTime(s.actualEnd)}
                        </span>
                      )}
                    </div>

                    <div className="mt-2 flex items-center justify-between">
                      <span className={`rounded-full border px-2.5 py-0.5 text-[11px] font-medium ${att.className}`}>{att.label}</span>
                      <span className="flex items-center gap-1 text-xs text-gray-500">
                        {s.approvedHours != null && <span className="font-medium text-gray-700">{formatDuration(s.approvedHours)}</span>}
                        <ChevronLeft className="w-4 h-4 text-gray-300" />
                      </span>
                    </div>
                  </Link>
                );
              })}
            </div>
          )}
        </>
      )}
    </div>
  );
}

function SummaryStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white px-3 py-2.5 text-center">
      <p className="text-lg font-bold text-gray-900">{value}</p>
      <p className="text-[11px] text-gray-500">{label}</p>
    </div>
  );
}

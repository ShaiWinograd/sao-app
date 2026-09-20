'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useAuth } from '@clerk/nextjs';
import { History, MapPin, Clock, LogIn, LogOut, FileText, ChevronLeft } from 'lucide-react';
import { api, authHeaders } from '../../../lib/api';
import { EmptyState } from '../../../components/ui/EmptyState';
import { PageHeader } from '../../../components/ui/PageHeader';
import {
  type WorkerShift,
  jobTypeLabel,
  jobTypeClasses,
  assignmentRoleLabel,
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
    <div className="mx-auto w-full max-w-[1120px] space-y-6" data-testid="worker-history-page">
      <PageHeader
        eyebrow="מעקב אישי"
        title="היסטוריית עבודות"
        description="כל המשמרות שביצעת, כולל שעות הנוכחות המאושרות."
        icon={<History className="h-6 w-6" />}
      />

      {/* Period filter */}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <p className="text-xs font-semibold tracking-[0.03em] text-[var(--color-text-secondary)]">סיכום לפי תקופה</p>
        <div className="flex max-w-full overflow-x-auto border-b border-[var(--color-border-strong)]" data-swipe-navigation="ignore">
          {(Object.keys(PERIOD_LABEL) as Period[]).map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => setPeriod(p)}
              className={`min-h-11 shrink-0 border-b-2 px-4 py-2 text-sm font-medium transition-colors ${
                period === p
                  ? 'border-primary-700 text-primary-800'
                  : 'border-transparent text-[var(--color-text-secondary)] hover:border-primary-200 hover:text-[#292724]'
              }`}
            >
              {PERIOD_LABEL[p]}
            </button>
          ))}
        </div>
      </div>

      {error ? (
        <p className="rounded-xl border border-gray-200 bg-white p-4 text-sm text-gray-500">לא נמצא פרופיל עובד/ת לחשבון זה.</p>
      ) : (
        <>
          {/* Summary */}
          <div className="grid grid-cols-3 divide-x divide-x-reverse divide-[var(--color-border)] border-y border-[var(--color-border)] bg-[var(--color-surface-muted)]">
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
            <EmptyState
              icon={<History className="h-7 w-7" />}
              title="אין משמרות בתקופה הזו"
              description="כאשר עבודות יושלמו, שעות הנוכחות והטפסים שלהן יופיעו כאן באופן מסודר."
            />
          ) : (
            <div className="grid gap-4 lg:grid-cols-2">
              {past.map((s) => {
                const att = attendanceBadge(s.attendanceStatus);
                const address = s.job.address?.fullAddress ?? '';
                return (
                  <Link
                    key={s.id}
                    href={`/worker/shifts/${s.id}`}
                    className="block rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5 transition-colors hover:border-primary-300"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="flex items-center gap-1.5">
                        <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium ${jobTypeClasses(s.job.jobType)}`}>
                          {jobTypeLabel(s.job.jobType)}
                        </span>
                        {assignmentRoleLabel(s.assignmentRole) && (
                          <span className="inline-flex items-center rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-700">
                            {assignmentRoleLabel(s.assignmentRole)}
                          </span>
                        )}
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
    <div className="px-2 py-4 text-center sm:px-5 sm:text-right">
      <p className="text-xl font-semibold tracking-tight text-[#292724] sm:text-2xl">{value}</p>
      <p className="mt-0.5 text-xs text-[var(--color-text-secondary)] sm:text-sm">{label}</p>
    </div>
  );
}

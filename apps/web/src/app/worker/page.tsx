'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useAuth } from '@clerk/nextjs';
import { CalendarClock, MapPin, Search, Bell, Clock } from 'lucide-react';
import { api, authHeaders } from '../../lib/api';
import {
  type WorkerShift,
  type WorkerJob,
  jobTypeLabel,
  jobTypeClasses,
  formatDate,
  formatTime,
  customerName,
  openPositions,
  dateKey,
} from '../../lib/worker';

type Notification = { id: string; title: string; body: string; isRead: boolean; sentAt: string };

export default function WorkerHomePage() {
  const { getToken } = useAuth();
  const [shifts, setShifts] = useState<WorkerShift[]>([]);
  const [jobs, setJobs] = useState<WorkerJob[]>([]);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const auth = await authHeaders(getToken);
        const [shiftsRes, jobsRes, notifRes] = await Promise.all([
          api.get<WorkerShift[]>('/shifts/mine', auth),
          api.get<WorkerJob[]>('/jobs?status=PUBLISHED', auth),
          api.get<Notification[]>('/notifications/mine', auth),
        ]);
        setShifts(shiftsRes.data ?? []);
        setJobs(jobsRes.data ?? []);
        setNotifications(notifRes.data ?? []);
      } catch {
        setShifts([]);
        setJobs([]);
        setNotifications([]);
      } finally {
        setLoading(false);
      }
    })();
  }, [getToken]);

  const todayKey = dateKey(new Date().toISOString());

  const upcomingShifts = useMemo(
    () =>
      shifts
        .filter((s) => s.joinRequestStatus === 'APPROVED' && dateKey(s.scheduledStart) >= todayKey)
        .sort((a, b) => a.scheduledStart.localeCompare(b.scheduledStart)),
    [shifts, todayKey],
  );

  const pendingRequests = useMemo(
    () => shifts.filter((s) => s.joinRequestStatus === 'PENDING' && dateKey(s.scheduledStart) >= todayKey),
    [shifts, todayKey],
  );

  const nextShift = upcomingShifts[0];
  const openJobsCount = jobs.filter((j) => openPositions(j) > 0).length;
  const unreadCount = notifications.filter((n) => !n.isRead).length;

  if (loading) {
    return <p className="text-sm text-gray-400">טוען…</p>;
  }

  return (
    <div className="space-y-5 max-w-3xl">
      <div>
        <h1 className="text-xl font-bold text-gray-900">בית</h1>
        <p className="text-sm text-gray-500 mt-0.5">המשמרות, העבודות הפתוחות וההתראות שלך במקום אחד.</p>
      </div>

      {/* Quick stats */}
      <div className="grid grid-cols-3 gap-3">
        <Link href="/worker/calendar" className="rounded-xl border border-gray-200 bg-white p-3 hover:border-primary-300">
          <div className="flex items-center gap-2 text-gray-500">
            <CalendarClock className="w-4 h-4" />
            <span className="text-xs">משמרות קרובות</span>
          </div>
          <p className="mt-1 text-2xl font-bold text-gray-900">{upcomingShifts.length}</p>
        </Link>
        <Link href="/worker/open-jobs" className="rounded-xl border border-gray-200 bg-white p-3 hover:border-primary-300">
          <div className="flex items-center gap-2 text-gray-500">
            <Search className="w-4 h-4" />
            <span className="text-xs">עבודות פתוחות</span>
          </div>
          <p className="mt-1 text-2xl font-bold text-gray-900">{openJobsCount}</p>
        </Link>
        <Link href="/worker/notifications" className="rounded-xl border border-gray-200 bg-white p-3 hover:border-primary-300">
          <div className="flex items-center gap-2 text-gray-500">
            <Bell className="w-4 h-4" />
            <span className="text-xs">התראות חדשות</span>
          </div>
          <p className="mt-1 text-2xl font-bold text-gray-900">{unreadCount}</p>
        </Link>
      </div>

      {/* Next shift */}
      <section>
        <h2 className="text-sm font-semibold text-gray-900 mb-2">המשמרת הבאה שלי</h2>
        {nextShift ? (
          <ShiftCard shift={nextShift} highlight />
        ) : (
          <p className="rounded-xl border border-gray-200 bg-white p-4 text-sm text-gray-500">אין לך משמרות מתוזמנות כרגע.</p>
        )}
      </section>

      {/* Pending acceptance */}
      {pendingRequests.length > 0 && (
        <section>
          <h2 className="text-sm font-semibold text-gray-900 mb-2">ממתין לאישור</h2>
          <div className="space-y-2">
            {pendingRequests.map((s) => (
              <ShiftCard key={s.id} shift={s} pending />
            ))}
          </div>
        </section>
      )}

      {/* Upcoming shifts list */}
      {upcomingShifts.length > 1 && (
        <section>
          <h2 className="text-sm font-semibold text-gray-900 mb-2">משמרות קרובות</h2>
          <div className="space-y-2">
            {upcomingShifts.slice(1, 5).map((s) => (
              <ShiftCard key={s.id} shift={s} />
            ))}
          </div>
          <Link href="/worker/calendar" className="mt-2 inline-block text-xs font-medium text-primary-700 hover:text-primary-800">
            לכל המשמרות →
          </Link>
        </section>
      )}

      {/* Recent notifications */}
      {notifications.length > 0 && (
        <section>
          <h2 className="text-sm font-semibold text-gray-900 mb-2">התראות אחרונות</h2>
          <div className="space-y-1.5">
            {notifications.slice(0, 4).map((n) => (
              <div key={n.id} className={`rounded-lg border px-3 py-2 ${n.isRead ? 'border-gray-200 bg-white' : 'border-primary-200 bg-primary-50'}`}>
                <p className="text-xs font-semibold text-gray-900">{n.title}</p>
                <p className="text-xs text-gray-600 mt-0.5">{n.body}</p>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

function ShiftCard({ shift, highlight, pending }: { shift: WorkerShift; highlight?: boolean; pending?: boolean }) {
  const { job } = shift;
  return (
    <Link
      href={`/worker/shifts/${shift.id}`}
      className={`block rounded-xl border p-3 ${highlight ? 'border-primary-300 bg-primary-50/40' : 'border-gray-200 bg-white'} hover:border-primary-300`}
    >
      <div className="flex items-center justify-between gap-2">
        <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium ${jobTypeClasses(job.jobType)}`}>
          {jobTypeLabel(job.jobType)}
        </span>
        {pending ? (
          <span className="text-[11px] font-medium text-amber-700">ממתין לאישור</span>
        ) : (
          <span className="text-xs font-semibold text-gray-900">{formatDate(shift.scheduledStart)}</span>
        )}
      </div>
      <p className="mt-1.5 text-sm font-semibold text-gray-900">{customerName(job.customer)}</p>
      <p className="mt-0.5 flex items-center gap-1 text-xs text-gray-600">
        <MapPin className="w-3.5 h-3.5 shrink-0" />
        {job.address?.fullAddress ?? 'כתובת תתעדכן'}
      </p>
      <p className="mt-0.5 flex items-center gap-1 text-xs text-gray-500">
        <Clock className="w-3.5 h-3.5 shrink-0" />
        {formatTime(shift.scheduledStart)}–{formatTime(shift.scheduledEnd)}
      </p>
    </Link>
  );
}

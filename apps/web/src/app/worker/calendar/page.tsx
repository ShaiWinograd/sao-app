'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useAuth } from '@clerk/nextjs';
import { ChevronRight, ChevronLeft, MapPin, Clock } from 'lucide-react';
import { api, authHeaders } from '../../../lib/api';
import {
  type WorkerShift,
  jobTypeLabel,
  jobTypeClasses,
  formatTime,
  customerName,
  dateKey,
  attendanceBadge,
  missingFormBadge,
  isActiveShift,
} from '../../../lib/worker';

type View = 'list' | 'week' | 'month';
const WEEKDAYS = ['א', 'ב', 'ג', 'ד', 'ה', 'ו', 'ש'];

function ymd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function shiftAnchor(anchor: Date, days: number, setAnchor: (d: Date) => void) {
  const d = new Date(anchor);
  d.setDate(anchor.getDate() + days);
  setAnchor(d);
}

export default function WorkerCalendarPage() {
  const { getToken } = useAuth();
  const [shifts, setShifts] = useState<WorkerShift[]>([]);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<View>('list');
  const [anchor, setAnchor] = useState(() => new Date());

  useEffect(() => {
    (async () => {
      try {
        const auth = await authHeaders(getToken);
        const res = await api.get<WorkerShift[]>('/shifts/mine', auth);
        setShifts((res.data ?? []).filter((s) => isActiveShift(s.joinRequestStatus)));
      } catch {
        setShifts([]);
      } finally {
        setLoading(false);
      }
    })();
  }, [getToken]);

  const shiftsByDate = useMemo(() => {
    const map = new Map<string, WorkerShift[]>();
    shifts.forEach((s) => {
      const key = dateKey(s.scheduledStart);
      map.set(key, [...(map.get(key) ?? []), s]);
    });
    for (const list of map.values()) list.sort((a, b) => a.scheduledStart.localeCompare(b.scheduledStart));
    return map;
  }, [shifts]);

  if (loading) return <p className="text-sm text-gray-400">טוען…</p>;

  return (
    <div className="space-y-4 max-w-4xl">
      <div className="flex items-center justify-between gap-2">
        <h1 className="text-xl font-bold text-gray-900">היומן שלי</h1>
        <div className="inline-flex rounded-lg border border-gray-200 bg-white p-0.5 text-xs">
          {([['list', 'רשימה'], ['week', 'שבוע'], ['month', 'חודש']] as [View, string][]).map(([v, label]) => (
            <button
              key={v}
              type="button"
              onClick={() => setView(v)}
              className={`rounded-md px-3 py-1 font-medium ${view === v ? 'bg-primary-600 text-white' : 'text-gray-600 hover:text-gray-900'}`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {view === 'list' && <ListView shifts={shifts} />}
      {view === 'week' && <WeekView anchor={anchor} setAnchor={setAnchor} shiftsByDate={shiftsByDate} />}
      {view === 'month' && <MonthView anchor={anchor} setAnchor={setAnchor} shiftsByDate={shiftsByDate} />}
    </div>
  );
}

function ShiftChip({ shift }: { shift: WorkerShift }) {
  return (
    <Link
      href={`/worker/shifts/${shift.id}`}
      className={`block rounded-md border px-1.5 py-1 text-[11px] leading-tight ${jobTypeClasses(shift.job.jobType)} hover:opacity-90`}
    >
      <span className="font-semibold">{formatTime(shift.scheduledStart)}</span> {customerName(shift.job.customer)}
    </Link>
  );
}

function ListView({ shifts }: { shifts: WorkerShift[] }) {
  const todayKey = dateKey(new Date().toISOString());
  const sorted = [...shifts].sort((a, b) => a.scheduledStart.localeCompare(b.scheduledStart));
  const upcoming = sorted.filter((s) => dateKey(s.scheduledStart) >= todayKey);
  const past = sorted.filter((s) => dateKey(s.scheduledStart) < todayKey).reverse();

  if (shifts.length === 0) {
    return <p className="rounded-xl border border-gray-200 bg-white p-4 text-sm text-gray-500">אין לך משמרות מתוזמנות.</p>;
  }

  return (
    <div className="space-y-5">
      <Section title="משמרות קרובות" shifts={upcoming} emptyText="אין משמרות קרובות." />
      {past.length > 0 && <Section title="משמרות קודמות" shifts={past} />}
    </div>
  );
}

function Section({ title, shifts, emptyText }: { title: string; shifts: WorkerShift[]; emptyText?: string }) {
  return (
    <section>
      <h2 className="text-sm font-semibold text-gray-900 mb-2">{title}</h2>
      {shifts.length === 0 && emptyText ? (
        <p className="text-xs text-gray-500">{emptyText}</p>
      ) : (
        <div className="space-y-2">
          {shifts.map((s) => (
            <ShiftRow key={s.id} shift={s} />
          ))}
        </div>
      )}
    </section>
  );
}

function ShiftRow({ shift }: { shift: WorkerShift }) {
  const att = attendanceBadge(shift.attendanceStatus);
  const missingForm = missingFormBadge(shift);
  const pending = shift.joinRequestStatus === 'PENDING';
  return (
    <Link href={`/worker/shifts/${shift.id}`} className="block rounded-xl border border-gray-200 bg-white p-3 hover:border-primary-300">
      <div className="flex items-center justify-between gap-2">
        <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium ${jobTypeClasses(shift.job.jobType)}`}>
          {jobTypeLabel(shift.job.jobType)}
        </span>
        <span className="text-xs font-semibold text-gray-900">
          {new Date(shift.scheduledStart).toLocaleDateString('he-IL', { weekday: 'short', day: '2-digit', month: '2-digit' })}
        </span>
      </div>
      <p className="mt-1.5 text-sm font-semibold text-gray-900">{customerName(shift.job.customer)}</p>
      <p className="mt-0.5 flex items-center gap-1 text-xs text-gray-600">
        <MapPin className="w-3.5 h-3.5 shrink-0" />
        {shift.job.address?.fullAddress ?? 'כתובת תתעדכן'}
      </p>
      <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
        <span className="inline-flex items-center gap-1 rounded-full border border-gray-200 bg-gray-50 px-2 py-0.5 text-[11px] text-gray-600">
          <Clock className="w-3 h-3" />
          {formatTime(shift.scheduledStart)}–{formatTime(shift.scheduledEnd)}
        </span>
        {pending ? (
          <span className="rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-700">ממתין לאישור</span>
        ) : (
          <span className={`rounded-full border px-2 py-0.5 text-[11px] font-medium ${att.className}`}>{att.label}</span>
        )}
        {missingForm && (
          <span className="rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-700">טופס חסר</span>
        )}
      </div>
    </Link>
  );
}

function WeekView({
  anchor,
  setAnchor,
  shiftsByDate,
}: {
  anchor: Date;
  setAnchor: (d: Date) => void;
  shiftsByDate: Map<string, WorkerShift[]>;
}) {
  const start = new Date(anchor);
  start.setDate(anchor.getDate() - anchor.getDay());
  const days = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    return d;
  });
  const todayKey = ymd(new Date());
  const rangeLabel = `${days[0].toLocaleDateString('he-IL', { day: '2-digit', month: '2-digit' })} – ${days[6].toLocaleDateString('he-IL', { day: '2-digit', month: '2-digit' })}`;

  return (
    <div className="rounded-xl border border-gray-200 bg-white overflow-hidden">
      <CalendarHeader label={rangeLabel} onPrev={() => shiftAnchor(anchor, -7, setAnchor)} onNext={() => shiftAnchor(anchor, 7, setAnchor)} />
      <div className="grid grid-cols-7">
        {days.map((d) => {
          const key = ymd(d);
          const isToday = key === todayKey;
          return (
            <div key={key} className={`min-h-[110px] border-l border-t border-gray-100 p-1.5 ${isToday ? 'bg-emerald-50/40' : ''}`}>
              <div className="text-center text-[11px] text-gray-500">
                {WEEKDAYS[d.getDay()]} {d.getDate()}
              </div>
              <div className="mt-1 space-y-1">
                {(shiftsByDate.get(key) ?? []).map((s) => (
                  <ShiftChip key={s.id} shift={s} />
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function MonthView({
  anchor,
  setAnchor,
  shiftsByDate,
}: {
  anchor: Date;
  setAnchor: (d: Date) => void;
  shiftsByDate: Map<string, WorkerShift[]>;
}) {
  const year = anchor.getFullYear();
  const month = anchor.getMonth();
  const first = new Date(year, month, 1);
  const gridStart = new Date(first);
  gridStart.setDate(1 - first.getDay());
  const cells = Array.from({ length: 42 }, (_, i) => {
    const d = new Date(gridStart);
    d.setDate(gridStart.getDate() + i);
    return d;
  });
  const todayKey = ymd(new Date());
  const monthLabel = anchor.toLocaleDateString('he-IL', { month: 'long', year: 'numeric' });

  return (
    <div className="rounded-xl border border-gray-200 bg-white overflow-hidden">
      <CalendarHeader label={monthLabel} onPrev={() => setAnchor(new Date(year, month - 1, 1))} onNext={() => setAnchor(new Date(year, month + 1, 1))} />
      <div className="grid grid-cols-7 bg-gray-50 text-center text-[11px] text-gray-500">
        {WEEKDAYS.map((w) => (
          <div key={w} className="py-1.5">
            {w}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7">
        {cells.map((d) => {
          const key = ymd(d);
          const inMonth = d.getMonth() === month;
          const isToday = key === todayKey;
          const dayShifts = shiftsByDate.get(key) ?? [];
          return (
            <div
              key={key}
              className={`min-h-[86px] border-l border-t border-gray-100 p-1 ${inMonth ? '' : 'bg-gray-50/60'} ${isToday ? 'bg-emerald-50/50' : ''}`}
            >
              <div className={`text-[11px] ${inMonth ? 'text-gray-700' : 'text-gray-300'} ${isToday ? 'font-bold text-emerald-700' : ''}`}>
                {d.getDate()}
              </div>
              <div className="mt-0.5 space-y-0.5">
                {dayShifts.slice(0, 3).map((s) => (
                  <ShiftChip key={s.id} shift={s} />
                ))}
                {dayShifts.length > 3 && <p className="text-[10px] text-gray-400">+{dayShifts.length - 3}</p>}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function CalendarHeader({ label, onPrev, onNext }: { label: string; onPrev: () => void; onNext: () => void }) {
  return (
    <div className="flex items-center justify-between border-b border-gray-100 px-3 py-2">
      <button type="button" onClick={onPrev} aria-label="הקודם" className="rounded p-1 text-gray-500 hover:bg-gray-100">
        <ChevronRight className="w-4 h-4" />
      </button>
      <span className="text-sm font-semibold text-gray-900">{label}</span>
      <button type="button" onClick={onNext} aria-label="הבא" className="rounded p-1 text-gray-500 hover:bg-gray-100">
        <ChevronLeft className="w-4 h-4" />
      </button>
    </div>
  );
}

'use client';

import { useMemo } from 'react';

export type CalendarWork = {
  id: string;
  date: string; // YYYY-MM-DD
  startTime: string;
  endTime: string;
  jobType: 'PACKING' | 'UNPACKING' | 'HOME_ORGANIZATION' | string;
  customerName: string;
  caseName: string;
  requiredWorkers: number;
  assignedWorkers: number;
  requiresManager: boolean;
  hasManager?: boolean;
};

const JOB_TYPE_LABELS: Record<string, string> = {
  PACKING: 'אריזה',
  UNPACKING: 'פריקה',
  HOME_ORGANIZATION: 'סידור',
  אריזה: 'אריזה',
  פריקה: 'פריקה',
  סידור: 'סידור',
};

const JOB_TYPE_DOT: Record<string, string> = {
  PACKING: 'bg-red-500',
  UNPACKING: 'bg-amber-500',
  HOME_ORGANIZATION: 'bg-blue-500',
  אריזה: 'bg-red-500',
  פריקה: 'bg-amber-500',
  סידור: 'bg-blue-500',
};

const WEEKDAY_LABELS = ['א׳', 'ב׳', 'ג׳', 'ד׳', 'ה׳', 'ו׳', 'ש׳'];

function toDateKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

type Props = {
  anchor: Date; // any date within the month to render
  works: CalendarWork[];
  todayKey: string;
  onSelectDay?: (dateKey: string) => void;
};

// §6 Calendar — Month view. Renders a Sunday-first RTL month grid with compact
// job cards per day (time, type, customer, X/Y workers, manager state).
export default function MonthCalendar({ anchor, works, todayKey, onSelectDay }: Props) {
  const weeks = useMemo(() => {
    const first = new Date(anchor.getFullYear(), anchor.getMonth(), 1);
    const gridStart = new Date(first);
    gridStart.setDate(first.getDate() - first.getDay()); // back to Sunday
    const cells: Date[] = [];
    for (let i = 0; i < 42; i += 1) {
      const d = new Date(gridStart);
      d.setDate(gridStart.getDate() + i);
      cells.push(d);
    }
    const rows: Date[][] = [];
    for (let i = 0; i < 42; i += 7) rows.push(cells.slice(i, i + 7));
    // Drop a trailing all-next-month week when unused.
    return rows.filter((row) => row.some((d) => d.getMonth() === anchor.getMonth()) || rows.indexOf(row) < 5);
  }, [anchor]);

  const worksByDate = useMemo(() => {
    const map = new Map<string, CalendarWork[]>();
    for (const work of works) {
      const list = map.get(work.date) ?? [];
      list.push(work);
      map.set(work.date, list);
    }
    return map;
  }, [works]);

  return (
    <div className="rounded-lg border border-gray-200 bg-white overflow-hidden" data-testid="month-calendar">
      <div className="grid grid-cols-7 border-b border-gray-200 bg-gray-50">
        {WEEKDAY_LABELS.map((label) => (
          <div key={label} className="px-2 py-2 text-center text-xs font-semibold text-gray-600 border-l border-gray-100 last:border-l-0">
            {label}
          </div>
        ))}
      </div>
      <div>
        {weeks.map((week, wi) => (
          <div key={wi} className="grid grid-cols-7 border-b border-gray-100 last:border-b-0">
            {week.map((day) => {
              const key = toDateKey(day);
              const inMonth = day.getMonth() === anchor.getMonth();
              const isToday = key === todayKey;
              const dayWorks = worksByDate.get(key) ?? [];
              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => onSelectDay?.(key)}
                  className={`min-h-[92px] border-l border-gray-100 last:border-l-0 p-1.5 text-right align-top hover:bg-primary-50/40 ${inMonth ? 'bg-white' : 'bg-gray-50/60'}`}
                >
                  <div className="flex items-center justify-between">
                    {isToday && <span className="rounded-full bg-primary-600 px-1.5 py-0.5 text-[10px] font-semibold text-white">היום</span>}
                    <span className={`text-[11px] ${inMonth ? 'text-gray-700' : 'text-gray-400'} ${isToday ? 'font-bold' : ''}`}>
                      {day.getDate()}
                    </span>
                  </div>
                  <div className="mt-1 space-y-1">
                    {dayWorks.slice(0, 3).map((work) => {
                      const understaffed = work.assignedWorkers < work.requiredWorkers;
                      const missingManager = work.requiresManager && work.hasManager === false;
                      return (
                        <div
                          key={work.id}
                          className={`rounded-md border px-1.5 py-1 text-[10px] leading-tight ${understaffed || missingManager ? 'border-warning/40 bg-warning-bg' : 'border-gray-200 bg-gray-50'}`}
                        >
                          <div className="flex items-center gap-1">
                            <span className={`inline-block h-1.5 w-1.5 rounded-full ${JOB_TYPE_DOT[work.jobType] ?? 'bg-gray-400'}`} />
                            <span className="font-semibold text-gray-800">{work.startTime}</span>
                            <span className="text-gray-500">{JOB_TYPE_LABELS[work.jobType] ?? work.jobType}</span>
                          </div>
                          <p className="truncate text-gray-600">{work.customerName}</p>
                          <p className={understaffed ? 'text-warning font-medium' : 'text-gray-500'}>
                            {work.assignedWorkers}/{work.requiredWorkers} עובדים{missingManager ? ' · חסר מנהל' : ''}
                          </p>
                        </div>
                      );
                    })}
                    {dayWorks.length > 3 && (
                      <p className="text-[10px] text-gray-500">+{dayWorks.length - 3} נוספות</p>
                    )}
                  </div>
                </button>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}

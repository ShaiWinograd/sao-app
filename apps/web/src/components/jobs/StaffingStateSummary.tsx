'use client';

import { useState } from 'react';

export type StaffingSummaryShift = {
  workerNameSnapshot?: string | null;
  name?: string | null;
  joinRequestStatus?: string | null;
  assignmentRole?: string | null;
};

export function getStaffingStateSummary(
  shifts: StaffingSummaryShift[],
  requiredWorkerCount: number,
) {
  const active = shifts.filter(
    (shift) =>
      shift.assignmentRole !== 'BACKUP' &&
      shift.joinRequestStatus !== 'REJECTED' &&
      shift.joinRequestStatus !== 'CANCELLED',
  );
  const names = (status: string) =>
    active
      .filter((shift) => shift.joinRequestStatus === status)
      .map((shift) => shift.workerNameSnapshot ?? shift.name ?? 'עובד/ת');
  const approvedNames = names('APPROVED');
  return {
    required: requiredWorkerCount,
    pendingOwnerNames: names('PENDING'),
    approvedNames,
    awaitingWorkerNames: names('AWAITING_WORKER'),
    openSlots: Math.max(requiredWorkerCount - approvedNames.length, 0),
  };
}

function StaffingCounter({
  label,
  value,
  names,
  tone,
}: {
  label: string;
  value: number;
  names?: string[];
  tone: string;
}) {
  const detail = names?.length ? names.join(' · ') : 'אין עובדים במצב זה';
  const [open, setOpen] = useState(false);
  return (
    <div
      tabIndex={0}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      onFocus={() => setOpen(true)}
      onBlur={() => setOpen(false)}
      className="relative min-w-0 border-l border-[var(--color-border)] px-2 py-1.5 text-center outline-none last:border-l-0 focus:bg-[var(--color-surface)]"
      aria-label={`${label}: ${value}. ${detail}`}
      title={`${label}: ${value}. ${detail}`}
    >
      <strong className={`block text-sm font-semibold leading-none ${tone}`}>{value}</strong>
      <span className="mt-1 block truncate text-[9px] text-[var(--color-text-secondary)]">{label}</span>
      {open && (
        <div className="pointer-events-none absolute bottom-full right-1/2 z-40 mb-2 w-52 translate-x-1/2 border border-[var(--color-border-strong)] bg-[var(--color-background)] px-3 py-2 text-right text-[11px] leading-5 text-gray-700 shadow-lg">
          <p className="font-semibold text-gray-900">{label} · {value}</p>
          <p>{detail}</p>
        </div>
      )}
    </div>
  );
}

export function StaffingStateSummary({
  shifts,
  requiredWorkerCount,
  className = '',
}: {
  shifts: StaffingSummaryShift[];
  requiredWorkerCount: number;
  className?: string;
}) {
  const summary = getStaffingStateSummary(shifts, requiredWorkerCount);
  return (
    <div
      className={`grid grid-cols-4 border-y border-[var(--color-border)] bg-[var(--color-surface-muted)] ${className}`}
      data-testid="staffing-state-summary"
    >
      <StaffingCounter label="נדרש" value={summary.required} tone="text-gray-900" />
      <StaffingCounter label="ממתין לבעלים" value={summary.pendingOwnerNames.length} names={summary.pendingOwnerNames} tone="text-[var(--color-calendar-sand)]" />
      <StaffingCounter label="מאושר" value={summary.approvedNames.length} names={summary.approvedNames} tone="text-[var(--color-calendar-sage)]" />
      <StaffingCounter label="ממתין לעובד/ת" value={summary.awaitingWorkerNames.length} names={summary.awaitingWorkerNames} tone="text-primary-700" />
    </div>
  );
}

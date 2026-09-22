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

function staffingStatusLabel(status?: string | null) {
  if (status === 'APPROVED') return 'מאושרת';
  if (status === 'PENDING') return 'ממתינה לאישור שלך';
  if (status === 'AWAITING_WORKER') return 'ממתינה לאישור העובדת';
  return 'בתהליך';
}

export function StaffingGapSummary({
  shifts,
  requiredWorkerCount,
}: {
  shifts: StaffingSummaryShift[];
  requiredWorkerCount: number;
}) {
  const summary = getStaffingStateSummary(shifts, requiredWorkerCount);
  const active = shifts.filter(
    (shift) =>
      shift.assignmentRole !== 'BACKUP' &&
      shift.joinRequestStatus !== 'REJECTED' &&
      shift.joinRequestStatus !== 'CANCELLED',
  );
  const hoverText = [
    ...active.map(
      (shift) =>
        `${shift.workerNameSnapshot ?? shift.name ?? 'עובדת'} — ${staffingStatusLabel(shift.joinRequestStatus)}`,
    ),
    `${summary.openSlots} חסרים`,
  ].join('\n');

  return (
    <>
      {summary.pendingOwnerNames.length > 0 && (
        <span
          className="absolute left-1.5 top-1.5 inline-flex items-center gap-1 text-[9px] font-semibold text-[var(--color-calendar-sand)]"
          aria-label={`${summary.pendingOwnerNames.length} בקשות הצטרפות ממתינות`}
        >
          <span className="h-1.5 w-1.5 rounded-full bg-[var(--color-calendar-sand)]" />
          {summary.pendingOwnerNames.length}
        </span>
      )}
      <div
        className="mt-1 border-t border-current/15 pt-1 text-[10px] font-semibold text-[var(--color-calendar-sand)]"
        data-testid="staffing-gap-bottom-line"
        title={hoverText}
      >
        {summary.approvedNames.length}/{summary.required} מאוישים · {summary.openSlots} חסרים
      </div>
      <div className="pointer-events-none absolute left-1 top-full z-50 mt-1 hidden w-56 border border-[var(--color-border-strong)] bg-[var(--color-background)] px-3 py-2 text-right text-[11px] leading-5 text-gray-700 shadow-lg group-hover/staffing:block group-focus-within/staffing:block">
        <p className="font-semibold text-gray-900">{summary.openSlots} חסרים</p>
        {active.map((shift, index) => (
            <p key={`${shift.workerNameSnapshot ?? shift.name ?? 'worker'}-${index}`}>
              {shift.workerNameSnapshot ?? shift.name ?? 'עובדת'} · {staffingStatusLabel(shift.joinRequestStatus)}
            </p>
          ))}
      </div>
    </>
  );
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
  const detail = names?.length ? names.join(' · ') : '';
  const [open, setOpen] = useState(false);
  return (
    <div
      tabIndex={0}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      onFocus={() => setOpen(true)}
      onBlur={() => setOpen(false)}
      className="relative min-w-0 border-l border-[var(--color-border)] px-2 py-1.5 text-center outline-none last:border-l-0 focus:bg-[var(--color-surface)]"
      aria-label={`${label}: ${value}${detail ? `. ${detail}` : ''}`}
      title={`${label}: ${value}${detail ? `. ${detail}` : ''}`}
    >
      <strong className={`block text-sm font-semibold leading-none ${tone}`}>{value}</strong>
      <span className="mt-1 block truncate text-[9px] text-[var(--color-text-secondary)]">{label}</span>
      {open && (
        <div className="pointer-events-none absolute bottom-full right-1/2 z-40 mb-2 w-52 translate-x-1/2 border border-[var(--color-border-strong)] bg-[var(--color-background)] px-3 py-2 text-right text-[11px] leading-5 text-gray-700 shadow-lg">
          <p className="font-semibold text-gray-900">{label} · {value}</p>
          {detail && <p>{detail}</p>}
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
      className={`grid grid-flow-col auto-cols-fr border-y border-[var(--color-border)] bg-[var(--color-surface-muted)] ${className}`}
      data-testid="staffing-state-summary"
    >
      <StaffingCounter label="נדרש" value={summary.required} tone="text-gray-900" />
      {summary.pendingOwnerNames.length > 0 && (
        <StaffingCounter label="ממתין לבעלים" value={summary.pendingOwnerNames.length} names={summary.pendingOwnerNames} tone="text-[var(--color-calendar-sand)]" />
      )}
      {summary.approvedNames.length > 0 && (
        <StaffingCounter label="מאוישים" value={summary.approvedNames.length} names={summary.approvedNames} tone="text-[var(--color-calendar-sage)]" />
      )}
      {summary.awaitingWorkerNames.length > 0 && (
        <StaffingCounter label="ממתין לעובד/ת" value={summary.awaitingWorkerNames.length} names={summary.awaitingWorkerNames} tone="text-primary-700" />
      )}
    </div>
  );
}

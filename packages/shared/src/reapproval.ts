// Reapproval rules for job changes and worker moves (spec §12.2, §13).
//
// A worker who already approved a job only needs to re-approve when the change
// is material to showing up: the location fundamentally changes (city/street) or
// the schedule shifts by at least 3 hours. Merely adding detail to a known
// address (full address after a city, building number, apartment/floor/access)
// or a customer/job-type change does not require reapproval.

export type ReapprovalInput = {
  oldAddress: string | null;
  newAddress: string | null;
  oldStart: Date | string;
  oldEnd: Date | string;
  newStart: Date | string;
  newEnd: Date | string;
};

// A schedule shift of at least this many minutes requires reapproval (spec §13.2).
export const REAPPROVAL_SCHEDULE_THRESHOLD_MINUTES = 180;

function addressTokens(a: string | null): string[] {
  return (a ?? '')
    .toLowerCase()
    .replace(/[.,;/\\-]+/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
}

// Reapproval when the location fundamentally changes (city/street). Adding
// detail keeps every original token (street, city) present and just adds new
// ones — e.g. a building number inserted between street and city, or an
// apartment/floor/access suffix. Only when an original token disappears or
// changes (a different street or city) is reapproval required (spec §13.1).
export function addressRequiresReapproval(
  oldAddress: string | null,
  newAddress: string | null,
): boolean {
  const oldTokens = addressTokens(oldAddress);
  if (oldTokens.length === 0) return false; // no prior address → filling one in is just detail
  const newTokens = new Set(addressTokens(newAddress));
  // If any original token is no longer present, the location changed materially.
  return oldTokens.some((token) => !newTokens.has(token));
}

function toTime(value: Date | string): number {
  return value instanceof Date ? value.getTime() : new Date(value).getTime();
}

// Reapproval when the start or end moves by at least the threshold (spec §13.2).
export function scheduleRequiresReapproval(
  oldStart: Date | string,
  oldEnd: Date | string,
  newStart: Date | string,
  newEnd: Date | string,
): boolean {
  const startShift = Math.abs(toTime(newStart) - toTime(oldStart));
  const endShift = Math.abs(toTime(newEnd) - toTime(oldEnd));
  const maxShiftMinutes = Math.max(startShift, endShift) / 60000;
  return maxShiftMinutes >= REAPPROVAL_SCHEDULE_THRESHOLD_MINUTES;
}

export function requiresReapproval(input: ReapprovalInput): boolean {
  return (
    addressRequiresReapproval(input.oldAddress, input.newAddress) ||
    scheduleRequiresReapproval(input.oldStart, input.oldEnd, input.newStart, input.newEnd)
  );
}

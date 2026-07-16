// Availability blocks a worker sets to mark themselves unavailable
// (worker_web_spec §3): a single date, a date range, or a recurring weekday.

export type AvailabilityBlockType = 'DATE' | 'RANGE' | 'WEEKLY';

export type AvailabilityBlock = {
  type: AvailabilityBlockType;
  startDate?: string | null;
  endDate?: string | null;
  weekday?: number | null;
};

function toDateKey(iso: string | null | undefined): string {
  return iso ? iso.slice(0, 10) : '';
}

// Whether the worker's availability blocks make them unavailable on the given
// calendar date (dateKey = 'YYYY-MM-DD').
export function isUnavailableOn(blocks: readonly AvailabilityBlock[], dateKey: string): boolean {
  if (!dateKey) return false;
  const weekday = new Date(`${dateKey}T00:00:00`).getDay();
  return blocks.some((block) => {
    if (block.type === 'WEEKLY') return block.weekday === weekday;
    if (block.type === 'DATE') return toDateKey(block.startDate) === dateKey;
    if (block.type === 'RANGE') {
      const start = toDateKey(block.startDate);
      const end = toDateKey(block.endDate);
      return Boolean(start && end && dateKey >= start && dateKey <= end);
    }
    return false;
  });
}

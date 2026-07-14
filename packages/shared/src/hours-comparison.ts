// Project hours comparison — estimated vs scheduled vs actual worker-hours,
// grouped by service type (business_app_ux_spec §10).

export type HoursComparisonEntry = {
  serviceType: string;
  estimated?: number;
  scheduled?: number;
  // null / undefined means "no actual data yet" (rendered as —).
  actual?: number | null;
};

export type HoursComparisonRow = {
  serviceType: string;
  estimated: number;
  scheduled: number;
  actual: number | null;
};

export type HoursComparison = {
  rows: HoursComparisonRow[];
  totals: { estimated: number; scheduled: number; actual: number | null };
};

// Groups entries by service type, summing estimated/scheduled and treating actual
// as null until at least one entry reports a real (non-null) actual figure.
export function buildHoursComparison(entries: HoursComparisonEntry[]): HoursComparison {
  const byService = new Map<string, { estimated: number; scheduled: number; actual: number; hasActual: boolean }>();

  for (const entry of entries) {
    const current = byService.get(entry.serviceType) ?? {
      estimated: 0,
      scheduled: 0,
      actual: 0,
      hasActual: false,
    };
    current.estimated += entry.estimated ?? 0;
    current.scheduled += entry.scheduled ?? 0;
    if (entry.actual !== null && entry.actual !== undefined) {
      current.actual += entry.actual;
      current.hasActual = true;
    }
    byService.set(entry.serviceType, current);
  }

  const rows: HoursComparisonRow[] = [...byService.entries()].map(([serviceType, value]) => ({
    serviceType,
    estimated: value.estimated,
    scheduled: value.scheduled,
    actual: value.hasActual ? value.actual : null,
  }));

  const anyActual = rows.some((row) => row.actual !== null);
  const totals = {
    estimated: rows.reduce((sum, row) => sum + row.estimated, 0),
    scheduled: rows.reduce((sum, row) => sum + row.scheduled, 0),
    actual: anyActual ? rows.reduce((sum, row) => sum + (row.actual ?? 0), 0) : null,
  };

  return { rows, totals };
}

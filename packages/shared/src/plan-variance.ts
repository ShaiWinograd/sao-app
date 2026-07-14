// Compares a planned/baseline figure against an actual figure for the
// project "estimated vs scheduled vs actual" comparison table.

export type VarianceTone = 'success' | 'warning' | 'info';

export type PlanVariance = {
  delta: number;
  pct: number | null;
  tone: VarianceTone;
};

// tone: on-target → success, actual above baseline (over) → warning,
// actual below baseline (under) → info.
export function computePlanVariance(baseline: number, actual: number): PlanVariance {
  const delta = actual - baseline;
  const pct = baseline === 0 ? null : (delta / baseline) * 100;
  const tone: VarianceTone = delta === 0 ? 'success' : delta > 0 ? 'warning' : 'info';
  return { delta, pct, tone };
}

// "+12%", "-8%", or "תואם" when there is no meaningful percentage delta.
export function formatVariancePct(variance: PlanVariance): string {
  if (variance.delta === 0) return 'תואם';
  if (variance.pct === null) return variance.delta > 0 ? 'חריגה' : 'מתחת לתכנון';
  const rounded = Math.round(variance.pct);
  return `${rounded > 0 ? '+' : ''}${rounded}%`;
}

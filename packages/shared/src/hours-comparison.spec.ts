import { describe, expect, it } from 'vitest';
import { buildHoursComparison } from './hours-comparison';

describe('buildHoursComparison', () => {
  it('matches the spec example (packing actual, unpacking pending)', () => {
    const result = buildHoursComparison([
      { serviceType: 'PACKING', estimated: 40, scheduled: 40, actual: 42.5 },
      { serviceType: 'UNPACKING', estimated: 25, scheduled: 25, actual: null },
    ]);

    const packing = result.rows.find((r) => r.serviceType === 'PACKING');
    const unpacking = result.rows.find((r) => r.serviceType === 'UNPACKING');
    expect(packing).toEqual({ serviceType: 'PACKING', estimated: 40, scheduled: 40, actual: 42.5 });
    expect(unpacking).toEqual({ serviceType: 'UNPACKING', estimated: 25, scheduled: 25, actual: null });

    expect(result.totals.estimated).toBe(65);
    expect(result.totals.scheduled).toBe(65);
    expect(result.totals.actual).toBe(42.5);
  });

  it('aggregates multiple entries of the same service', () => {
    const result = buildHoursComparison([
      { serviceType: 'PACKING', estimated: 20, scheduled: 20, actual: 21 },
      { serviceType: 'PACKING', estimated: 20, scheduled: 20, actual: 21.5 },
    ]);
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].estimated).toBe(40);
    expect(result.rows[0].actual).toBe(42.5);
  });

  it('reports null actual when no actual data exists', () => {
    const result = buildHoursComparison([
      { serviceType: 'HOME_ORGANIZATION', estimated: 10, scheduled: 5 },
    ]);
    expect(result.rows[0].actual).toBeNull();
    expect(result.totals.actual).toBeNull();
  });
});

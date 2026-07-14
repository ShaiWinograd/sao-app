import { describe, expect, it } from 'vitest';
import { findCandidateDates, type DateFinderWorker } from './date-finder';

function worker(overrides: Partial<DateFinderWorker> & { id: string }): DateFinderWorker {
  return { isActive: true, isManager: false, bookedDates: [], ...overrides };
}

describe('findCandidateDates', () => {
  it('returns a candidate per day in range', () => {
    const result = findCandidateDates(
      { startDate: '2026-08-01', endDate: '2026-08-03', requiredWorkers: 1 },
      [worker({ id: 'w1' })],
    );
    expect(result.map((c) => c.date).sort()).toEqual(['2026-08-01', '2026-08-02', '2026-08-03']);
  });

  it('marks a date unsuitable when not enough workers are free', () => {
    const result = findCandidateDates(
      { startDate: '2026-08-01', endDate: '2026-08-01', requiredWorkers: 2 },
      [worker({ id: 'w1' }), worker({ id: 'w2', bookedDates: ['2026-08-01'] })],
    );
    expect(result[0].availableWorkers).toBe(1);
    expect(result[0].suitable).toBe(false);
  });

  it('requires an available manager when requiresManager is set', () => {
    const result = findCandidateDates(
      { startDate: '2026-08-01', endDate: '2026-08-01', requiredWorkers: 1, requiresManager: true },
      [worker({ id: 'w1' }), worker({ id: 'w2' })],
    );
    expect(result[0].availableManagers).toBe(0);
    expect(result[0].suitable).toBe(false);

    const withManager = findCandidateDates(
      { startDate: '2026-08-01', endDate: '2026-08-01', requiredWorkers: 1, requiresManager: true },
      [worker({ id: 'w1' }), worker({ id: 'mgr', isManager: true })],
    );
    expect(withManager[0].suitable).toBe(true);
  });

  it('filters by allowed weekdays', () => {
    // 2026-08-01 is a Saturday (6), 2026-08-02 Sunday (0)
    const result = findCandidateDates(
      { startDate: '2026-08-01', endDate: '2026-08-03', requiredWorkers: 1, allowedWeekdays: [0] },
      [worker({ id: 'w1' })],
    );
    expect(result.map((c) => c.date)).toEqual(['2026-08-02']);
  });

  it('ranks suitable dates with more availability first', () => {
    const result = findCandidateDates(
      { startDate: '2026-08-01', endDate: '2026-08-02', requiredWorkers: 1 },
      [
        worker({ id: 'w1', bookedDates: ['2026-08-01'] }),
        worker({ id: 'w2' }),
      ],
    );
    // Aug 2 has 2 free, Aug 1 has 1 free → Aug 2 ranks first
    expect(result[0].date).toBe('2026-08-02');
  });

  it('returns empty for an inverted range', () => {
    expect(findCandidateDates({ startDate: '2026-08-05', endDate: '2026-08-01', requiredWorkers: 1 }, [])).toEqual([]);
  });
});

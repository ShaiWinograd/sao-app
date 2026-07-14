import { describe, expect, it } from 'vitest';
import { rankWorkerAvailability, type WorkerCandidate } from './worker-availability';

function candidate(overrides: Partial<WorkerCandidate> & { id: string; name: string }): WorkerCandidate {
  return {
    skills: [],
    isActive: true,
    homeArea: null,
    bookedDates: [],
    ...overrides,
  };
}

describe('rankWorkerAvailability', () => {
  it('excludes inactive workers', () => {
    const result = rankWorkerAvailability(
      { date: '2026-08-01' },
      [candidate({ id: 'w1', name: 'א', isActive: false })],
    );
    expect(result).toHaveLength(0);
  });

  it('ranks available workers above booked ones', () => {
    const result = rankWorkerAvailability({ date: '2026-08-01' }, [
      candidate({ id: 'busy', name: 'עמוס', bookedDates: ['2026-08-01'] }),
      candidate({ id: 'free', name: 'פנוי', bookedDates: ['2026-08-02'] }),
    ]);
    expect(result[0].id).toBe('free');
    expect(result[0].available).toBe(true);
    expect(result[1].available).toBe(false);
  });

  it('boosts candidates with the required skill', () => {
    const result = rankWorkerAvailability(
      { date: '2026-08-01', requiredSkill: 'PACKING_SPECIALIST' },
      [
        candidate({ id: 'general', name: 'כללי', skills: ['GENERAL_WORKER'] }),
        candidate({ id: 'packer', name: 'אורז', skills: ['PACKING_SPECIALIST'] }),
      ],
    );
    expect(result[0].id).toBe('packer');
    expect(result[0].hasRequiredSkill).toBe(true);
    expect(result[0].reasons).toContain('כישור מתאים');
  });

  it('prioritises managers when a manager is required', () => {
    const result = rankWorkerAvailability(
      { date: '2026-08-01', requiresManager: true },
      [
        candidate({ id: 'worker', name: 'עובד', skills: ['GENERAL_WORKER'] }),
        candidate({ id: 'lead', name: 'מנהל', skills: ['SHIFT_LEADER'] }),
      ],
    );
    expect(result[0].id).toBe('lead');
    expect(result[0].isManagerCapable).toBe(true);
    expect(result[0].reasons).toContain('יכול לשמש מנהל עבודה');
  });

  it('rewards a matching home area', () => {
    const result = rankWorkerAvailability(
      { date: '2026-08-01', area: 'תל אביב' },
      [
        candidate({ id: 'far', name: 'רחוק', homeArea: 'חיפה' }),
        candidate({ id: 'near', name: 'קרוב', homeArea: 'תל אביב' }),
      ],
    );
    expect(result[0].id).toBe('near');
    expect(result[0].reasons).toContain('אזור מגורים תואם');
  });
});

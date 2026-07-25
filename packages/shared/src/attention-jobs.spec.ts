import { describe, expect, it } from 'vitest';
import {
  businessDateKey,
  businessTomorrowStartUtc,
  classifyAttentionJobs,
  type AttentionJobInput,
} from './attention-jobs';

// Business timezone is Asia/Jerusalem (UTC+2 winter / +3 summer). All job dates
// are stored at UTC midnight of their calendar day.
const TZ = 'Asia/Jerusalem';

function job(partial: Partial<AttentionJobInput> & { jobId: string }): AttentionJobInput {
  return {
    date: '2026-07-25T00:00:00.000Z',
    status: 'RESERVATION',
    plannedStart: '2026-07-25T09:00:00.000Z',
    customerName: 'לקוח',
    ...partial,
  };
}

// "Now" fixed at 2026-07-25 12:00 Jerusalem (summer, UTC+3) → 09:00 UTC.
const NOW = new Date('2026-07-25T09:00:00.000Z');

describe('businessDateKey', () => {
  it('formats the calendar day in the business timezone', () => {
    expect(businessDateKey(new Date('2026-07-25T09:00:00.000Z'), TZ)).toBe('2026-07-25');
  });

  it('rolls to the next local day after local (not UTC) midnight', () => {
    // 2026-07-25 21:30 UTC = 2026-07-26 00:30 Jerusalem → next day.
    expect(businessDateKey(new Date('2026-07-25T21:30:00.000Z'), TZ)).toBe('2026-07-26');
    // 2026-07-25 20:30 UTC = 2026-07-25 23:30 Jerusalem → still same day.
    expect(businessDateKey(new Date('2026-07-25T20:30:00.000Z'), TZ)).toBe('2026-07-25');
  });
});

describe('businessTomorrowStartUtc', () => {
  it('is UTC midnight of the day after the business "today"', () => {
    expect(businessTomorrowStartUtc(NOW, TZ).toISOString()).toBe('2026-07-26T00:00:00.000Z');
  });

  it('advances when local midnight has passed even though UTC is still "yesterday"', () => {
    // 2026-07-25 22:30 UTC = 2026-07-26 01:30 Jerusalem → tomorrow is the 27th.
    expect(businessTomorrowStartUtc(new Date('2026-07-25T22:30:00.000Z'), TZ).toISOString()).toBe(
      '2026-07-27T00:00:00.000Z',
    );
  });
});

describe('classifyAttentionJobs — inspection-report scenarios', () => {
  it('1. job today + RESERVATION → todayInReservation', () => {
    const g = classifyAttentionJobs([job({ jobId: 'j1', date: '2026-07-25T00:00:00.000Z', status: 'RESERVATION' })], NOW, TZ);
    expect(g.todayInReservation.map((j) => j.jobId)).toEqual(['j1']);
    expect(g.pastNotCompleted).toEqual([]);
  });

  it('2. job today + APPROVED → excluded from todayInReservation', () => {
    const g = classifyAttentionJobs([job({ jobId: 'j2', date: '2026-07-25T00:00:00.000Z', status: 'APPROVED' })], NOW, TZ);
    expect(g.todayInReservation).toEqual([]);
    expect(g.pastNotCompleted).toEqual([]);
  });

  it('3. job today + COMPLETED → excluded', () => {
    const g = classifyAttentionJobs([job({ jobId: 'j3', date: '2026-07-25T00:00:00.000Z', status: 'COMPLETED' })], NOW, TZ);
    expect(g.todayInReservation).toEqual([]);
    expect(g.pastNotCompleted).toEqual([]);
  });

  it('4. job yesterday + APPROVED → pastNotCompleted', () => {
    const g = classifyAttentionJobs([job({ jobId: 'j4', date: '2026-07-24T00:00:00.000Z', status: 'APPROVED' })], NOW, TZ);
    expect(g.pastNotCompleted.map((j) => j.jobId)).toEqual(['j4']);
    expect(g.todayInReservation).toEqual([]);
  });

  it('5. job yesterday + RESERVATION → pastNotCompleted', () => {
    const g = classifyAttentionJobs([job({ jobId: 'j5', date: '2026-07-24T00:00:00.000Z', status: 'RESERVATION' })], NOW, TZ);
    expect(g.pastNotCompleted.map((j) => j.jobId)).toEqual(['j5']);
  });

  it('6. job yesterday + COMPLETED → excluded', () => {
    const g = classifyAttentionJobs([job({ jobId: 'j6', date: '2026-07-24T00:00:00.000Z', status: 'COMPLETED' })], NOW, TZ);
    expect(g.pastNotCompleted).toEqual([]);
  });

  it('7. job yesterday + ARCHIVED → excluded', () => {
    const g = classifyAttentionJobs([job({ jobId: 'j7', date: '2026-07-24T00:00:00.000Z', status: 'ARCHIVED' })], NOW, TZ);
    expect(g.pastNotCompleted).toEqual([]);
  });

  it('8. future job + RESERVATION → excluded from both', () => {
    const g = classifyAttentionJobs([job({ jobId: 'j8', date: '2026-07-26T00:00:00.000Z', status: 'RESERVATION' })], NOW, TZ);
    expect(g.todayInReservation).toEqual([]);
    expect(g.pastNotCompleted).toEqual([]);
  });

  it('9. resolving a job (status → COMPLETED) drops it on the next classification', () => {
    const before = classifyAttentionJobs([job({ jobId: 'j9', date: '2026-07-24T00:00:00.000Z', status: 'RESERVATION' })], NOW, TZ);
    expect(before.pastNotCompleted.map((j) => j.jobId)).toEqual(['j9']);
    const after = classifyAttentionJobs([job({ jobId: 'j9', date: '2026-07-24T00:00:00.000Z', status: 'COMPLETED' })], NOW, TZ);
    expect(after.pastNotCompleted).toEqual([]);
  });

  it('10. empty input → empty groups (nothing to render)', () => {
    const g = classifyAttentionJobs([], NOW, TZ);
    expect(g.todayInReservation).toEqual([]);
    expect(g.pastNotCompleted).toEqual([]);
  });
});

describe('classifyAttentionJobs — timezone boundary around midnight', () => {
  it('a job dated the 25th is "today" just after local midnight (UTC still the 24th)', () => {
    // now = 2026-07-24 22:30 UTC = 2026-07-25 01:30 Jerusalem → today = the 25th.
    const now = new Date('2026-07-24T22:30:00.000Z');
    const g = classifyAttentionJobs(
      [job({ jobId: 'today', date: '2026-07-25T00:00:00.000Z', status: 'RESERVATION' })],
      now,
      TZ,
    );
    expect(g.todayInReservation.map((j) => j.jobId)).toEqual(['today']);
    expect(g.pastNotCompleted).toEqual([]);
  });

  it('the same job becomes overdue once local midnight of the 26th passes', () => {
    // now = 2026-07-25 21:30 UTC = 2026-07-26 00:30 Jerusalem → today = the 26th.
    const now = new Date('2026-07-25T21:30:00.000Z');
    const g = classifyAttentionJobs(
      [job({ jobId: 'was-today', date: '2026-07-25T00:00:00.000Z', status: 'RESERVATION' })],
      now,
      TZ,
    );
    expect(g.todayInReservation).toEqual([]);
    expect(g.pastNotCompleted.map((j) => j.jobId)).toEqual(['was-today']);
  });
});

describe('classifyAttentionJobs — ordering', () => {
  it('orders multiple overdue jobs oldest first (then by start time)', () => {
    const g = classifyAttentionJobs(
      [
        job({ jobId: 'd23-late', date: '2026-07-23T00:00:00.000Z', plannedStart: '2026-07-23T14:00:00.000Z', status: 'APPROVED' }),
        job({ jobId: 'd22', date: '2026-07-22T00:00:00.000Z', plannedStart: '2026-07-22T09:00:00.000Z', status: 'RESERVATION' }),
        job({ jobId: 'd23-early', date: '2026-07-23T00:00:00.000Z', plannedStart: '2026-07-23T08:00:00.000Z', status: 'RESERVATION' }),
      ],
      NOW,
      TZ,
    );
    expect(g.pastNotCompleted.map((j) => j.jobId)).toEqual(['d22', 'd23-early', 'd23-late']);
  });

  it("orders today's reservation jobs by start time", () => {
    const g = classifyAttentionJobs(
      [
        job({ jobId: 'noon', date: '2026-07-25T00:00:00.000Z', plannedStart: '2026-07-25T12:00:00.000Z' }),
        job({ jobId: 'morning', date: '2026-07-25T00:00:00.000Z', plannedStart: '2026-07-25T07:00:00.000Z' }),
        job({ jobId: 'afternoon', date: '2026-07-25T00:00:00.000Z', plannedStart: '2026-07-25T16:00:00.000Z' }),
      ],
      NOW,
      TZ,
    );
    expect(g.todayInReservation.map((j) => j.jobId)).toEqual(['morning', 'noon', 'afternoon']);
  });
});

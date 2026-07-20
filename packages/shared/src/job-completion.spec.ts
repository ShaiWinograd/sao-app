import { describe, expect, it } from 'vitest';
import { evaluateJobCompletion, type CompletionShift } from './job-completion';

function shift(overrides: Partial<CompletionShift> = {}): CompletionShift {
  return {
    joinRequestStatus: 'APPROVED',
    assignmentRole: 'REGULAR',
    attendanceStatus: 'CLOCKED_OUT',
    actualStart: '2026-08-01T08:00:00.000Z',
    actualEnd: '2026-08-01T13:00:00.000Z',
    requiresReview: false,
    ...overrides,
  };
}

describe('evaluateJobCompletion', () => {
  it('completes when all regular workers clocked out', () => {
    expect(evaluateJobCompletion([shift(), shift()]).complete).toBe(true);
  });

  it('does not complete while a regular worker is still clocked in', () => {
    const result = evaluateJobCompletion([shift(), shift({ attendanceStatus: 'CLOCKED_IN', actualEnd: null })]);
    expect(result.complete).toBe(false);
    expect(result.blockingReasons).toContain('a worker has not clocked out');
  });

  it('does not complete when no regular worker has worked yet', () => {
    const result = evaluateJobCompletion([shift({ actualStart: null, attendanceStatus: 'SCHEDULED', actualEnd: null })]);
    expect(result.complete).toBe(false);
  });

  it('blocks completion for an assigned regular with no attendance outcome (§17.1)', () => {
    const result = evaluateJobCompletion([
      shift(),
      shift({ actualStart: null, actualEnd: null, attendanceStatus: 'SCHEDULED' }),
    ]);
    expect(result.complete).toBe(false);
    expect(result.blockingReasons).toContain('a worker has no attendance outcome yet');
  });

  it('completes when an unclocked regular is explicitly marked Did not work (NO_SHOW)', () => {
    const result = evaluateJobCompletion([
      shift(),
      shift({ actualStart: null, actualEnd: null, attendanceStatus: 'NO_SHOW' }),
    ]);
    expect(result.complete).toBe(true);
  });

  it('ignores backup workers who did not work', () => {
    const result = evaluateJobCompletion([
      shift(),
      shift({ assignmentRole: 'BACKUP', actualStart: null, actualEnd: null, attendanceStatus: 'SCHEDULED' }),
    ]);
    expect(result.complete).toBe(true);
  });

  it('completes even when a backup worked and clocked out', () => {
    expect(evaluateJobCompletion([shift(), shift({ assignmentRole: 'BACKUP' })]).complete).toBe(true);
  });

  it('ignores removed (non-approved) workers', () => {
    const result = evaluateJobCompletion([
      shift(),
      shift({ joinRequestStatus: 'CANCELLED', attendanceStatus: 'SCHEDULED', actualStart: null, actualEnd: null }),
    ]);
    expect(result.complete).toBe(true);
  });

  it('blocks on attendance awaiting owner review (auto clock-out)', () => {
    const result = evaluateJobCompletion([
      shift(),
      shift({ attendanceStatus: 'AUTO_CLOCKED_OUT', requiresReview: true }),
    ]);
    expect(result.complete).toBe(false);
    expect(result.blockingReasons).toContain('attendance awaiting owner review');
  });

  it('completes when an auto clock-out has been reviewed', () => {
    expect(
      evaluateJobCompletion([shift(), shift({ attendanceStatus: 'AUTO_CLOCKED_OUT', requiresReview: false })]).complete,
    ).toBe(true);
  });

  it('treats a team leader as a regular worker', () => {
    const result = evaluateJobCompletion([shift({ assignmentRole: 'TEAM_LEADER', attendanceStatus: 'CLOCKED_IN', actualEnd: null })]);
    expect(result.complete).toBe(false);
  });

  it('blocks completion for a worked backup who has not clocked out (§16.6)', () => {
    const result = evaluateJobCompletion([
      shift(),
      shift({ assignmentRole: 'BACKUP', attendanceStatus: 'CLOCKED_IN', actualEnd: null }),
    ]);
    expect(result.complete).toBe(false);
    expect(result.blockingReasons).toContain('a worker has not clocked out');
  });
});

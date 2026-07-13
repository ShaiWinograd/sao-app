import { describe, expect, it } from 'vitest';
import { evaluateJobPublishReadiness, type JobReadinessInput } from './job-readiness';

function baseInput(overrides: Partial<JobReadinessInput> = {}): JobReadinessInput {
  return {
    status: 'DRAFT',
    requiredWorkerCount: 2,
    slotCount: 2,
    plannedStart: '2026-08-01T08:00:00.000Z',
    plannedEnd: '2026-08-01T16:00:00.000Z',
    hasAddress: true,
    ...overrides,
  };
}

describe('evaluateJobPublishReadiness', () => {
  it('is ready when all checks pass', () => {
    const result = evaluateJobPublishReadiness(baseInput());
    expect(result.ready).toBe(true);
    expect(result.unmetReasons).toHaveLength(0);
    expect(result.checks.every((check) => check.passed)).toBe(true);
  });

  it('fails when the job is cancelled', () => {
    const result = evaluateJobPublishReadiness(baseInput({ status: 'CANCELLED' }));
    expect(result.ready).toBe(false);
    expect(result.checks.find((c) => c.key === 'notCancelled')?.passed).toBe(false);
  });

  it('fails when no workers are required', () => {
    const result = evaluateJobPublishReadiness(baseInput({ requiredWorkerCount: 0 }));
    expect(result.ready).toBe(false);
    expect(result.checks.find((c) => c.key === 'hasWorkerRequirement')?.passed).toBe(false);
    expect(result.checks.find((c) => c.key === 'slotsCoverRequirement')?.passed).toBe(false);
  });

  it('fails when slots do not cover the required workers', () => {
    const result = evaluateJobPublishReadiness(baseInput({ requiredWorkerCount: 3, slotCount: 2 }));
    expect(result.ready).toBe(false);
    expect(result.checks.find((c) => c.key === 'slotsCoverRequirement')?.passed).toBe(false);
  });

  it('fails when the time window is invalid', () => {
    const result = evaluateJobPublishReadiness(
      baseInput({ plannedStart: '2026-08-01T16:00:00.000Z', plannedEnd: '2026-08-01T08:00:00.000Z' }),
    );
    expect(result.ready).toBe(false);
    expect(result.checks.find((c) => c.key === 'validTimeWindow')?.passed).toBe(false);
  });

  it('fails when there is no address', () => {
    const result = evaluateJobPublishReadiness(baseInput({ hasAddress: false }));
    expect(result.ready).toBe(false);
    expect(result.unmetReasons).toContain('הוגדרה כתובת לעבודה');
  });

  it('accepts Date instances for the time window', () => {
    const result = evaluateJobPublishReadiness(
      baseInput({
        plannedStart: new Date('2026-08-01T08:00:00.000Z'),
        plannedEnd: new Date('2026-08-01T16:00:00.000Z'),
      }),
    );
    expect(result.ready).toBe(true);
  });
});

import { describe, expect, it } from 'vitest';
import { UserRole } from '@workforce/shared';
import { evaluateJobEditLock } from './jobEditLock.js';

const now = new Date('2026-09-23T12:00:00.000Z');

describe('evaluateJobEditLock', () => {
  it('allows normal admin edits for future active jobs', () => {
    expect(evaluateJobEditLock({
      status: 'APPROVED',
      date: new Date('2026-09-24T00:00:00.000Z'),
      now,
      role: UserRole.ADMIN,
      confirmed: false,
    })).toEqual({ allowed: true, locked: false });
  });

  it('requires the owner and explicit confirmation for past or completed jobs', () => {
    expect(evaluateJobEditLock({
      status: 'APPROVED',
      date: new Date('2026-09-22T00:00:00.000Z'),
      now,
      role: UserRole.ADMIN,
      confirmed: true,
    })).toMatchObject({ allowed: false, statusCode: 403, error: 'LOCKED_JOB_OWNER_REQUIRED' });

    expect(evaluateJobEditLock({
      status: 'COMPLETED',
      date: new Date('2026-09-24T00:00:00.000Z'),
      now,
      role: UserRole.OWNER,
      confirmed: false,
    })).toMatchObject({ allowed: false, statusCode: 409, error: 'LOCKED_JOB_CONFIRMATION_REQUIRED' });

    expect(evaluateJobEditLock({
      status: 'COMPLETED',
      date: new Date('2026-09-24T00:00:00.000Z'),
      now,
      role: UserRole.OWNER,
      confirmed: true,
    })).toEqual({ allowed: true, locked: true });
  });
});

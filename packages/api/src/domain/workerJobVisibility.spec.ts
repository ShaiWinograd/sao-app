import { describe, expect, it } from 'vitest';
import {
  isWorkerVisibleJob,
  workerInvitationsForJob,
  WORKER_VISIBLE_JOB_STATUS,
} from './workerJobVisibility.js';

describe('worker job visibility', () => {
  it('exposes only approved jobs to workers', () => {
    expect(WORKER_VISIBLE_JOB_STATUS).toBe('APPROVED');
    expect(isWorkerVisibleJob('APPROVED')).toBe(true);
    expect(isWorkerVisibleJob('RESERVATION')).toBe(false);
  });

  it('suppresses worker invitations while a job is reserved', () => {
    expect(workerInvitationsForJob('RESERVATION', ['worker-1', 'worker-2'])).toEqual([]);
    expect(workerInvitationsForJob('APPROVED', ['worker-1', 'worker-2'])).toEqual([
      'worker-1',
      'worker-2',
    ]);
  });
});

import { describe, expect, it } from 'vitest';
import { resolveJoinRequestPolicy } from './joinRequestPolicy.js';

const base = {
  requiredWorkerCount: 2,
  requiresLeader: false,
  approvedNormalCount: 0,
  approvedLeaderCount: 0,
  workerLeaderEligible: false,
};

describe('resolveJoinRequestPolicy', () => {
  it('keeps requests pending when owner approval is required', () => {
    expect(resolveJoinRequestPolicy({ ...base, staffingMode: 'MANAGER_APPROVAL' })).toEqual({
      ok: true,
      joinRequestStatus: 'PENDING',
      assignmentRole: 'REGULAR',
    });
  });

  it('auto-approves an open regular position', () => {
    expect(resolveJoinRequestPolicy({ ...base, staffingMode: 'AUTO_APPROVE' })).toEqual({
      ok: true,
      joinRequestStatus: 'APPROVED',
      assignmentRole: 'REGULAR',
    });
  });

  it('fills a reserved leader position only with an eligible worker', () => {
    expect(resolveJoinRequestPolicy({
      ...base,
      staffingMode: 'AUTO_APPROVE',
      requiredWorkerCount: 1,
      requiresLeader: true,
      workerLeaderEligible: true,
    })).toMatchObject({ ok: true, joinRequestStatus: 'APPROVED', assignmentRole: 'TEAM_LEADER' });

    expect(resolveJoinRequestPolicy({
      ...base,
      staffingMode: 'AUTO_APPROVE',
      requiredWorkerCount: 1,
      requiresLeader: true,
      workerLeaderEligible: false,
    })).toMatchObject({ ok: false, code: 'LEADER_SLOT_ONLY' });
  });
});

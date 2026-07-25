import { describe, expect, it } from 'vitest';
import { decideDirectAssignment } from './direct-assign';

const base = {
  requiredWorkerCount: 1,
  requiresLeader: false,
  reservedRegular: 0,
  reservedLeader: 0,
  workerLeaderEligible: true,
};

describe('decideDirectAssignment', () => {
  it('reserves the first regular position, then rejects a second one (capacity full)', () => {
    // 1 required, no reservations → the first direct regular assign is allowed.
    expect(decideDirectAssignment({ ...base, role: 'REGULAR', reservedRegular: 0 }).ok).toBe(true);
    // After it reserves the position (approved OR awaiting), a second is rejected.
    const second = decideDirectAssignment({ ...base, role: 'REGULAR', reservedRegular: 1 });
    expect(second.ok).toBe(false);
    expect(second.ok === false && second.code).toBe('JOB_FULL');
  });

  it('counts an approved slotId=null worker toward capacity', () => {
    // reservedRegular already 1 (an approved regular with no slot) → full.
    const d = decideDirectAssignment({ ...base, role: 'REGULAR', reservedRegular: 1 });
    expect(d.ok).toBe(false);
    expect(d.ok === false && d.code).toBe('JOB_FULL');
  });

  it('backups never reserve or fill a required position (always allowed)', () => {
    expect(decideDirectAssignment({ ...base, role: 'BACKUP', reservedRegular: 5 }).ok).toBe(true);
    // A backup does not change regular capacity: with 1 required and 0 regulars, a
    // regular assign is still allowed.
    expect(decideDirectAssignment({ ...base, role: 'REGULAR', reservedRegular: 0 }).ok).toBe(true);
  });

  it('allows only one team leader', () => {
    expect(decideDirectAssignment({ ...base, role: 'TEAM_LEADER', requiresLeader: true, reservedLeader: 0 }).ok).toBe(true);
    const taken = decideDirectAssignment({ ...base, role: 'TEAM_LEADER', requiresLeader: true, reservedLeader: 1 });
    expect(taken.ok).toBe(false);
    expect(taken.ok === false && taken.code).toBe('LEADER_TAKEN');
  });

  it('rejects a non-eligible worker as team leader', () => {
    const d = decideDirectAssignment({ ...base, role: 'TEAM_LEADER', requiresLeader: true, workerLeaderEligible: false });
    expect(d.ok).toBe(false);
    expect(d.ok === false && d.code).toBe('NOT_LEADER_ELIGIBLE');
  });

  it('reserves the leader position separately from regular capacity', () => {
    // 2 required, leader required → regularRequired = 1. A reserved leader does not
    // consume the single regular position.
    expect(
      decideDirectAssignment({ role: 'REGULAR', requiredWorkerCount: 2, requiresLeader: true, reservedRegular: 0, reservedLeader: 1, workerLeaderEligible: true }).ok,
    ).toBe(true);
    // …but once that regular position is reserved, the next regular is rejected.
    const full = decideDirectAssignment({ role: 'REGULAR', requiredWorkerCount: 2, requiresLeader: true, reservedRegular: 1, reservedLeader: 1, workerLeaderEligible: true });
    expect(full.ok).toBe(false);
    expect(full.ok === false && full.code).toBe('JOB_FULL');
  });
});

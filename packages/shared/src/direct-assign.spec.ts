import { describe, expect, it } from 'vitest';
import { decideDirectAssignment, type DirectAssignCapacityInput } from './direct-assign';

const base: Omit<DirectAssignCapacityInput, 'role'> = {
  requiredWorkerCount: 1,
  requiresLeader: false,
  reservedNonBackup: 0,
  reservedLeader: 0,
  workerLeaderEligible: true,
};

describe('decideDirectAssignment', () => {
  it('reserves the first regular position, then rejects a second one (capacity full)', () => {
    expect(decideDirectAssignment({ ...base, role: 'REGULAR', reservedNonBackup: 0 }).ok).toBe(true);
    const second = decideDirectAssignment({ ...base, role: 'REGULAR', reservedNonBackup: 1 });
    expect(second.ok).toBe(false);
    expect(second.ok === false && second.code).toBe('JOB_FULL');
  });

  it('counts an approved slotId=null worker toward capacity', () => {
    const d = decideDirectAssignment({ ...base, role: 'REGULAR', reservedNonBackup: 1 });
    expect(d.ok).toBe(false);
    expect(d.ok === false && d.code).toBe('JOB_FULL');
  });

  it('backups never reserve or fill a required position (always allowed)', () => {
    expect(decideDirectAssignment({ ...base, role: 'BACKUP', reservedNonBackup: 5 }).ok).toBe(true);
    expect(decideDirectAssignment({ ...base, role: 'REGULAR', reservedNonBackup: 0 }).ok).toBe(true);
  });

  it('allows only one team leader', () => {
    expect(
      decideDirectAssignment({ ...base, role: 'TEAM_LEADER', requiredWorkerCount: 2, requiresLeader: true, reservedNonBackup: 0, reservedLeader: 0 }).ok,
    ).toBe(true);
    const taken = decideDirectAssignment({ ...base, role: 'TEAM_LEADER', requiredWorkerCount: 2, requiresLeader: true, reservedNonBackup: 1, reservedLeader: 1 });
    expect(taken.ok).toBe(false);
    expect(taken.ok === false && taken.code).toBe('LEADER_TAKEN');
  });

  it('rejects a non-eligible worker as team leader', () => {
    const d = decideDirectAssignment({ ...base, role: 'TEAM_LEADER', requiresLeader: true, workerLeaderEligible: false });
    expect(d.ok).toBe(false);
    expect(d.ok === false && d.code).toBe('NOT_LEADER_ELIGIBLE');
  });

  // ── Total-capacity guard for leaders (blocker #1) ───────────────────────────

  it('rejects a leader when total capacity is already full with regulars (missing leader)', () => {
    // required 2, leader required, both positions reserved by regulars, no leader.
    const d = decideDirectAssignment({
      role: 'TEAM_LEADER',
      requiredWorkerCount: 2,
      requiresLeader: true,
      reservedNonBackup: 2, // two regulars
      reservedLeader: 0,
      workerLeaderEligible: true,
    });
    expect(d.ok).toBe(false);
    expect(d.ok === false && d.code).toBe('JOB_FULL');
  });

  it('allows a leader when one total position remains and the leader is missing', () => {
    const d = decideDirectAssignment({
      role: 'TEAM_LEADER',
      requiredWorkerCount: 2,
      requiresLeader: true,
      reservedNonBackup: 1, // one regular; one position free
      reservedLeader: 0,
      workerLeaderEligible: true,
    });
    expect(d.ok).toBe(true);
  });

  // ── Leader not required (blocker #2) ────────────────────────────────────────

  it('rejects a TEAM_LEADER assignment when the job does not require a leader', () => {
    const d = decideDirectAssignment({ ...base, role: 'TEAM_LEADER', requiresLeader: false });
    expect(d.ok).toBe(false);
    expect(d.ok === false && d.code).toBe('LEADER_NOT_REQUIRED');
  });
});

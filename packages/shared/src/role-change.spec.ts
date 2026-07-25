import { describe, it, expect } from 'vitest';
import { decideRoleChange, type RoleChangeInput } from './role-change';

const base: RoleChangeInput = {
  fromRole: 'REGULAR',
  toRole: 'REGULAR',
  requiredWorkerCount: 2,
  requiresLeader: true,
  reservedNonBackupOthers: 0,
  reservedLeaderOthers: 0,
  workerLeaderEligible: true,
  shiftReserves: true,
};

describe('decideRoleChange', () => {
  it('allows an eligible REGULAR → TEAM_LEADER on a full job without exceeding capacity', () => {
    // Full job: this shift + 1 other fill the 2 required positions.
    expect(decideRoleChange({ ...base, fromRole: 'REGULAR', toRole: 'TEAM_LEADER', reservedNonBackupOthers: 1 })).toEqual({ ok: true });
  });

  it('rejects an ineligible worker becoming TEAM_LEADER', () => {
    expect(decideRoleChange({ ...base, toRole: 'TEAM_LEADER', workerLeaderEligible: false, reservedNonBackupOthers: 1 })).toMatchObject({ ok: false, code: 'NOT_LEADER_ELIGIBLE' });
  });

  it('rejects a second leader when another leader is already reserved', () => {
    expect(decideRoleChange({ ...base, toRole: 'TEAM_LEADER', reservedLeaderOthers: 1, reservedNonBackupOthers: 1 })).toMatchObject({ ok: false, code: 'LEADER_TAKEN' });
  });

  it('rejects TEAM_LEADER on a job that does not require a leader', () => {
    expect(decideRoleChange({ ...base, toRole: 'TEAM_LEADER', requiresLeader: false, reservedNonBackupOthers: 1 })).toMatchObject({ ok: false, code: 'LEADER_NOT_REQUIRED' });
  });

  it('rejects BACKUP → TEAM_LEADER on a full job (consumes a required position)', () => {
    // A backup is not counted among the others; both required positions are held by others.
    expect(decideRoleChange({ ...base, fromRole: 'BACKUP', toRole: 'TEAM_LEADER', reservedNonBackupOthers: 2 })).toMatchObject({ ok: false, code: 'JOB_FULL' });
  });

  it('allows BACKUP → TEAM_LEADER when a position and the leader slot are free', () => {
    expect(decideRoleChange({ ...base, fromRole: 'BACKUP', toRole: 'TEAM_LEADER', reservedNonBackupOthers: 1 })).toEqual({ ok: true });
  });

  it('rejects BACKUP → REGULAR when the job is full', () => {
    expect(decideRoleChange({ ...base, fromRole: 'BACKUP', toRole: 'REGULAR', reservedNonBackupOthers: 2 })).toMatchObject({ ok: false, code: 'JOB_FULL' });
  });

  it('allows BACKUP → REGULAR when a required position is available', () => {
    expect(decideRoleChange({ ...base, fromRole: 'BACKUP', toRole: 'REGULAR', reservedNonBackupOthers: 1 })).toEqual({ ok: true });
  });

  it('preserves capacity for TEAM_LEADER → REGULAR (reopens the missing-leader state)', () => {
    // The other required position is filled; this shift stays non-backup so total is unchanged.
    expect(decideRoleChange({ ...base, fromRole: 'TEAM_LEADER', toRole: 'REGULAR', reservedNonBackupOthers: 1 })).toEqual({ ok: true });
  });

  it('is idempotent for REGULAR → REGULAR on a full job', () => {
    expect(decideRoleChange({ ...base, fromRole: 'REGULAR', toRole: 'REGULAR', reservedNonBackupOthers: 1 })).toEqual({ ok: true });
  });

  it('always allows converting to BACKUP (releases the required position)', () => {
    expect(decideRoleChange({ ...base, fromRole: 'TEAM_LEADER', toRole: 'BACKUP', reservedNonBackupOthers: 2 })).toEqual({ ok: true });
  });

  it('does not count a non-reserving (PENDING) shift toward capacity', () => {
    // shiftReserves=false → converting to a non-backup role adds nothing to reserved total.
    expect(decideRoleChange({ ...base, fromRole: 'REGULAR', toRole: 'REGULAR', reservedNonBackupOthers: 2, shiftReserves: false })).toEqual({ ok: true });
  });
});

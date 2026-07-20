import { describe, expect, it } from 'vitest';
import {
  findCommitmentConflict,
  decideApproval,
  orderBackupsForPromotion,
  nextBackupToPromote,
  validateCapacityReduction,
  hoursUntil,
  LEADER_SLOT_ONLY_WARNING,
  type CommitmentShift,
} from './staffing';

describe('findCommitmentConflict (§12.1, guard #13)', () => {
  const shift = (id: string, dateKey: string, status: CommitmentShift['joinRequestStatus']): CommitmentShift => ({
    id,
    dateKey,
    joinRequestStatus: status,
  });

  it('blocks on a pending join request that date', () => {
    const c = findCommitmentConflict('2026-08-01', { shifts: [shift('s1', '2026-08-01', 'PENDING')], isUnavailable: false });
    expect(c).toEqual({ code: 'ALREADY_COMMITTED', shiftId: 's1' });
  });

  it('blocks on a pending direct assignment (AWAITING_WORKER)', () => {
    const c = findCommitmentConflict('2026-08-01', { shifts: [shift('s1', '2026-08-01', 'AWAITING_WORKER')], isUnavailable: false });
    expect(c?.code).toBe('ALREADY_COMMITTED');
  });

  it('blocks on an approved assignment (regular/leader/backup all use APPROVED)', () => {
    const c = findCommitmentConflict('2026-08-01', { shifts: [shift('s1', '2026-08-01', 'APPROVED')], isUnavailable: false });
    expect(c?.code).toBe('ALREADY_COMMITTED');
  });

  it('does not block on rejected/cancelled shifts', () => {
    const c = findCommitmentConflict('2026-08-01', {
      shifts: [shift('s1', '2026-08-01', 'REJECTED'), shift('s2', '2026-08-01', 'CANCELLED')],
      isUnavailable: false,
    });
    expect(c).toBeNull();
  });

  it('ignores the shift being updated (ignoreShiftId)', () => {
    const c = findCommitmentConflict('2026-08-01', {
      shifts: [shift('s1', '2026-08-01', 'APPROVED')],
      isUnavailable: false,
      ignoreShiftId: 's1',
    });
    expect(c).toBeNull();
  });

  it('blocks on worker unavailability', () => {
    const c = findCommitmentConflict('2026-08-01', { shifts: [], isUnavailable: true });
    expect(c).toEqual({ code: 'UNAVAILABLE' });
  });

  it('blocks on a pending swap landing on that date', () => {
    const c = findCommitmentConflict('2026-08-01', {
      shifts: [],
      isUnavailable: false,
      pendingSwapTargets: [{ swapId: 'sw1', workerLandsOnDateKey: '2026-08-01' }],
    });
    expect(c).toEqual({ code: 'PENDING_SWAP', swapId: 'sw1' });
  });

  it('ignores the swap being executed (ignoreSwapId)', () => {
    const c = findCommitmentConflict('2026-08-01', {
      shifts: [],
      isUnavailable: false,
      pendingSwapTargets: [{ swapId: 'sw1', workerLandsOnDateKey: '2026-08-01' }],
      ignoreSwapId: 'sw1',
    });
    expect(c).toBeNull();
  });

  it('is free when nothing conflicts on that date', () => {
    const c = findCommitmentConflict('2026-08-02', {
      shifts: [shift('s1', '2026-08-01', 'APPROVED')],
      isUnavailable: false,
      pendingSwapTargets: [{ swapId: 'sw1', workerLandsOnDateKey: '2026-08-03' }],
    });
    expect(c).toBeNull();
  });
});

describe('decideApproval (§12.6, §12.7)', () => {
  const base = {
    requiredWorkerCount: 3,
    requiresLeader: false,
    approvedNormalCount: 0,
    approvedLeaderCount: 0,
    workerLeaderEligible: false,
    requestedRole: 'REGULAR' as const,
    confirmBackup: false,
  };

  it('assigns a regular when a normal slot is open', () => {
    expect(decideApproval(base)).toEqual({ outcome: 'ASSIGN', role: 'REGULAR' });
  });

  it('requires backup confirmation once the job is full', () => {
    const d = decideApproval({ ...base, approvedNormalCount: 3 });
    expect(d.outcome).toBe('NEEDS_BACKUP_CONFIRM');
    if (d.outcome === 'NEEDS_BACKUP_CONFIRM') expect(d.code).toBe('JOB_FULL');
  });

  it('assigns backup when full and owner confirms', () => {
    const d = decideApproval({ ...base, approvedNormalCount: 3, confirmBackup: true });
    expect(d.outcome).toBe('ASSIGN_BACKUP');
  });

  it('never auto-converts an explicit backup request without confirmation', () => {
    const d = decideApproval({ ...base, requestedRole: 'BACKUP' });
    expect(d.outcome).toBe('NEEDS_BACKUP_CONFIRM');
  });

  it('leader-only remaining slot: non-eligible worker must confirm backup with the exact warning', () => {
    // required 2, 1 regular approved, leader required and unfilled → only leader slot left
    const d = decideApproval({
      ...base,
      requiredWorkerCount: 2,
      requiresLeader: true,
      approvedNormalCount: 1,
      approvedLeaderCount: 0,
      workerLeaderEligible: false,
    });
    expect(d).toEqual({ outcome: 'NEEDS_BACKUP_CONFIRM', code: 'LEADER_SLOT_ONLY', message: LEADER_SLOT_ONLY_WARNING });
  });

  it('leader-only remaining slot: confirming backup assigns backup and keeps the leader requirement unmet', () => {
    const d = decideApproval({
      ...base,
      requiredWorkerCount: 2,
      requiresLeader: true,
      approvedNormalCount: 1,
      workerLeaderEligible: false,
      confirmBackup: true,
    });
    expect(d).toEqual({ outcome: 'ASSIGN_BACKUP', warning: LEADER_SLOT_ONLY_WARNING });
  });

  it('leader-only remaining slot: an eligible worker fills the reserved leader slot', () => {
    const d = decideApproval({
      ...base,
      requiredWorkerCount: 2,
      requiresLeader: true,
      approvedNormalCount: 1,
      workerLeaderEligible: true,
    });
    expect(d).toEqual({ outcome: 'ASSIGN', role: 'TEAM_LEADER' });
  });

  it('rejects a non-eligible worker requested explicitly as team leader', () => {
    const d = decideApproval({ ...base, requiresLeader: true, requestedRole: 'TEAM_LEADER', workerLeaderEligible: false });
    expect(d.outcome).toBe('REJECT');
  });

  it('rejects a second team leader', () => {
    const d = decideApproval({
      ...base,
      requiresLeader: true,
      requestedRole: 'TEAM_LEADER',
      workerLeaderEligible: true,
      approvedLeaderCount: 1,
    });
    if (d.outcome === 'REJECT') expect(d.code).toBe('LEADER_TAKEN');
    else throw new Error('expected reject');
  });

  it('assigns an eligible worker as team leader into a normal+leader job', () => {
    const d = decideApproval({
      ...base,
      requiredWorkerCount: 3,
      requiresLeader: true,
      requestedRole: 'TEAM_LEADER',
      workerLeaderEligible: true,
    });
    expect(d).toEqual({ outcome: 'ASSIGN', role: 'TEAM_LEADER' });
  });
});

describe('backup promotion order (§12.7, §13.2)', () => {
  it('promotes the earliest backup by assignment timestamp', () => {
    const backups = [
      { id: 'b2', assignedAt: 200 },
      { id: 'b1', assignedAt: 100 },
      { id: 'b3', assignedAt: 300 },
    ];
    expect(nextBackupToPromote(backups)?.id).toBe('b1');
    expect(orderBackupsForPromotion(backups).map((b) => b.id)).toEqual(['b1', 'b2', 'b3']);
  });

  it('is deterministic on ties (by id)', () => {
    const backups = [
      { id: 'bB', assignedAt: 100 },
      { id: 'bA', assignedAt: 100 },
    ];
    expect(nextBackupToPromote(backups)?.id).toBe('bA');
  });

  it('returns null with no backups', () => {
    expect(nextBackupToPromote([])).toBeNull();
  });
});

describe('validateCapacityReduction (§11.3, clarification #6)', () => {
  it('passes when capacity is not reduced below assignments', () => {
    expect(validateCapacityReduction({ newRequiredCount: 3, regularShiftIds: ['a', 'b'], demoteToBackupIds: [] }).ok).toBe(true);
  });

  it('requires the owner to choose exactly the excess workers as backups', () => {
    const r = validateCapacityReduction({ newRequiredCount: 1, regularShiftIds: ['a', 'b', 'c'], demoteToBackupIds: [] });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.code).toBe('MUST_SELECT_BACKUPS');
      expect(r.needed).toBe(2);
    }
  });

  it('accepts a valid backup selection matching the excess', () => {
    expect(
      validateCapacityReduction({ newRequiredCount: 1, regularShiftIds: ['a', 'b', 'c'], demoteToBackupIds: ['b', 'c'] }).ok,
    ).toBe(true);
  });

  it('rejects a selection that includes a non-assigned worker', () => {
    const r = validateCapacityReduction({ newRequiredCount: 1, regularShiftIds: ['a', 'b'], demoteToBackupIds: ['z'] });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('INVALID_SELECTION');
  });
});

describe('hoursUntil / 48h drop window (§13)', () => {
  it('computes hours to job start', () => {
    const now = new Date('2026-08-01T09:00:00Z');
    expect(hoursUntil(new Date('2026-08-03T09:00:00Z'), now)).toBe(48);
    expect(hoursUntil(new Date('2026-08-02T09:00:00Z'), now)).toBe(24);
  });
});

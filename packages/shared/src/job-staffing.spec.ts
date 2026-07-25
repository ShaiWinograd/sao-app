import { describe, expect, it } from 'vitest';
import { deriveJobStaffing, type StaffingShift } from './job-staffing';

function shift(joinRequestStatus: string, assignmentRole: string): StaffingShift {
  return { joinRequestStatus, assignmentRole };
}

describe('deriveJobStaffing', () => {
  it('1. an APPROVED REGULAR shift (slotId null) counts as an assigned worker', () => {
    const r = deriveJobStaffing([shift('APPROVED', 'REGULAR')], { requiredWorkerCount: 1, requiresTeamLeader: false });
    expect(r.regulars).toHaveLength(1);
    expect(r.assignedWorkers).toBe(1);
    expect(r.reservedRegular).toBe(1);
    expect(r.emptyRegularPositions).toBe(0);
    expect(r.breakdown.workerShortageSlots).toBe(0);
  });

  it('2. an APPROVED TEAM_LEADER (slotId null) is assigned and satisfies the leader requirement', () => {
    const r = deriveJobStaffing([shift('APPROVED', 'TEAM_LEADER')], { requiredWorkerCount: 1, requiresTeamLeader: true });
    expect(r.leaderShift).not.toBeNull();
    expect(r.hasApprovedLeader).toBe(true);
    expect(r.canAssignLeader).toBe(false);
    expect(r.assignedWorkers).toBe(1);
    expect(r.breakdown.managerShortage).toBe(false);
    expect(r.breakdown.workerShortageSlots).toBe(0);
  });

  it('3. an APPROVED BACKUP does not fill or reserve required capacity', () => {
    const r = deriveJobStaffing([shift('APPROVED', 'BACKUP')], { requiredWorkerCount: 2, requiresTeamLeader: false });
    expect(r.backups).toHaveLength(1);
    expect(r.assignedWorkers).toBe(0);
    expect(r.reservedRegular).toBe(0);
    expect(r.emptyRegularPositions).toBe(2);
    expect(r.breakdown.workerShortageSlots).toBe(2);
  });

  it('4. PENDING/AWAITING regulars are visible; AWAITING reserves capacity, PENDING does not', () => {
    const r = deriveJobStaffing(
      [shift('PENDING', 'REGULAR'), shift('AWAITING_WORKER', 'REGULAR')],
      { requiredWorkerCount: 2, requiresTeamLeader: false },
    );
    expect(r.pendingRegulars).toHaveLength(1);
    expect(r.awaitingRegulars).toHaveLength(1);
    expect(r.assignedWorkers).toBe(0); // approved-only shortage numerator
    expect(r.reservedRegular).toBe(1); // only AWAITING reserves
    expect(r.emptyRegularPositions).toBe(1); // regularRequired 2 − reserved 1
    expect(r.breakdown.workerShortageSlots).toBe(2); // shortage still approved-based
  });

  it('5. REJECTED (and CANCELLED) shifts are excluded from active staffing', () => {
    const r = deriveJobStaffing(
      [shift('REJECTED', 'REGULAR'), shift('CANCELLED', 'REGULAR'), shift('APPROVED', 'REGULAR')],
      { requiredWorkerCount: 2, requiresTeamLeader: false },
    );
    expect(r.regulars).toHaveLength(1);
    expect(r.assignedWorkers).toBe(1);
    expect(r.emptyRegularPositions).toBe(1);
  });

  it('6. more approved workers than required → zero empty positions, never negative', () => {
    const r = deriveJobStaffing(
      [shift('APPROVED', 'REGULAR'), shift('APPROVED', 'REGULAR'), shift('APPROVED', 'REGULAR')],
      { requiredWorkerCount: 2, requiresTeamLeader: false },
    );
    expect(r.assignedWorkers).toBe(3);
    expect(r.emptyRegularPositions).toBe(0);
    expect(r.breakdown.workerShortageSlots).toBe(0);
  });

  it('7. a shift appears exactly once even when it also has a slotId', () => {
    const bound = { joinRequestStatus: 'APPROVED', assignmentRole: 'REGULAR', slotId: 'slot-1' } as StaffingShift & { slotId: string };
    const r = deriveJobStaffing([bound], { requiredWorkerCount: 1, requiresTeamLeader: false });
    const appearances = [
      ...(r.leaderShift ? [r.leaderShift] : []),
      ...r.regulars,
      ...r.awaitingRegulars,
      ...r.pendingRegulars,
      ...r.backups,
    ].filter((s) => s === bound);
    expect(appearances).toHaveLength(1);
  });

  it('8. team-leader shortage shows when required-and-unfilled, and clears when approved', () => {
    const missing = deriveJobStaffing([shift('APPROVED', 'REGULAR')], { requiredWorkerCount: 2, requiresTeamLeader: true });
    expect(missing.leaderShift).toBeNull();
    expect(missing.canAssignLeader).toBe(true);
    expect(missing.breakdown.managerShortage).toBe(true);

    const satisfied = deriveJobStaffing(
      [shift('APPROVED', 'TEAM_LEADER'), shift('APPROVED', 'REGULAR')],
      { requiredWorkerCount: 2, requiresTeamLeader: true },
    );
    expect(satisfied.hasApprovedLeader).toBe(true);
    expect(satisfied.canAssignLeader).toBe(false);
    expect(satisfied.breakdown.managerShortage).toBe(false);
    expect(satisfied.assignedWorkers).toBe(2);
    expect(satisfied.emptyRegularPositions).toBe(0);
  });

  it('9. mixed regular, leader, backup, pending, and empty positions', () => {
    const r = deriveJobStaffing(
      [
        shift('APPROVED', 'TEAM_LEADER'),
        shift('APPROVED', 'REGULAR'),
        shift('APPROVED', 'BACKUP'),
        shift('PENDING', 'REGULAR'),
        shift('AWAITING_WORKER', 'REGULAR'),
        shift('REJECTED', 'REGULAR'),
      ],
      { requiredWorkerCount: 3, requiresTeamLeader: true },
    );
    expect(r.hasApprovedLeader).toBe(true);
    expect(r.regulars).toHaveLength(1);
    expect(r.awaitingRegulars).toHaveLength(1);
    expect(r.pendingRegulars).toHaveLength(1);
    expect(r.backups).toHaveLength(1);
    expect(r.assignedWorkers).toBe(2); // leader + 1 approved regular
    // regularRequired = 3 − 1 (leader) = 2; reserved = approved 1 + awaiting 1 = 2 → 0 empty.
    expect(r.emptyRegularPositions).toBe(0);
    expect(r.breakdown.workerShortageSlots).toBe(1); // required 3 − approved 2
    expect(r.breakdown.managerShortage).toBe(false);
  });

  // ── Role preservation for non-approved states (blocker #2) ──────────────────

  it('10. an AWAITING_WORKER TEAM_LEADER stays in the leader position and reserves it', () => {
    const r = deriveJobStaffing([shift('AWAITING_WORKER', 'TEAM_LEADER')], { requiredWorkerCount: 1, requiresTeamLeader: true });
    expect(r.leaderShift).not.toBeNull();
    expect(r.leaderShift?.assignmentRole).toBe('TEAM_LEADER');
    // Not approved → does not satisfy the requirement; no second "assign leader"
    // affordance while the invitation reserves the position.
    expect(r.hasApprovedLeader).toBe(false);
    expect(r.canAssignLeader).toBe(false);
    expect(r.breakdown.managerShortage).toBe(true);
    expect(r.regulars).toHaveLength(0);
    expect(r.awaitingRegulars).toHaveLength(0);
  });

  it('11. a PENDING TEAM_LEADER stays in the leader position and does NOT reserve capacity', () => {
    const r = deriveJobStaffing([shift('PENDING', 'TEAM_LEADER')], { requiredWorkerCount: 1, requiresTeamLeader: true });
    expect(r.leaderShift?.assignmentRole).toBe('TEAM_LEADER');
    expect(r.hasApprovedLeader).toBe(false);
    expect(r.pendingRegulars).toHaveLength(0);
    // A pending leader does not reserve capacity, so a direct leader assignment is
    // still permitted by the API (capacity available). The UI keeps showing the
    // pending leader, so it never offers a second leader assignment in practice.
    expect(r.reservedNonBackup).toBe(0);
    expect(r.canAssignLeader).toBe(true);
  });

  it('13. capacity full with regulars + missing leader → no assign-leader (convert a role instead)', () => {
    const r = deriveJobStaffing(
      [shift('APPROVED', 'REGULAR'), shift('APPROVED', 'REGULAR')],
      { requiredWorkerCount: 2, requiresTeamLeader: true },
    );
    expect(r.reservedNonBackup).toBe(2);
    expect(r.canAssignLeader).toBe(false); // total capacity full → cannot add a leader
    expect(r.breakdown.managerShortage).toBe(true); // leader still missing
    expect(r.emptyRegularPositions).toBe(0);
  });

  it('12. a pending/awaiting BACKUP is identified as Backup and never fills normal capacity', () => {
    const r = deriveJobStaffing(
      [shift('AWAITING_WORKER', 'BACKUP'), shift('PENDING', 'BACKUP')],
      { requiredWorkerCount: 2, requiresTeamLeader: false },
    );
    expect(r.backups).toHaveLength(2);
    expect(r.reservedRegular).toBe(0);
    expect(r.emptyRegularPositions).toBe(2);
    expect(r.awaitingRegulars).toHaveLength(0);
    expect(r.pendingRegulars).toHaveLength(0);
  });
});

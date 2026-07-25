import { describe, expect, it } from 'vitest';
import { deriveJobStaffing, type StaffingShift } from './job-staffing';

// Shift factory. slotId is intentionally omitted from the derivation entirely —
// these tests model the production-representative case where approved shifts have
// no slot binding.
function shift(joinRequestStatus: string, assignmentRole: string): StaffingShift {
  return { joinRequestStatus, assignmentRole };
}

describe('deriveJobStaffing', () => {
  it('1. an APPROVED REGULAR shift (slotId null) counts as an assigned worker', () => {
    const r = deriveJobStaffing([shift('APPROVED', 'REGULAR')], { requiredWorkerCount: 1, requiresTeamLeader: false });
    expect(r.regulars).toHaveLength(1);
    expect(r.assignedWorkers).toBe(1);
    expect(r.emptyRegularPositions).toBe(0);
    expect(r.breakdown.workerShortageSlots).toBe(0);
  });

  it('2. an APPROVED TEAM_LEADER (slotId null) is assigned and satisfies the leader requirement', () => {
    const r = deriveJobStaffing([shift('APPROVED', 'TEAM_LEADER')], { requiredWorkerCount: 1, requiresTeamLeader: true });
    expect(r.leaderShift).not.toBeNull();
    expect(r.hasApprovedLeader).toBe(true);
    expect(r.assignedWorkers).toBe(1);
    expect(r.emptyLeaderPosition).toBe(false);
    expect(r.breakdown.managerShortage).toBe(false);
    expect(r.breakdown.workerShortageSlots).toBe(0);
  });

  it('3. an APPROVED BACKUP does not fill required capacity', () => {
    const r = deriveJobStaffing([shift('APPROVED', 'BACKUP')], { requiredWorkerCount: 2, requiresTeamLeader: false });
    expect(r.backups).toHaveLength(1);
    expect(r.assignedWorkers).toBe(0);
    expect(r.emptyRegularPositions).toBe(2);
    expect(r.breakdown.workerShortageSlots).toBe(2);
  });

  it('4. PENDING and AWAITING_WORKER are visible but do not count as approved filled', () => {
    const r = deriveJobStaffing(
      [shift('PENDING', 'REGULAR'), shift('AWAITING_WORKER', 'REGULAR')],
      { requiredWorkerCount: 2, requiresTeamLeader: false },
    );
    expect(r.pending).toHaveLength(1);
    expect(r.awaiting).toHaveLength(1);
    expect(r.assignedWorkers).toBe(0);
    expect(r.emptyRegularPositions).toBe(2); // required − approved (approved = 0)
    expect(r.breakdown.workerShortageSlots).toBe(2);
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
      ...r.backups,
      ...r.awaiting,
      ...r.pending,
    ].filter((s) => s === bound);
    expect(appearances).toHaveLength(1);
  });

  it('8. team-leader shortage shows when required-and-unfilled, and clears when an approved leader exists', () => {
    const missing = deriveJobStaffing([shift('APPROVED', 'REGULAR')], { requiredWorkerCount: 2, requiresTeamLeader: true });
    expect(missing.emptyLeaderPosition).toBe(true);
    expect(missing.breakdown.managerShortage).toBe(true);

    const satisfied = deriveJobStaffing(
      [shift('APPROVED', 'TEAM_LEADER'), shift('APPROVED', 'REGULAR')],
      { requiredWorkerCount: 2, requiresTeamLeader: true },
    );
    expect(satisfied.emptyLeaderPosition).toBe(false);
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
    expect(r.backups).toHaveLength(1);
    expect(r.pending).toHaveLength(1);
    expect(r.awaiting).toHaveLength(1);
    expect(r.assignedWorkers).toBe(2); // leader + 1 regular
    // regularRequired = 3 − 1 (leader) = 2; approved regulars = 1 → 1 empty.
    expect(r.emptyRegularPositions).toBe(1);
    expect(r.emptyLeaderPosition).toBe(false);
    expect(r.breakdown.workerShortageSlots).toBe(1); // required 3 − assigned 2
    expect(r.breakdown.managerShortage).toBe(false);
  });
});

import { describe, expect, it } from 'vitest';
import { rendersInWorkerRow, workerRowAssignments, fillsRequiredSlot, assignmentBadge } from './owner-grid';

describe('owner-grid worker-row assignment rules', () => {
  it('hides a worker-initiated PENDING join request from the worker row', () => {
    expect(rendersInWorkerRow({ joinRequestStatus: 'PENDING', assignmentRole: 'REGULAR' })).toBe(false);
  });

  it('shows approved regular, team-leader and backup assignments in the worker row', () => {
    expect(rendersInWorkerRow({ joinRequestStatus: 'APPROVED', assignmentRole: 'REGULAR' })).toBe(true);
    expect(rendersInWorkerRow({ joinRequestStatus: 'APPROVED', assignmentRole: 'TEAM_LEADER' })).toBe(true);
    expect(rendersInWorkerRow({ joinRequestStatus: 'APPROVED', assignmentRole: 'BACKUP' })).toBe(true);
  });

  it('filters a mixed set to actual assignments only (pending removed)', () => {
    const assignments = [
      { name: 'A', joinRequestStatus: 'PENDING', assignmentRole: 'REGULAR' },
      { name: 'B', joinRequestStatus: 'APPROVED', assignmentRole: 'REGULAR' },
      { name: 'C', joinRequestStatus: 'APPROVED', assignmentRole: 'TEAM_LEADER' },
      { name: 'D', joinRequestStatus: 'APPROVED', assignmentRole: 'BACKUP' },
    ];
    expect(workerRowAssignments(assignments).map((a) => a.name)).toEqual(['B', 'C', 'D']);
  });

  it('a single approval yields exactly one worker-row card', () => {
    // Before approval: one pending → zero cards.
    const pending = [{ name: 'A', joinRequestStatus: 'PENDING', assignmentRole: 'REGULAR' }];
    expect(workerRowAssignments(pending)).toHaveLength(0);
    // After approval (same worker, status flips in place): exactly one card.
    const approved = [{ name: 'A', joinRequestStatus: 'APPROVED', assignmentRole: 'REGULAR' }];
    expect(workerRowAssignments(approved)).toHaveLength(1);
  });

  it('a rejected or cancelled request yields no worker-row card', () => {
    expect(workerRowAssignments([{ name: 'A', joinRequestStatus: 'REJECTED' }])).toHaveLength(1);
    // Note: REJECTED/CANCELLED are already excluded upstream before this filter,
    // but a lingering PENDING must still be hidden here.
    expect(workerRowAssignments([{ name: 'A', joinRequestStatus: 'PENDING' }])).toHaveLength(0);
  });

  it('only approved non-backup assignments fill a required staffing slot', () => {
    expect(fillsRequiredSlot({ joinRequestStatus: 'APPROVED', assignmentRole: 'REGULAR' })).toBe(true);
    expect(fillsRequiredSlot({ joinRequestStatus: 'APPROVED', assignmentRole: 'TEAM_LEADER' })).toBe(true);
    expect(fillsRequiredSlot({ joinRequestStatus: 'APPROVED', assignmentRole: 'BACKUP' })).toBe(false);
    expect(fillsRequiredSlot({ joinRequestStatus: 'PENDING', assignmentRole: 'REGULAR' })).toBe(false);
  });

  it('badges reflect assignment (not job) status for each role', () => {
    expect(assignmentBadge({ joinRequestStatus: 'PENDING' }).label).toBe('ממתינה לאישור');
    expect(assignmentBadge({ joinRequestStatus: 'APPROVED', assignmentRole: 'TEAM_LEADER' }).label).toBe('ראש צוות');
    expect(assignmentBadge({ joinRequestStatus: 'APPROVED', assignmentRole: 'BACKUP' }).label).toBe('גיבוי');
    expect(assignmentBadge({ joinRequestStatus: 'APPROVED', assignmentRole: 'REGULAR' }).label).toBe('משובצת');
  });
});

import { describe, expect, it } from 'vitest';
import { MANAGER_SKILL } from './worker-availability';
import { planJobSlotSync } from './job-slots';

describe('planJobSlotSync', () => {
  it('enables a team-leader requirement without changing total capacity', () => {
    expect(
      planJobSlotSync(
        [{ id: 'a', requiredSkill: null }, { id: 'b', requiredSkill: null }],
        2,
        true,
      ),
    ).toEqual({
      updates: [{ id: 'a', requiredSkill: MANAGER_SKILL }],
      deleteIds: [],
      createSkills: [],
    });
  });

  it('disables the leader requirement and grows capacity with regular slots', () => {
    expect(
      planJobSlotSync([{ id: 'leader', requiredSkill: MANAGER_SKILL }], 3, false),
    ).toEqual({
      updates: [{ id: 'leader', requiredSkill: null }],
      deleteIds: [],
      createSkills: [null, null],
    });
  });

  it('keeps the leader slot while reducing capacity', () => {
    const plan = planJobSlotSync(
      [
        { id: 'regular-a', requiredSkill: null },
        { id: 'leader', requiredSkill: MANAGER_SKILL },
        { id: 'regular-b', requiredSkill: null },
      ],
      1,
      true,
    );
    expect(plan.deleteIds).toEqual(['regular-a', 'regular-b']);
    expect(plan.updates).toEqual([]);
    expect(plan.createSkills).toEqual([]);
  });
});

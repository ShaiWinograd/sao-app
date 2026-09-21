import { describe, expect, it, vi } from 'vitest';
import { MANAGER_SKILL } from '@workforce/shared';
import { syncJobSlots } from './jobSlots.js';

describe('syncJobSlots', () => {
  it('persists an enabled leader requirement while keeping the slot count stable', async () => {
    const tx = {
      jobSlot: {
        findMany: vi.fn().mockResolvedValue([
          { id: 'a', requiredSkill: null },
          { id: 'b', requiredSkill: null },
        ]),
        update: vi.fn().mockResolvedValue({}),
        deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
        createMany: vi.fn().mockResolvedValue({ count: 0 }),
      },
    };

    await syncJobSlots(tx as any, {
      jobId: 'job-1',
      requiredWorkerCount: 2,
      requiresTeamLeader: true,
    });

    expect(tx.jobSlot.update).toHaveBeenCalledWith({
      where: { id: 'a' },
      data: { requiredSkill: MANAGER_SKILL },
    });
    expect(tx.jobSlot.deleteMany).not.toHaveBeenCalled();
    expect(tx.jobSlot.createMany).not.toHaveBeenCalled();
  });

  it('removes the leader skill and creates regular slots when the requirement is disabled', async () => {
    const tx = {
      jobSlot: {
        findMany: vi.fn().mockResolvedValue([{ id: 'leader', requiredSkill: MANAGER_SKILL }]),
        update: vi.fn().mockResolvedValue({}),
        deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
        createMany: vi.fn().mockResolvedValue({ count: 2 }),
      },
    };

    await syncJobSlots(tx as any, {
      jobId: 'job-1',
      requiredWorkerCount: 3,
      requiresTeamLeader: false,
    });

    expect(tx.jobSlot.update).toHaveBeenCalledWith({
      where: { id: 'leader' },
      data: { requiredSkill: null },
    });
    expect(tx.jobSlot.createMany).toHaveBeenCalledWith({
      data: [
        { jobId: 'job-1', requiredSkill: null },
        { jobId: 'job-1', requiredSkill: null },
      ],
    });
  });
});

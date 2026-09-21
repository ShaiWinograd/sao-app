import { MANAGER_SKILL } from './worker-availability';

export type ExistingJobSlot = {
  id: string;
  requiredSkill?: string | null;
};

export type JobSlotSyncPlan = {
  updates: Array<{ id: string; requiredSkill: string | null }>;
  deleteIds: string[];
  createSkills: Array<string | null>;
};

export function planJobSlotSync(
  existingSlots: ExistingJobSlot[],
  requiredWorkerCount: number,
  requiresTeamLeader: boolean,
): JobSlotSyncPlan {
  const desiredCount = Math.max(1, Math.floor(requiredWorkerCount));
  const slots = existingSlots.map((slot) => ({ ...slot, requiredSkill: slot.requiredSkill ?? null }));
  const updates: JobSlotSyncPlan['updates'] = [];

  const leaderSlots = slots.filter((slot) => slot.requiredSkill === MANAGER_SKILL);
  if (requiresTeamLeader) {
    if (leaderSlots.length === 0 && slots.length > 0) {
      const promoted = slots.find((slot) => slot.requiredSkill === null) ?? slots[0];
      promoted.requiredSkill = MANAGER_SKILL;
      updates.push({ id: promoted.id, requiredSkill: MANAGER_SKILL });
    }
    for (const extraLeader of leaderSlots.slice(1)) {
      extraLeader.requiredSkill = null;
      updates.push({ id: extraLeader.id, requiredSkill: null });
    }
  } else {
    for (const leader of leaderSlots) {
      leader.requiredSkill = null;
      updates.push({ id: leader.id, requiredSkill: null });
    }
  }

  const protectedLeaderId = requiresTeamLeader
    ? slots.find((slot) => slot.requiredSkill === MANAGER_SKILL)?.id
    : undefined;
  const deleteIds =
    slots.length > desiredCount
      ? slots
          .filter((slot) => slot.id !== protectedLeaderId)
          .slice(0, slots.length - desiredCount)
          .map((slot) => slot.id)
      : [];
  const remainingCount = slots.length - deleteIds.length;
  const createSkills = Array.from(
    { length: Math.max(0, desiredCount - remainingCount) },
    (_, index) =>
      requiresTeamLeader && !protectedLeaderId && index === 0 ? MANAGER_SKILL : null,
  );

  return { updates, deleteIds, createSkills };
}

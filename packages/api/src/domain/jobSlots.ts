import type { Prisma, WorkerSkill } from '@prisma/client';
import { planJobSlotSync } from '@workforce/shared';

export async function syncJobSlots(
  tx: Prisma.TransactionClient,
  input: { jobId: string; requiredWorkerCount: number; requiresTeamLeader: boolean },
): Promise<void> {
  const existingSlots = await tx.jobSlot.findMany({
    where: { jobId: input.jobId },
    select: { id: true, requiredSkill: true },
    orderBy: { id: 'asc' },
  });
  const plan = planJobSlotSync(
    existingSlots,
    input.requiredWorkerCount,
    input.requiresTeamLeader,
  );

  for (const update of plan.updates) {
    await tx.jobSlot.update({
      where: { id: update.id },
      data: { requiredSkill: update.requiredSkill as WorkerSkill | null },
    });
  }
  if (plan.deleteIds.length > 0) {
    await tx.jobSlot.deleteMany({ where: { id: { in: plan.deleteIds } } });
  }
  if (plan.createSkills.length > 0) {
    await tx.jobSlot.createMany({
      data: plan.createSkills.map((requiredSkill) => ({
        jobId: input.jobId,
        requiredSkill: requiredSkill as WorkerSkill | null,
      })),
    });
  }
}

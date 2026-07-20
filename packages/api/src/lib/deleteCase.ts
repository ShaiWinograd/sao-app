import { Prisma } from '@prisma/client';

/**
 * Hard-delete a customer case and every record that depends on it, children
 * first, so no foreign-key constraint blocks the delete. Must run inside a
 * transaction (pass the tx client) so a partial failure rolls back cleanly.
 */
export async function deleteCaseCascade(tx: Prisma.TransactionClient, caseId: string): Promise<void> {
  // Shift-scoped records (attendance, forms, location, replacements)
  await tx.attendanceCorrection.deleteMany({ where: { shift: { job: { caseId } } } });
  await tx.locationCheck.deleteMany({ where: { shift: { job: { caseId } } } });
  await tx.replacementRequest.deleteMany({ where: { shift: { job: { caseId } } } });
  await tx.formSubmission.deleteMany({ where: { shift: { job: { caseId } } } });

  // Job-scoped records
  await tx.jobSlot.deleteMany({ where: { job: { caseId } } });
  await tx.shift.deleteMany({ where: { job: { caseId } } });
  await tx.jobExpense.deleteMany({ where: { job: { caseId } } });

  // Case-scoped records
  await tx.job.deleteMany({ where: { caseId } });

  await tx.customerCase.delete({ where: { id: caseId } });
}

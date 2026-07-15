import { Prisma } from '@prisma/client';

/**
 * Hard-delete a customer case and every record that depends on it, children
 * first, so no foreign-key constraint blocks the delete. Must run inside a
 * transaction (pass the tx client) so a partial failure rolls back cleanly.
 */
export async function deleteCaseCascade(tx: Prisma.TransactionClient, caseId: string): Promise<void> {
  // Quotations
  await tx.quotationSend.deleteMany({ where: { version: { quotation: { caseId } } } });
  await tx.quotationVersion.deleteMany({ where: { quotation: { caseId } } });
  await tx.quotation.deleteMany({ where: { caseId } });

  // Shift-scoped records (attendance, forms, location, replacements)
  await tx.attendanceCorrection.deleteMany({ where: { shift: { job: { caseId } } } });
  await tx.locationCheck.deleteMany({ where: { shift: { job: { caseId } } } });
  await tx.replacementRequest.deleteMany({ where: { shift: { job: { caseId } } } });
  await tx.formSubmission.deleteMany({ where: { shift: { job: { caseId } } } });

  // Job-scoped records
  await tx.jobSlot.deleteMany({ where: { job: { caseId } } });
  await tx.shift.deleteMany({ where: { job: { caseId } } });
  await tx.invoiceItem.deleteMany({ where: { OR: [{ invoice: { caseId } }, { job: { caseId } }] } });
  await tx.jobExpense.deleteMany({ where: { job: { caseId } } });

  // Case-scoped records
  await tx.invoice.deleteMany({ where: { caseId } });
  await tx.workerAdjustment.deleteMany({ where: { caseId } });
  await tx.job.deleteMany({ where: { caseId } });
  await tx.plannedServiceComponent.deleteMany({ where: { caseId } });

  await tx.customerCase.delete({ where: { id: caseId } });
}

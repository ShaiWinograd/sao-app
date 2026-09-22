export const WORKER_VISIBLE_JOB_STATUS = 'APPROVED' as const;

export function isWorkerVisibleJob(status: string): boolean {
  return status === WORKER_VISIBLE_JOB_STATUS;
}

export function workerInvitationsForJob(status: string, workerIds: string[]): string[] {
  return isWorkerVisibleJob(status) ? workerIds : [];
}

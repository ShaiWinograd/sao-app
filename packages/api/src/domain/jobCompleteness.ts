export type CompletableJob = {
  date: Date | null;
  plannedStart: Date | null;
  plannedEnd: Date | null;
  requiredWorkerCount: number | null;
  customer: { firstName: string | null; isSystem?: boolean | null } | null;
  address: { fullAddress: string | null } | null;
};

export function getJobCompletenessIssues(job: CompletableJob): string[] {
  const issues: string[] = [];
  if (!job.customer || job.customer.isSystem || !job.customer.firstName?.trim()) {
    issues.push('לקוח אמיתי עם שם');
  }
  if (!job.address?.fullAddress?.trim()) {
    issues.push('כתובת');
  }
  if (!job.date || Number.isNaN(job.date.getTime())) {
    issues.push('תאריך');
  }
  if (
    !job.plannedStart ||
    !job.plannedEnd ||
    Number.isNaN(job.plannedStart.getTime()) ||
    Number.isNaN(job.plannedEnd.getTime()) ||
    job.plannedEnd <= job.plannedStart
  ) {
    issues.push('שעות התחלה וסיום');
  }
  if (!job.requiredWorkerCount || job.requiredWorkerCount < 1) {
    issues.push('מספר עובדות נדרש');
  }
  return issues;
}

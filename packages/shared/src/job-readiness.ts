export type JobReadinessInput = {
  status: string;
  requiredWorkerCount: number;
  slotCount: number;
  plannedStart: Date | string;
  plannedEnd: Date | string;
  hasAddress: boolean;
};

export type JobReadinessCheckKey =
  | 'notCancelled'
  | 'hasWorkerRequirement'
  | 'slotsCoverRequirement'
  | 'validTimeWindow'
  | 'hasAddress';

export type JobReadinessCheck = {
  key: JobReadinessCheckKey;
  label: string;
  passed: boolean;
};

export type JobReadinessResult = {
  ready: boolean;
  checks: JobReadinessCheck[];
  unmetReasons: string[];
};

const CHECK_LABELS: Record<JobReadinessCheckKey, string> = {
  notCancelled: 'העבודה אינה מבוטלת',
  hasWorkerRequirement: 'הוגדר מספר עובדים נדרש',
  slotsCoverRequirement: 'הוגדרו מספיק עמדות לכל העובדים הנדרשים',
  validTimeWindow: 'שעת הסיום מאוחרת משעת ההתחלה',
  hasAddress: 'הוגדרה כתובת לעבודה',
};

function toTime(value: Date | string): number {
  return value instanceof Date ? value.getTime() : new Date(value).getTime();
}

export function evaluateJobPublishReadiness(input: JobReadinessInput): JobReadinessResult {
  const start = toTime(input.plannedStart);
  const end = toTime(input.plannedEnd);

  const passedByKey: Record<JobReadinessCheckKey, boolean> = {
    notCancelled: input.status !== 'CANCELLED',
    hasWorkerRequirement: input.requiredWorkerCount >= 1,
    slotsCoverRequirement:
      input.requiredWorkerCount >= 1 && input.slotCount >= input.requiredWorkerCount,
    validTimeWindow: Number.isFinite(start) && Number.isFinite(end) && end > start,
    hasAddress: input.hasAddress,
  };

  const checks = (Object.keys(CHECK_LABELS) as JobReadinessCheckKey[]).map((key) => ({
    key,
    label: CHECK_LABELS[key],
    passed: passedByKey[key],
  }));

  const unmetReasons = checks.filter((check) => !check.passed).map((check) => check.label);

  return {
    ready: unmetReasons.length === 0,
    checks,
    unmetReasons,
  };
}

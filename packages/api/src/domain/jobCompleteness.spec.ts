import { describe, expect, it } from 'vitest';
import { getJobCompletenessIssues } from './jobCompleteness.js';

const completeJob = {
  date: new Date('2026-10-01T00:00:00.000Z'),
  plannedStart: new Date('2026-10-01T09:00:00.000Z'),
  plannedEnd: new Date('2026-10-01T14:00:00.000Z'),
  requiredWorkerCount: 2,
  customer: { firstName: 'נועה', isSystem: false },
  address: { fullAddress: 'הרצל 10, תל אביב' },
};

describe('getJobCompletenessIssues', () => {
  it('accepts a complete job record', () => {
    expect(getJobCompletenessIssues(completeJob)).toEqual([]);
  });

  it('reports customer, address, schedule, and staffing gaps', () => {
    expect(getJobCompletenessIssues({
      ...completeJob,
      customer: { firstName: '', isSystem: true },
      address: { fullAddress: ' ' },
      plannedEnd: new Date('2026-10-01T08:00:00.000Z'),
      requiredWorkerCount: 0,
    })).toEqual([
      'לקוח אמיתי עם שם',
      'כתובת',
      'שעות התחלה וסיום',
      'מספר עובדות נדרש',
    ]);
  });
});

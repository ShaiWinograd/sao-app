import { describe, it, expect } from 'vitest';
import { computeApprovedScheduleStatus } from './schedule-status';

describe('computeApprovedScheduleStatus', () => {
  it('is APPROVED_NO_DATES when nothing is scheduled', () => {
    expect(computeApprovedScheduleStatus(['PACKING', 'UNPACKING'], [])).toBe('APPROVED_NO_DATES');
    expect(computeApprovedScheduleStatus([], [])).toBe('APPROVED_NO_DATES');
  });

  it('is READY_FOR_EXECUTION when every planned type is scheduled', () => {
    expect(computeApprovedScheduleStatus(['PACKING', 'UNPACKING'], ['PACKING', 'UNPACKING'])).toBe(
      'READY_FOR_EXECUTION',
    );
  });

  it('is PARTIALLY_SCHEDULED when some planned types are still missing', () => {
    expect(computeApprovedScheduleStatus(['PACKING', 'UNPACKING'], ['PACKING'])).toBe(
      'PARTIALLY_SCHEDULED',
    );
  });

  it('is READY_FOR_EXECUTION when there are no planned components but work is scheduled', () => {
    expect(computeApprovedScheduleStatus([], ['PACKING'])).toBe('READY_FOR_EXECUTION');
  });

  it('ignores extra scheduled types not in the plan', () => {
    expect(
      computeApprovedScheduleStatus(['PACKING'], ['PACKING', 'HOME_ORGANIZATION']),
    ).toBe('READY_FOR_EXECUTION');
  });
});

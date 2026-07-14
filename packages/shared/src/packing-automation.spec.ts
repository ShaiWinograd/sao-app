import { describe, expect, it } from 'vitest';
import { computePackingFormSchedule } from './packing-automation';

describe('computePackingFormSchedule', () => {
  it('waits when there is no packing date', () => {
    expect(
      computePackingFormSchedule({ firstPackingDate: null, quotationApproved: true, alreadySent: false, today: '2026-07-14' }),
    ).toEqual({ state: 'no_packing_date', sendDate: null });
  });

  it('waits for quotation approval', () => {
    expect(
      computePackingFormSchedule({ firstPackingDate: '2026-08-01', quotationApproved: false, alreadySent: false, today: '2026-07-14' }),
    ).toEqual({ state: 'awaiting_approval', sendDate: null });
  });

  it('schedules the send seven days before packing', () => {
    const result = computePackingFormSchedule({
      firstPackingDate: '2026-08-01',
      quotationApproved: true,
      alreadySent: false,
      today: '2026-07-14',
    });
    expect(result.state).toBe('scheduled');
    expect(result.sendDate).toBe('2026-07-25');
  });

  it('is due now when seven or fewer days remain', () => {
    const result = computePackingFormSchedule({
      firstPackingDate: '2026-08-01',
      quotationApproved: true,
      alreadySent: false,
      today: '2026-07-28',
    });
    expect(result.state).toBe('due_now');
  });

  it('does not resend once already sent', () => {
    expect(
      computePackingFormSchedule({ firstPackingDate: '2026-08-01', quotationApproved: true, alreadySent: true, today: '2026-07-28' }),
    ).toEqual({ state: 'already_sent', sendDate: null });
  });
});

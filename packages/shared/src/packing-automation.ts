// Packing-supplies form automation timing (business_app_ux_spec §8).
// The form is sent 7 days before the first packing job, after the quotation is
// approved; immediately after approval when 7 or fewer days remain; only once a
// packing date exists; and never re-sent automatically once already sent.

export type PackingFormScheduleInput = {
  firstPackingDate: string | null;
  quotationApproved: boolean;
  alreadySent: boolean;
  today: string;
};

export type PackingFormScheduleState =
  | 'already_sent'
  | 'no_packing_date'
  | 'awaiting_approval'
  | 'due_now'
  | 'scheduled';

export type PackingFormSchedule = {
  state: PackingFormScheduleState;
  sendDate: string | null;
};

const LEAD_DAYS = 7;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

function toDateKey(value: string): string {
  return value.length > 10 ? value.slice(0, 10) : value;
}

export function computePackingFormSchedule(input: PackingFormScheduleInput): PackingFormSchedule {
  if (input.alreadySent) return { state: 'already_sent', sendDate: null };
  if (!input.firstPackingDate) return { state: 'no_packing_date', sendDate: null };
  if (!input.quotationApproved) return { state: 'awaiting_approval', sendDate: null };

  const packing = new Date(`${toDateKey(input.firstPackingDate)}T00:00:00.000Z`);
  const today = new Date(`${toDateKey(input.today)}T00:00:00.000Z`);
  if (Number.isNaN(packing.getTime()) || Number.isNaN(today.getTime())) {
    return { state: 'no_packing_date', sendDate: null };
  }

  const sendDate = new Date(packing.getTime() - LEAD_DAYS * MS_PER_DAY);
  const sendDateKey = sendDate.toISOString().slice(0, 10);

  // 7 or fewer days remain (today is on/after the computed send date) → send now.
  if (today.getTime() >= sendDate.getTime()) {
    return { state: 'due_now', sendDate: sendDateKey };
  }
  return { state: 'scheduled', sendDate: sendDateKey };
}

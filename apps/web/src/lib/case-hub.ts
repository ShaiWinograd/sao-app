export type EndShiftFormStatus = 'הושלם' | 'הושלם חלקית' | 'חסר מידע';
export type EndShiftJobType = 'אריזה' | 'פריקה' | 'סידור בית';

export type EndShiftFormLink = {
  id: string;
  workerName: string;
  jobType: EndShiftJobType;
  customerName: string;
  caseName: string;
  shiftDate: string;
  completedAt: string;
  status: EndShiftFormStatus;
  hasPhotos: boolean;
  followUp: boolean;
};

const CASE_FORMS_STORAGE_KEY = 'spaceorder_case_end_shift_forms_v1';

export function normalizeHebrewName(value: string) {
  return value.trim().replace(/\s+/g, ' ');
}

export function getCaseNameForCustomerAndDate(customerName: string, shiftDate: string) {
  const normalizedCustomer = normalizeHebrewName(customerName);
  const [, month, year] = shiftDate.split('/').map(Number);
  if (!month || !year) {
    return `${normalizedCustomer} - יולי 2026`;
  }
  const monthLabel = month >= 7 ? 'יולי' : 'יוני';
  return `${normalizedCustomer} - ${monthLabel} ${year}`;
}

export function loadCaseEndShiftForms(): EndShiftFormLink[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(CASE_FORMS_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as EndShiftFormLink[];
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (item) =>
        typeof item.id === 'string' &&
        typeof item.workerName === 'string' &&
        typeof item.customerName === 'string' &&
        typeof item.caseName === 'string' &&
        typeof item.shiftDate === 'string',
    );
  } catch (error) {
    console.error('Failed to parse case end-shift forms from localStorage', error);
    return [];
  }
}

export function saveCaseEndShiftForms(forms: EndShiftFormLink[]) {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(CASE_FORMS_STORAGE_KEY, JSON.stringify(forms));
}

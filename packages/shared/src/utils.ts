// Date formatting utilities (Hebrew / Israeli format)

/** Format a date as DD/MM/YYYY */
export function formatDate(date: Date | string): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  const day = String(d.getDate()).padStart(2, '0');
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const year = d.getFullYear();
  return `${day}/${month}/${year}`;
}

/** Format a time as HH:mm (24-hour) */
export function formatTime(date: Date | string): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  const hours = String(d.getHours()).padStart(2, '0');
  const minutes = String(d.getMinutes()).padStart(2, '0');
  return `${hours}:${minutes}`;
}

/** Format an Israeli phone number */
export function formatPhone(phone: string): string {
  const digits = phone.replace(/\D/g, '');
  if (digits.length === 10) {
    return `${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6)}`;
  }
  return phone;
}

/** Format currency in ₪ */
export function formatCurrency(amount: number): string {
  return new Intl.NumberFormat('he-IL', {
    style: 'currency',
    currency: 'ILS',
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(amount);
}

/** Calculate distance between two coordinates in meters (Haversine) */
export function distanceInMeters(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  const R = 6371000;
  const φ1 = (lat1 * Math.PI) / 180;
  const φ2 = (lat2 * Math.PI) / 180;
  const Δφ = ((lat2 - lat1) * Math.PI) / 180;
  const Δλ = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(Δφ / 2) ** 2 + Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) ** 2;
  return 2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/** Get month/year label in Hebrew */
export function getMonthLabel(month: number, year: number): string {
  const months = [
    'ינואר', 'פברואר', 'מרץ', 'אפריל', 'מאי', 'יוני',
    'יולי', 'אוגוסט', 'ספטמבר', 'אוקטובר', 'נובמבר', 'דצמבר',
  ];
  return `${months[month - 1]} ${year}`;
}

/** Returns true if a shift can still accept a replacement request (>12h before start) */
export function canRequestReplacement(shiftStart: Date | string): boolean {
  const start = typeof shiftStart === 'string' ? new Date(shiftStart) : shiftStart;
  const hoursUntilStart = (start.getTime() - Date.now()) / (1000 * 60 * 60);
  return hoursUntilStart > 12;
}

/** Build a default case name from customer name, job type, and date */
export function buildDefaultCaseName(
  customerFullName: string,
  jobTypeLabel: string,
  date: Date | string
): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  const months = [
    'ינואר', 'פברואר', 'מרץ', 'אפריל', 'מאי', 'יוני',
    'יולי', 'אוגוסט', 'ספטמבר', 'אוקטובר', 'נובמבר', 'דצמבר',
  ];
  return `${customerFullName} – ${jobTypeLabel} – ${months[d.getMonth()]} ${d.getFullYear()}`;
}

export type SupportedJobType = 'PACKING' | 'UNPACKING' | 'HOME_ORGANIZATION';

export type ProjectClassification =
  | 'אריזה'
  | 'פריקה'
  | 'סידור'
  | 'מעבר דירה'
  | 'פרויקט מותאם אישית';

/**
 * Spec-aligned service combination classification.
 * Supported combinations are:
 * - Packing only
 * - Unpacking only
 * - Organizing only
 * - Packing + Unpacking (Moving project)
 */
export function classifyProjectFromJobTypes(jobTypes: SupportedJobType[]): ProjectClassification {
  const hasPacking = jobTypes.includes('PACKING');
  const hasUnpacking = jobTypes.includes('UNPACKING');
  const hasOrganizing = jobTypes.includes('HOME_ORGANIZATION');

  if (hasPacking && hasUnpacking) return 'מעבר דירה';
  if (hasPacking && !hasUnpacking && !hasOrganizing) return 'אריזה';
  if (!hasPacking && hasUnpacking && !hasOrganizing) return 'פריקה';
  if (!hasPacking && !hasUnpacking && hasOrganizing) return 'סידור';
  return 'פרויקט מותאם אישית';
}

/**
 * Returns a user-facing validation message when trying to add an unsupported
 * job type to the current project service mix.
 */
export function validateServiceAddition(
  existingJobTypes: SupportedJobType[],
  nextJobType: SupportedJobType,
): string | null {
  const hasPacking = existingJobTypes.includes('PACKING');
  const hasUnpacking = existingJobTypes.includes('UNPACKING');
  const hasOrganizing = existingJobTypes.includes('HOME_ORGANIZATION');

  if (nextJobType === 'HOME_ORGANIZATION' && hasUnpacking) {
    return 'שירות פריקה כבר כולל סידור של התכולה שנפרקה. ניתן להוסיף יום פריקה נוסף או ליצור פרויקט סידור נפרד.';
  }

  if (nextJobType === 'UNPACKING' && hasOrganizing) {
    return 'פריקה וסידור עצמאי מנוהלים כפרויקטים נפרדים. יש ליצור פרויקט פריקה/מעבר נפרד.';
  }

  if (nextJobType === 'PACKING' && hasOrganizing) {
    return 'אריזה לא מתווספת אוטומטית לפרויקט סידור. יש ליצור פרויקט אריזה/מעבר נפרד.';
  }

  // Moving projects support packing+unpacking only as the core combination.
  if (nextJobType === 'HOME_ORGANIZATION' && hasPacking && hasUnpacking) {
    return 'בפרויקט מעבר דירה נתמכים אריזה ופריקה בלבד. לסידור עצמאי יש לפתוח פרויקט נפרד.';
  }

  return null;
}

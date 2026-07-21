// Centralized owner-readable Hebrew labels for audit-log `reason` codes.
//
// The database keeps the raw reason codes (technical traceability). The owner UI
// must never show those internal identifiers — it renders these Hebrew labels
// instead, and any unknown/new code falls back to a safe generic label rather
// than leaking raw text.

export const AUDIT_REASON_FALLBACK = 'עדכון פעילות';

export const AUDIT_REASON_LABELS: Record<string, string> = {
  // Jobs
  'quick-created': 'העבודה נוצרה',
  'created+published': 'העבודה נוצרה ופורסמה',
  approve: 'העבודה אושרה',
  'return-to-reservation': 'העבודה הוחזרה לשריון',
  archive: 'העבודה הועברה לארכיון',
  republish: 'העבודה נשלחה שוב לעובדות',
  'capacity-reduced': 'כמות העובדות עודכנה',
  'manual-complete': 'העבודה סומנה כבוצעה',
  'manual-complete:worked': 'העובדת סומנה כמי שעבדה',
  'manual-complete:did-not-work': 'העובדת סומנה כמי שלא עבדה',
  'auto-complete': 'העבודה הושלמה אוטומטית',

  // Attendance
  'clock-out': 'יציאה מהמשמרת',
  'area-exit': 'יציאה מאזור העבודה',
  'area-return': 'חזרה לאזור העבודה',

  // Join requests / assignment
  'join-request': 'העובדת ביקשה להצטרף',
  'join-rejected': 'בקשת ההצטרפות נדחתה',
  approved: 'בקשת ההצטרפות אושרה',
  'approved-as-backup': 'העובדת אושרה כגיבוי',
  'direct-assign': 'שיבוץ ישיר של עובדת',
  'assignment-accepted': 'העובדת אישרה את השיבוץ',
  'assignment-declined': 'העובדת דחתה את השיבוץ',
  'join-request-cancelled': 'העובדת ביטלה את בקשת ההצטרפות',
  'admin-remove': 'העובדת הוסרה מהעבודה',
  'role-change': 'תפקיד העובדת עודכן',
  'backup-promoted': 'גיבוי קודמה לשיבוץ מלא',
  'backup-auto-promoted': 'גיבוי שובצה אוטומטית',
  'drop-within-48h': 'ביטול שיבוץ (פחות מ-48 שעות)',

  // Replacements / swaps
  'replacement-request': 'הוגשה בקשת החלפה',
  reassigned: 'בוצע שיבוץ מחדש',
  'swap-proposed': 'הוצעה החלפת משמרות',
  'worker-rejected': 'העובדת דחתה את ההחלפה',
  'worker-approved': 'העובדת אישרה את ההחלפה',

  // Forms
  'form-submit': 'טופס סיום הוגש',
  'form-edit': 'טופס סיום עודכן',

  // Customer report
  'customer-report:finalized': 'דוח הלקוחה הופק',
  'customer-report:corrected': 'נוצרה גרסה מתוקנת לדוח',
  'customer-report:excluded-jobs-moved': 'עבודות שלא נכללו הועברו לתיק חדש',
  // Aliases (defensive — in case a shorter code is ever emitted)
  'report-finalized': 'דוח הלקוחה הופק',
  'report-corrected': 'נוצרה גרסה מתוקנת לדוח',

  // Worker monthly report
  'report-published': 'הדוח החודשי פורסם',
};

/** Owner-readable Hebrew label for an audit reason code (safe fallback, never raw). */
export function auditReasonLabel(reason?: string | null): string {
  if (!reason) return AUDIT_REASON_FALLBACK;
  return AUDIT_REASON_LABELS[reason] ?? AUDIT_REASON_FALLBACK;
}

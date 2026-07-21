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

/**
 * Actor-aware, full-sentence Hebrew description of an audit event. Centralized so
 * pages never hardcode names or sentence templates. `actorName` is who performed
 * the action; `subjectName` is the affected worker/customer (resolved by the API
 * from durable snapshot names). When a needed name is missing it degrades to a
 * safe subject-less sentence rather than an incorrect generic subject, and an
 * unknown reason still never exposes the raw event code.
 */
export function formatAuditEvent(input: {
  reason?: string | null;
  actorName?: string | null;
  subjectName?: string | null;
}): string {
  const actor = (input.actorName ?? '').trim() || null;
  const subject = (input.subjectName ?? '').trim() || null;
  const reason = input.reason ?? '';

  switch (reason) {
    case 'quick-created':
      return actor ? `${actor} יצרה את העבודה` : 'העבודה נוצרה';
    case 'created+published':
      return actor ? `${actor} יצרה ופרסמה את העבודה` : 'העבודה נוצרה ופורסמה';
    case 'approve':
      return actor ? `${actor} אישרה את העבודה` : 'העבודה אושרה';
    case 'republish':
      return actor ? `${actor} שלחה את העבודה שוב לעובדות` : 'העבודה נשלחה שוב לעובדות';
    case 'return-to-reservation':
      return actor ? `${actor} החזירה את העבודה לשריון` : 'העבודה הוחזרה לשריון';
    case 'archive':
      return actor ? `${actor} העבירה את העבודה לארכיון` : 'העבודה הועברה לארכיון';

    case 'join-request':
      return subject ? `${subject} ביקשה להצטרף לעבודה` : 'בקשת הצטרפות נשלחה';
    case 'approved':
      if (actor && subject) return `${actor} אישרה את בקשת ההצטרפות של ${subject}`;
      if (subject) return `בקשת ההצטרפות של ${subject} אושרה`;
      return 'בקשת ההצטרפות אושרה';
    case 'approved-as-backup':
      if (actor && subject) return `${actor} שיבצה את ${subject} כגיבוי`;
      if (subject) return `${subject} שובצה כגיבוי`;
      return 'העובדת שובצה כגיבוי';
    case 'join-rejected':
      if (actor && subject) return `${actor} דחתה את בקשת ההצטרפות של ${subject}`;
      if (subject) return `בקשת ההצטרפות של ${subject} נדחתה`;
      return 'בקשת ההצטרפות נדחתה';
    case 'direct-assign':
      if (actor && subject) return `${actor} שיבצה את ${subject} לעבודה`;
      if (subject) return `${subject} שובצה לעבודה`;
      return 'בוצע שיבוץ לעבודה';
    case 'assignment-accepted':
      return subject ? `${subject} אישרה את השיבוץ` : 'השיבוץ אושר';
    case 'assignment-declined':
      return subject ? `${subject} דחתה את השיבוץ` : 'השיבוץ נדחה';
    case 'join-request-cancelled':
      return subject ? `${subject} ביטלה את בקשת ההצטרפות` : 'בקשת ההצטרפות בוטלה';
    case 'admin-remove':
      if (actor && subject) return `${actor} הסירה את ${subject} מהעבודה`;
      if (subject) return `${subject} הוסרה מהעבודה`;
      return 'העובדת הוסרה מהעבודה';
    case 'role-change':
      return subject ? `תפקיד של ${subject} עודכן` : 'תפקיד העובדת עודכן';

    case 'manual-complete:worked':
      if (actor && subject) return `${actor} סימנה ש${subject} עבדה`;
      if (subject) return `${subject} סומנה כמי שעבדה`;
      return 'סומן שהעובדת עבדה';
    case 'manual-complete:did-not-work':
      if (actor && subject) return `${actor} סימנה ש${subject} לא עבדה`;
      if (subject) return `${subject} סומנה כמי שלא עבדה`;
      return 'סומן שהעובדת לא עבדה';
    case 'manual-complete':
      return actor ? `${actor} סימנה את העבודה כבוצעה` : 'העבודה סומנה כבוצעה';
    case 'auto-complete':
      return 'העבודה הושלמה אוטומטית';

    case 'customer-report:finalized':
    case 'report-finalized':
      return actor ? `${actor} הפיקה את דוח הלקוחה` : 'דוח הלקוחה הופק';
    case 'customer-report:corrected':
    case 'report-corrected':
      return actor ? `${actor} יצרה גרסה מתוקנת לדוח` : 'נוצרה גרסה מתוקנת לדוח';

    default:
      // Never expose the raw code — fall back to the plain localized label.
      return auditReasonLabel(reason);
  }
}

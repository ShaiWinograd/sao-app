// Hebrew UI translations for all shared enums and labels
// Used by both web dashboard and mobile app

export const HE = {
  // ─── Navigation ───────────────────────────────────────────────────
  nav: {
    dashboard: 'לוח בקרה',
    schedule: 'לוח שנה',
    jobs: 'עבודות',
    staffing: 'שיבוץ צוות',
    joinRequests: 'בקשות הצטרפות',
    replacementRequests: 'בקשות החלפה',
    customers: 'לקוחות',
    customerCase: 'פרוייקט',
    projectBoard: 'לוח פרוייקטים',
    quotations: 'הצעות מחיר',
    workers: 'עובדים',
    attendance: 'נוכחות',
    forms: 'טפסי סיום משמרת',
    invoices: 'חשבוניות',
    customerPayments: 'תשלומי לקוחות',
    workerPayroll: 'שכר עובדים',
    workerPayments: 'תשלומי עובדים',
    expenses: 'הוצאות עסקיות',
    reports: 'דוחות חודשיים',
    profitability: 'רווחיות',
    settings: 'הגדרות',
    userManagement: 'ניהול משתמשים',
    auditLog: 'יומן פעולות',
  },

  // ─── General actions ──────────────────────────────────────────────
  actions: {
    save: 'שמור',
    cancel: 'ביטול',
    edit: 'עריכה',
    delete: 'מחיקה',
    approve: 'אישור',
    reject: 'דחייה',
    create: 'צור',
    add: 'הוסף',
    close: 'סגור',
    reopen: 'פתח מחדש',
    export: 'ייצוא',
    generatePdf: 'צור PDF',
    search: 'חיפוש',
    filter: 'סינון',
    confirm: 'אישור',
    submit: 'שליחה',
    view: 'צפייה',
    back: 'חזרה',
    next: 'הבא',
    previous: 'הקודם',
  },

  // ─── Worker mobile actions ────────────────────────────────────────
  worker: {
    startShift: 'התחלת משמרת',
    endShift: 'סיום משמרת',
    requestReplacement: 'בקשת החלפה',
    openJobs: 'עבודות פתוחות',
    pendingApproval: 'ממתין לאישור',
    fullyBooked: 'העבודה מלאה',
    myShifts: 'המשמרות שלי',
    myHistory: 'ההיסטוריה שלי',
    myPayments: 'התשלומים שלי',
    requestToJoin: 'בקשה להצטרף',
    shiftForm: 'טופס סיום משמרת',
    notifications: 'התראות',
    profile: 'פרופיל',
    contactManager: 'אנא פנה למנהל ישירות',
  },

  // ─── Job type labels ──────────────────────────────────────────────
  jobType: {
    PACKING: 'אריזה',
    UNPACKING: 'פריקה',
    HOME_ORGANIZATION: 'ארגון הבית',
  },

  // ─── Job status labels ────────────────────────────────────────────
  jobStatus: {
    RESERVATION: 'שריון',
    APPROVED: 'אושר',
    COMPLETED: 'בוצע',
    ARCHIVED: 'בארכיון',
  },

  // ─── Case status labels ───────────────────────────────────────────
  caseStatus: {
    DRAFT: 'טיוטה',
    ACTIVE: 'פעיל',
    READY_FOR_REVIEW: 'ממתין לסקירה סופית',
    COMPLETED: 'הושלם',
  },

  // ─── Staffing mode labels ─────────────────────────────────────────
  staffingMode: {
    AUTO_APPROVE: 'אישור אוטומטי – ראשון שמגיע',
    MANAGER_APPROVAL: 'דרוש אישור מנהל',
  },

  // ─── Join request status ──────────────────────────────────────────
  joinRequestStatus: {
    PENDING: 'ממתין',
    APPROVED: 'מאושר',
    REJECTED: 'נדחה',
    WAITLISTED: 'ברשימת המתנה',
    CANCELLED: 'בוטל',
  },

  // ─── Assignment role ──────────────────────────────────────────────
  assignmentRole: {
    REGULAR: 'עובד',
    TEAM_LEADER: 'ראש צוות',
    BACKUP: 'מחליף',
  },

  // ─── Worker skills ────────────────────────────────────────────────
  workerSkill: {
    SHIFT_LEADER: 'ראש צוות',
    PACKING_SPECIALIST: 'מומחה אריזה',
    UNPACKING_SPECIALIST: 'מומחה פריקה',
    ORGANIZATION_SPECIALIST: 'מומחה ארגון',
    DRIVER: 'נהג',
    GENERAL_WORKER: 'עובד כללי',
  },

  // ─── Invoice status ───────────────────────────────────────────────
  invoiceStatus: {
    NOT_INVOICED: 'לא חויב',
    DRAFT: 'טיוטה',
    SENT: 'נשלח',
    PARTIALLY_PAID: 'שולם חלקית',
    PAID: 'שולם',
    OVERDUE: 'באיחור',
    CANCELLED: 'בוטל',
  },

  // ─── Payment method ───────────────────────────────────────────────
  paymentMethod: {
    BANK_TRANSFER: 'העברה בנקאית',
    CASH: 'מזומן',
    BIT: 'ביט',
    CHECK: "צ'ק",
    OTHER: 'אחר',
  },

  // ─── Address labels ───────────────────────────────────────────────
  addressLabel: {
    OLD_APARTMENT: 'דירה ישנה',
    NEW_APARTMENT: 'דירה חדשה',
    STORAGE: 'מחסן',
    OFFICE: 'משרד',
    OTHER: 'אחר',
  },

  // ─── Billing model ────────────────────────────────────────────────
  billingModel: {
    HOURLY: 'לפי שעה',
    FIXED: 'מחיר קבוע',
    CUSTOM: 'מותאם אישית',
  },

  // ─── Attendance status ────────────────────────────────────────────
  attendanceStatus: {
    SCHEDULED: 'מתוזמן',
    CLOCKED_IN: 'נכנס',
    CLOCKED_OUT: 'יצא',
    NO_SHOW: 'לא הגיע',
    CORRECTED: 'תוקן',
    AUTO_CLOCKED_OUT: 'יצא אוטומטית',
  },

  // ─── Completion status ────────────────────────────────────────────
  completionStatus: {
    COMPLETED: 'הושלם',
    PARTIALLY_COMPLETED: 'הושלם חלקית',
    NOT_COMPLETED: 'לא הושלם',
  },

  // ─── Expense categories ───────────────────────────────────────────
  expenseCategory: {
    SOFTWARE: 'תוכנה ומנויים',
    MARKETING: 'שיווק',
    INSURANCE: 'ביטוח',
    ACCOUNTANT: 'רואה חשבון',
    OFFICE: 'הוצאות משרד',
    EQUIPMENT: 'ציוד',
    VEHICLE: 'רכב',
    PARKING: 'חניה',
    SUPPLIES: 'חומרים ואביזרים',
    OTHER: 'אחר',
  },

  // ─── Adjustment categories ────────────────────────────────────────
  adjustmentCategory: {
    CUSTOMER_REFERRAL: 'הבאת לקוח',
    SHIFT_LEADER_BONUS: 'תוספת ראש צוות',
    SPECIAL_ASSIGNMENT_BONUS: 'תוספת משימה מיוחדת',
    TRAVEL_REIMBURSEMENT: 'החזר נסיעות',
    EXTRA_RESPONSIBILITY: 'תוספת אחריות',
    CORRECTION: 'תיקון',
    DEDUCTION: 'ניכוי',
  },

  // ─── Notifications ────────────────────────────────────────────────
  notifications: {
    newJobPublished: 'עבודה חדשה פורסמה',
    applicationReceived: 'התקבלה בקשת הצטרפות',
    applicationApproved: 'בקשתך אושרה',
    applicationRejected: 'בקשתך נדחתה',
    shiftReminder: 'תזכורת משמרת',
    shiftChanged: 'משמרת שונתה',
    shiftCancelled: 'משמרת בוטלה',
    replacementRequested: 'התקבלה בקשת החלפה',
    replacementApproved: 'בקשת ההחלפה אושרה',
    replacementRejected: 'בקשת ההחלפה נדחתה',
    missingClockIn: 'לא נרשמה כניסה למשמרת',
    outsideLocation: 'נראה שאתה מחוץ לאזור העבודה. האם אתה מסיים את המשמרת?',
    autoClockOutWarning: 'יצאת אוטומטית מהמשמרת. נדרשת בדיקת מנהל.',
    missingForm: 'טופס סיום משמרת לא הוגש',
    jobFullyStaffed: 'כל העובדים שובצו למשמרת',
    shiftLeaderRequired: 'נדרש ראש צוות',
    caseReadyForReport: 'תיק הלקוח מוכן לסקירה סופית',
    invoiceDue: 'חשבונית לתשלום',
    paymentOverdue: 'תשלום חשבונית באיחור',
    workerPaymentReady: 'תשלום עובד מוכן',
  },

  // ─── Reporting ────────────────────────────────────────────────────
  reports: {
    monthlyReport: 'דוח חודשי',
    workerReport: 'דוח עובד',
    customerReport: 'דוח לקוח',
    profitabilityReport: 'דוח רווחיות',
    cashBasis: 'בסיס מזומן',
    accrualBasis: 'בסיס צבירה',
  },

  // ─── Field labels ─────────────────────────────────────────────────
  fields: {
    firstName: 'שם פרטי',
    lastName: 'שם משפחה',
    fullName: 'שם מלא',
    phone: 'טלפון',
    email: 'אימייל',
    address: 'כתובת',
    date: 'תאריך',
    startTime: 'שעת התחלה',
    endTime: 'שעת סיום',
    hours: 'שעות',
    amount: 'סכום',
    notes: 'הערות',
    status: 'סטטוס',
    worker: 'עובד',
    customer: 'לקוח',
    case: 'תיק',
    job: 'עבודה',
    shift: 'משמרת',
    month: 'חודש',
    year: 'שנה',
    hourlyRate: 'תעריף שעתי',
    dailyPayment: 'תשלום יומי',
    totalAmount: 'סה"כ',
    balance: 'יתרה',
    invoiceTotal: 'סה"כ חשבונית',
    paid: 'שולם',
    outstanding: 'יתרה לתשלום',
    vatIncluded: 'כולל מע"מ',
    internalNotes: 'הערות פנימיות',
  },

  // ─── Messages ─────────────────────────────────────────────────────
  messages: {
    activeCase: 'ללקוח זה יש תיק פעיל. להוסיף את העבודה לתיק הקיים?',
    recentCase: 'נמצא תיק שהסתיים לאחרונה עבור לקוח זה. להוסיף את העבודה אליו או לפתוח תיק חדש?',
    addToExistingCase: 'הוסף לתיק הקיים',
    reopenAndAdd: 'פתח מחדש והוסף לתיק',
    createNewCase: 'צור תיק חדש',
    duplicateCustomerWarning: 'נמצא לקוח דומה. האם להשתמש בלקוח הקיים?',
    caseReadyForReview: 'כל ימי העבודה בתיק זה הסתיימו. בדוק וצור דוח סופי.',
    locationBlocked: 'לא ניתן להתחיל משמרת. התקרב למיקום העבודה או פנה למנהל.',
    shiftFormPending: 'עליך להגיש טופס סיום משמרת לפני שתוכל לסגור את המשמרת.',
    replacementTooLate: 'פנה למנהל ישירות – פחות מ-12 שעות עד תחילת המשמרת.',
    monthClosed: 'החודש נסגר. לפתיחה מחדש יש לפנות לבעל העסק.',
  },

  // ─── Currency ─────────────────────────────────────────────────────
  currency: {
    symbol: '₪',
    name: 'שקל',
  },
} as const;

export type HEType = typeof HE;

export type ProjectCommunicationTemplateKey =
  | 'quote'
  | 'packing_form'
  | 'move_reminder'
  | 'completion_summary';

export type ProjectCommunicationChannel = 'whatsapp' | 'email';

export type ProjectCommunicationTemplate = {
  key: ProjectCommunicationTemplateKey;
  title: string;
  description: string;
  defaultChannel: ProjectCommunicationChannel;
  isEnabled: boolean;
  disabledReason?: string;
  subject: string;
  body: string;
};

export type ProjectCommunicationLogEntry = {
  id: string;
  caseId: string;
  templateKey: ProjectCommunicationTemplateKey;
  channel: ProjectCommunicationChannel;
  recipient: string;
  sentAt: string;
  preview: string;
  performedByName?: string;
};

export type ProjectCommunicationContext = {
  customerName: string;
  caseName: string;
  quoteHours: number;
  quoteRate: number;
  quoteTotalLabel: string;
  quoteApproved: boolean;
  isMovingProject: boolean;
  firstJobDateLabel?: string | null;
  firstPackingDateLabel?: string | null;
  packingFormAutoSendDateLabel?: string | null;
};

export function communicationTemplateTitle(key: ProjectCommunicationTemplateKey) {
  if (key === 'quote') return 'הצעת מחיר';
  if (key === 'packing_form') return 'טופס ציוד אריזה';
  if (key === 'move_reminder') return 'תזכורת לפני מעבר';
  return 'סיכום וסגירת פרוייקט';
}

export function communicationChannelLabel(channel: ProjectCommunicationChannel) {
  return channel === 'whatsapp' ? 'וואטסאפ' : 'אימייל';
}

export function buildProjectCommunicationTemplates(context: ProjectCommunicationContext): ProjectCommunicationTemplate[] {
  const quoteBody =
    `היי ${context.customerName},\n` +
    `מצורפת הצעת המחיר עבור "${context.caseName}":\n` +
    `${context.quoteHours} שעות × ${context.quoteRate} ₪ לשעה = ${context.quoteTotalLabel}.\n\n` +
    'נשמח לאישור כדי להתקדם לתיאום סופי.\n' +
    'תודה,\nצוות Space & Order';

  const packingBody =
    `היי ${context.customerName},\n` +
    `לקראת פרוייקט "${context.caseName}" מצורף טופס ציוד האריזה למילוי.\n` +
    'נשמח לקבל את הטופס בהקדם כדי להיערך בצורה מיטבית.\n\n' +
    'תודה רבה,\nצוות Space & Order';

  const reminderBody =
    `היי ${context.customerName},\n` +
    `תזכורת ידידותית לקראת תחילת פרוייקט "${context.caseName}"${context.firstJobDateLabel ? ` בתאריך ${context.firstJobDateLabel}` : ''}.\n` +
    'הכנו עבורך הודעת היערכות מסודרת ונשלח את הנוסח המעודכן בהמשך.\n' +
    'אנחנו כאן לכל שאלה, ויחד נעבור את זה בצורה רגועה ומסודרת.\n\n' +
    'בהצלחה,\nצוות Space & Order';

  const completionBody =
    `היי ${context.customerName},\n` +
    `בשעה טובה סיימנו את פרוייקט "${context.caseName}".\n` +
    'מצורף סיכום העבודה והעלות הסופית.\n' +
    'תודה שבחרתם בנו, ונשמח לעזור גם בהמשך.\n\n' +
    'באהבה,\nצוות Space & Order';

  return [
    {
      key: 'quote',
      title: communicationTemplateTitle('quote'),
      description: 'שליחת הצעת המחיר לאישור הלקוח.',
      defaultChannel: 'whatsapp',
      isEnabled: true,
      subject: `הצעת מחיר - ${context.caseName}`,
      body: quoteBody,
    },
    {
      key: 'packing_form',
      title: communicationTemplateTitle('packing_form'),
      description: 'טופס ציוד אריזה ללקוח לאחר אישור הצעה.',
      defaultChannel: 'email',
      isEnabled: context.quoteApproved && Boolean(context.firstPackingDateLabel),
      disabledReason: !context.quoteApproved
        ? 'הטופס נשלח רק לאחר אישור הצעת מחיר.'
        : 'אין בפרוייקט עבודת אריזה.',
      subject: `טופס ציוד אריזה - ${context.caseName}`,
      body:
        packingBody +
        (context.packingFormAutoSendDateLabel
          ? `\n\nתזמון מומלץ: ${context.packingFormAutoSendDateLabel}.`
          : ''),
    },
    {
      key: 'move_reminder',
      title: communicationTemplateTitle('move_reminder'),
      description: 'תזכורת יומיים לפני תחילת העבודה (מעבר דירה).',
      defaultChannel: 'whatsapp',
      isEnabled: context.isMovingProject && Boolean(context.firstJobDateLabel),
      disabledReason: context.isMovingProject
        ? 'חסר תאריך התחלת עבודה.'
        : 'רלוונטי רק לפרוייקט מעבר דירה.',
      subject: `תזכורת לפני המעבר - ${context.caseName}`,
      body: reminderBody,
    },
    {
      key: 'completion_summary',
      title: communicationTemplateTitle('completion_summary'),
      description: 'הודעת סיכום וברכה לאחר סיום העבודה.',
      defaultChannel: 'whatsapp',
      isEnabled: true,
      subject: `סיכום פרוייקט - ${context.caseName}`,
      body: completionBody,
    },
  ];
}

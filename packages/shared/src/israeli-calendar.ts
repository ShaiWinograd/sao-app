const HEBREW_DATE = new Intl.DateTimeFormat('en-u-ca-hebrew', {
  day: 'numeric',
  month: 'long',
  timeZone: 'Asia/Jerusalem',
});

const HOLIDAYS = new Map([
  ['Tishri-1', 'ראש השנה'],
  ['Tishri-2', 'ראש השנה'],
  ['Tishri-10', 'יום כיפור'],
  ['Tishri-15', 'סוכות'],
  ['Tishri-22', 'שמחת תורה'],
  ['Nisan-15', 'פסח'],
  ['Nisan-21', 'שביעי של פסח'],
  ['Sivan-6', 'שבועות'],
]);

export function israeliNonWorkingDayName(date: Date): string | null {
  if (date.getDay() === 6) return 'שבת';

  const businessDate = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate(), 12));
  const parts = HEBREW_DATE.formatToParts(businessDate);
  const day = parts.find((part) => part.type === 'day')?.value;
  const month = parts.find((part) => part.type === 'month')?.value;
  if (!day || !month) return null;
  return HOLIDAYS.get(`${month}-${day}`) ?? null;
}

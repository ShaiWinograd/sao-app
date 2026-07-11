export type JobType = 'אריזה' | 'פריקה' | 'סידור';

export type ImportedWorkSeed = {
  shortDate: string; // D.M
  customerName: string;
  jobType: JobType;
  totalHours: number;
};

export const importedWorkSeeds: ImportedWorkSeed[] = [
  { shortDate: '1.6', customerName: 'דנה', jobType: 'אריזה', totalHours: 10 },
  { shortDate: '2.6', customerName: 'קים', jobType: 'פריקה', totalHours: 16.5 },
  { shortDate: '2.6', customerName: 'אמנדה', jobType: 'סידור', totalHours: 10 },
  { shortDate: '3.6', customerName: 'דנה', jobType: 'פריקה', totalHours: 10 },
  { shortDate: '3.6', customerName: 'טוטי', jobType: 'סידור', totalHours: 30 },
  { shortDate: '3.6', customerName: 'אמנדה', jobType: 'סידור', totalHours: 6 },
  { shortDate: '4.6', customerName: 'טוטי', jobType: 'סידור', totalHours: 16.5 },
  { shortDate: '4.6', customerName: 'ירדן', jobType: 'פריקה', totalHours: 26 },
  { shortDate: '10.6', customerName: 'נעמי לבוב', jobType: 'סידור', totalHours: 16.5 },
  { shortDate: '10.6', customerName: 'לירון קצב', jobType: 'אריזה', totalHours: 8 },
  { shortDate: '11.6', customerName: 'מורן יעקב', jobType: 'פריקה', totalHours: 16 },
  { shortDate: '11.6', customerName: 'מריאנה', jobType: 'סידור', totalHours: 12.5 },
  { shortDate: '14.6', customerName: 'מאיה קנט', jobType: 'סידור', totalHours: 5 },
  { shortDate: '15.6', customerName: 'גילי נתן', jobType: 'סידור', totalHours: 10 },
  { shortDate: '15.6', customerName: 'ליז', jobType: 'סידור', totalHours: 6 },
  { shortDate: '16.6', customerName: 'אופיר גולדמן', jobType: 'אריזה', totalHours: 30 },
  { shortDate: '17.6', customerName: 'גל לדרמן', jobType: 'סידור', totalHours: 11 },
  { shortDate: '18.6', customerName: 'אופיר גולדמן', jobType: 'פריקה', totalHours: 15 },
  { shortDate: '21.6', customerName: 'תני', jobType: 'אריזה', totalHours: 18 },
  { shortDate: '22.6', customerName: 'תני', jobType: 'פריקה', totalHours: 19.5 },
  { shortDate: '22.6', customerName: 'יעל', jobType: 'אריזה', totalHours: 20 },
  { shortDate: '23.6', customerName: 'מאיה', jobType: 'אריזה', totalHours: 24 },
  { shortDate: '23.6', customerName: 'דניאלה', jobType: 'אריזה', totalHours: 25 },
  { shortDate: '24.6', customerName: 'מאיה', jobType: 'פריקה', totalHours: 30 },
  { shortDate: '24.6', customerName: 'עינת בהרב', jobType: 'פריקה', totalHours: 24 },
  { shortDate: '26.6', customerName: 'דניאלה', jobType: 'פריקה', totalHours: 24 },
  { shortDate: '26.6', customerName: 'גל', jobType: 'סידור', totalHours: 7.5 },
  { shortDate: '28.6', customerName: 'אפי אמא', jobType: 'אריזה', totalHours: 8 },
  { shortDate: '29.6', customerName: 'אפי אמא', jobType: 'פריקה', totalHours: 8 },
  { shortDate: '30.6', customerName: 'ליעד שובל', jobType: 'אריזה', totalHours: 26.5 },
  { shortDate: '30.6', customerName: 'גוני', jobType: 'אריזה', totalHours: 16.5 },
  { shortDate: '1.7', customerName: 'תמי לפידות', jobType: 'סידור', totalHours: 40 },
  { shortDate: '2.7', customerName: 'עוז', jobType: 'אריזה', totalHours: 10 },
  { shortDate: '2.7', customerName: 'גוני רבינר', jobType: 'פריקה', totalHours: 15 },
  { shortDate: '2.7', customerName: 'יונית', jobType: 'סידור', totalHours: 10 },
  { shortDate: '3.7', customerName: 'עוז', jobType: 'פריקה', totalHours: 10 },
  { shortDate: '5.7', customerName: 'לילך', jobType: 'אריזה', totalHours: 25 },
  { shortDate: '6.7', customerName: 'ירון', jobType: 'אריזה', totalHours: 20 },
  { shortDate: '7.7', customerName: 'לילך', jobType: 'פריקה', totalHours: 25 },
  { shortDate: '7.7', customerName: 'דניאלה זגמן', jobType: 'אריזה', totalHours: 25 },
  { shortDate: '8.7', customerName: 'ירון', jobType: 'פריקה', totalHours: 20 },
  { shortDate: '8.7', customerName: 'אודליה בוגנים', jobType: 'אריזה', totalHours: 20 },
  { shortDate: '9.7', customerName: 'דניאלה זגמן', jobType: 'פריקה', totalHours: 20 },
  { shortDate: '12.7', customerName: 'דניאל רוזנטל', jobType: 'סידור', totalHours: 10 },
  { shortDate: '15.7', customerName: 'אודליה בוגנים', jobType: 'פריקה', totalHours: 20 },
  { shortDate: '19.7', customerName: 'ליאה', jobType: 'אריזה', totalHours: 10 },
  { shortDate: '21.7', customerName: 'ליאה', jobType: 'פריקה', totalHours: 25 },
  { shortDate: '21.7', customerName: 'ספיר חבקין', jobType: 'אריזה', totalHours: 10 },
  { shortDate: '22.7', customerName: 'שרי אריאב', jobType: 'אריזה', totalHours: 25 },
  { shortDate: '23.7', customerName: 'שרי אריאב', jobType: 'אריזה', totalHours: 20 },
  { shortDate: '26.7', customerName: 'שרי אריאב', jobType: 'פריקה', totalHours: 20 },
  { shortDate: '27.7', customerName: 'שרון אביסרור', jobType: 'אריזה', totalHours: 25 },
  { shortDate: '27.7', customerName: 'שרי אריאב', jobType: 'פריקה', totalHours: 10 },
  { shortDate: '28.7', customerName: 'ירדן אריאלה', jobType: 'אריזה', totalHours: 20 },
  { shortDate: '28.7', customerName: 'שרון', jobType: 'אריזה', totalHours: 20 },
  { shortDate: '29.7', customerName: 'שרון אביסרור', jobType: 'פריקה', totalHours: 30 },
  { shortDate: '29.7', customerName: 'עזרן', jobType: 'אריזה', totalHours: 25 },
  { shortDate: '30.7', customerName: 'עזרן', jobType: 'פריקה', totalHours: 25 },
];

export function shortDateToDateKey(shortDate: string) {
  const [dayRaw, monthRaw] = shortDate.split('.').map(Number);
  return `2026-${String(monthRaw).padStart(2, '0')}-${String(dayRaw).padStart(2, '0')}`;
}

export function shortDateToDisplayDate(shortDate: string) {
  const [dayRaw, monthRaw] = shortDate.split('.').map(Number);
  return `${String(dayRaw).padStart(2, '0')}/${String(monthRaw).padStart(2, '0')}/2026`;
}

export function ensureCustomerFullName(name: string) {
  const normalized = name.trim().replace(/\s+/g, ' ');
  return normalized.split(' ').length >= 2 ? normalized : `${normalized} לקוח`;
}

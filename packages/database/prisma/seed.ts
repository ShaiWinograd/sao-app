import { PrismaClient, JobType } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Seeding default data...');

  // Default form templates per job type
  const packingTemplate = await prisma.formTemplate.upsert({
    where: { id: 'tpl-packing' },
    update: {},
    create: {
      id: 'tpl-packing',
      name: 'טופס סיום - אריזה',
      jobType: JobType.PACKING,
      isDefault: true,
      questions: {
        create: [
          { order: 1, questionText: 'האם האריזה הושלמה?', type: 'YES_NO', isRequired: true, visibility: 'WORKER', options: [] },
          { order: 2, questionText: 'כמה חדרים/אזורים נארזו?', type: 'NUMBER', isRequired: true, visibility: 'WORKER', options: [] },
          { order: 3, questionText: 'כמה קופסאות נארזו?', type: 'NUMBER', isRequired: true, visibility: 'WORKER', options: [] },
          { order: 4, questionText: 'כמה קופסאות עם פריטים שבירים?', type: 'NUMBER', isRequired: false, visibility: 'WORKER', options: [] },
          { order: 5, questionText: 'האם הקופסאות סומנו?', type: 'YES_NO', isRequired: true, visibility: 'WORKER', options: [] },
          { order: 6, questionText: 'האם נארזו פריטים מיוחדים?', type: 'YES_NO', isRequired: false, visibility: 'WORKER', options: [] },
          { order: 7, questionText: 'האם היו פריטים פגומים או תקלות?', type: 'YES_NO', isRequired: true, visibility: 'WORKER', options: [] },
          { order: 8, questionText: 'מה נותר לאריזה?', type: 'LONG_TEXT', isRequired: false, visibility: 'WORKER', options: [] },
          { order: 9, questionText: 'נדרשת המשך עבודה?', type: 'YES_NO', isRequired: true, visibility: 'WORKER', options: [] },
          { order: 10, questionText: 'הערות נוספות', type: 'LONG_TEXT', isRequired: false, visibility: 'WORKER', options: [] },
          { order: 11, questionText: 'הערה פנימית (גלויה למנהל בלבד)', type: 'LONG_TEXT', isRequired: false, visibility: 'ADMIN', options: [] },
        ],
      },
    },
  });

  const unpackingTemplate = await prisma.formTemplate.upsert({
    where: { id: 'tpl-unpacking' },
    update: {},
    create: {
      id: 'tpl-unpacking',
      name: 'טופס סיום - פריקה',
      jobType: JobType.UNPACKING,
      isDefault: true,
      questions: {
        create: [
          { order: 1, questionText: 'האם הפריקה הושלמה?', type: 'YES_NO', isRequired: true, visibility: 'WORKER', options: [] },
          { order: 2, questionText: 'כמה קופסאות פורקו?', type: 'NUMBER', isRequired: true, visibility: 'WORKER', options: [] },
          { order: 3, questionText: 'אילו חדרים הושלמו?', type: 'LONG_TEXT', isRequired: true, visibility: 'WORKER', options: [] },
          { order: 4, questionText: 'האם הקופסאות הוצאו/פונו?', type: 'YES_NO', isRequired: false, visibility: 'WORKER', options: [] },
          { order: 5, questionText: 'האם הפריטים מוקמו בחדרים הנכונים?', type: 'YES_NO', isRequired: true, visibility: 'WORKER', options: [] },
          { order: 6, questionText: 'האם נותרו קופסאות או אזורים לא מטופלים?', type: 'YES_NO', isRequired: true, visibility: 'WORKER', options: [] },
          { order: 7, questionText: 'בקשות או הערות של הלקוח', type: 'LONG_TEXT', isRequired: false, visibility: 'WORKER', options: [] },
          { order: 8, questionText: 'נדרשת המשך עבודה?', type: 'YES_NO', isRequired: true, visibility: 'WORKER', options: [] },
          { order: 9, questionText: 'הערות נוספות', type: 'LONG_TEXT', isRequired: false, visibility: 'WORKER', options: [] },
          { order: 10, questionText: 'הערה פנימית (גלויה למנהל בלבד)', type: 'LONG_TEXT', isRequired: false, visibility: 'ADMIN', options: [] },
        ],
      },
    },
  });

  const orgTemplate = await prisma.formTemplate.upsert({
    where: { id: 'tpl-organization' },
    update: {},
    create: {
      id: 'tpl-organization',
      name: 'טופס סיום - ארגון הבית',
      jobType: JobType.HOME_ORGANIZATION,
      isDefault: true,
      questions: {
        create: [
          { order: 1, questionText: 'אילו אזורים/חדרים טופלו?', type: 'LONG_TEXT', isRequired: true, visibility: 'WORKER', options: [] },
          { order: 2, questionText: 'האם מיון/הדללה בוצעו?', type: 'YES_NO', isRequired: true, visibility: 'WORKER', options: [] },
          { order: 3, questionText: 'האם נוספו תוויות או פתרונות אחסון?', type: 'YES_NO', isRequired: false, visibility: 'WORKER', options: [] },
          { order: 4, questionText: 'מה נותר לביצוע?', type: 'LONG_TEXT', isRequired: false, visibility: 'WORKER', options: [] },
          { order: 5, questionText: 'המלצות להמשך', type: 'LONG_TEXT', isRequired: false, visibility: 'WORKER', options: [] },
          { order: 6, questionText: 'בקשות או הערות של הלקוח', type: 'LONG_TEXT', isRequired: false, visibility: 'WORKER', options: [] },
          { order: 7, questionText: 'נדרשת המשך עבודה?', type: 'YES_NO', isRequired: true, visibility: 'WORKER', options: [] },
          { order: 8, questionText: 'הערות נוספות', type: 'LONG_TEXT', isRequired: false, visibility: 'WORKER', options: [] },
          { order: 9, questionText: 'הערה פנימית (גלויה למנהל בלבד)', type: 'LONG_TEXT', isRequired: false, visibility: 'ADMIN', options: [] },
        ],
      },
    },
  });

  // Default app settings
  const defaultSettings = [
    { key: 'DEFAULT_LOCATION_RADIUS_METERS', value: '500', notes: 'Default allowed radius for shift clock-in' },
    { key: 'LOCATION_CHECK_INTERVAL_MINUTES', value: '15', notes: 'How often to check worker location during active shift' },
    { key: 'AUTO_CLOCK_OUT_GRACE_MINUTES', value: '15', notes: 'Grace period before auto clock-out when worker is outside radius' },
    { key: 'CASE_REOPEN_DAYS', value: '60', notes: 'Days after latest job to suggest reopening a completed case' },
    { key: 'REPLACEMENT_REQUEST_HOURS_CUTOFF', value: '12', notes: 'Hours before shift start; below this replacement requires direct manager contact' },
    { key: 'FORM_EDIT_MINUTES', value: '30', notes: 'Minutes after form submission during which worker can self-edit' },
    { key: 'VAT_RATE', value: '0.18', notes: 'Default Israeli VAT rate (18%)' },
    { key: 'REPORTING_BASIS', value: 'ACCRUAL', notes: 'Default reporting basis: ACCRUAL or CASH' },
    { key: 'WORKER_PAYMENT_VISIBLE', value: 'false', notes: 'Whether workers can see their payment summary in the mobile app' },
  ];

  for (const setting of defaultSettings) {
    await prisma.appSetting.upsert({
      where: { key: setting.key },
      update: {},
      create: setting,
    });
  }

  console.log('✅ Seed complete');
  console.log(`   Form templates: packing, unpacking, home-organization`);
  console.log(`   App settings: ${defaultSettings.length} defaults`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

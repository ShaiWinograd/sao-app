import { expect, test } from '@playwright/test';

const caseDetail = {
  id: 'case-1',
  name: 'מעבר דירה משפחת כהן',
  status: 'AWAITING_APPROVAL',
  internalNotes: null,
  customer: { firstName: 'יעל', lastName: 'כהן', phone: '0501111111', email: 'yael@example.com' },
  jobs: [
    {
      id: 'job-1',
      date: '2026-08-01T08:00:00.000Z',
      jobType: 'PACKING',
      status: 'DRAFT',
      requiredWorkerCount: 4,
      address: { fullAddress: 'תל אביב 1' },
    },
  ],
  invoices: [{ id: 'inv-1', total: 5400, status: 'SENT' }],
};

const plannedServices = [
  {
    id: 'ps-1',
    serviceType: 'PACKING',
    timingPrecision: 'EXPECTED_MONTH',
    timingNote: null,
    estimatedWorkdays: 2,
    workersPerDay: 4,
    hoursPerDay: 5,
    requiresManager: true,
    reservedManagerPositions: 1,
  },
];

const quotations = [
  {
    id: 'quote-1',
    status: 'SENT',
    versions: [
      { id: 'v1', versionNumber: 1, status: 'SENT', estimatedTotal: 5400, isAddendum: false },
    ],
  },
];

test.describe('Project detail page', () => {
  test.beforeEach(async ({ page }) => {
    await page.route('**/api/v1/cases/case-1', async (route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(caseDetail) });
    });
    await page.route('**/api/v1/planned-services**', async (route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(plannedServices) });
    });
    await page.route('**/api/v1/quotations**', async (route) => {
      if (route.request().method() === 'GET') {
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(quotations) });
      } else {
        await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
      }
    });
    await page.route('**/api/v1/cases/case-1/communications', async (route) => {
      if (route.request().method() === 'GET') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify([
            {
              id: 'comm-1',
              caseId: 'case-1',
              templateKey: 'quote',
              channel: 'whatsapp',
              recipient: '0501111111',
              preview: 'שלום, מצורפת הצעת מחיר',
              sentAt: '2026-07-12T10:00:00.000Z',
              performedByName: 'מנהל',
            },
          ]),
        });
      } else {
        await route.fulfill({ status: 201, contentType: 'application/json', body: '{}' });
      }
    });
    await page.route('**/api/v1/cases/case-1/hub', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          checklist: { totalJobs: 1, completedOrCancelledJobs: 0, totalShifts: 2, closedShifts: 1, linkedForms: 1 },
          readyForFinalReport: false,
          forms: [
            {
              id: 'form-1',
              shiftId: 'shift-1',
              completionStatus: 'COMPLETED',
              submittedAt: '2026-08-01T17:00:00.000Z',
              managerNote: null,
              workerName: 'נועה לוי',
              jobType: 'PACKING',
              shiftDate: '2026-08-01T08:00:00.000Z',
            },
          ],
        }),
      });
    });
  });

  test('shows overview with planned services and financials', async ({ page }) => {
    await page.goto('/cases/case-1');

    await expect(page.getByRole('heading', { name: 'מעבר דירה משפחת כהן' })).toBeVisible();
    await expect(page.getByText('שירותים מתוכננים')).toBeVisible();
    // 2 workdays * 4 workers * 5 hours = 40 estimated worker-hours
    await expect(page.getByText(/40\s*שעות עבודה משוערות/)).toBeVisible();
    await expect(page.getByText(/שעות עבודה משוערות.*דורש מנהל עבודה/)).toBeVisible();

    // Plan-vs-actual comparison table
    await expect(page.getByRole('heading', { name: 'השוואת תכנון מול ביצוע' })).toBeVisible();
    await expect(page.getByText('חיוב מול הצעה מאושרת')).toBeVisible();
    await expect(page.getByText('תשלום מול חיוב')).toBeVisible();

    // Estimated / scheduled / actual hours table
    await expect(page.getByRole('heading', { name: 'השוואת שעות עבודה' })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: 'מתוזמן' })).toBeVisible();
  });

  test('shows the lifecycle stepper and next-action card', async ({ page }) => {
    await page.goto('/cases/case-1');

    // Stepper renders the lifecycle steps
    await expect(page.getByRole('navigation', { name: 'שלבי הפרוייקט' })).toBeVisible();
    await expect(page.getByText('אישור לקוח')).toBeVisible();
    await expect(page.getByText('תזמון')).toBeVisible();

    // Next-action card for an AWAITING_APPROVAL project points to quotations
    await expect(page.getByText('הפעולה הבאה')).toBeVisible();
    await expect(page.getByText('תיעוד אישור הלקוח להצעת המחיר')).toBeVisible();
    await page.getByRole('button', { name: 'מעבר להצעות מחיר' }).click();
    await expect(page.getByRole('button', { name: 'תיעוד אישור לקוח' })).toBeVisible();
  });

  test('records a quotation approval from the quotations tab', async ({ page }) => {
    let approved = false;
    await page.route('**/api/v1/quotations/quote-1/approve', async (route) => {
      approved = true;
      await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
    });

    await page.goto('/cases/case-1');
    await page.getByRole('tab', { name: 'הצעות מחיר' }).click();
    await page.getByRole('button', { name: 'תיעוד אישור לקוח' }).click();

    await expect.poll(() => approved).toBe(true);
  });

  test('opens a quotation preview from the quotations tab', async ({ page }) => {
    await page.route('**/api/v1/quotations/quote-1/preview', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          quotationId: 'quote-1',
          caseName: 'מעבר דירה משפחת כהן',
          versionNumber: 1,
          status: 'SENT',
          estimatedTotal: 5400,
          includedServices: ['אריזת דירה 4 חדרים'],
          datePrecision: 'EXPECTED_MONTH',
          timingNote: null,
          validUntil: null,
          datesFinal: false,
        }),
      });
    });

    await page.goto('/cases/case-1');
    await page.getByRole('tab', { name: 'הצעות מחיר' }).click();
    await page.getByRole('button', { name: 'תצוגה מקדימה' }).click();

    await expect(page.getByRole('heading', { name: 'תצוגה מקדימה — הצעת מחיר' })).toBeVisible();
    await expect(page.getByText('אריזת דירה 4 חדרים')).toBeVisible();
    await expect(page.getByText('המועדים המדויקים יתואמו בהמשך ובהתאם לזמינות.')).toBeVisible();
  });

  test('adds planned services from a moving selection', async ({ page }) => {
    let fromSelection = false;
    await page.route('**/api/v1/planned-services/from-selection', async (route) => {
      fromSelection = true;
      await route.fulfill({ status: 201, contentType: 'application/json', body: '[]' });
    });

    await page.goto('/cases/case-1');
    await page.getByRole('button', { name: 'מעבר דירה', exact: true }).click();

    await expect.poll(() => fromSelection).toBe(true);
  });

  test('lists project jobs in the jobs tab', async ({ page }) => {
    await page.goto('/cases/case-1');
    await page.getByRole('tab', { name: 'עבודות' }).click();

    await expect(page.getByText('עבודות הפרוייקט')).toBeVisible();
    await expect(page.getByText('תל אביב 1')).toBeVisible();
    await expect(page.getByText('4 עובדים')).toBeVisible();
  });

  test('finds ranked available workers from the jobs tab', async ({ page }) => {
    await page.route('**/api/v1/workers/availability**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([
          { id: 'w1', name: 'דנה כהן', available: true, hasRequiredSkill: true, isManagerCapable: true, score: 180, reasons: ['זמין בתאריך', 'יכול לשמש מנהל עבודה'] },
          { id: 'w2', name: 'רון לוי', available: false, hasRequiredSkill: false, isManagerCapable: false, score: 0, reasons: ['עמוס בתאריך'] },
        ]),
      });
    });

    await page.goto('/cases/case-1');
    await page.getByRole('tab', { name: 'עבודות' }).click();

    const finder = page.getByTestId('availability-finder');
    await expect(finder).toBeVisible();
    await finder.getByRole('button', { name: 'חיפוש' }).click();

    await expect(finder.getByText('דנה כהן')).toBeVisible();
    await expect(finder.getByText('רון לוי')).toBeVisible();
    await expect(finder.getByText('זמין', { exact: true })).toBeVisible();
    await expect(finder.getByText('עמוס', { exact: true })).toBeVisible();
  });

  test('finds candidate dates from the jobs tab', async ({ page }) => {
    await page.route('**/api/v1/workers/available-dates**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([
          { date: '2026-08-02', availableWorkers: 6, availableManagers: 2, suitable: true },
          { date: '2026-08-03', availableWorkers: 2, availableManagers: 0, suitable: false },
        ]),
      });
    });

    await page.goto('/cases/case-1');
    await page.getByRole('tab', { name: 'עבודות' }).click();

    const finder = page.getByTestId('date-finder');
    await expect(finder).toBeVisible();
    await finder.locator('input[type=date]').nth(1).fill('2026-08-10');
    await finder.getByRole('button', { name: 'חיפוש' }).click();

    await expect(finder.getByText(/6 עובדים זמינים/)).toBeVisible();
    await expect(finder.getByText('מתאים', { exact: true })).toBeVisible();
    await expect(finder.getByText('לא מתאים')).toBeVisible();
  });

  test('shows the communication timeline and sends a message from the activity tab', async ({ page }) => {
    let sent = false;
    await page.route('**/api/v1/cases/case-1/communications', async (route) => {
      if (route.request().method() === 'GET') {
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([]) });
      } else {
        sent = true;
        await route.fulfill({ status: 201, contentType: 'application/json', body: '{}' });
      }
    });

    await page.goto('/cases/case-1');
    await page.getByRole('tab', { name: 'פעילות' }).click();

    await expect(page.getByText('אוטומציות')).toBeVisible();
    await expect(page.getByText('טופס ציוד לאריזה')).toBeVisible();
    await expect(page.getByText('ציר תקשורת')).toBeVisible();
    await page.getByRole('button', { name: 'ואטסאפ' }).first().click();

    await expect.poll(() => sent).toBe(true);
  });

  test('shows forms readiness and worker forms in the forms tab', async ({ page }) => {
    await page.goto('/cases/case-1');
    await page.getByRole('tab', { name: 'טפסים' }).click();

    await expect(page.getByText('מוכנות טפסים ודוחות')).toBeVisible();
    await expect(page.getByText('ממתין להשלמות')).toBeVisible();
    await expect(page.getByText('טפסי עובדים')).toBeVisible();
    await expect(page.getByText('נועה לוי')).toBeVisible();
    await expect(page.getByText('הושלם', { exact: true })).toBeVisible();
  });
});

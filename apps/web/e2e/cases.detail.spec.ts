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
  });

  test('shows overview with planned services and financials', async ({ page }) => {
    await page.goto('/cases/case-1');

    await expect(page.getByRole('heading', { name: 'מעבר דירה משפחת כהן' })).toBeVisible();
    await expect(page.getByText('שירותים מתוכננים')).toBeVisible();
    // 2 workdays * 4 workers * 5 hours = 40 estimated worker-hours
    await expect(page.getByText(/40\s*שעות עבודה משוערות/)).toBeVisible();
    await expect(page.getByText(/שעות עבודה משוערות.*דורש מנהל עבודה/)).toBeVisible();
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

    await expect(page.getByText('ציר תקשורת')).toBeVisible();
    await page.getByRole('button', { name: 'ואטסאפ' }).first().click();

    await expect.poll(() => sent).toBe(true);
  });
});

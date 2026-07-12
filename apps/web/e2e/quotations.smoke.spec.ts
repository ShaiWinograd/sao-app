import { expect, test } from '@playwright/test';

const quotationPayload = [
  {
    id: 'quote-1',
    status: 'SENT',
    createdAt: '2026-07-10T08:00:00.000Z',
    updatedAt: '2026-07-11T08:00:00.000Z',
    case: { id: 'case-1', name: 'מעבר דירה משפחת כהן', customerId: 'customer-1' },
    versions: [
      {
        id: 'version-1',
        versionNumber: 1,
        status: 'SENT',
        estimatedTotal: 5400,
        datePrecision: 'EXPECTED_MONTH',
        includedServices: ['אריזת דירה 4 חדרים', 'פריקה וסידור'],
        timingNote: 'המועדים המדויקים יתואמו בהמשך.',
        validUntil: '2026-08-01T00:00:00.000Z',
        notes: null,
        isAddendum: false,
        sentAt: '2026-07-11T08:00:00.000Z',
        approvedAt: null,
        approvalMethod: null,
        sends: [
          {
            id: 'send-1',
            channel: 'WHATSAPP',
            recipient: '—',
            versionNumberSnapshot: 1,
            createdAt: '2026-07-11T08:00:00.000Z',
          },
        ],
      },
    ],
  },
];

test.describe('Quotations management', () => {
  test.beforeEach(async ({ page }) => {
    await page.route('**/api/v1/quotations', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(quotationPayload),
      });
    });

    await page.route('**/api/v1/cases', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([
          {
            id: 'case-1',
            name: 'מעבר דירה משפחת כהן',
            customer: { firstName: 'יעל', lastName: 'כהן' },
          },
        ]),
      });
    });
  });

  test('renders quotation detail and version history', async ({ page }) => {
    await page.goto('/quotations');

    await expect(page.getByRole('heading', { name: 'הצעות מחיר', exact: true })).toBeVisible();
    await expect(page.getByText('מעבר דירה משפחת כהן').first()).toBeVisible();
    await expect(page.getByText('אריזת דירה 4 חדרים')).toBeVisible();
    await expect(page.getByText('חודש משוער').first()).toBeVisible();
    await expect(page.getByRole('heading', { name: 'היסטוריית גרסאות' })).toBeVisible();
    await expect(page.getByText('נשלח: וואטסאפ')).toBeVisible();
  });

  test('records an approval via the approve action', async ({ page }) => {
    let approvalRequested = false;
    await page.route('**/api/v1/quotations/*/approve', async (route) => {
      approvalRequested = true;
      await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
    });

    await page.goto('/quotations');
    await page.getByRole('button', { name: 'תיעוד אישור לקוח' }).click();

    await expect.poll(() => approvalRequested).toBe(true);
  });
});

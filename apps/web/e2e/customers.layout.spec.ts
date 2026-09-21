import { expect, test } from '@playwright/test';

test.describe('Customers directory', () => {
  test.beforeEach(async ({ page }) => {
    await page.route('**/api/v1/customers', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([
          {
            id: 'customer-1',
            firstName: 'הדר',
            lastName: 'ורניק',
            phone: '0549555330',
            email: 'hadar@example.com',
            internalNotes: 'רגישה לאבק',
            updatedAt: '2026-09-21T08:58:00.000Z',
            cases: [{ id: 'case-1', name: 'מעבר אביב', status: 'ACTIVE' }],
            addresses: [{ id: 'address-1', label: 'NEW_APARTMENT', fullAddress: 'רמת השרון 12' }],
          },
          {
            id: 'customer-2',
            firstName: 'יעל',
            lastName: 'כהן',
            phone: '0521112233',
            email: 'yael@example.com',
            internalNotes: '',
            updatedAt: '2026-09-20T07:30:00.000Z',
            cases: [{ id: 'case-2', name: 'בית בכפר סבא', status: 'DRAFT' }],
            addresses: [
              { id: 'address-2', label: 'OLD_APARTMENT', fullAddress: 'ויצמן 8, כפר סבא' },
            ],
          },
        ]),
      })
    );
    await page.route('**/api/v1/jobs?customerId=customer-1', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: '[]' })
    );
    await page.route('**/api/v1/cases/reports-overview?customerId=customer-1', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: '{"ready":[],"closed":[]}',
      })
    );
    await page.route('**/api/v1/jobs?customerId=customer-2', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: '[]' })
    );
    await page.route('**/api/v1/cases/reports-overview?customerId=customer-2', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: '{"ready":[],"closed":[]}',
      })
    );

    await page.goto('/customers');
  });

  test('searches name, normalized phone, email, project, and address', async ({ page }) => {
    const search = page.getByLabel('חיפוש לקוחות');
    for (const query of ['הדר', '054-955-5330', 'hadar@example.com', 'מעבר אביב', 'השרון 12']) {
      await search.fill(query);
      await expect(page.getByText('הדר ורניק').first()).toBeVisible();
      await expect(page.getByText('יעל כהן').first()).toHaveCount(0);
    }

    await search.fill('כפר סבא');
    await expect(page.getByText('יעל כהן').first()).toBeVisible();
    await expect(page.getByText('הדר ורניק').first()).toHaveCount(0);
  });

  test('sorts from table headers and keeps existing customer metadata read-only until edit', async ({
    page,
  }) => {
    await expect(page.getByRole('columnheader', { name: 'לקוחה' })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: 'סטטוס' })).toBeVisible();
    await expect(page.getByLabel('מיון לקוחות')).toHaveCount(0);
    await expect(page.getByLabel('סינון לפי סטטוס')).toBeVisible();
    await page.getByRole('button', { name: /מיון לפי לקוחה/ }).click();
    await expect(page.getByRole('button', { name: 'מיון לפי לקוחה, עולה' })).toBeVisible();
    await page.getByText('הדר ורניק').first().click();

    await expect(page.getByRole('dialog').getByText('הדר ורניק', { exact: true })).toHaveCount(1);
    await expect(page.getByRole('button', { name: 'עריכת פרטים' })).toBeVisible();
    await expect(page.getByPlaceholder('שם פרטי')).toHaveCount(0);
    await expect(page.getByText('רגישה לאבק')).toBeVisible();

    await page.getByRole('button', { name: 'עריכת פרטים' }).click();
    await expect(page.getByPlaceholder('שם פרטי')).toHaveValue('הדר');
    await expect(page.getByRole('button', { name: 'שמירת שינויים' })).toBeVisible();
    await page.getByPlaceholder('שם פרטי').fill('שם זמני');
    await page.getByRole('button', { name: 'ביטול עריכה' }).click();
    await expect(page.getByPlaceholder('שם פרטי')).toHaveCount(0);
    await expect(page.getByRole('dialog').getByText('הדר ורניק', { exact: true })).toHaveCount(1);
    await page.getByRole('button', { name: 'עריכת פרטים' }).click();
    await expect(page.getByPlaceholder('שם פרטי')).toHaveValue('הדר');
  });
});

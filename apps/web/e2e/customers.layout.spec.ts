import { expect, test } from '@playwright/test';

test.describe('Customers directory', () => {
  test('uses a sortable table and keeps existing customer metadata read-only until edit', async ({ page }) => {
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
            cases: [{ id: 'case-1', name: 'רמת השרון', status: 'ACTIVE' }],
            addresses: [{ id: 'address-1', label: 'NEW_APARTMENT', fullAddress: 'רמת השרון 12' }],
          },
        ]),
      }),
    );
    await page.route('**/api/v1/jobs?customerId=customer-1', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }),
    );
    await page.route('**/api/v1/cases/reports-overview?customerId=customer-1', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: '{"ready":[],"closed":[]}' }),
    );

    await page.goto('/customers');

    await expect(page.getByRole('columnheader', { name: 'לקוחה' })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: 'סטטוס' })).toBeVisible();
    await expect(page.getByLabel('מיון לקוחות')).toBeVisible();
    await page.getByText('הדר ורניק').first().click();

    await expect(page.getByRole('button', { name: 'עריכת פרטים' })).toBeVisible();
    await expect(page.getByPlaceholder('שם פרטי')).toHaveCount(0);
    await expect(page.getByText('רגישה לאבק')).toBeVisible();

    await page.getByRole('button', { name: 'עריכת פרטים' }).click();
    await expect(page.getByPlaceholder('שם פרטי')).toHaveValue('הדר');
    await expect(page.getByRole('button', { name: 'שמירת שינויים' })).toBeVisible();
  });
});

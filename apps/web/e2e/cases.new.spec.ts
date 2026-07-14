import { expect, test } from '@playwright/test';

test.describe('New project wizard', () => {
  test('creates a project through the seven steps', async ({ page }) => {
    let customerCreated = false;
    let caseCreated = false;
    let plannedCreated = false;

    await page.route('**/api/v1/customers', async (route) => {
      if (route.request().method() === 'POST') {
        customerCreated = true;
        await route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify({ id: 'cust-1' }) });
      } else {
        await route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
      }
    });
    await page.route('**/api/v1/cases', async (route) => {
      if (route.request().method() === 'POST') {
        caseCreated = true;
        await route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify({ id: 'case-new' }) });
      } else {
        await route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
      }
    });
    await page.route('**/api/v1/planned-services**', async (route) => {
      if (route.request().method() === 'POST') {
        plannedCreated = true;
        await route.fulfill({ status: 201, contentType: 'application/json', body: '{}' });
      } else {
        await route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
      }
    });
    // Detail page loaded after the wizard redirects
    await page.route('**/api/v1/cases/case-new', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          id: 'case-new',
          name: 'מעבר דירה – ישראל ישראלי',
          status: 'QUOTATION_DRAFT',
          internalNotes: null,
          customer: { firstName: 'ישראל', lastName: 'ישראלי', phone: '0501234567', email: '' },
          jobs: [],
          invoices: [],
        }),
      });
    });
    await page.route('**/api/v1/quotations**', async (route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
    });
    await page.route('**/api/v1/cases/case-new/communications', async (route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
    });
    await page.route('**/api/v1/cases/case-new/hub', async (route) => {
      await route.fulfill({ status: 404, contentType: 'application/json', body: '{}' });
    });

    await page.goto('/cases/new');

    // Step 1 — customer
    await expect(page.getByText('שלב 1 מתוך 7')).toBeVisible();
    const textboxes = page.getByRole('textbox');
    await textboxes.nth(0).fill('ישראל');
    await textboxes.nth(1).fill('ישראלי');
    await textboxes.nth(2).fill('0501234567');
    await page.getByRole('button', { name: 'הבא' }).click();

    // Step 2 — service type
    await expect(page.getByText('שלב 2 מתוך 7')).toBeVisible();
    await page.getByRole('button', { name: /מעבר דירה/ }).click();
    await page.getByRole('button', { name: 'הבא' }).click();

    // Steps 3–6 — advance
    for (let i = 0; i < 4; i += 1) {
      await page.getByRole('button', { name: 'הבא' }).click();
    }

    // Step 7 — finish
    await expect(page.getByText('שלב 7 מתוך 7')).toBeVisible();
    await page.getByRole('button', { name: 'שמירה והכנת הצעת מחיר' }).click();

    await expect.poll(() => customerCreated).toBe(true);
    await expect.poll(() => caseCreated).toBe(true);
    await expect.poll(() => plannedCreated).toBe(true);
  });
});

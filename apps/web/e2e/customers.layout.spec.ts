import { expect, test } from '@playwright/test';

test.describe('Customers directory', () => {
  let createdQuote: Record<string, unknown> | null;

  test.beforeEach(async ({ page }) => {
    createdQuote = null;
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
            addresses: [
              { id: 'address-new', label: 'NEW_APARTMENT', fullAddress: 'רמת השרון 12' },
              { id: 'address-old', label: 'OLD_APARTMENT', fullAddress: 'הרצל 4, תל אביב' },
            ],
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
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([{
          id: 'job-1',
          date: '2026-10-01T00:00:00.000Z',
          jobType: 'PACKING',
          status: 'APPROVED',
          address: { fullAddress: 'רמת השרון 12' },
        }]),
      })
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
    await page.route('**/api/v1/customers/customer-1/quote-context', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          customerName: 'הדר ורניק',
          email: 'hadar@example.com',
          phone: '0549555330',
          address: 'רמת השרון 12',
          identifierType: null,
          identifierNumber: null,
          jobs: [{
            id: 'job-1',
            date: '2026-10-01T00:00:00.000Z',
            jobType: 'PACKING',
            status: 'APPROVED',
            address: { fullAddress: 'רמת השרון 12' },
          }],
        }),
      })
    );
    await page.route('**/api/v1/customers/customer-1/quotes', async (route) => {
      if (route.request().method() === 'POST') {
        createdQuote = route.request().postDataJSON();
        await route.fulfill({
          status: 201,
          contentType: 'application/json',
          body: JSON.stringify({
            id: 'quote-new',
            ...createdQuote,
            customerName: 'הדר ורניק',
            customerAddress: 'רמת השרון 12',
            createdAt: '2026-09-23T18:30:00.000Z',
          }),
        });
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([{
          id: 'quote-1',
          customerName: 'הדר ורניק',
          customerAddress: 'רמת השרון 12',
          identifierType: 'ISRAELI_ID',
          identifierNumber: '123456789',
          jobIds: ['job-1'],
          totalAmount: 2400,
          createdAt: '2026-09-22T10:00:00.000Z',
        }]),
      });
    });

    await page.goto('/customers');
  });

  test('searches name, normalized phone, email, and address', async ({ page }) => {
    const search = page.getByLabel('חיפוש לקוחות');
    for (const query of ['הדר', '054-955-5330', 'hadar@example.com', 'השרון 12']) {
      await search.fill(query);
      await expect(page.getByText('הדר ורניק').first()).toBeVisible();
      await expect(page.getByText('יעל כהן').first()).toHaveCount(0);
    }

    await search.fill('כפר סבא');
    await expect(page.getByText('יעל כהן').first()).toBeVisible();
    await expect(page.getByText('הדר ורניק').first()).toHaveCount(0);
  });

  test('keeps the customer card compact and creates a prefilled job-based quote', async ({ page }) => {
    await page.getByText('הדר ורניק').first().click();

    await expect(page.getByText('פרויקט', { exact: true })).toHaveCount(0);
    await expect(page.getByText('רמת השרון 12', { exact: true }).first()).toBeVisible();
    await page.getByRole('button', { name: 'הצגת כתובות נוספות' }).click();
    await expect(page.getByText('הרצל 4, תל אביב', { exact: true })).toBeVisible();

    await page.getByRole('button', { name: 'מסמכים' }).click();
    await expect(page.getByText('הצעת מחיר', { exact: true })).toBeVisible();
    await expect(page.getByText('2,400 ₪ · 1 עבודות', { exact: true })).toBeVisible();

    await page.getByRole('button', { name: 'הצעת מחיר חדשה' }).click();
    const quoteForm = page.locator('section').filter({ has: page.getByRole('heading', { name: 'הצעת מחיר חדשה' }) });
    await expect(quoteForm.getByText('hadar@example.com', { exact: true })).toBeVisible();
    await expect(quoteForm.getByText('0549555330', { exact: true })).toBeVisible();
    await page.getByLabel('סוג מזהה').selectOption('COMPANY_NUMBER');
    await page.getByLabel('מספר חברה').fill('515123456');
    await page.getByLabel('סכום הצעה').fill('3600');
    await page.getByRole('button', { name: 'שמירת הצעת מחיר' }).click();

    await expect.poll(() => createdQuote).toEqual({
      identifierType: 'COMPANY_NUMBER',
      identifierNumber: '515123456',
      jobIds: ['job-1'],
      totalAmount: 3600,
    });
    await expect(page.getByText('הצעת המחיר נשמרה במסמכי הלקוחה.')).toBeVisible();
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

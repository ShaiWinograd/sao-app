import { expect, test } from '@playwright/test';

const worker = {
  id: 'worker-1',
  firstName: 'נועה',
  lastName: 'לוי',
  phone: '0502222222',
  email: 'noa@example.com',
  paymentMethod: 'BANK_TRANSFER',
  skills: ['SHIFT_LEADER', 'PACKING_SPECIALIST'],
  isActive: true,
  homeArea: 'תל אביב',
  notes: null,
  shifts: [
    { id: 's1', attendanceStatus: 'CLOCKED_OUT', job: { date: '2026-08-01T08:00:00.000Z', jobType: 'PACKING' } },
  ],
  adjustments: [],
  workerPayments: [{ id: 'p1', amount: 500, createdAt: '2026-07-30T00:00:00.000Z' }],
};

test.describe('Worker detail page', () => {
  test.beforeEach(async ({ page }) => {
    await page.route('**/api/v1/workers/worker-1', async (route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(worker) });
    });
  });

  test('uses a text-only team overview and allows a Hebrew system name independent of login', async ({ page }) => {
    const updated: { firstName?: string; lastName?: string } = {};
    await page.route('**/api/v1/workers', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([
          {
            id: 'worker-english',
            firstName: 'Shai',
            lastName: 'Winograd',
            phone: '0546626125',
            email: 'shaiw121@gmail.com',
            paymentMethod: 'BANK_TRANSFER',
            hourlyWage: 50,
            skills: ['GENERAL_WORKER'],
            isActive: true,
          },
        ]),
      });
    });
    await page.route('**/api/v1/workers/worker-english', async (route) => {
      if (route.request().method() === 'PATCH') {
        Object.assign(updated, route.request().postDataJSON());
        await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
        return;
      }
      await route.continue();
    });
    page.on('dialog', (dialog) => dialog.accept());

    await page.goto('/workers');

    await expect(page.getByText('THE PEOPLE WHO MAKE SPACE')).toBeVisible();
    await expect(page.getByText('האנשים, התפקידים והפרטים שמחזיקים את העבודה יחד.')).toHaveCount(0);
    await expect(page.locator('main svg')).toHaveCount(0);

    await page.getByRole('button', { name: 'Shai Winograd' }).click();
    await page.getByLabel('שם פרטי במערכת').fill('שי');
    await page.getByLabel('שם משפחה במערכת').fill('וינוגרד');
    await page.getByRole('button', { name: 'שמירת שינוי' }).click();

    await expect.poll(() => updated).toMatchObject({ firstName: 'שי', lastName: 'וינוגרד' });
    await expect(page.getByRole('button', { name: 'שי וינוגרד' })).toBeVisible();
  });

  test('shows worker details, jobs, and payments across tabs', async ({ page }) => {
    await page.goto('/workers/worker-1');

    await expect(page.getByRole('heading', { name: 'נועה לוי' })).toBeVisible();
    await expect(page.getByText('פעיל', { exact: true })).toBeVisible();

    // Details tab — skills
    await expect(page.getByText('ראש צוות')).toBeVisible();

    // Jobs tab
    await page.getByRole('tab', { name: 'עבודות' }).click();
    await expect(page.getByText('היסטוריית עבודות')).toBeVisible();
    await expect(page.getByText('אריזה', { exact: false }).first()).toBeVisible();

    // Payments tab
    await page.getByRole('tab', { name: 'תשלומים' }).click();
    await expect(page.getByText('₪500')).toBeVisible();
  });
});

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
    await page.addInitScript(() => window.localStorage.setItem('sao-role-override', 'OWNER'));
    await page.route('**/api/v1/workers/worker-1', async (route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(worker) });
    });
  });

  test('uses a text-only team overview and allows a Hebrew system name independent of login', async ({ page }) => {
    const updated: { firstName?: string; lastName?: string } = {};
    let reinvited = false;
    let archived = false;
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
            homeAddress: 'הרצל 10, תל אביב',
            birthday: '1990-05-12T00:00:00.000Z',
            bankNumber: '10',
            bankBranch: '123',
            bankAccountNumber: '456789',
            bankAccountHolder: 'שי וינוגרד',
          },
        ]),
      });
    });
    await page.route('**/api/v1/workers?status=all', async (route) => {
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
            homeAddress: 'הרצל 10, תל אביב',
            birthday: '1990-05-12T00:00:00.000Z',
            bankNumber: '10',
            bankBranch: '123',
            bankAccountNumber: '456789',
            bankAccountHolder: 'שי וינוגרד',
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
      if (route.request().method() === 'DELETE') {
        archived = true;
        await route.fulfill({ status: 204, body: '' });
        return;
      }
      await route.continue();
    });
    await page.route('**/api/v1/workers/worker-english/link-login', async (route) => {
      reinvited = true;
      await route.fulfill({ status: 200, contentType: 'application/json', body: '{"success":true}' });
    });
    page.on('dialog', (dialog) => dialog.accept());

    await page.goto('/workers');

    await expect(page.getByText('THE PEOPLE WHO MAKE SPACE')).toBeVisible();
    await expect(page.getByText('האנשים, התפקידים והפרטים שמחזיקים את העבודה יחד.')).toHaveCount(0);
    await expect(page.locator('main svg')).toHaveCount(0);

    await page.getByRole('button', { name: 'Shai Winograd' }).click();
    await page.getByLabel('שם פרטי במערכת').fill('שי');
    await page.getByLabel('שם משפחה במערכת').fill('וינוגרד');
    await expect(page.getByLabel('כתובת מגורים')).toHaveValue('הרצל 10, תל אביב');
    await expect(page.getByLabel('תאריך לידה')).toHaveValue('1990-05-12');
    await expect(page.getByPlaceholder('מספר חשבון')).toHaveValue('456789');
    await expect(page.getByText('הזמנת העובדת להתחברות')).toHaveCount(0);
    await page.getByRole('button', { name: 'שמירת שינוי' }).click();

    await expect.poll(() => updated).toMatchObject({
      firstName: 'שי',
      lastName: 'וינוגרד',
      homeAddress: 'הרצל 10, תל אביב',
      birthday: '1990-05-12',
      bankAccountNumber: '456789',
    });
    await expect(page.getByRole('button', { name: 'שי וינוגרד' })).toBeVisible();
    await page.getByRole('button', { name: 'ניהול צוות' }).click();
    await page.getByRole('button', { name: 'שליחת הזמנה מחדש' }).click();
    await page.getByRole('button', { name: 'אישור' }).click();
    await expect.poll(() => reinvited).toBe(true);

    await page.getByRole('button', { name: 'ניהול צוות' }).click();
    await page.getByRole('button', { name: 'העברה לארכיון' }).click();
    await page.getByRole('button', { name: 'אישור' }).click();
    await expect.poll(() => archived).toBe(true);
  });

  test('shows worker details, jobs, and payments across tabs', async ({ page }) => {
    await page.goto('/workers/worker-1');

    await expect(page.getByRole('heading', { name: 'נועה לוי' })).toBeVisible();
    await expect(page.getByText('פעיל', { exact: true })).toBeVisible();

    // Details tab — skills
    await expect(page.getByText('ראש צוות')).toBeVisible();
    await expect(page.getByText('תאריך לידה')).toBeVisible();
    await expect(page.getByText('חשבון בנק')).toBeVisible();

    // Jobs tab
    await page.getByRole('tab', { name: 'עבודות' }).click();
    await expect(page.getByText('היסטוריית עבודות')).toBeVisible();
    await expect(page.getByText('אריזה', { exact: false }).first()).toBeVisible();

    // Payments tab
    await page.getByRole('tab', { name: 'תשלומים' }).click();
    await expect(page.getByText('₪500')).toBeVisible();
  });
});

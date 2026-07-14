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

  test('shows worker details, jobs, and payments across tabs', async ({ page }) => {
    await page.goto('/workers/worker-1');

    await expect(page.getByRole('heading', { name: 'נועה לוי' })).toBeVisible();
    await expect(page.getByText('פעיל', { exact: true })).toBeVisible();

    // Details tab — skills
    await expect(page.getByText('מנהל עבודה')).toBeVisible();

    // Jobs tab
    await page.getByRole('tab', { name: 'עבודות' }).click();
    await expect(page.getByText('היסטוריית עבודות')).toBeVisible();
    await expect(page.getByText('אריזה', { exact: false }).first()).toBeVisible();

    // Payments tab
    await page.getByRole('tab', { name: 'תשלומים' }).click();
    await expect(page.getByText('₪500')).toBeVisible();
  });
});

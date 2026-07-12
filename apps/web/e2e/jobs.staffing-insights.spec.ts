import { expect, test } from '@playwright/test';

test.describe('Jobs staffing insights', () => {
  test.beforeEach(async ({ page }) => {
    await page.route('**/api/v1/customers', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([
          {
            id: 'customer-1',
            firstName: 'נועה',
            lastName: 'כהן',
            phone: '0501234567',
            email: 'noa@example.com',
          },
        ]),
      });
    });

    await page.route('**/api/v1/addresses/for-customer/*', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([
          {
            id: 'address-1',
            customerId: 'customer-1',
            fullAddress: 'תל אביב 1',
          },
        ]),
      });
    });

    await page.route('**/api/v1/cases', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([
          {
            id: 'case-1',
            name: 'פרויקט נועה',
            status: 'ACTIVE',
            latestActivityDate: '2026-07-12T08:00:00.000Z',
            customer: { id: 'customer-1' },
          },
        ]),
      });
    });

    await page.route('**/api/v1/jobs', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([
          {
            id: 'job-1',
            customerId: 'customer-1',
            caseId: 'case-1',
            addressId: 'address-1',
            jobType: 'PACKING',
            date: '2026-07-12T08:00:00.000Z',
            plannedStart: '2026-07-12T08:00:00.000Z',
            plannedEnd: '2026-07-12T13:00:00.000Z',
            requiredWorkerCount: 4,
            staffingMode: 'MANAGER_APPROVAL',
            status: 'PUBLISHED',
            customer: { firstName: 'נועה', lastName: 'כהן' },
            case: { id: 'case-1', name: 'פרויקט נועה' },
            address: { fullAddress: 'תל אביב 1' },
            slots: [{ requiredSkill: 'SHIFT_LEADER' }],
            shifts: [{ workerId: 'worker-1' }, { workerId: 'worker-2' }, { workerId: 'worker-3' }],
          },
          {
            id: 'job-2',
            customerId: 'customer-1',
            caseId: 'case-1',
            addressId: 'address-1',
            jobType: 'UNPACKING',
            date: '2026-07-12T09:00:00.000Z',
            plannedStart: '2026-07-12T09:00:00.000Z',
            plannedEnd: '2026-07-12T14:00:00.000Z',
            requiredWorkerCount: 2,
            staffingMode: 'AUTO_APPROVE',
            status: 'COMPLETED',
            customer: { firstName: 'נועה', lastName: 'כהן' },
            case: { id: 'case-1', name: 'פרויקט נועה' },
            address: { fullAddress: 'תל אביב 1' },
            slots: [{ requiredSkill: null }],
            shifts: [{ workerId: 'worker-4' }, { workerId: 'worker-5' }],
          },
        ]),
      });
    });
  });

  test('shows agreed/scheduled/actual summary and separate shortage chips', async ({ page }) => {
    await page.goto('/jobs');
    await page.getByRole('button', { name: 'תצוגת עבודות' }).click();

    const insightsPanel = page.getByTestId('staffing-insights-panel');
    await expect(insightsPanel).toBeVisible();
    await expect(insightsPanel.getByText('מה סוכם מול לקוח / מה שובץ / מה בוצע בפועל')).toBeVisible();
    await expect(insightsPanel.getByText('סוכם', { exact: true })).toBeVisible();
    await expect(insightsPanel.getByText('שובץ', { exact: true })).toBeVisible();
    await expect(insightsPanel.getByText('בוצע בפועל', { exact: true })).toBeVisible();

    await expect(page.getByText('חוסר עובדים: 1')).toBeVisible();
    await expect(page.getByText('חוסר מנהל: 1')).toBeVisible();
  });
});

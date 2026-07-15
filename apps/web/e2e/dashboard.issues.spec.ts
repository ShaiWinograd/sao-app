import { expect, test } from '@playwright/test';

test.describe('Dashboard urgent and workflow sections', () => {
  test.beforeEach(async ({ page }) => {
    await page.route('**/api/v1/customers', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([
          {
            id: 'customer-1',
            firstName: 'יעל',
            lastName: 'כהן',
            phone: '0501111111',
            email: 'yael@example.com',
            addresses: ['תל אביב 1'],
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
            id: 'case-draft',
            customerId: 'customer-1',
            name: 'מעבר דירה משפחת כהן',
            status: 'DRAFT',
            updatedAt: '2026-07-12T08:00:00.000Z',
          },
          {
            id: 'case-active',
            customerId: 'customer-1',
            name: 'אריזה דחופה',
            status: 'ACTIVE',
            updatedAt: '2026-07-12T08:00:00.000Z',
          },
        ]),
      });
    });

    await page.route('**/api/v1/jobs', async (route) => {
      const soonIso = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([
          {
            id: 'job-1',
            customerId: 'customer-1',
            caseId: 'case-active',
            date: soonIso,
            status: 'PUBLISHED',
            jobType: 'PACKING',
            requiredWorkerCount: 4,
            customer: { firstName: 'יעל', lastName: 'כהן' },
            case: { id: 'case-active', name: 'אריזה דחופה' },
            address: { fullAddress: 'תל אביב 1' },
            shifts: [{ worker: { firstName: 'נועה', lastName: 'לוי' } }],
            slots: [{ requiredSkill: 'SHIFT_LEADER' }],
          },
        ]),
      });
    });
  });

  test('shows a focused urgent panel with only near-term understaffed shifts', async ({ page }) => {
    await page.goto('/dashboard');

    // At-a-glance stat cards
    await expect(page.getByText('חריגות', { exact: true })).toBeVisible();
    await expect(page.getByText('מחכות לאישור', { exact: true })).toBeVisible();
    await expect(page.getByText('עבודות היום', { exact: true })).toBeVisible();

    // Header quick action
    await expect(page.getByRole('link', { name: 'יצירת פרויקט חדש' })).toBeVisible();

    const urgentPanel = page.getByTestId('dashboard-urgent-panel');
    await expect(urgentPanel).toBeVisible();
    await expect(urgentPanel.getByRole('heading', { name: 'דורש טיפול' })).toBeVisible();
    await expect(urgentPanel.getByText('חסרים 3 עובדים', { exact: true })).toBeVisible();
    await expect(urgentPanel.getByRole('link', { name: 'פתיחת העבודה' }).first()).toBeVisible();

    // The noisy workflow board was removed.
    await expect(page.getByTestId('dashboard-workflow-sections')).toHaveCount(0);
  });
});

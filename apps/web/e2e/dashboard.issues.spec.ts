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
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([
          {
            id: 'job-1',
            customerId: 'customer-1',
            caseId: 'case-active',
            date: '2026-07-12T08:00:00.000Z',
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

  test('shows urgent panel and separated workflow sections with direct actions', async ({ page }) => {
    await page.goto('/dashboard');

    const urgentPanel = page.getByTestId('dashboard-urgent-panel');
    await expect(urgentPanel).toBeVisible();
    await expect(urgentPanel.getByRole('heading', { name: 'דורש טיפול' })).toBeVisible();
    await expect(urgentPanel.getByText('חסרים 3 עובדים', { exact: true })).toBeVisible();
    await expect(urgentPanel.getByText('לעבודה אין מנהל עבודה משויך', { exact: true })).toBeVisible();
    await expect(urgentPanel.getByRole('link', { name: 'פעולה ישירה' }).first()).toBeVisible();

    const workflow = page.getByTestId('dashboard-workflow-sections');
    await expect(workflow).toBeVisible();
    await expect(workflow.getByText('מחכה לאישור הצעת מחיר')).toBeVisible();
    await expect(workflow.getByText('עבודות לא מאוישות')).toBeVisible();
    await expect(workflow.getByText('חסר מנהל עבודה')).toBeVisible();
  });
});

import { expect, test } from '@playwright/test';

test.describe('Forms page end-shift flow', () => {
  test.beforeEach(async ({ page }) => {
    await page.route('**/api/v1/forms/templates', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([
          {
            id: 'template-1',
            jobType: 'אריזה',
            title: 'טופס אריזה',
            questions: [
              {
                id: 'q-1',
                label: 'האם הלקוחה הייתה נוכחת?',
                type: 'yes_no',
                required: true,
                visibility: 'worker',
              },
            ],
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
            date: '2026-07-12T08:00:00.000Z',
            plannedEnd: '2026-07-12T12:00:00.000Z',
            jobType: 'PACKING',
            customer: { firstName: 'נועה', lastName: 'כהן' },
            case: { name: 'פרויקט נועה' },
            shifts: [
              {
                id: 'shift-1',
                formStatus: 'NOT_SUBMITTED',
                clockOut: null,
                worker: { firstName: 'יעל', lastName: 'כהן' },
              },
            ],
          },
        ]),
      });
    });

    await page.route('**/api/v1/forms/recent?limit=30', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([]),
      });
    });
  });

  test('allows adding a template question in the builder', async ({ page }) => {
    await page.goto('/forms');

    await expect(page.getByRole('heading', { name: 'טפסי סיום משמרת' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'אריזה' })).toBeVisible();

    const uniqueLabel = `שאלת בדיקה ${Date.now()}`;
    await page.getByPlaceholder('כותרת שאלה').fill(uniqueLabel);
    await page.getByRole('button', { name: 'הוספת שאלה' }).click();

    await expect(page.getByText('השאלה נוספה לתבנית בהצלחה.')).toBeVisible();
    await expect(page.getByRole('cell', { name: uniqueLabel })).toBeVisible();
  });

  test('shows validation when submitting without selected shift', async ({ page }) => {
    await page.goto('/forms');

    await expect(page.locator('select').nth(1)).toHaveValue('נועה כהן');

    await page.getByRole('button', { name: 'שליחת טופס וקישור לתיק' }).click();

    await expect(page.getByText('יש לבחור משמרת קיימת כדי לשמור טופס לשרת.')).toBeVisible();
  });
});

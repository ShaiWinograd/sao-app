import { expect, test } from '@playwright/test';

const shift = {
  id: 'shift-1',
  scheduledStart: '2026-08-01T08:00:00.000Z',
  scheduledEnd: '2026-08-01T13:00:00.000Z',
  actualStart: '2026-08-01T08:05:00.000Z',
  actualEnd: null,
  clockInDistanceMeters: 40,
  clockOutDistanceMeters: 0,
  attendanceStatus: 'CLOCKED_IN',
  clockInMethod: 'NORMAL',
  requiresReview: true,
  worker: { id: 'w1', firstName: 'נועה', lastName: 'לוי' },
  job: { date: '2026-08-01T08:00:00.000Z', jobType: 'PACKING' },
};

test.describe('Attendance review', () => {
  test.beforeEach(async ({ page }) => {
    await page.route('**/api/v1/attendance/needs-review', async (route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([shift]) });
    });
  });

  test('approves an attendance record needing review', async ({ page }) => {
    let corrected = false;
    await page.route('**/api/v1/attendance/correct', async (route) => {
      corrected = true;
      await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
    });

    await page.goto('/attendance');

    await expect(page.getByText('נועה לוי')).toBeVisible();
    await page.getByRole('button', { name: 'אישור' }).click();

    await expect.poll(() => corrected).toBe(true);
  });

  test('saves a manual attendance correction', async ({ page }) => {
    let correctionBody: Record<string, unknown> | null = null;
    await page.route('**/api/v1/attendance/correct', async (route) => {
      correctionBody = route.request().postDataJSON();
      await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
    });

    await page.goto('/attendance');

    await page.getByRole('button', { name: 'תיקון' }).click();
    await page.getByPlaceholder('למשל: העובד שכח להחתים יציאה').fill('העובד שכח להחתים יציאה');
    await page.getByRole('button', { name: 'שמירת תיקון' }).click();

    await expect.poll(() => correctionBody?.reason).toBe('העובד שכח להחתים יציאה');
  });
});

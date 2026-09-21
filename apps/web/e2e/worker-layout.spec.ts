import { expect, test } from '@playwright/test';

test.describe('Worker desktop layout', () => {
  test('centers history content and presents an intentional empty state', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.route('**/api/v1/shifts/mine', async (route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
    });

    await page.goto('/worker/history');

    const content = page.getByTestId('worker-history-page');
    const mainBounds = await page.locator('main').boundingBox();
    const bounds = await content.boundingBox();
    expect(bounds?.width).toBeGreaterThanOrEqual(1000);
    const leftGap = (bounds?.x ?? 0) - (mainBounds?.x ?? 0);
    const rightGap =
      (mainBounds?.x ?? 0) + (mainBounds?.width ?? 0) - ((bounds?.x ?? 0) + (bounds?.width ?? 0));
    expect(Math.abs(leftGap - rightGap)).toBeLessThan(4);
    await expect(page.getByRole('heading', { name: 'העבודה שעשית' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'אין משמרות בתקופה הזו' })).toBeVisible();
  });

  test('supports worker mobile home and swipe navigation gestures', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.route('**/api/v1/jobs/board', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }),
    );
    await page.route('**/api/v1/shifts/swaps/mine', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }),
    );
    await page.route('**/api/v1/shifts/replacement-requests/open', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }),
    );
    await page.route('**/api/v1/shifts/mine', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }),
    );

    await page.goto('/worker/history');
    await page.getByRole('link', { name: 'מעבר למסך המשמרות' }).click();
    await expect(page).toHaveURL(/\/worker$/);
    await expect(page.getByRole('button', { name: 'שבוע הבא' })).toBeVisible();

    const main = page.locator('main');
    await main.dispatchEvent('pointerdown', { pointerType: 'touch', clientX: 300, clientY: 400 });
    await main.dispatchEvent('pointerup', { pointerType: 'touch', clientX: 180, clientY: 405 });
    await expect(page).toHaveURL(/\/worker\/history$/);

    await main.dispatchEvent('pointerdown', { pointerType: 'touch', clientX: 385, clientY: 400 });
    await main.dispatchEvent('pointerup', { pointerType: 'touch', clientX: 290, clientY: 405 });
    await expect(page.getByRole('dialog', { name: 'תפריט ניווט' })).toBeVisible();

    const drawer = page.getByRole('dialog', { name: 'תפריט ניווט' });
    await drawer.dispatchEvent('pointerdown', { pointerType: 'touch', clientX: 120, clientY: 400 });
    await drawer.dispatchEvent('pointerup', { pointerType: 'touch', clientX: 210, clientY: 405 });
    await expect(page.getByRole('dialog', { name: 'תפריט ניווט' })).toHaveCount(0);
  });

  test('leads with the worker schedule and next confirmed shift on desktop', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    const nextDate = new Date();
    nextDate.setDate(nextDate.getDate() + 1);
    nextDate.setHours(0, 0, 0, 0);

    await page.route('**/api/v1/jobs/board', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([
          {
            jobId: 'job-next',
            jobType: 'HOME_ORGANIZATION',
            date: nextDate.toISOString(),
            plannedStart: '09:00',
            plannedEnd: '15:00',
            customerName: 'משפחת לוי',
            address: 'תל אביב',
            requiredWorkerCount: 2,
            assignedWorkers: [{ name: 'שי', isTeamLeader: false }],
            openSpots: 1,
            myStatus: 'APPROVED',
            myShiftId: 'shift-next',
          },
        ]),
      }),
    );
    await page.route('**/api/v1/shifts/swaps/mine', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }),
    );
    await page.route('**/api/v1/shifts/replacement-requests/open', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }),
    );

    await page.goto('/worker');

    await expect(page.getByRole('heading', { name: 'המשמרות שלי' })).toBeVisible();
    await expect(page.getByText('המשמרת הבאה')).toBeVisible();
    await expect(page.getByText('משפחת לוי').first()).toBeVisible();
    await expect(page.getByText('הצוות במשמרת')).toBeVisible();
    await expect(page.getByText('שי').first()).toBeVisible();
    await page.getByRole('button', { name: /תל אביב/ }).first().click();
    await expect(page.getByTitle('מפה של תל אביב')).toBeVisible();
    await expect(page.getByRole('button', { name: 'שבוע הבא' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'היומן שלי' })).toHaveClass(/border-primary-700/);

    const mainBounds = await page.locator('main').boundingBox();
    const calendarBounds = await page.getByTestId('worker-week-calendar').boundingBox();
    const leftGap = (calendarBounds?.x ?? 0) - (mainBounds?.x ?? 0);
    const rightGap =
      (mainBounds?.x ?? 0) + (mainBounds?.width ?? 0) -
      ((calendarBounds?.x ?? 0) + (calendarBounds?.width ?? 0));
    expect(Math.abs(leftGap - rightGap)).toBeLessThan(4);
    await expect(page.locator('aside nav svg')).toHaveCount(0);
  });
});

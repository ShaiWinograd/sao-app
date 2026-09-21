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
    await page.route('**/api/v1/workers/me/availability', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }),
    );

    await page.goto('/worker/history');
    await page.getByRole('link', { name: 'מעבר למסך המשמרות' }).click();
    await expect(page).toHaveURL(/\/worker$/);
    await expect(page.getByText('היומן של כולן')).toBeVisible();

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
    const invitedDate = new Date(nextDate);
    invitedDate.setDate(invitedDate.getDate() + 1);
    const openDate = new Date(invitedDate);
    openDate.setDate(openDate.getDate() + 1);

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
          {
            jobId: 'job-invited',
            jobType: 'PACKING',
            date: invitedDate.toISOString(),
            plannedStart: '10:00',
            plannedEnd: '14:00',
            customerName: 'נועה ישראלי',
            address: 'רמת גן 4',
            requiredWorkerCount: 2,
            assignedWorkers: [{ name: 'רות', isTeamLeader: true }],
            openSpots: 1,
            myStatus: 'AWAITING_WORKER',
            myShiftId: 'shift-invited',
          },
          {
            jobId: 'job-open',
            jobType: 'UNPACKING',
            date: openDate.toISOString(),
            plannedStart: '08:30',
            plannedEnd: '12:30',
            customerName: 'דנה כהן',
            address: 'גבעתיים 8',
            requiredWorkerCount: 3,
            assignedWorkers: [{ name: 'מיה', isTeamLeader: false }],
            openSpots: 2,
            myStatus: 'NONE',
            myShiftId: null,
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
    let availabilityPayload: Record<string, unknown> | null = null;
    let savedAvailability: Record<string, unknown>[] = [];
    await page.route('**/api/v1/workers/me/availability', async (route) => {
      if (route.request().method() === 'POST') {
        availabilityPayload = route.request().postDataJSON() as Record<string, unknown>;
        savedAvailability = [{ id: 'availability-1', ...availabilityPayload }];
        await route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify({ id: 'availability-1' }) });
        return;
      }
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(savedAvailability) });
    });

    await page.goto('/worker');

    const nextDateKey = `${nextDate.getFullYear()}-${String(nextDate.getMonth() + 1).padStart(2, '0')}-${String(nextDate.getDate()).padStart(2, '0')}`;
    await expect(page.locator(`#worker-day-${nextDateKey}`)).toBeInViewport();
    await expect(page.locator(`[data-worker-date="${nextDateKey}"]`)).toBeInViewport();
    await expect(page.getByRole('heading', { name: 'המשמרות שלי' })).toBeVisible();
    await expect(page.getByText('המשמרת הבאה')).toBeVisible();
    await expect(page.getByText('משפחת לוי').first()).toBeVisible();
    await expect(page.getByText('הצוות במשמרת')).toBeVisible();
    await expect(page.getByText('שי').first()).toBeVisible();
    await page.getByRole('button', { name: /תל אביב/ }).first().click();
    await expect(page.getByTitle('מפה של תל אביב')).toBeVisible();
    await expect(page.getByText('היומן של כולן')).toBeVisible();
    await page.getByRole('button', { name: 'חזרה להיום' }).click();
    const availableDay = page.getByRole('button', { name: 'זמינה', exact: true }).first();
    await expect(availableDay).toBeVisible();
    await availableDay.click();
    await expect(page.getByRole('dialog', { name: 'עדכון זמינות' })).toBeVisible();
    await page.getByRole('button', { name: 'שעות מסוימות' }).click();
    await page.locator('input[type="time"]').first().fill('13:00');
    await page.locator('input[type="time"]').last().fill('17:00');
    await page.getByLabel('סיבה (רשות)').fill('לימודים');
    await page.getByRole('button', { name: 'סימון כלא זמינה' }).click();
    expect(availabilityPayload).toMatchObject({ type: 'DATE', startTime: '13:00', endTime: '17:00', reason: 'לימודים' });
    await expect(page.locator('[aria-label="הוגדרה זמינות"]')).toHaveCount(1);

    await page.getByRole('button', { name: 'כל פרטי המשמרת' }).click();
    await expect(page).toHaveURL(/\/worker$/);
    await expect(page.getByRole('button', { name: 'סגירת הפרטים' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'החלפה או בקשת מחליפה' }).first()).toBeVisible();
    await expect(page.getByText('נועה ישראלי')).toBeVisible();
    await expect(page.getByText('רמת גן 4')).toBeVisible();
    await expect(page.getByRole('button', { name: 'אישור' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'דחייה' })).toBeVisible();
    await expect(page.getByText('דנה כהן')).toBeVisible();
    await expect(page.getByText('גבעתיים 8')).toBeVisible();
    await expect(page.getByText('לחצי כדי לבקש להצטרף ›')).toBeVisible();
    await expect(page.getByRole('button', { name: 'הוספה ל-Google או Apple Calendar' })).toBeVisible();
    await page.getByRole('button', { name: 'קשורות אליי' }).click();
    await expect(page.getByText('דנה כהן')).toHaveCount(0);

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

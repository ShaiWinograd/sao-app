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
            status: 'RESERVATION',
            jobType: 'PACKING',
            requiredWorkerCount: 4,
            customer: { firstName: 'יעל', lastName: 'כהן' },
            case: { id: 'case-active', name: 'אריזה דחופה' },
            address: { fullAddress: 'תל אביב 1' },
            shifts: [
              {
                worker: { firstName: 'נועה', lastName: 'לוי' },
                joinRequestStatus: 'APPROVED',
                assignmentRole: 'REGULAR',
              },
              {
                worker: { firstName: 'מיה', lastName: 'גל' },
                joinRequestStatus: 'PENDING',
                assignmentRole: 'REGULAR',
              },
              {
                worker: { firstName: 'רות', lastName: 'בר' },
                joinRequestStatus: 'AWAITING_WORKER',
                assignmentRole: 'REGULAR',
              },
            ],
            slots: [{ requiredSkill: 'SHIFT_LEADER' }],
          },
        ]),
      });
    });

    await page.route('**/api/v1/workers', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([
          {
            id: 'worker-michal',
            firstName: 'מיכל',
            lastName: 'כהן',
            skills: ['GENERAL_WORKER'],
          },
          ...Array.from({ length: 14 }, (_, index) => ({
            id: `worker-${index}`,
            firstName: `עובדת ${index + 1}`,
            lastName: 'בדיקה',
            skills: ['GENERAL_WORKER'],
          })),
        ]),
      });
    });

    await page.route('**/api/v1/workers/calendar-availability*', async (route) => {
      const availableBlockDate = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toLocaleDateString('en-CA');
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([
          {
            workerId: 'worker-michal',
            dateKey: availableBlockDate,
            reason: 'חופשה',
            startTime: '10:00',
            endTime: '13:30',
          },
        ]),
      });
    });

    await page.route('**/api/v1/admin/tasks', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          joinRequests: 0,
          pendingAcceptance: 0,
          replacementRequests: 0,
          swapApprovals: 0,
          attendanceReview: 0,
          reportCorrections: 0,
          customerReportReady: 0,
          todayInReservation: 0,
          pastNotCompleted: 0,
          todayInReservationJobs: [],
          pastNotCompletedJobs: [],
        }),
      });
    });
  });

  test('shows direct operational actions and no separate urgent panel', async ({
    page,
  }) => {
    await page.goto('/dashboard');

    // At-a-glance metrics are direct actions.
    await expect(page.getByRole('button', { name: /חריגות · לטיפול/ })).toBeVisible();
    await expect(page.getByRole('button', { name: /בקשות הצטרפות/ })).toBeVisible();
    await expect(page.getByRole('button', { name: /עבודות היום/ })).toBeVisible();
    await page.getByRole('button', { name: /חריגות · לטיפול/ }).click();
    await expect(page.getByRole('heading', { name: 'חריגות שדורשות טיפול' })).toBeVisible();
    await expect(page.getByText('אריזה דחופה').first()).toBeVisible();
    await page.getByRole('button', { name: 'סגירה' }).click();

    // Creation is available from each future date instead of a global header action.
    await expect(page.getByRole('button', { name: 'יצירת עבודה', exact: true })).toHaveCount(0);

    // The separate 'must handle' urgent panel was removed.
    await expect(page.getByTestId('dashboard-urgent-panel')).toHaveCount(0);

  });

  test('uses the full viewport and a navigation drawer on mobile', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/dashboard');

    const main = page.locator('main');
    const bounds = await main.boundingBox();
    expect(bounds?.width).toBeGreaterThanOrEqual(380);
    await expect(page.getByRole('button', { name: 'פתיחת תפריט' })).toBeVisible();

    await page.getByRole('button', { name: 'פתיחת תפריט' }).click();
    const navigationDrawer = page.getByRole('dialog', { name: 'תפריט ניווט' });
    await expect(navigationDrawer).toBeVisible();
    await expect(page.getByRole('link', { name: 'בית' })).toBeVisible();
    await expect(navigationDrawer.getByText('ניווט', { exact: true })).toHaveCount(0);
    await expect(navigationDrawer.getByRole('link', { name: 'יומן עבודות' })).toHaveCount(0);
    const navigationLabels = await navigationDrawer.locator('nav a').allTextContents();
    navigationLabels.forEach((label) => expect(label.trim()).not.toMatch(/^\d{2}/));

    await page.getByRole('button', { name: 'סגירת תפריט' }).click();
    await page.goto('/jobs/new');
    await expect(page).toHaveURL(/\/dashboard\?createDate=/);

    const firstName = page.getByPlaceholder('שם פרטי');
    const lastName = page.getByPlaceholder('שם משפחה');
    const firstNameBounds = await firstName.boundingBox();
    const lastNameBounds = await lastName.boundingBox();
    expect(firstNameBounds?.width).toBeGreaterThanOrEqual(300);
    expect(lastNameBounds?.y).toBeGreaterThan((firstNameBounds?.y ?? 0) + 30);
  });

  test('uses the spacious desktop shell without mobile navigation', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/dashboard');

    await expect(page.getByRole('button', { name: 'פתיחת תפריט' })).toBeHidden();
    const sidebarBounds = await page.locator('aside').first().boundingBox();
    const mainBounds = await page.locator('main').boundingBox();
    expect(sidebarBounds?.width).toBe(220);
    expect(mainBounds?.width).toBeGreaterThanOrEqual(1190);
    await page.getByRole('button', { name: 'סגירת תפריט צד' }).click();
    await expect(page.getByRole('button', { name: 'פתיחת תפריט צד' })).toBeVisible();
    const expandedMainBounds = await page.locator('main').boundingBox();
    expect(expandedMainBounds?.width).toBeGreaterThan(mainBounds?.width ?? 0);
    await page.getByRole('button', { name: 'פתיחת תפריט צד' }).click();
    const brand = page.getByRole('link', { name: 'מעבר ללוח הבקרה' });
    await expect(brand).not.toContainText('ניהול עסק');
    const logoBounds = await brand.locator('img').boundingBox();
    expect(logoBounds?.width).toBeGreaterThanOrEqual(92);
    await expect(page.getByRole('heading', { name: 'היום בעסק' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'יומן עבודות' })).toHaveCount(0);
  });

  test('redirects the retired jobs calendar to the home calendar', async ({ page }) => {
    await page.goto('/jobs');
    await expect(page).toHaveURL(/\/dashboard#owner-shift-grid$/);
    await expect(page.getByRole('heading', { name: 'היום בעסק' })).toBeVisible();
  });

  test('uses date headers for creation and worker cells for assignment', async ({ page }) => {
    const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000).toLocaleDateString('en-CA');
    const assignment: { jobId?: string; workerId?: string; role?: string } = {};
    await page.route('**/api/v1/shifts/admin-assign', async (route) => {
      Object.assign(assignment, route.request().postDataJSON());
      await route.fulfill({
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify({ shift: { id: 'shift-created' } }),
      });
    });

    await page.goto('/dashboard');

    await expect(page.getByText('לא זמינה', { exact: true })).toBeVisible();
    await expect(page.getByText('חופשה', { exact: true })).toBeVisible();
    await expect(page.getByText('10:00–13:30', { exact: true })).toBeVisible();
    const calendarScroll = page.getByTestId('owner-calendar-scroll');
    expect(await calendarScroll.evaluate((element) => element.scrollHeight > element.clientHeight)).toBe(true);
    const createForDate = page.getByRole('button', { name: `יצירת עבודה בתאריך ${tomorrow}` });
    await expect(createForDate).toBeVisible();
    await expect(
      page.locator('button[aria-label^="יצירת עבודה בתאריך"]').filter({ hasText: 'יצירת עבודה' }),
    ).toHaveCount(0);
    await expect(page.getByRole('link', { name: 'החלפות משמרות' })).toBeVisible();
    await createForDate.click();
    await expect(page.getByRole('heading', { name: 'יצירת עבודה' })).toBeVisible();
    await page.getByRole('button', { name: 'סגירה' }).click();
    await expect(page.getByText('סיכום שיבוץ לעבודות')).toHaveCount(0);

    await page.getByRole('button', { name: `שיבוץ מיכל כהן בתאריך ${tomorrow}` }).click();
    await expect(page.getByRole('heading', { name: 'שיבוץ עובדת' })).toBeVisible();
    await page.getByRole('button', { name: /שיבוץ לעבודה/ }).click();

    await expect.poll(() => assignment).toEqual({ jobId: 'job-1', workerId: 'worker-michal', role: 'REGULAR' });
  });

  test('keeps staffing details compact in the staffing-gap row', async ({ page }) => {
    await page.goto('/dashboard');

    const gapLine = page.getByTestId('staffing-gap-bottom-line');
    await expect(gapLine).toHaveText('2/4 מאוישים · 2 חסרים');
    await expect(page.getByLabel('1 בקשות הצטרפות ממתינות')).toBeVisible();
    await expect(page.getByTestId('staffing-state-summary')).toHaveCount(0);

    await gapLine.hover();
    await expect(page.getByText('נועה לוי · מאושרת')).toBeVisible();
    await expect(page.getByText('מיה גל · ממתינה לאישור שלך')).toBeVisible();
    await expect(page.getByText('רות בר · ממתינה לאישור העובדת')).toBeVisible();
    await expect(page.getByText('2 חסרים').last()).toBeVisible();
  });

  test('keeps the selected date across views and returns the current view to today', async ({ page }) => {
    const today = new Date().toLocaleDateString('en-CA');
    await page.goto('/dashboard');

    const datePicker = page.getByLabel('בחירת תאריך לתצוגת היומן');
    await datePicker.fill('2026-10-14');
    await page.getByRole('button', { name: 'חודש', exact: true }).click();
    await expect(datePicker).toHaveValue('2026-10-14');

    await page.getByRole('button', { name: 'שבוע', exact: true }).click();
    await expect(datePicker).toHaveValue('2026-10-14');
    await expect(page.getByText('14.10', { exact: true })).toBeVisible();

    await page.getByRole('button', { name: 'חודש', exact: true }).click();
    await page.getByRole('button', { name: 'היום', exact: true }).click();
    await expect(datePicker).toHaveValue(today);
  });

  test('creates a job with the server-signed geocoded address selection', async ({ page }) => {
    const submitted: { payload?: { address?: unknown; cityOrAddress?: unknown; initialStatus?: unknown } } = {};
    await page.route('**/api/v1/geocode/suggest', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          available: true,
          candidates: [
            {
              token: 'signed-address-token',
              displayAddress: 'הרצל 10, תל אביב',
              city: 'תל אביב',
              precision: 'HOUSE',
              exact: true,
            },
          ],
        }),
      });
    });
    await page.route('**/api/v1/jobs/quick', async (route) => {
      submitted.payload = route.request().postDataJSON();
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          job: { id: 'job-geocoded' },
          capacityWarning: false,
          availableWorkers: 3,
        }),
      });
    });

    await page.goto('/jobs/new');
    await expect(page.getByRole('button', { name: 'יצירת העבודה' })).toHaveCount(0);
    await expect(page.getByText('סטטוס התחלתי', { exact: true })).toHaveCount(0);
    await expect(page.getByText('מתלמדת', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'אושר', exact: true }).click();
    await expect(page.getByPlaceholder('שם פרטי')).toHaveAttribute('aria-invalid', 'true');
    await expect(page.getByPlaceholder('טלפון')).toHaveAttribute('aria-invalid', 'true');
    await expect(page.getByPlaceholder('רחוב, מספר ועיר')).toHaveAttribute('aria-invalid', 'true');
    await page.getByPlaceholder('שם פרטי').fill('יעל');
    await page.getByPlaceholder('טלפון').fill('0501111111');
    await page.getByPlaceholder('רחוב, מספר ועיר').fill('הרצל 10 תל אביב');
    await page.getByRole('button', { name: 'סגירת הצעות כתובת' }).click();
    await expect(page.getByRole('button', { name: /הרצל 10, תל אביב/ })).toHaveCount(0);
    await page.getByPlaceholder('רחוב, מספר ועיר').focus();
    await page.getByRole('button', { name: /הרצל 10, תל אביב/ }).click();

    await expect(page.getByText('הכתובת אומתה ותאפשר ניטור מיקום במשמרת.')).toBeVisible();
    await page.getByRole('button', { name: 'אושר', exact: true }).click();
    await expect.poll(() => submitted.payload).toBeDefined();
    expect(submitted.payload?.address).toEqual({ mode: 'selected', token: 'signed-address-token' });
    expect(submitted.payload?.initialStatus).toBe('APPROVED');
    expect(submitted.payload).not.toHaveProperty('cityOrAddress');
  });
});

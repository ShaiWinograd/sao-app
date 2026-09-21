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
            shifts: [{ worker: { firstName: 'נועה', lastName: 'לוי' } }],
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

  test('shows workflow sections with direct actions and no separate urgent panel', async ({
    page,
  }) => {
    await page.goto('/dashboard');

    // At-a-glance stat cards
    await expect(page.getByText('חריגות', { exact: true })).toBeVisible();
    await expect(page.getByText('מחכות לאישור', { exact: true })).toBeVisible();
    await expect(page.getByText('עבודות היום', { exact: true })).toBeVisible();

    // Header quick action
    await expect(page.getByRole('button', { name: 'יצירת עבודה' })).toBeVisible();

    // The separate 'must handle' urgent panel was removed.
    await expect(page.getByTestId('dashboard-urgent-panel')).toHaveCount(0);

    const workflow = page.getByTestId('dashboard-workflow-sections');
    await expect(workflow).toBeVisible();
    await expect(workflow.getByText('מחכה לאישור הצעת מחיר')).toBeVisible();
    await expect(workflow.getByText('עבודות לא מאוישות')).toBeVisible();
    await expect(workflow.getByText('חסר ראש צוות')).toBeVisible();
  });

  test('uses the full viewport and a navigation drawer on mobile', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/dashboard');

    const main = page.locator('main');
    const bounds = await main.boundingBox();
    expect(bounds?.width).toBeGreaterThanOrEqual(380);
    await expect(page.getByRole('button', { name: 'פתיחת תפריט' })).toBeVisible();

    await page.getByRole('button', { name: 'פתיחת תפריט' }).click();
    await expect(page.getByRole('dialog', { name: 'תפריט ניווט' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'בית' })).toBeVisible();

    await page.getByRole('button', { name: 'סגירת תפריט' }).click();
    await page.goto('/jobs/new');

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
    const brand = page.getByRole('link', { name: 'מעבר ללוח הבקרה' });
    await expect(brand).not.toContainText('ניהול עסק');
    const logoBounds = await brand.locator('img').boundingBox();
    expect(logoBounds?.width).toBeGreaterThanOrEqual(92);
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
    await expect(page.getByRole('button', { name: `יצירת עבודה בתאריך ${tomorrow}` })).toBeVisible();

    await page.getByRole('button', { name: `שיבוץ מיכל כהן בתאריך ${tomorrow}` }).click();
    await expect(page.getByRole('heading', { name: 'שיבוץ עובדת' })).toBeVisible();
    await page.getByRole('button', { name: /שיבוץ לעבודה/ }).click();

    await expect.poll(() => assignment).toEqual({ jobId: 'job-1', workerId: 'worker-michal', role: 'REGULAR' });
  });

  test('creates a job with the server-signed geocoded address selection', async ({ page }) => {
    const submitted: { payload?: { address?: unknown; cityOrAddress?: unknown } } = {};
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
    await page.getByPlaceholder('שם פרטי').fill('יעל');
    await page.getByPlaceholder('טלפון').fill('0501111111');
    await page.getByPlaceholder('רחוב, מספר ועיר').fill('הרצל 10 תל אביב');
    await page.getByRole('button', { name: /הרצל 10, תל אביב/ }).click();

    await expect(page.getByText('הכתובת אומתה ותאפשר ניטור מיקום במשמרת.')).toBeVisible();
    await page.getByRole('button', { name: 'יצירת העבודה' }).click();
    await expect.poll(() => submitted.payload).toBeDefined();
    expect(submitted.payload?.address).toEqual({ mode: 'selected', token: 'signed-address-token' });
    expect(submitted.payload).not.toHaveProperty('cityOrAddress');
  });
});

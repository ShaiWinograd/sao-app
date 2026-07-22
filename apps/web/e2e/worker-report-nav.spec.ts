import { expect, test } from '@playwright/test';

// Owner monthly-report view navigation (§19 UX). The view lives in the URL so it
// is refresh- and back-safe, and the draft preview never needs a version id.
const WORKER = { id: 'w1', firstName: 'אורית', lastName: 'וינוגרד' };

const DRAFT = {
  workerId: WORKER.id,
  shifts: [
    {
      shiftId: 's1',
      date: '2026-07-22',
      customerName: 'נסיון',
      shiftLabel: 'אריזה',
      roleLabel: 'עובדת',
      clockIn: '09:05',
      clockOut: '13:58',
      approvedHours: '4.88',
      paidHours: 5,
      pay: '450',
    },
  ],
  summary: { shiftsCount: 1, totalApprovedHours: '4.88', totalPaidHours: 5, total: '450' },
  reportStatus: 'PUBLISHED',
  version: 1,
  versions: [{ id: 'v1', version: 1, status: 'PUBLISHED', publishedAt: '2026-07-22T09:00:00.000Z', workerApprovedAt: null }],
  notes: [],
};

const VERSION_SNAPSHOT = {
  workerId: WORKER.id,
  version: 1,
  status: 'PUBLISHED',
  publishedAt: '2026-07-22T09:00:00.000Z',
  month: 7,
  year: 2026,
  shifts: [
    { shiftId: 's1', date: '2026-07-22', customerName: 'נסיון', jobTypeLabel: 'אריזה', roleLabel: 'עובדת', clockIn: '09:05', clockOut: '13:58', approvedHours: '4.88', paidHours: 5, dayTotal: '450' },
  ],
  summary: { workdays: 1, totalApprovedHours: '4.88', totalPaidHours: 5, total: '450' },
};

test.describe('Owner monthly-report view navigation', () => {
  test.beforeEach(async ({ page }) => {
    await page.route('**/api/v1/payroll/summary**', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          workers: [{ id: WORKER.id, firstName: WORKER.firstName, lastName: WORKER.lastName, summary: DRAFT.summary, reportStatus: 'PUBLISHED', version: 1 }],
          month: 7,
          year: 2026,
        }),
      }),
    );
    await page.route('**/api/v1/payroll/worker/w1/version/v1', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(VERSION_SNAPSHOT) }),
    );
    await page.route('**/api/v1/payroll/worker/w1?**', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(DRAFT) }),
    );
  });

  test('View Draft opens the current worker draft with no version id', async ({ page }) => {
    await page.goto('/payroll');
    await page.getByRole('button', { name: new RegExp(WORKER.firstName) }).click();
    await expect(page).toHaveURL(/worker=w1/);
    await page.getByRole('button', { name: 'תצוגת טיוטה' }).click();
    await expect(page).toHaveURL(/view=draft/);
    await expect(page).not.toHaveURL(/version=/); // draft never needs a version id
    await expect(page.getByText('תצוגת טיוטה')).toBeVisible();
    await expect(page.getByText(new RegExp(`${WORKER.firstName} ${WORKER.lastName}`))).toBeVisible();
    await expect(page.getByText('כניסה 09:05 · יציאה 13:58')).toBeVisible();
  });

  test('refresh preserves the draft preview', async ({ page }) => {
    await page.goto('/payroll?worker=w1&month=7&year=2026&view=draft');
    await expect(page.getByText('תצוגת טיוטה')).toBeVisible();
    await page.reload();
    await expect(page).toHaveURL(/view=draft/);
    await expect(page.getByText('תצוגת טיוטה')).toBeVisible();
  });

  test('browser back returns from draft preview to the editor predictably', async ({ page }) => {
    await page.goto('/payroll');
    await page.getByRole('button', { name: new RegExp(WORKER.firstName) }).click();
    await page.getByRole('button', { name: 'תצוגת טיוטה' }).click();
    await expect(page).toHaveURL(/view=draft/);
    await page.goBack();
    await expect(page).toHaveURL(/worker=w1/);
    await expect(page).not.toHaveURL(/view=draft/);
    await expect(page.getByRole('button', { name: 'תצוגת טיוטה' })).toBeVisible(); // back on the editor
  });

  test('View Published Version opens the immutable stored snapshot', async ({ page }) => {
    await page.goto('/payroll?worker=w1&month=7&year=2026');
    await page.getByRole('button', { name: 'צפייה בדוח' }).click();
    await expect(page).toHaveURL(/version=v1/);
    await expect(page.getByText(/גרסה 1 · פורסם/)).toBeVisible();
    await expect(page.getByText('כניסה 09:05 · יציאה 13:58')).toBeVisible();
  });
});

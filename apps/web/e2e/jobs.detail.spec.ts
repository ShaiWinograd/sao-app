import { expect, test } from '@playwright/test';

const job = {
  id: 'job-1',
  caseId: 'case-1',
  jobType: 'PACKING',
  date: '2026-08-01T08:00:00.000Z',
  plannedStart: '2026-08-01T08:00:00.000Z',
  plannedEnd: '2026-08-01T13:00:00.000Z',
  status: 'RESERVATION',
  requiredWorkerCount: 2,
  addressId: 'addr-1',
  jobNotes: 'להביא ארגזים נוספים',
  workerVisibleNotes: null,
  address: { fullAddress: 'תל אביב 1' },
  customer: { firstName: 'יעל', lastName: 'כהן', phone: '0501111111' },
  slots: [
    { id: 'slot-mgr', requiredSkill: 'SHIFT_LEADER', label: null, filledByShiftId: 'shift-1' },
    { id: 'slot-w1', requiredSkill: null, label: null, filledByShiftId: null },
    { id: 'slot-w2', requiredSkill: null, label: null, filledByShiftId: null },
  ],
  shifts: [
    {
      id: 'shift-1',
      slotId: 'slot-mgr',
      workerNameSnapshot: 'דנה לוי',
      attendanceStatus: 'SCHEDULED',
      joinRequestStatus: 'APPROVED',
      formStatus: 'NOT_SUBMITTED',
      worker: { firstName: 'דנה', lastName: 'לוי' },
    },
    {
      id: 'shift-2',
      slotId: 'slot-w1',
      workerNameSnapshot: 'רון כהן',
      attendanceStatus: 'SCHEDULED',
      joinRequestStatus: 'PENDING',
      formStatus: 'NOT_SUBMITTED',
      worker: { firstName: 'רון', lastName: 'כהן' },
    },
  ],
};

test.describe('Job detail page', () => {
  test.beforeEach(async ({ page }) => {
    await page.route('**/api/v1/jobs/job-1', async (route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(job) });
    });
  });

  test('shows header, readiness checklist, and slot-based staffing', async ({ page }) => {
    await page.goto('/jobs/job-1');

    await expect(page.getByRole('heading', { name: 'אריזה · יעל כהן' })).toBeVisible();

    // Readiness checklist (details tab)
    await expect(page.getByText('מוכנות לעבודה')).toBeVisible();
    await expect(page.getByText('מוכן לפרסום')).toBeVisible();

    // Staffing tab — manager slot filled, worker slots empty
    await page.getByRole('tab', { name: 'עובדים' }).click();
    await expect(page.getByText('מנהל עבודה')).toBeVisible();
    await expect(page.getByText('דנה לוי')).toBeVisible();
    await expect(page.getByText('מקום פנוי').first()).toBeVisible();
  });

  test('approves a pending join request from the staffing tab', async ({ page }) => {
    let approved = false;
    await page.route('**/api/v1/shifts/shift-2/approve', async (route) => {
      approved = true;
      await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
    });

    await page.goto('/jobs/job-1');
    await page.getByRole('tab', { name: 'עובדים' }).click();

    await expect(page.getByText('רון כהן')).toBeVisible();
    await page.getByRole('button', { name: 'אישור' }).click();

    await expect.poll(() => approved).toBe(true);
  });
});

import { expect, test } from '@playwright/test';

const job = {
  id: 'job-1',
  caseId: 'case-1',
  jobType: 'PACKING',
  date: '2026-08-01T08:00:00.000Z',
  plannedStart: '2026-08-01T08:00:00.000Z',
  plannedEnd: '2026-08-01T13:00:00.000Z',
  status: 'DRAFT',
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
});

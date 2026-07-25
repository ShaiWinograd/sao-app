import { expect, test } from '@playwright/test';

// Production-representative case (job cms0bntts…): an APPROVED REGULAR shift whose
// slotId is null. Before PR-1 it was invisible in the slot-based Workers tab while
// visible in the shift-based Attendance tab. The shared derivation fixes this.
const jobSlotlessApproved = {
  id: 'job-slotless',
  caseId: 'case-1',
  jobType: 'PACKING',
  date: '2026-08-01T08:00:00.000Z',
  plannedStart: '2026-08-01T08:00:00.000Z',
  plannedEnd: '2026-08-01T13:00:00.000Z',
  status: 'RESERVATION',
  requiredWorkerCount: 1,
  addressId: 'addr-1',
  jobNotes: null,
  workerVisibleNotes: null,
  address: { fullAddress: 'תל אביב 1' },
  customer: { firstName: 'יעל', lastName: 'כהן', phone: '0501111111' },
  // One unbound slot — the derivation must NOT rely on it to detect assignment.
  slots: [{ id: 'slot-x', requiredSkill: null, label: null, filledByShiftId: null }],
  shifts: [
    {
      id: 'shift-orit',
      slotId: null,
      workerNameSnapshot: 'אורית וינוגרד',
      attendanceStatus: 'SCHEDULED',
      joinRequestStatus: 'APPROVED',
      assignmentRole: 'REGULAR',
      formStatus: 'NOT_SUBMITTED',
      worker: { firstName: 'אורית', lastName: 'וינוגרד' },
    },
  ],
};

// A job with a pending join request (slotId null) for the approve action.
const jobPending = {
  ...jobSlotlessApproved,
  id: 'job-pending',
  requiredWorkerCount: 2,
  shifts: [
    {
      id: 'shift-pending',
      slotId: null,
      workerNameSnapshot: 'רון כהן',
      attendanceStatus: 'SCHEDULED',
      joinRequestStatus: 'PENDING',
      assignmentRole: 'REGULAR',
      formStatus: 'NOT_SUBMITTED',
      worker: { firstName: 'רון', lastName: 'כהן' },
    },
  ],
};

test.describe('Job detail — staffing consistency (PR-1)', () => {
  test('an APPROVED worker with slotId=null appears in BOTH Workers and Attendance', async ({ page }) => {
    await page.route('**/api/v1/jobs/job-slotless', async (route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(jobSlotlessApproved) });
    });

    await page.goto('/jobs/job-slotless');
    await expect(page.getByRole('heading', { name: 'אריזה · יעל כהן' })).toBeVisible();

    // Workers tab: the approved worker is listed (the bug showed only "מקום פנוי").
    await page.getByRole('tab', { name: 'עובדים' }).click();
    await expect(page.getByText('אורית וינוגרד')).toBeVisible();
    // Required count is 1 and it is filled → no empty position shown.
    await expect(page.getByText('מקום פנוי')).toHaveCount(0);

    // Attendance tab: the SAME worker is listed.
    await page.getByRole('tab', { name: 'נוכחות' }).click();
    await expect(page.getByText('אורית וינוגרד')).toBeVisible();
  });

  test('approves a pending join request (slotId=null) from the Workers tab', async ({ page }) => {
    let approved = false;
    await page.route('**/api/v1/jobs/job-pending', async (route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(jobPending) });
    });
    await page.route('**/api/v1/shifts/shift-pending/approve', async (route) => {
      approved = true;
      await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
    });

    await page.goto('/jobs/job-pending');
    await page.getByRole('tab', { name: 'עובדים' }).click();

    await expect(page.getByText('רון כהן')).toBeVisible();
    await page.getByRole('button', { name: 'אישור', exact: true }).click();

    await expect.poll(() => approved).toBe(true);
  });
});

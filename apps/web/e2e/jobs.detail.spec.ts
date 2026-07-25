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

// An AWAITING_WORKER team leader (slotId null): must occupy the Team Leader
// section and block a second leader assignment (blocker #2).
const jobAwaitingLeader = {
  ...jobSlotlessApproved,
  id: 'job-awaiting-leader',
  requiredWorkerCount: 1,
  slots: [{ id: 'slot-mgr', requiredSkill: 'SHIFT_LEADER', label: null, filledByShiftId: null }],
  shifts: [
    {
      id: 'shift-leader',
      slotId: null,
      workerNameSnapshot: 'דנה לוי',
      attendanceStatus: 'SCHEDULED',
      joinRequestStatus: 'AWAITING_WORKER',
      assignmentRole: 'TEAM_LEADER',
      formStatus: 'NOT_SUBMITTED',
      worker: { firstName: 'דנה', lastName: 'לוי' },
    },
  ],
};

test.describe('Job detail page', () => {
  test('shows header, details, and the publication action', async ({ page }) => {
    await page.route('**/api/v1/jobs/job-slotless', async (route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(jobSlotlessApproved) });
    });
    await page.goto('/jobs/job-slotless');

    await expect(page.getByRole('heading', { name: 'אריזה · יעל כהן' })).toBeVisible();
    // Details tab (default): address + contact.
    await expect(page.getByText('תל אביב 1').first()).toBeVisible();
    await expect(page.getByText('יעל כהן').first()).toBeVisible();
    // Publication-readiness action is present (enabled state is readiness-driven).
    await expect(page.getByRole('button', { name: 'שליחה שוב לעובדים' })).toBeVisible();
    // The owner approval action is present for a real-customer reservation.
    await expect(page.getByRole('button', { name: 'אישור העבודה' })).toBeVisible();
  });
});

test.describe('Job detail — staffing consistency (PR-1)', () => {
  test('an APPROVED worker with slotId=null appears in BOTH Workers and Attendance', async ({ page }) => {
    await page.route('**/api/v1/jobs/job-slotless', async (route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(jobSlotlessApproved) });
    });

    await page.goto('/jobs/job-slotless');

    await page.getByRole('tab', { name: 'עובדים' }).click();
    await expect(page.getByText('אורית וינוגרד')).toBeVisible();
    await expect(page.getByText('מקום פנוי')).toHaveCount(0);

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

  test('an AWAITING_WORKER team leader occupies the Team Leader section and blocks a second leader assignment', async ({ page }) => {
    await page.route('**/api/v1/jobs/job-awaiting-leader', async (route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(jobAwaitingLeader) });
    });

    await page.goto('/jobs/job-awaiting-leader');
    await page.getByRole('tab', { name: 'עובדים' }).click();

    // The awaiting leader is shown (in the Team Leader section)…
    await expect(page.getByText('דנה לוי')).toBeVisible();
    // …no empty-leader "assign" affordance is offered while the invitation reserves it…
    await expect(page.getByText('לא מאויש')).toHaveCount(0);
    // …and the leader requirement is still unmet until she accepts.
    await expect(page.getByText('חסר ראש צוות').first()).toBeVisible();
  });
});

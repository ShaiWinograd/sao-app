import { expect, test } from '@playwright/test';

const futureDate = new Date();
futureDate.setDate(futureDate.getDate() + 30);
futureDate.setUTCHours(8, 0, 0, 0);
const futureEnd = new Date(futureDate);
futureEnd.setUTCHours(13, 0, 0, 0);

// Production-representative case (job cms0bntts…): an APPROVED REGULAR shift whose
// slotId is null. Before PR-1 it was invisible in the slot-based Workers tab while
// visible in the shift-based Attendance tab. The shared derivation fixes this.
const jobSlotlessApproved = {
  id: 'job-slotless',
  caseId: 'case-1',
  jobType: 'PACKING',
  date: futureDate.toISOString(),
  plannedStart: futureDate.toISOString(),
  plannedEnd: futureEnd.toISOString(),
  status: 'RESERVATION',
  requiredWorkerCount: 1,
  addressId: 'addr-1',
  jobNotes: null,
  workerVisibleNotes: null,
  address: { fullAddress: 'תל אביב 1' },
  customer: { id: 'customer-1', firstName: 'יעל', lastName: 'כהן', phone: '0501111111', isSystem: false },
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

// Two approved regulars on a leader-requiring job: one is leader-eligible
// (skills include SHIFT_LEADER), one is not. The role selector must offer
// TEAM_LEADER only for the eligible worker (the API stays authoritative).
const jobRoleSelector = {
  ...jobSlotlessApproved,
  id: 'job-role-selector',
  requiredWorkerCount: 3,
  slots: [{ id: 'slot-mgr', requiredSkill: 'SHIFT_LEADER', label: null, filledByShiftId: null }],
  shifts: [
    { id: 's-eligible', slotId: null, workerNameSnapshot: 'נועה שמש', attendanceStatus: 'SCHEDULED', joinRequestStatus: 'APPROVED', assignmentRole: 'REGULAR', formStatus: 'NOT_SUBMITTED', worker: { firstName: 'נועה', lastName: 'שמש', skills: ['SHIFT_LEADER'] } },
    { id: 's-ineligible', slotId: null, workerNameSnapshot: 'עדי כץ', attendanceStatus: 'SCHEDULED', joinRequestStatus: 'APPROVED', assignmentRole: 'REGULAR', formStatus: 'NOT_SUBMITTED', worker: { firstName: 'עדי', lastName: 'כץ', skills: [] } },
  ],
};

// Capacity full with regulars but the leader is still missing: "assign leader"
// must NOT be offered; the owner converts an existing worker's role instead.
const jobFullMissingLeader = {
  ...jobSlotlessApproved,
  id: 'job-full-missing-leader',
  requiredWorkerCount: 2,
  slots: [{ id: 'slot-mgr', requiredSkill: 'SHIFT_LEADER', label: null, filledByShiftId: null }],
  shifts: [
    { id: 's-a', slotId: null, workerNameSnapshot: 'רות בר', attendanceStatus: 'SCHEDULED', joinRequestStatus: 'APPROVED', assignmentRole: 'REGULAR', formStatus: 'NOT_SUBMITTED', worker: { firstName: 'רות', lastName: 'בר' } },
    { id: 's-b', slotId: null, workerNameSnapshot: 'מיה גל', attendanceStatus: 'SCHEDULED', joinRequestStatus: 'APPROVED', assignmentRole: 'REGULAR', formStatus: 'NOT_SUBMITTED', worker: { firstName: 'מיה', lastName: 'גל' } },
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
    await expect(page.getByText('08:00–13:00').first()).toBeVisible();
    // Publication-readiness action is present (enabled state is readiness-driven).
    await expect(page.getByRole('button', { name: 'שליחה שוב לעובדים' })).toBeVisible();
    // The owner approval action is present for a real-customer reservation.
    await expect(page.getByRole('button', { name: 'אישור העבודה' })).toBeVisible();
  });

  test('enables a team-leader requirement after creation and shows the full staffing breakdown', async ({ page }) => {
    let requiresLeader = false;
    let patchBody: unknown = null;
    await page.route('**/api/v1/jobs/job-pending', async (route) => {
      if (route.request().method() === 'PATCH') {
        patchBody = route.request().postDataJSON();
        requiresLeader = true;
        await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          ...jobPending,
          slots: requiresLeader
            ? [
                { id: 'slot-leader', requiredSkill: 'SHIFT_LEADER', label: null, filledByShiftId: null },
                { id: 'slot-regular', requiredSkill: null, label: null, filledByShiftId: null },
              ]
            : [
                { id: 'slot-a', requiredSkill: null, label: null, filledByShiftId: null },
                { id: 'slot-b', requiredSkill: null, label: null, filledByShiftId: null },
              ],
        }),
      });
    });

    await page.goto('/jobs/job-pending');
    await expect(page.getByText('0/2 משובצים')).toBeVisible();
    await expect(page.getByText('2 מקומות עדיין פתוחים')).toBeVisible();
    await expect(page.getByTestId('staffing-state-summary').getByText('1', { exact: true })).toBeVisible();
    const pendingCounter = page.locator('[aria-label^="ממתין לבעלים: 1"]');
    await pendingCounter.focus();
    await expect(page.getByText('ממתין לבעלים · 1')).toBeVisible();
    await expect(page.getByText('רון כהן').last()).toBeVisible();

    await page.getByRole('checkbox').check();
    await expect.poll(() => patchBody).toEqual({ requiresTeamLeader: true });
    await expect(page.getByText('נדרש ראש צוות')).toBeVisible();
    await expect(page.getByText('חסר ראש צוות').first()).toBeVisible();
  });

  test('warns the owner and marks edits to a past job as explicitly confirmed', async ({ page }) => {
    let patchBody: Record<string, unknown> | null = null;
    const pastDate = new Date();
    pastDate.setDate(pastDate.getDate() - 2);
    pastDate.setHours(9, 0, 0, 0);
    const pastEnd = new Date(pastDate);
    pastEnd.setHours(14, 0, 0, 0);
    await page.addInitScript(() => window.localStorage.setItem('sao-role-override', 'OWNER'));
    await page.route('**/api/v1/jobs/job-past', async (route) => {
      if (route.request().method() === 'PATCH') {
        patchBody = route.request().postDataJSON() as Record<string, unknown>;
        await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          ...jobSlotlessApproved,
          id: 'job-past',
          date: pastDate.toISOString(),
          plannedStart: pastDate.toISOString(),
          plannedEnd: pastEnd.toISOString(),
        }),
      });
    });
    page.once('dialog', (dialog) => dialog.accept());

    await page.goto('/jobs/job-past');

    await expect(page.getByText(/העבודה נעולה משום שהושלמה או שמועדה עבר/)).toBeVisible();
    await page.getByRole('button', { name: 'עריכת תאריך ושעות' }).click();
    await page.getByRole('button', { name: 'שמירת תאריך ושעות' }).click();
    await expect.poll(() => patchBody).toMatchObject({ confirmLockedEdit: true });
  });
});

test.describe('Job detail — staffing consistency (PR-1)', () => {
  test('an APPROVED worker with slotId=null appears in BOTH Workers and Attendance', async ({ page }) => {
    await page.route('**/api/v1/jobs/job-slotless', async (route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(jobSlotlessApproved) });
    });

    await page.goto('/jobs/job-slotless');

    await expect(page.getByText('אורית וינוגרד').first()).toBeVisible();
    await expect(page.getByText('מקום פנוי')).toHaveCount(0);

    await expect(page.getByText('אורית וינוגרד').last()).toBeVisible();
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
    await expect(page.getByText('רון כהן').first()).toBeVisible();
    await page.getByRole('button', { name: 'אישור', exact: true }).click();

    await expect.poll(() => approved).toBe(true);
  });

  test('an AWAITING_WORKER team leader occupies the Team Leader section and blocks a second leader assignment', async ({ page }) => {
    await page.route('**/api/v1/jobs/job-awaiting-leader', async (route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(jobAwaitingLeader) });
    });

    await page.goto('/jobs/job-awaiting-leader');
    // The awaiting leader is shown (in the Team Leader section)…
    await expect(page.getByText('דנה לוי').first()).toBeVisible();
    // …no empty-leader "assign" affordance is offered while the invitation reserves it…
    await expect(page.getByText('לא מאויש')).toHaveCount(0);
    // …and the leader requirement is still unmet until she accepts.
    await expect(page.getByText('חסר ראש צוות').first()).toBeVisible();
  });

  test('capacity full + missing leader: no "assign leader" is offered; role-change hint is shown', async ({ page }) => {
    await page.route('**/api/v1/jobs/job-full-missing-leader', async (route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(jobFullMissingLeader) });
    });

    await page.goto('/jobs/job-full-missing-leader');
    // Both regular workers are shown, the leader is still missing…
    await expect(page.getByText('רות בר').first()).toBeVisible();
    await expect(page.getByText('מיה גל').first()).toBeVisible();
    await expect(page.getByText('חסר ראש צוות').first()).toBeVisible();
    // …no assign affordance (capacity is full)…
    await expect(page.getByRole('button', { name: 'שיבוץ' })).toHaveCount(0);
    // …and the supported resolution (convert an existing worker's role) is hinted.
    await expect(page.getByText('יש להסב עובד/ת קיים/ת לתפקיד ראש צוות מרשימת העובדים.')).toBeVisible();
  });

  test('role selector offers TEAM_LEADER only for a leader-eligible worker', async ({ page }) => {
    await page.route('**/api/v1/jobs/job-role-selector', async (route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(jobRoleSelector) });
    });

    await page.goto('/jobs/job-role-selector');
    // The eligible worker's role selector includes the TEAM_LEADER option…
    const eligibleSelect = page.locator('li', { hasText: 'נועה שמש' }).locator('select[title="תפקיד בעבודה"]');
    await expect(eligibleSelect.locator('option', { hasText: 'ראש צוות' })).toHaveCount(1);
    // …the ineligible worker's does not (only עובד / גיבוי).
    const ineligibleSelect = page.locator('li', { hasText: 'עדי כץ' }).locator('select[title="תפקיד בעבודה"]');
    await expect(ineligibleSelect.locator('option', { hasText: 'ראש צוות' })).toHaveCount(0);
    await expect(ineligibleSelect.locator('option')).toHaveCount(2);
  });
});

import { expect, test } from '@playwright/test';

test.describe('Jobs staffing insights', () => {
  test.beforeEach(async ({ page }) => {
    await page.route('**/api/v1/customers', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([
          {
            id: 'customer-1',
            firstName: 'נועה',
            lastName: 'כהן',
            phone: '0501234567',
            email: 'noa@example.com',
          },
        ]),
      });
    });

    await page.route('**/api/v1/addresses/for-customer/*', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([
          {
            id: 'address-1',
            customerId: 'customer-1',
            fullAddress: 'תל אביב 1',
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
            id: 'case-1',
            name: 'פרויקט נועה',
            status: 'ACTIVE',
            latestActivityDate: '2026-07-12T08:00:00.000Z',
            customer: { id: 'customer-1' },
          },
        ]),
      });
    });

    await page.route('**/api/v1/jobs', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([
          {
            id: 'job-1',
            customerId: 'customer-1',
            caseId: 'case-1',
            addressId: 'address-1',
            jobType: 'PACKING',
            date: '2026-07-12T08:00:00.000Z',
            plannedStart: '2026-07-12T08:00:00.000Z',
            plannedEnd: '2026-07-12T13:00:00.000Z',
            requiredWorkerCount: 4,
            staffingMode: 'MANAGER_APPROVAL',
            status: 'RESERVATION',
            customer: { firstName: 'נועה', lastName: 'כהן' },
            case: { id: 'case-1', name: 'פרויקט נועה' },
            address: { fullAddress: 'תל אביב 1' },
            slots: [{ requiredSkill: 'SHIFT_LEADER' }],
            shifts: [
              { workerId: 'worker-1', workerNameSnapshot: 'דנה לוי', joinRequestStatus: 'APPROVED', assignmentRole: 'TEAM_LEADER' },
              { workerId: 'worker-2', workerNameSnapshot: 'נועה כהן', joinRequestStatus: 'PENDING', assignmentRole: 'REGULAR' },
              { workerId: 'worker-3', workerNameSnapshot: 'מיה גל', joinRequestStatus: 'AWAITING_WORKER', assignmentRole: 'REGULAR' },
            ],
          },
          {
            id: 'job-2',
            customerId: 'customer-1',
            caseId: 'case-1',
            addressId: 'address-1',
            jobType: 'UNPACKING',
            date: '2026-07-12T09:00:00.000Z',
            plannedStart: '2026-07-12T09:00:00.000Z',
            plannedEnd: '2026-07-12T14:00:00.000Z',
            requiredWorkerCount: 2,
            staffingMode: 'AUTO_APPROVE',
            status: 'COMPLETED',
            customer: { firstName: 'נועה', lastName: 'כהן' },
            case: { id: 'case-1', name: 'פרויקט נועה' },
            address: { fullAddress: 'תל אביב 1' },
            slots: [{ requiredSkill: null }],
            shifts: [
              { workerId: 'worker-4', workerNameSnapshot: 'רות בר', joinRequestStatus: 'APPROVED', assignmentRole: 'REGULAR' },
              { workerId: 'worker-5', workerNameSnapshot: 'עדי כץ', joinRequestStatus: 'APPROVED', assignmentRole: 'REGULAR' },
            ],
          },
        ]),
      });
    });
  });

  test('shows assigned/total, open slots, and focusable staffing-state names without tabs', async ({ page }) => {
    await page.goto('/jobs');
    await expect(page.getByText('1/4 משובצים · 3 פתוחים').first()).toBeVisible();
    await expect(page.getByRole('tab')).toHaveCount(0);

    const pendingOwner = page.locator('[aria-label^="ממתין לבעלים: 1"]').first();
    await pendingOwner.focus();
    await expect(page.getByText('נועה כהן').last()).toBeVisible();

    const awaitingWorker = page.locator('[aria-label^="ממתין לעובד/ת: 1"]').first();
    await awaitingWorker.focus();
    await expect(page.getByText('מיה גל').last()).toBeVisible();
  });
});

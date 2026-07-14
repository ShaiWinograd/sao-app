import { expect, test } from '@playwright/test';

const boardPayload = {
  tabs: [
    {
      key: 'sale_planning',
      title: 'מכירה ותכנון',
      columns: [
        {
          key: 'lead',
          title: 'ליד חדש',
          items: [
            {
              id: 'case-lead-1',
              name: 'מעבר דירה משפחת כהן',
              status: 'LEAD',
              latestActivityDate: '2026-07-11T08:00:00.000Z',
              updatedAt: '2026-07-11T08:00:00.000Z',
              customer: { firstName: 'יעל', lastName: 'כהן' },
              jobs: [],
            },
          ],
        },
        { key: 'quotation_draft', title: 'בהכנת הצעת מחיר', items: [] },
        { key: 'awaiting_approval', title: 'מחכה לאישור', items: [] },
        { key: 'reserved', title: 'משוריין', items: [] },
      ],
    },
    {
      key: 'execution',
      title: 'ביצוע',
      columns: [
        { key: 'approved_no_dates', title: 'מאושר – ללא תאריכים', items: [] },
        { key: 'partial_scheduling', title: 'תזמון חלקי', items: [] },
        { key: 'ready', title: 'מאושר לביצוע', items: [] },
        { key: 'in_progress', title: 'בביצוע', items: [] },
        { key: 'awaiting_completion', title: 'מחכה להשלמות', items: [] },
      ],
    },
    {
      key: 'payment_closure',
      title: 'תשלום וסגירה',
      columns: [
        { key: 'awaiting_billing', title: 'מחכה לחיוב', items: [] },
        { key: 'awaiting_payment', title: 'מחכה לתשלום', items: [] },
        { key: 'paid', title: 'שולם', items: [] },
      ],
    },
  ],
  unplaced: [],
};

test.describe('Projects lifecycle board', () => {
  test.beforeEach(async ({ page }) => {
    await page.route('**/api/v1/cases/board', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(boardPayload),
      });
    });
  });

  test('renders lifecycle tabs and project cards', async ({ page }) => {
    await page.goto('/cases/board');

    await expect(page.getByRole('heading', { name: 'לוח פרוייקטים', exact: true })).toBeVisible();
    await expect(page.getByRole('tab', { name: 'מכירה ותכנון' })).toBeVisible();
    await expect(page.getByRole('tab', { name: 'תשלום וסגירה' })).toBeVisible();

    const leadColumn = page.getByTestId('board-column-lead');
    await expect(leadColumn.getByText('מעבר דירה משפחת כהן')).toBeVisible();
  });

  test('shows a filterable list view', async ({ page }) => {
    await page.goto('/cases/board');

    await page.getByRole('button', { name: 'רשימה' }).click();
    const list = page.getByTestId('projects-list');
    await expect(list).toBeVisible();
    await expect(list.getByText('מעבר דירה משפחת כהן')).toBeVisible();

    await page.getByPlaceholder('חיפוש לפי שם פרויקט או לקוח').fill('לוי');
    await expect(list.getByText('לא נמצאו פרויקטים')).toBeVisible();

    await page.getByPlaceholder('חיפוש לפי שם פרויקט או לקוח').fill('כהן');
    await expect(list.getByText('מעבר דירה משפחת כהן')).toBeVisible();
  });

  test('changing a status issues a PATCH honoring allowed transitions', async ({ page }) => {
    let patched = false;
    await page.route('**/api/v1/cases/case-lead-1', async (route) => {
      patched = true;
      await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
    });

    await page.goto('/cases/board');
    await page.getByLabel('שינוי סטטוס למעבר דירה משפחת כהן').selectOption('QUOTATION_DRAFT');

    await expect.poll(() => patched).toBe(true);
  });

  test('cancels a project only after confirmation is accepted', async ({ page }) => {
    let patched = false;
    await page.route('**/api/v1/cases/case-lead-1', async (route) => {
      patched = true;
      await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
    });
    page.on('dialog', (dialog) => dialog.accept());

    await page.goto('/cases/board');
    await page.getByLabel('שינוי סטטוס למעבר דירה משפחת כהן').selectOption('CANCELLED');

    await expect.poll(() => patched).toBe(true);
  });

  test('does not cancel when the confirmation is dismissed', async ({ page }) => {
    let patched = false;
    await page.route('**/api/v1/cases/case-lead-1', async (route) => {
      patched = true;
      await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
    });
    page.on('dialog', (dialog) => dialog.dismiss());

    await page.goto('/cases/board');
    await page.getByLabel('שינוי סטטוס למעבר דירה משפחת כהן').selectOption('CANCELLED');
    await page.waitForTimeout(300);

    expect(patched).toBe(false);
  });
});

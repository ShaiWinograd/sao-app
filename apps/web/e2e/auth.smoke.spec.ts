import { expect, test } from '@playwright/test';

test.describe('Auth smoke flow', () => {
  test('sign-in page is reachable', async ({ page }) => {
    await page.goto('/sign-in');
    await expect(page.getByText('Space & Order')).toBeVisible();
    await expect(page.getByText('מערכת ניהול כוח אדם ותזמון משמרות')).toBeVisible();
  });

  test('sign-up page is reachable', async ({ page }) => {
    await page.goto('/sign-up');
    await expect(page.getByText('Space & Order')).toBeVisible();
    await expect(page.getByText('יצירת חשבון חדש למנהלי משמרות')).toBeVisible();
  });
});

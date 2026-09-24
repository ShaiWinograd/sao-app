import { expect, test } from '@playwright/test';

test.describe('Auth smoke flow', () => {
  test('root route redirects to dashboard', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveURL(/\/dashboard$/);
    await expect(page.getByRole('heading', { name: 'לוח בקרה' })).toBeVisible();
  });

  test('sign-in page is reachable', async ({ page }) => {
    await page.goto('/sign-in');
    await expect(page.getByText('Space & Order', { exact: true })).toBeVisible();
    await expect(page.getByText('ניהול צוות ולוח שנה')).toBeVisible();
    await expect(page.getByText('הכניסה מיועדת לחשבונות צוות קיימים. עובדות חדשות מצטרפות באמצעות הזמנה.')).toBeVisible();
    await expect(page.getByText('SAO', { exact: true })).toHaveCount(0);
  });

  test('sign-up page is reachable', async ({ page }) => {
    await page.goto('/sign-up');
    await expect(page.getByText('Space & Order', { exact: true })).toBeVisible();
    await expect(page.getByText('פתיחת חשבון חדש מתבצעת באמצעות הזמנה.')).toBeVisible();
  });
});

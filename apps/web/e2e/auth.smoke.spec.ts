import { expect, test } from '@playwright/test';

test.describe('Auth smoke flow', () => {
  test('root route redirects to dashboard', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveURL(/\/dashboard$/);
    await expect(page.getByRole('heading', { name: 'לוח בקרה' })).toBeVisible();
  });

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

  test('projects page is reachable and shows core controls', async ({ page }) => {
    await page.goto('/cases');
    await expect(page.getByRole('heading', { name: 'פרוייקטים' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'תצוגת כרטיסים' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'תצוגת עמודות' })).toBeVisible();
  });
});

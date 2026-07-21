import { expect, test } from '@playwright/test';

// Reachability of the Reports hub and the finalized customer report. Runs against
// the deployed app when E2E_BASE_URL is set (skipped in PR CI, like the other
// e2e specs). No production IDs are hardcoded — the finalized report is
// discovered through the UI's own persisted overview.
test.describe('Reports navigation & finalized-report reachability', () => {
  test('main Reports opens the hub, not the legacy financial dashboard', async ({ page }) => {
    await page.goto('/reports');
    await expect(page.getByRole('heading', { name: 'דוחות', exact: true })).toBeVisible();
    await expect(page.getByRole('link', { name: /דוחות לקוחות/ })).toBeVisible();
    await expect(page.getByRole('link', { name: /דוחות חודשיים לעובדות/ })).toBeVisible();
    // The primary Reports page must NOT show legacy profitability concepts.
    await expect(page.getByText('רווחיות')).toHaveCount(0);
    await expect(page.getByText('הכנסות')).toHaveCount(0);
  });

  test('the legacy management dashboard is relocated to an internal route', async ({ page }) => {
    await page.goto('/reports/management');
    await expect(page.getByText(/רווחיות|הכנסות/).first()).toBeVisible();
  });

  test('customer reports hub reaches version history, stored PDF and the corrected-version action', async ({ page }) => {
    await page.goto('/reports/customer');
    await expect(page.getByRole('heading', { name: /דוחות לקוח/ })).toBeVisible();
    await expect(page.getByText(/מוכנים לדוח/)).toBeVisible();
    await expect(page.getByText(/דוחות שהופקו/)).toBeVisible();

    // Open a persisted finalized report, if any exists, from the shared overview.
    const reportLink = page.locator('a[href*="/customer-report"]').first();
    if (await reportLink.count()) {
      await reportLink.click();
      await expect(page).toHaveURL(/\/cases\/.+\/customer-report/);
      await expect(page.getByRole('heading', { name: 'היסטוריית גרסאות' })).toBeVisible();
      await expect(page.getByText(/גרסה\s*1/)).toBeVisible();
      await expect(page.getByRole('button', { name: 'PDF' }).first()).toBeVisible();
      await expect(page.getByRole('button', { name: 'יצירת גרסה מתוקנת' })).toBeVisible();
    }
  });

  test('deep link + refresh load the report editor independently of navigation state', async ({ page }) => {
    await page.goto('/reports/customer');
    const reportLink = page.locator('a[href*="/customer-report"]').first();
    if (await reportLink.count()) {
      const href = await reportLink.getAttribute('href');
      if (href) {
        await page.goto(href); // deep link
        await expect(page.getByText(/היסטוריית גרסאות|יצירת גרסה מתוקנת|הפקת דוח/)).toBeVisible();
        await page.reload(); // browser refresh preserves it
        await expect(page.getByText(/היסטוריית גרסאות|יצירת גרסה מתוקנת|הפקת דוח/)).toBeVisible();
      }
    }
  });
});

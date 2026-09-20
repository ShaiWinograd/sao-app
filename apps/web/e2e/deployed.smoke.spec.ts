import { expect, test } from '@playwright/test';

test.describe('Deployed web smoke', () => {
  for (const path of ['/', '/sign-in', '/sign-up']) {
    test(`${path} is reachable`, async ({ request }) => {
      const response = await request.get(path);

      expect(response.ok()).toBe(true);
      expect(response.headers()['content-type']).toContain('text/html');
    });
  }

  test('sign-in page renders the application shell', async ({ page }) => {
    await page.goto('/sign-in', { waitUntil: 'domcontentloaded' });

    await expect(page.locator('body')).toContainText('Space & Order');
  });
});

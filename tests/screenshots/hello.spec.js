// @ts-check
const { test, expect } = require('@playwright/test');

test('hello world page renders', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('h1')).toHaveText('Papa Stud');
  await expect(page.locator('h2')).toHaveText('Hello, World');
  await expect(page).toHaveScreenshot('hello.png');
});

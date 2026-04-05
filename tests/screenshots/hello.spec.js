// @ts-check
const { test, expect } = require('@playwright/test');
const { mockApi } = require('./fixtures');

test('home page renders with empty state', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('h1')).toHaveText('Papa Stud');
  await expect(page.locator('text=Add Project')).toBeVisible();
  await expect(page.locator('text=No projects configured')).toBeVisible({ timeout: 10000 });
  await expect(page).toHaveScreenshot('home-empty.png');
});

test('add project form toggles', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('text=Add Project')).toBeVisible({ timeout: 10000 });
  await page.click('button:has-text("Add Project")');
  await expect(page.locator('input[placeholder*="path"]')).toBeVisible();
  await expect(page).toHaveScreenshot('home-add-project.png');
});

test('home page shows scans with snapshot bars', async ({ page }) => {
  await mockApi(page);
  await page.goto('/');
  await expect(page.locator('text=3 screenshot failures')).toBeVisible({ timeout: 10000 });
  await expect(page.locator('.scan-test-bar')).toBeVisible();
  await expect(page).toHaveScreenshot('home-with-scans.png', { maxDiffPixels: 50 });
});

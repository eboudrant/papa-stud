// @ts-check
const { test, expect } = require('@playwright/test');
const { mockApi, mockPendingFilter } = require('./fixtures');

test.beforeEach(async ({ page }) => {
  await mockApi(page);
});

test('review grid shows failures with status badges', async ({ page }) => {
  await page.goto('/#/scans/20260403-120000');
  await expect(page.locator('.thumb-card')).toHaveCount(3, { timeout: 10000 });
  await expect(page.locator('.badge-accepted')).toHaveCount(1);
  await expect(page.locator('.badge-pending')).toHaveCount(2);
  await expect(page.locator('text=1 / 3 reviewed')).toBeVisible();
  await expect(page).toHaveScreenshot('review-grid.png');
});

test('review grid filters by status', async ({ page }) => {
  await mockPendingFilter(page);
  await page.goto('/#/scans/20260403-120000');
  await expect(page.locator('.thumb-card')).toHaveCount(3, { timeout: 10000 });
  await page.click('button:has-text("Pending")');
  await expect(page.locator('.thumb-card')).toHaveCount(2, { timeout: 10000 });
  await expect(page).toHaveScreenshot('review-grid-filtered.png');
});

test('detail view shows three-pane comparison', async ({ page }) => {
  await page.goto('/#/scans/20260403-120000/review/com.example_LoginTest_testSignup.png');
  await expect(page.locator('.detail-title')).toHaveText('LoginTest', { timeout: 10000 });
  await expect(page.locator('.pane-label')).toHaveCount(3);
  await expect(page.locator('text=Expected (Golden)')).toBeVisible();
  await expect(page.locator('text=Delta (Diff)')).toBeVisible();
  await expect(page.locator('text=Actual')).toBeVisible();
  await expect(page.locator('text=2 / 3')).toBeVisible();
  await expect(page).toHaveScreenshot('detail-view.png');
});

// @ts-check
const { test, expect } = require('@playwright/test');
const { mockApi } = require('./fixtures');

test.beforeEach(async ({ page }) => {
  await mockApi(page);
});

test('review grid shows failures with sidebar modules', async ({ page }) => {
  await page.goto('/#/scans/20260403-120000');
  await expect(page.locator('.thumb-card')).toHaveCount(3, { timeout: 10000 });
  await expect(page.locator('text=3 failures')).toBeVisible();
  // Sidebar shows modules with snapshot bars
  await expect(page.locator('.tree-module')).toHaveCount(4);
  await expect(page.locator('.test-bar')).toHaveCount(4);
  await expect(page).toHaveScreenshot('review-grid.png');
});

test('review sidebar abbreviates common prefixes', async ({ page }) => {
  await page.goto('/#/scans/20260403-120000');
  await expect(page.locator('.thumb-card')).toHaveCount(3, { timeout: 10000 });
  // :libraries:ui: should be abbreviated to :l:u:
  await expect(page.locator('text=:l:u:login')).toBeVisible();
  await expect(page.locator('text=:l:u:dashboard')).toBeVisible();
  await expect(page).toHaveScreenshot('review-sidebar.png');
});

test('detail view defaults to delta mode', async ({ page }) => {
  await page.goto('/#/scans/20260403-120000/review/com.example_LoginTest_testSignup.png');
  await expect(page.locator('.detail-title')).toHaveText('LoginTest', { timeout: 10000 });
  await expect(page.locator('.pill.active')).toHaveText('Delta (1)');
  await expect(page.locator('.detail-view-area img')).toBeVisible();
  await expect(page.locator('.zoom-controls')).toBeVisible();
  await expect(page).toHaveScreenshot('detail-delta.png');
});

test('detail toggle mode shows golden with label', async ({ page }) => {
  await page.goto('/#/scans/20260403-120000/review/com.example_LoginTest_testSignup.png');
  await expect(page.locator('.detail-title')).toHaveText('LoginTest', { timeout: 10000 });
  await page.click('button:has-text("Toggle (2)")');
  await expect(page.locator('.toggle-label')).toContainText('Expected (Golden)');
  await expect(page).toHaveScreenshot('detail-toggle.png');
});

test('detail slider mode shows handle', async ({ page }) => {
  await page.goto('/#/scans/20260403-120000/review/com.example_LoginTest_testSignup.png');
  await expect(page.locator('.detail-title')).toHaveText('LoginTest', { timeout: 10000 });
  await page.click('button:has-text("Slider (3)")');
  await expect(page.locator('#slider-handle')).toBeVisible();
  await expect(page.locator('.slider-labels')).toBeVisible();
  await expect(page).toHaveScreenshot('detail-slider.png');
});

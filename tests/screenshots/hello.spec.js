// @ts-check
const { test, expect } = require('@playwright/test');
const { mockApi } = require('./fixtures');

test('home page renders with empty state', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('h1')).toContainText('Papa Stud');
  await expect(page.locator('button:has-text("Add Project")').first()).toBeVisible();
  await expect(page.locator('text=No projects configured')).toBeVisible({ timeout: 10000 });
  await expect(page).toHaveScreenshot('home-empty.png');
});

test('add project form toggles', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.section-header button:has-text("Add Project")')).toBeVisible({ timeout: 10000 });
  await page.click('.section-header button:has-text("Add Project")');
  await expect(page.locator('input#project-path')).toBeVisible();
  await expect(page.locator('.template-card')).toHaveCount(3, { timeout: 5000 });
  await expect(page).toHaveScreenshot('home-add-project.png');
});

test('home page shows scans with snapshot bars', async ({ page }) => {
  await page.addInitScript(() => {
    const fixed = new Date('2026-04-03T13:00:00Z').getTime();
    Date.now = () => fixed;
  });
  await mockApi(page);
  await page.goto('/');
  await expect(page.locator('text=3 screenshot failures')).toBeVisible({ timeout: 10000 });
  await expect(page.locator('.scan-test-bar')).toBeVisible();
  await expect(page).toHaveScreenshot('home-with-scans.png');
});

test('home page shows profile tags on projects', async ({ page }) => {
  await mockApi(page);
  await page.goto('/');
  await expect(page.locator('.profile-tag')).toHaveCount(2, { timeout: 10000 });
  await expect(page).toHaveScreenshot('home-profile-tags.png');
});

// Dark mode tests
test('home page dark mode', async ({ page }) => {
  await mockApi(page);
  await page.addInitScript(() => {
    localStorage.setItem('papastud_theme', 'dark');
  });
  await page.goto('/');
  await expect(page.locator('.profile-tag')).toHaveCount(2, { timeout: 10000 });
  await expect(page).toHaveScreenshot('home-dark.png');
});

// @ts-check
const { test, expect } = require('@playwright/test');

test('home page renders with empty state', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('h1')).toHaveText('Papa Stud');
  await expect(page.locator('text=Add Project')).toBeVisible();
  // Wait for API to load
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

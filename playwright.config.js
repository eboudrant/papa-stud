// @ts-check
const { defineConfig } = require('@playwright/test');

module.exports = defineConfig({
  testDir: './tests/screenshots',
  snapshotPathTemplate: '{snapshotDir}/{projectName}/{arg}{ext}',
  timeout: 30_000,
  fullyParallel: true,
  expect: {
    toHaveScreenshot: {
      maxDiffPixels: 0,
    },
  },
  use: {
    baseURL: 'http://127.0.0.1:8770',
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 1,
  },
  projects: [
    {
      name: 'mobile',
      use: { viewport: { width: 390, height: 844 } },
    },
    {
      name: 'desktop',
      use: { viewport: { width: 1280, height: 800 } },
    },
  ],
  webServer: {
    command: 'python3 server.py',
    port: 8770,
    reuseExistingServer: true,
    timeout: 30_000,
  },
});

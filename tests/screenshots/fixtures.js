// @ts-check
const fs = require('fs');
const path = require('path');

const FIXTURE_DIR = path.join(__dirname, 'fixtures');
const GOLDEN_PNG = fs.readFileSync(path.join(FIXTURE_DIR, 'golden.png'));
const ACTUAL_PNG = fs.readFileSync(path.join(FIXTURE_DIR, 'actual.png'));
const DELTA_PNG = fs.readFileSync(path.join(FIXTURE_DIR, 'delta.png'));

const MOCK_SCAN = {
  id: '20260403-120000',
  projectId: 'abc123',
  projectName: 'test-app',
  projectPath: '/tmp/test-app',
  created: '2026-04-03T12:00:00Z',
  modules: [
    { name: ':libraries:ui:login', failures_path: '/tmp/test-app/libraries/ui/login/build/paparazzi/failures', golden_path: '/tmp/test-app/libraries/ui/login/src/test/snapshots/images', failure_count: 2, snapshot_count: 30, profile_counts: { baseline: 1, figma: 1 } },
    { name: ':libraries:ui:dashboard', failures_path: null, golden_path: '/tmp/test-app/libraries/ui/dashboard/src/test/snapshots/images', failure_count: 0, snapshot_count: 120, profile_counts: {} },
    { name: ':libraries:ui:settings', failures_path: null, golden_path: '/tmp/test-app/libraries/ui/settings/src/test/snapshots/images', failure_count: 0, snapshot_count: 45, profile_counts: {} },
    { name: ':app:main', failures_path: '/tmp/test-app/app/main/build/paparazzi/failures', golden_path: '/tmp/test-app/app/main/src/test/snapshots/images', failure_count: 1, snapshot_count: 80, profile_counts: { baseline: 1 } },
  ],
  stats: { total: 3, pending: 2, accepted: 1, rejected: 0 },
  failures: [
    {
      module: ':libraries:ui:login', profile: 'baseline', filename: 'com.example_LoginTest_testLogin.png',
      delta_path: '/tmp/fake/delta-login.png', actual_path: '/tmp/fake/login.png', golden_path: '/tmp/fake/golden-login.png',
      package: 'com.example', class_name: 'LoginTest', method: 'testLogin', snapshot_name: null,
      status: 'pending', has_golden: true, has_actual: true, mtime: 1712160622.0
    },
    {
      module: ':libraries:ui:login', profile: 'figma', filename: 'com.example_LoginTest_testSignup.png',
      delta_path: '/tmp/fake/delta-signup.png', actual_path: '/tmp/fake/signup.png', golden_path: '/tmp/fake/golden-signup.png',
      package: 'com.example', class_name: 'LoginTest', method: 'testSignup', snapshot_name: null,
      status: 'pending', has_golden: true, has_actual: true, mtime: 1712160622.0
    },
    {
      module: ':app:main', profile: 'baseline', filename: 'com.example.ui_DashboardTest_testHeader.png',
      delta_path: '/tmp/fake/delta-header.png', actual_path: '/tmp/fake/header.png', golden_path: '/tmp/fake/golden-header.png',
      package: 'com.example.ui', class_name: 'DashboardTest', method: 'testHeader', snapshot_name: null,
      status: 'pending', has_golden: true, has_actual: true, mtime: 1712160622.0
    },
  ],
  totalFiltered: 3,
  page: 0,
  pageSize: 50,
};

const MOCK_SCANS_LIST = [{
  id: '20260403-120000',
  projectId: 'abc123',
  projectName: 'test-app',
  created: '2026-04-03T12:00:00Z',
  modules: MOCK_SCAN.modules,
  stats: MOCK_SCAN.stats,
}];

const MOCK_PROJECTS = [{
  id: 'abc123',
  name: 'test-app',
  path: '/tmp/test-app',
  added: '2026-04-03T10:00:00Z',
  profiles: [
    { name: 'baseline', failures_dir: 'build/paparazzi/failures', golden_patterns: ['src/test/snapshots/images/{name}.png'] },
    { name: 'figma', failures_dir: 'build/paparazzi/figma-failures', golden_patterns: ['src/assets/all/{name}@4x.png', 'src/assets/all/{name}.png', 'src/assets/examples/{name}.png'] },
  ],
}];

/**
 * Mock all API routes for screenshot tests.
 * @param {import('@playwright/test').Page} page
 */
async function mockApi(page) {
  await page.route(/\/api\/projects/, route => {
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(MOCK_PROJECTS) });
  });

  await page.route(/\/api\/scans\/[^/]+\?/, route => {
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(MOCK_SCAN) });
  });

  await page.route(/\/api\/scans$/, route => {
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(MOCK_SCANS_LIST) });
  });

  await page.route(/\/api\/images\/meta/, route => {
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ apng: false }) });
  });
  await page.route(/\/api\/images/, route => {
    const url = route.request().url();
    let body = DELTA_PNG;
    if (url.includes('golden')) body = GOLDEN_PNG;
    else if (url.includes('delta')) body = DELTA_PNG;
    else body = ACTUAL_PNG;
    route.fulfill({ status: 200, contentType: 'image/png', body });
  });
}

module.exports = { MOCK_SCAN, MOCK_SCANS_LIST, MOCK_PROJECTS, mockApi };

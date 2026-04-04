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
    { name: ':app', failures_path: '/tmp/test-app/app/build/paparazzi/failures', golden_path: '/tmp/test-app/app/src/test/snapshots/images', failureCount: 3 }
  ],
  stats: { total: 3, pending: 2, accepted: 1, rejected: 0 },
  failures: [
    {
      module: ':app', filename: 'com.example_LoginTest_testLogin.png',
      delta_path: '/tmp/fake/delta-login.png', actual_path: '/tmp/fake/login.png', golden_path: '/tmp/fake/golden-login.png',
      package: 'com.example', class_name: 'LoginTest', method: 'testLogin', snapshot_name: null,
      status: 'accepted', has_golden: true, has_actual: true, mtime: 1712160622.0
    },
    {
      module: ':app', filename: 'com.example_LoginTest_testSignup.png',
      delta_path: '/tmp/fake/delta-signup.png', actual_path: '/tmp/fake/signup.png', golden_path: '/tmp/fake/golden-signup.png',
      package: 'com.example', class_name: 'LoginTest', method: 'testSignup', snapshot_name: null,
      status: 'pending', has_golden: true, has_actual: true, mtime: 1712160622.0
    },
    {
      module: ':app', filename: 'com.example.ui_DashboardTest_testHeader.png',
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

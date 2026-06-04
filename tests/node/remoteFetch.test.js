const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { spawnSync } = require('child_process');
const projects = require('../../src/projects');
const { createApp } = require('../../src/handler');
const remoteFetch = require('../../src/remoteFetch');

// Stage { 'rel/path': content } into a temp dir and pack it into a .tar.
// Returns the tarball path.
function makeTar(entries) {
  const stage = fs.mkdtempSync(path.join(os.tmpdir(), 'papastud-tar-stage-'));
  const tops = new Set();
  for (const [rel, content] of Object.entries(entries)) {
    const abs = path.join(stage, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content);
    tops.add(rel.split('/')[0]);
  }
  const tarFile = path.join(stage, 'archive.tar');
  const r = spawnSync('tar', ['-cf', tarFile, '-C', stage, ...tops], { encoding: 'utf8' });
  assert.equal(r.status, 0, `tar -cf failed: ${r.stderr}`);
  return tarFile;
}

const JUNIT_FAILING = `<?xml version="1.0" encoding="UTF-8"?>
<testsuite name="MyScreenshotTest" tests="1" failures="1" errors="0" skipped="0" time="0.5">
  <testcase name="snap" classname="com.example.MyScreenshotTest" time="0.5">
    <failure message="image differ (by 5.0%) delta-com.example_MyScreenshotTest_snap.png">stack</failure>
  </testcase>
</testsuite>`;

const DELTA_NAME = 'delta-com.example_MyScreenshotTest_snap.png';
const GOLDEN_NAME = 'com.example_MyScreenshotTest_snap.png';

describe('remoteFetch pure helpers', () => {
  it('isBuildMember matches only build/ segments', () => {
    assert.equal(remoteFetch.isBuildMember('app/build/paparazzi/failures/x.png'), true);
    assert.equal(remoteFetch.isBuildMember('build/x.png'), true);
    assert.equal(remoteFetch.isBuildMember('app/src/test/snapshots/x.png'), false);
    // `prebuild/` must not be mistaken for a build dir
    assert.equal(remoteFetch.isBuildMember('app/prebuild/x.png'), false);
  });

  it('isUnsafeMember rejects absolute paths and traversal', () => {
    assert.equal(remoteFetch.isUnsafeMember('/etc/passwd'), true);
    assert.equal(remoteFetch.isUnsafeMember('../escape/x.png'), true);
    assert.equal(remoteFetch.isUnsafeMember('a/../../x.png'), true);
    assert.equal(remoteFetch.isUnsafeMember('app/build/x.png'), false);
  });

  it('moduleRootOf strips at the build/ boundary', () => {
    assert.equal(remoteFetch.moduleRootOf('libraries/x/build/paparazzi/failures/d.png'), 'libraries/x');
    assert.equal(remoteFetch.moduleRootOf('build/x.png'), '');
    assert.equal(remoteFetch.moduleRootOf('app/prebuild/build/x.png'), 'app/prebuild');
  });

  it('listBuildMembers keeps only build/ files, drops src/ and dirs', () => {
    const tar = makeTar({
      'app/build/paparazzi/failures/d.png': 'x',
      'app/src/test/snapshots/g.png': 'x',
      'app/build/test-results/v/TEST-A.xml': 'x',
    });
    const members = remoteFetch.listBuildMembers(tar);
    assert.ok(members.includes('app/build/paparazzi/failures/d.png'));
    assert.ok(members.includes('app/build/test-results/v/TEST-A.xml'));
    assert.ok(!members.some(m => m.includes('/src/')));
    fs.rmSync(path.dirname(tar), { recursive: true, force: true });
  });

  it('checkCompat reports matched/unmatched module roots', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'papastud-compat-'));
    fs.mkdirSync(path.join(root, 'app'), { recursive: true });
    const compat = remoteFetch.checkCompat(
      ['app/build/x.png', 'other/build/y.png'], root
    );
    assert.equal(compat.compatible, true);
    assert.deepEqual(compat.matched, ['app']);
    assert.deepEqual(compat.unmatched, ['other']);
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('extractBuildMembers writes only the listed members', () => {
    const tar = makeTar({
      'app/build/paparazzi/failures/d.png': 'delta',
      'app/src/test/snapshots/g.png': 'golden',
    });
    const dest = fs.mkdtempSync(path.join(os.tmpdir(), 'papastud-extract-'));
    remoteFetch.extractBuildMembers(tar, ['app/build/paparazzi/failures/d.png'], dest);
    assert.ok(fs.existsSync(path.join(dest, 'app/build/paparazzi/failures/d.png')));
    assert.ok(!fs.existsSync(path.join(dest, 'app/src/test/snapshots/g.png')));
    fs.rmSync(path.dirname(tar), { recursive: true, force: true });
    fs.rmSync(dest, { recursive: true, force: true });
  });

  it('extracts Paparazzi filenames containing [bracket] glob chars', () => {
    // bsdtar glob-interprets `-T` member entries, so a per-file list silently
    // fails on bracketed parameterized snapshot names. We extract whole build
    // dirs instead — this guards that regression.
    const bracketName = 'delta-com.x_Test_popoverTest[FontScale1x,Basic,NoHeadline,hasFooter].png';
    const tar = makeTar({
      [`mod/build/paparazzi/failures/${bracketName}`]: 'delta',
      'mod/src/test/snapshots/g.png': 'golden',
    });
    const members = remoteFetch.listBuildMembers(tar);
    const dest = fs.mkdtempSync(path.join(os.tmpdir(), 'papastud-bracket-'));
    remoteFetch.extractBuildMembers(tar, members, dest);
    assert.ok(fs.existsSync(path.join(dest, 'mod/build/paparazzi/failures', bracketName)));
    assert.ok(!fs.existsSync(path.join(dest, 'mod/src/test/snapshots/g.png')));
    fs.rmSync(path.dirname(tar), { recursive: true, force: true });
    fs.rmSync(dest, { recursive: true, force: true });
  });

  it('buildDirsOf dedups to <module>/build directories', () => {
    assert.deepEqual(
      remoteFetch.buildDirsOf([
        'libraries/x/build/paparazzi/failures/a.png',
        'libraries/x/build/test-results/v/TEST-A.xml',
        'app/build/outputs/roborazzi/b.png',
      ]),
      ['app/build', 'libraries/x/build']
    );
    assert.deepEqual(remoteFetch.buildDirsOf(['build/x.png']), ['build']);
  });
});

describe('POST /api/projects/:id/scan-from-url', () => {
  let tmpdir, projectRoot, server, baseUrl, tarServer, tarUrl, tarFile;

  function startTarServer(file) {
    return new Promise(resolve => {
      const srv = http.createServer((req, res) => {
        res.writeHead(200, { 'Content-Type': 'application/x-tar' });
        fs.createReadStream(file).pipe(res);
      });
      srv.listen(0, '127.0.0.1', () => {
        const { port } = srv.address();
        resolve([srv, `http://127.0.0.1:${port}/result.tar`]);
      });
    });
  }

  beforeEach(async () => {
    tmpdir = fs.mkdtempSync(path.join(os.tmpdir(), 'papastud-rf-data-'));
    projects.setDataDir(tmpdir);
    projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'papastud-rf-proj-'));
    // Local golden (the source of truth) lives in the working copy already.
    const goldenDir = path.join(projectRoot, 'app', 'src', 'test', 'snapshots', 'images');
    fs.mkdirSync(goldenDir, { recursive: true });
    fs.writeFileSync(path.join(goldenDir, GOLDEN_NAME), 'local-golden-bytes');
    // The CI tarball carries only build/ outputs (the failure delta + JUnit).
    fs.mkdirSync(path.join(projectRoot, 'app'), { recursive: true });
    await new Promise(r => {
      server = createApp().listen(0, '127.0.0.1', () => {
        baseUrl = `http://127.0.0.1:${server.address().port}`;
        r();
      });
    });
  });

  afterEach(async () => {
    await new Promise(r => server.close(r));
    if (tarServer) await new Promise(r => tarServer.close(r));
    tarServer = null;
    fs.rmSync(tmpdir, { recursive: true, force: true });
    fs.rmSync(projectRoot, { recursive: true, force: true });
    if (tarFile) fs.rmSync(path.dirname(tarFile), { recursive: true, force: true });
    tarFile = null;
  });

  async function post(pathname, body) {
    const res = await fetch(baseUrl + pathname, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body || {}),
    });
    return { status: res.status, data: await res.json().catch(() => null) };
  }

  async function addProject() {
    const res = await post('/api/projects', {
      path: projectRoot, strategy: 'gradle', template_ids: ['paparazzi'],
    });
    assert.equal(res.status, 201);
    return res.data.id;
  }

  async function waitForJob(jobId, until = 8000) {
    const deadline = Date.now() + until;
    while (Date.now() < deadline) {
      const res = await fetch(`${baseUrl}/api/scan-jobs/${jobId}`);
      const job = await res.json();
      if (['completed', 'failed', 'cancelled', 'needs_confirmation'].includes(job.status)) return job;
      await new Promise(r => setTimeout(r, 100));
    }
    throw new Error('job did not settle in time');
  }

  it('downloads, overlays build/ into the project, and finds the CI failure', async () => {
    tarFile = makeTar({
      [`app/build/paparazzi/failures/${DELTA_NAME}`]: 'ci-delta-bytes',
      'app/build/test-results/testDebugUnitTest/TEST-MyScreenshotTest.xml': JUNIT_FAILING,
    });
    [tarServer, tarUrl] = await startTarServer(tarFile);

    const projectId = await addProject();
    const start = await post(`/api/projects/${projectId}/scan-from-url`, { url: tarUrl });
    assert.equal(start.status, 202);

    const job = await waitForJob(start.data.jobId);
    assert.equal(job.status, 'completed', `error: ${job.error}`);
    assert.ok(job.failuresFound >= 1);

    // The delta landed in the project's build dir; the local golden is untouched.
    assert.ok(fs.existsSync(path.join(projectRoot, 'app/build/paparazzi/failures', DELTA_NAME)));
    assert.ok(fs.existsSync(path.join(projectRoot, 'app/src/test/snapshots/images', GOLDEN_NAME)));

    // Scan resolved the local golden for the CI failure.
    const scan = await (await fetch(`${baseUrl}/api/scans/${job.scanId}`)).json();
    assert.ok(scan.failures.some(f => f.has_golden));
  });

  it('parks at needs_confirmation when the tarball layout does not match, then confirms', async () => {
    tarFile = makeTar({
      [`unknownmod/build/paparazzi/failures/${DELTA_NAME}`]: 'ci-delta-bytes',
      'unknownmod/build/test-results/testDebugUnitTest/TEST-MyScreenshotTest.xml': JUNIT_FAILING,
    });
    [tarServer, tarUrl] = await startTarServer(tarFile);

    const projectId = await addProject();
    const start = await post(`/api/projects/${projectId}/scan-from-url`, { url: tarUrl });
    assert.equal(start.status, 202);

    const parked = await waitForJob(start.data.jobId);
    assert.equal(parked.status, 'needs_confirmation');
    assert.deepEqual(parked.compat.unmatched, ['unknownmod']);
    assert.ok(!fs.existsSync(path.join(projectRoot, 'unknownmod')), 'must not extract before confirm');

    const confirm = await post(`/api/scan-jobs/${start.data.jobId}/confirm`, {});
    assert.equal(confirm.status, 200);

    const done = await waitForJob(start.data.jobId);
    assert.equal(done.status, 'completed', `error: ${done.error}`);
    assert.ok(fs.existsSync(path.join(projectRoot, 'unknownmod/build/paparazzi/failures', DELTA_NAME)));
  });

  it('rejects a missing url and a non-http url', async () => {
    const projectId = await addProject();
    const a = await post(`/api/projects/${projectId}/scan-from-url`, {});
    assert.equal(a.status, 400);
    const b = await post(`/api/projects/${projectId}/scan-from-url`, { url: 'file:///etc/passwd' });
    assert.equal(b.status, 400);
  });

  it('404s scan-from-url for an unknown project and confirm for an unknown job', async () => {
    const a = await post('/api/projects/nope/scan-from-url', { url: 'http://127.0.0.1/x.tar' });
    assert.equal(a.status, 404);
    const b = await post('/api/scan-jobs/nope/confirm', {});
    assert.equal(b.status, 404);
  });
});

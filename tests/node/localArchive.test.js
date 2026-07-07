const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const projects = require('../../src/projects');
const { createApp } = require('../../src/handler');
const localArchive = require('../../src/localArchive');

// --- Archive builders: stage { 'rel/path': content } then pack. ---

function stageEntries(entries) {
  const stage = fs.mkdtempSync(path.join(os.tmpdir(), 'papastud-stage-src-'));
  const tops = new Set();
  for (const [rel, content] of Object.entries(entries)) {
    const abs = path.join(stage, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content);
    tops.add(rel.split('/')[0]);
  }
  return { stage, tops: [...tops] };
}

function makeTar(entries, ext = '.tar') {
  const { stage, tops } = stageEntries(entries);
  const tarFile = path.join(stage, `archive${ext}`);
  const flags = ext === '.tar' ? '-cf' : '-czf';
  const r = spawnSync('tar', [flags, tarFile, '-C', stage, ...tops], { encoding: 'utf8' });
  assert.equal(r.status, 0, `tar failed: ${r.stderr}`);
  return tarFile;
}

function makeZip(entries) {
  const { stage, tops } = stageEntries(entries);
  const zipFile = path.join(stage, 'archive.zip');
  const r = spawnSync('zip', ['-r', '-q', zipFile, ...tops], { cwd: stage, encoding: 'utf8' });
  assert.equal(r.status, 0, `zip failed: ${r.stderr}`);
  return zipFile;
}

function rmParent(file) {
  fs.rmSync(path.dirname(file), { recursive: true, force: true });
}

const JUNIT_FAILING = `<?xml version="1.0" encoding="UTF-8"?>
<testsuite name="MyScreenshotTest" tests="1" failures="1" errors="0" skipped="0" time="0.5">
  <testcase name="snap" classname="com.example.MyScreenshotTest" time="0.5">
    <failure message="image differ (by 5.0%) delta-com.example_MyScreenshotTest_snap.png">stack</failure>
  </testcase>
</testsuite>`;

const DELTA_NAME = 'delta-com.example_MyScreenshotTest_snap.png';
const GOLDEN_NAME = 'com.example_MyScreenshotTest_snap.png';

// Extract an archive into a fresh stage dir and return it.
function extractToStage(file) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'papastud-stage-'));
  localArchive.extractArchive(file, dir);
  return dir;
}

describe('localArchive pure helpers', () => {
  it('sniffFormat detects zip vs tar vs tar.gz by magic bytes', () => {
    const zip = makeZip({ 'a/build/x.png': 'x' });
    const tar = makeTar({ 'a/build/x.png': 'x' });
    const tgz = makeTar({ 'a/build/x.png': 'x' }, '.tar.gz');
    assert.equal(localArchive.sniffFormat(zip), 'zip');
    assert.equal(localArchive.sniffFormat(tar), 'tar');
    assert.equal(localArchive.sniffFormat(tgz), 'tar');
    [zip, tar, tgz].forEach(rmParent);
  });

  it('collectBuildMembers keeps build/ files, drops src/ + dirs, skips symlinks', () => {
    const stage = extractToStage(makeTar({
      'app/build/paparazzi/failures/d.png': 'delta',
      'app/build/test-results/v/TEST-A.xml': 'junit',
      'app/src/test/snapshots/g.png': 'golden',
    }));
    // A symlink under build/ must be skipped, not followed.
    fs.symlinkSync('/etc/hosts', path.join(stage, 'app/build/link.png'));
    const members = localArchive.collectBuildMembers(stage);
    const rels = members.map(m => m.relPath).sort();
    assert.deepEqual(rels, [
      'app/build/paparazzi/failures/d.png',
      'app/build/test-results/v/TEST-A.xml',
    ]);
    fs.rmSync(stage, { recursive: true, force: true });
  });

  it('mergeStages merges disjoint archives with no conflict', () => {
    const s1 = extractToStage(makeTar({ 'app/build/x.png': 'aaa' }));
    const s2 = extractToStage(makeZip({ 'lib/build/y.png': 'bbb' }));
    const { members, moduleRoots, conflicts } = localArchive.mergeStages([
      { name: 'a.tar', dir: s1 }, { name: 'b.zip', dir: s2 },
    ]);
    assert.equal(conflicts.length, 0);
    assert.deepEqual(members.map(m => m.relPath).sort(), ['app/build/x.png', 'lib/build/y.png']);
    assert.deepEqual(moduleRoots, ['app', 'lib']);
    [s1, s2].forEach(d => fs.rmSync(d, { recursive: true, force: true }));
  });

  it('mergeStages treats identical-content duplicates as a silent merge', () => {
    const s1 = extractToStage(makeTar({ 'app/build/x.png': 'same-bytes' }));
    const s2 = extractToStage(makeZip({ 'app/build/x.png': 'same-bytes' }));
    const { members, conflicts } = localArchive.mergeStages([
      { name: 'a.tar', dir: s1 }, { name: 'b.zip', dir: s2 },
    ]);
    assert.equal(conflicts.length, 0);
    assert.equal(members.length, 1);
    [s1, s2].forEach(d => fs.rmSync(d, { recursive: true, force: true }));
  });

  it('mergeStages reports a conflict when the same path differs in content', () => {
    const s1 = extractToStage(makeTar({ 'app/build/x.png': 'version-one' }));
    const s2 = extractToStage(makeZip({ 'app/build/x.png': 'version-two' }));
    const { conflicts } = localArchive.mergeStages([
      { name: 'a.tar', dir: s1 }, { name: 'b.zip', dir: s2 },
    ]);
    assert.equal(conflicts.length, 1);
    assert.equal(conflicts[0].path, 'app/build/x.png');
    assert.deepEqual(conflicts[0].archives, ['a.tar', 'b.zip']);
    [s1, s2].forEach(d => fs.rmSync(d, { recursive: true, force: true }));
  });
});

describe('POST /api/uploads + /api/projects/:id/scan-from-uploads', () => {
  let tmpdir, projectRoot, server, baseUrl;

  function listUploadTemps() {
    return fs.readdirSync(os.tmpdir()).filter(n => n.startsWith('papastud-upload-'));
  }

  function seedGolden(moduleDir) {
    const goldenDir = path.join(projectRoot, moduleDir, 'src', 'test', 'snapshots', 'images');
    fs.mkdirSync(goldenDir, { recursive: true });
    fs.writeFileSync(path.join(goldenDir, GOLDEN_NAME), 'local-golden-bytes');
    fs.mkdirSync(path.join(projectRoot, moduleDir), { recursive: true });
  }

  beforeEach(async () => {
    tmpdir = fs.mkdtempSync(path.join(os.tmpdir(), 'papastud-la-data-'));
    projects.setDataDir(tmpdir);
    projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'papastud-la-proj-'));
    await new Promise(r => {
      server = createApp().listen(0, '127.0.0.1', () => {
        baseUrl = `http://127.0.0.1:${server.address().port}`;
        r();
      });
    });
  });

  afterEach(async () => {
    await new Promise(r => server.close(r));
    fs.rmSync(tmpdir, { recursive: true, force: true });
    fs.rmSync(projectRoot, { recursive: true, force: true });
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

  async function upload(filename, file) {
    const res = await fetch(`${baseUrl}/api/uploads?filename=${encodeURIComponent(filename)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/octet-stream' },
      body: fs.readFileSync(file),
    });
    return { status: res.status, data: await res.json().catch(() => null) };
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

  it('merges a tar and a zip (disjoint modules) into one scan', async () => {
    seedGolden('app');
    seedGolden('lib');
    const tar = makeTar({
      [`app/build/paparazzi/failures/${DELTA_NAME}`]: 'ci-delta-app',
      'app/build/test-results/testDebugUnitTest/TEST-A.xml': JUNIT_FAILING,
    });
    const zip = makeZip({
      [`lib/build/paparazzi/failures/${DELTA_NAME}`]: 'ci-delta-lib',
      'lib/build/test-results/testDebugUnitTest/TEST-B.xml': JUNIT_FAILING,
    });
    const projectId = await addProject();
    const u1 = await upload('app.tar', tar);
    const u2 = await upload('lib.zip', zip);
    assert.equal(u1.status, 201);
    assert.equal(u2.status, 201);

    const start = await post(`/api/projects/${projectId}/scan-from-uploads`, {
      uploadIds: [u1.data.uploadId, u2.data.uploadId],
    });
    assert.equal(start.status, 202);
    const job = await waitForJob(start.data.jobId);
    assert.equal(job.status, 'completed', `error: ${job.error}`);
    assert.ok(job.failuresFound >= 2);
    assert.ok(fs.existsSync(path.join(projectRoot, 'app/build/paparazzi/failures', DELTA_NAME)));
    assert.ok(fs.existsSync(path.join(projectRoot, 'lib/build/paparazzi/failures', DELTA_NAME)));
    // Goldens untouched.
    assert.ok(fs.existsSync(path.join(projectRoot, 'app/src/test/snapshots/images', GOLDEN_NAME)));
    [tar, zip].forEach(rmParent);
  });

  it('merges identical-content duplicates without conflict', async () => {
    seedGolden('app');
    const entries = {
      [`app/build/paparazzi/failures/${DELTA_NAME}`]: 'identical-delta',
      'app/build/test-results/testDebugUnitTest/TEST-A.xml': JUNIT_FAILING,
    };
    const a = makeTar(entries);
    const b = makeZip(entries);
    const projectId = await addProject();
    const u1 = await upload('a.tar', a);
    const u2 = await upload('b.zip', b);

    const start = await post(`/api/projects/${projectId}/scan-from-uploads`, {
      uploadIds: [u1.data.uploadId, u2.data.uploadId],
    });
    const job = await waitForJob(start.data.jobId);
    assert.equal(job.status, 'completed', `error: ${job.error}`);
    assert.ok(job.failuresFound >= 1);
    [a, b].forEach(rmParent);
  });

  it('aborts with a conflicts list when archives disagree, leaving the project untouched', async () => {
    seedGolden('app');
    const a = makeTar({ [`app/build/paparazzi/failures/${DELTA_NAME}`]: 'version-one' });
    const b = makeZip({ [`app/build/paparazzi/failures/${DELTA_NAME}`]: 'version-two' });
    const projectId = await addProject();
    const u1 = await upload('a.tar', a);
    const u2 = await upload('b.zip', b);

    const start = await post(`/api/projects/${projectId}/scan-from-uploads`, {
      uploadIds: [u1.data.uploadId, u2.data.uploadId],
    });
    const job = await waitForJob(start.data.jobId);
    assert.equal(job.status, 'failed');
    assert.ok(job.conflicts && job.conflicts.length === 1);
    assert.equal(job.conflicts[0].path, `app/build/paparazzi/failures/${DELTA_NAME}`);
    assert.deepEqual(job.conflicts[0].archives, ['a.tar', 'b.zip']);
    // Nothing was overlaid onto the project.
    assert.ok(!fs.existsSync(path.join(projectRoot, 'app/build')), 'must not overlay on conflict');
    [a, b].forEach(rmParent);
  });

  it('parks at needs_confirmation when no module matches, then confirms', async () => {
    const tar = makeTar({
      [`unknownmod/build/paparazzi/failures/${DELTA_NAME}`]: 'ci-delta',
      'unknownmod/build/test-results/testDebugUnitTest/TEST-A.xml': JUNIT_FAILING,
    });
    const projectId = await addProject();
    const u1 = await upload('x.tar', tar);
    const start = await post(`/api/projects/${projectId}/scan-from-uploads`, {
      uploadIds: [u1.data.uploadId],
    });
    const parked = await waitForJob(start.data.jobId);
    assert.equal(parked.status, 'needs_confirmation');
    assert.deepEqual(parked.compat.unmatched, ['unknownmod']);
    assert.ok(!fs.existsSync(path.join(projectRoot, 'unknownmod')), 'must not overlay before confirm');

    const confirm = await post(`/api/scan-jobs/${start.data.jobId}/confirm`, {});
    assert.equal(confirm.status, 200);
    const done = await waitForJob(start.data.jobId);
    assert.equal(done.status, 'completed', `error: ${done.error}`);
    assert.ok(fs.existsSync(path.join(projectRoot, 'unknownmod/build/paparazzi/failures', DELTA_NAME)));
    rmParent(tar);
  });

  it('rejects an oversized upload with 413 and leaves no temp dir', async () => {
    const before = new Set(listUploadTemps());
    const saved = localArchive.MAX_UPLOAD_BYTES;
    localArchive.MAX_UPLOAD_BYTES = 8; // tiny cap for the test
    try {
      const res = await fetch(`${baseUrl}/api/uploads?filename=big.zip`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/octet-stream' },
        body: Buffer.alloc(64, 1),
      });
      assert.equal(res.status, 413);
      const leaked = listUploadTemps().filter(n => !before.has(n));
      assert.deepEqual(leaked, [], 'oversized upload temp dir must be cleaned up');
    } finally {
      localArchive.MAX_UPLOAD_BYTES = saved;
    }
  });

  it('validates uploads and scan-from-uploads inputs', async () => {
    const projectId = await addProject();
    // Bad extension.
    const bad = await fetch(`${baseUrl}/api/uploads?filename=notes.txt`, {
      method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: Buffer.from('x'),
    });
    assert.equal(bad.status, 400);
    // Empty list.
    assert.equal((await post(`/api/projects/${projectId}/scan-from-uploads`, { uploadIds: [] })).status, 400);
    // Unknown id.
    assert.equal((await post(`/api/projects/${projectId}/scan-from-uploads`, { uploadIds: ['deadbeef'] })).status, 400);
    // Unknown project.
    assert.equal((await post('/api/projects/nope/scan-from-uploads', { uploadIds: ['x'] })).status, 404);
  });
});

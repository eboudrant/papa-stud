const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');
const projects = require('../../src/projects');
const scanJobs = require('../../src/scanJobs');

let tmpdir;

beforeEach(() => {
  tmpdir = fs.mkdtempSync(path.join(os.tmpdir(), 'papastud-scanjobs-test-'));
  projects.setDataDir(tmpdir);
});

afterEach(() => {
  fs.rmSync(tmpdir, { recursive: true, force: true });
});

describe('watch support by strategy', () => {
  function makeScan(strategy) {
    const proj = projects.addProject('P', tmpdir, undefined, strategy);
    const failures = [
      { module: ':app', profile: 'swift-snapshot', filename: 'A.png', status: 'accepted' },
      { module: ':app', profile: 'swift-snapshot', filename: 'B.png', status: 'pending' },
    ];
    const scan = projects.createScanFromResults(proj.id, 'P', tmpdir, [{ name: ':app' }], failures);
    return scan;
  }

  it('watchSupported is false for xcresult-driven strategies (swift-snapshot)', () => {
    const scan = makeScan('swift-snapshot');
    assert.equal(scanJobs.watchSupported(scan.id), false);
  });

  it('watchSupported is true for gradle', () => {
    const scan = makeScan('gradle');
    assert.equal(scanJobs.watchSupported(scan.id), true);
  });

  it('watchSupported is null for a missing scan', () => {
    assert.equal(scanJobs.watchSupported('does-not-exist'), null);
  });

  it('startWatching refuses swift-snapshot and does NOT wipe failures', () => {
    const scan = makeScan('swift-snapshot');
    const started = scanJobs.startWatching(scan.id);
    assert.equal(started, false);
    assert.equal(scanJobs.isWatching(scan.id), false);
    // The parse-derived failures (and the accepted status) must survive.
    const after = projects.getScan(scan.id, { page: 0, size: 100 });
    assert.equal(after.failures.length, 2);
    const a = after.failures.find(f => f.filename === 'A.png');
    assert.equal(a.status, 'accepted');
  });
});

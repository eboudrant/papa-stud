const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');
const projects = require('../../src/projects');

let tmpdir;
let origDir;

beforeEach(() => {
  tmpdir = fs.mkdtempSync(path.join(os.tmpdir(), 'papastud-proj-test-'));
  origDir = process.cwd();
  projects.setDataDir(tmpdir);
});

afterEach(() => {
  process.chdir(origDir);
  fs.rmSync(tmpdir, { recursive: true, force: true });
});

describe('one scan per project', () => {
  it('second scan replaces first', () => {
    const scan1 = projects.createScanFromResults('proj1', 'MyProject', '/tmp/proj', [], []);
    let scans = projects.listScans();
    assert.equal(scans.length, 1);
    assert.equal(scans[0].id, scan1.id);

    const scan2 = projects.createScanFromResults('proj1', 'MyProject', '/tmp/proj', [], []);
    scans = projects.listScans();
    assert.equal(scans.length, 1);
    assert.equal(scans[0].id, scan2.id);
    assert.ok(!fs.existsSync(projects.scanPath(scan1.id)));
  });

  it('different projects kept', () => {
    const scanA = projects.createScanFromResults('proj_a', 'ProjectA', '/tmp/a', [], []);
    const scanB = projects.createScanFromResults('proj_b', 'ProjectB', '/tmp/b', [], []);
    const scans = projects.listScans();
    assert.equal(scans.length, 2);
    const ids = new Set(scans.map(s => s.id));
    assert.ok(ids.has(scanA.id));
    assert.ok(ids.has(scanB.id));
  });

  it('third scan still one per project', () => {
    const scan1 = projects.createScanFromResults('proj1', 'P', '/tmp/p', [], []);
    const scan2 = projects.createScanFromResults('proj1', 'P', '/tmp/p', [], []);
    const scan3 = projects.createScanFromResults('proj1', 'P', '/tmp/p', [], []);
    const scans = projects.listScans();
    assert.equal(scans.length, 1);
    assert.equal(scans[0].id, scan3.id);
    assert.ok(!fs.existsSync(projects.scanPath(scan1.id)));
    assert.ok(!fs.existsSync(projects.scanPath(scan2.id)));
  });
});

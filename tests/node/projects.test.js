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

describe('acceptBaseline', () => {
  let projectDir;

  beforeEach(() => {
    projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'papastud-proj-real-'));
  });

  afterEach(() => {
    fs.rmSync(projectDir, { recursive: true, force: true });
  });

  function setupScan({ withGolden = true, actualExists = true } = {}) {
    const actualPath = path.join(projectDir, 'build', 'actual.png');
    const goldenPath = path.join(projectDir, 'goldens', 'golden.png');
    if (actualExists) {
      fs.mkdirSync(path.dirname(actualPath), { recursive: true });
      fs.writeFileSync(actualPath, 'ACTUAL_CONTENT');
    }
    if (withGolden) {
      fs.mkdirSync(path.dirname(goldenPath), { recursive: true });
      fs.writeFileSync(goldenPath, 'OLD_GOLDEN');
    }
    const proj = projects.addProject('MyProj', projectDir);
    const scan = projects.createScanFromResults(
      proj.id, 'MyProj', projectDir, [],
      [{
        filename: 'test.png',
        actual_path: actualPath,
        golden_path: goldenPath,
        module: ':app',
        profile: 'baseline',
        status: 'pending',
      }]
    );
    return { scan, actualPath, goldenPath };
  }

  it('copies actual over golden and marks accepted', () => {
    const { scan, actualPath, goldenPath } = setupScan();
    const result = projects.acceptBaseline(scan.id, 'test.png');
    assert.ok(result);
    assert.equal(result.error, undefined);
    assert.equal(fs.readFileSync(goldenPath, 'utf8'), 'ACTUAL_CONTENT');
    const updated = projects.getScan(scan.id);
    assert.equal(updated.failures[0].status, 'accepted');
    assert.equal(updated.stats.accepted, 1);
    assert.equal(updated.stats.pending, 0);
  });

  it('creates parent dir for first-time golden', () => {
    const { scan } = setupScan({ withGolden: false });
    const result = projects.acceptBaseline(scan.id, 'test.png');
    assert.equal(result.error, undefined);
    assert.ok(fs.existsSync(path.join(projectDir, 'goldens', 'golden.png')));
  });

  it('returns error if actual missing', () => {
    const { scan } = setupScan({ actualExists: false });
    const result = projects.acceptBaseline(scan.id, 'test.png');
    assert.ok(result.error);
    assert.match(result.error, /actual image missing/);
  });

  it('returns null for unknown scan', () => {
    const result = projects.acceptBaseline('bogus-scan-id', 'test.png');
    assert.equal(result, null);
  });

  it('returns null for unknown filename', () => {
    const { scan } = setupScan();
    const result = projects.acceptBaseline(scan.id, 'nope.png');
    assert.equal(result, null);
  });

  it('refuses paths outside project root', () => {
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'papastud-outside-'));
    const outsideActual = path.join(outside, 'evil.png');
    fs.writeFileSync(outsideActual, 'EVIL');
    try {
      const proj = projects.addProject('P', projectDir);
      const scan = projects.createScanFromResults(
        proj.id, 'P', projectDir, [],
        [{
          filename: 'test.png',
          actual_path: outsideActual,
          golden_path: path.join(projectDir, 'golden.png'),
          module: ':app', profile: 'baseline', status: 'pending',
        }]
      );
      const result = projects.acceptBaseline(scan.id, 'test.png');
      assert.ok(result.error);
      assert.match(result.error, /outside project/);
    } finally {
      fs.rmSync(outside, { recursive: true, force: true });
    }
  });
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

describe('home directory expansion', () => {
  it('expands ~ in addProject path', () => {
    const proj = projects.addProject('Home', '~/some/dir');
    assert.equal(proj.path, path.join(os.homedir(), 'some', 'dir'));
  });

  it('expands bare ~ in addProject path', () => {
    const proj = projects.addProject('Home', '~');
    assert.equal(proj.path, os.homedir());
  });

  it('leaves absolute paths untouched', () => {
    const proj = projects.addProject('Abs', '/tmp/x');
    assert.equal(proj.path, '/tmp/x');
  });

  it('does not expand ~ in middle of path', () => {
    const proj = projects.addProject('Mid', '/tmp/~weird');
    assert.equal(proj.path, '/tmp/~weird');
  });

  it('listProjects expands ~ for legacy stored paths', () => {
    const raw = path.join(tmpdir, 'projects.json');
    fs.writeFileSync(raw, JSON.stringify([
      { id: 'a', name: 'Legacy', path: '~/legacy', profiles: [] },
    ]));
    const list = projects.listProjects();
    assert.equal(list[0].path, path.join(os.homedir(), 'legacy'));
  });

  it('getProject returns expanded path for legacy stored paths', () => {
    const raw = path.join(tmpdir, 'projects.json');
    fs.writeFileSync(raw, JSON.stringify([
      { id: 'a', name: 'Legacy', path: '~/legacy', profiles: [] },
    ]));
    const proj = projects.getProject('a');
    assert.equal(proj.path, path.join(os.homedir(), 'legacy'));
  });
});

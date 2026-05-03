const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  discoverModules,
  getWatchDirs,
  resolveModulePath,
  parseTestIdentifier,
  locateXcresult,
  bucketFailures,
} = require('../../src/strategies/swift-snapshot');
const { findNewestXcresult } = require('../../src/xcresultParser');

let tmpRoot;

beforeEach(() => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'papastud-swift-'));
});

afterEach(() => {
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

function mkdirs(...rels) {
  for (const r of rels) fs.mkdirSync(path.join(tmpRoot, r), { recursive: true });
}

describe('discoverModules', () => {
  it('yields one entry per __Snapshots__ directory, parent dir as module', () => {
    mkdirs(
      'Argo/ArgoComponentTests/__Snapshots__/Foo',
      'libraries/HML/Tests/HMLTests/__Snapshots__/Bar',
    );
    const found = [...discoverModules(tmpRoot)];
    const names = found.map(([, name]) => name).sort();
    assert.deepEqual(names, ['Argo/ArgoComponentTests', 'libraries/HML/Tests/HMLTests']);
    for (const [snapDir, , modulePath] of found) {
      assert.ok(snapDir.endsWith('__Snapshots__'));
      assert.ok(snapDir.startsWith(modulePath + path.sep));
    }
  });

  it('prunes node_modules and .build', () => {
    mkdirs(
      'node_modules/x/__Snapshots__',
      '.build/y/__Snapshots__',
      'pkg/Tests/__Snapshots__',
    );
    const names = [...discoverModules(tmpRoot)].map(([, n]) => n);
    assert.deepEqual(names, ['pkg/Tests']);
  });
});

describe('getWatchDirs', () => {
  it('includes __Snapshots__ under the module', () => {
    const dirs = getWatchDirs('/p/m', null);
    assert.ok([...dirs].some(d => d.endsWith(path.join('m', '__Snapshots__'))));
  });
});

describe('resolveModulePath', () => {
  it('joins forward-slash module name back to project root', () => {
    assert.equal(resolveModulePath('Argo/ArgoComponentTests', '/p'), path.join('/p', 'Argo', 'ArgoComponentTests'));
    assert.equal(resolveModulePath(':root', '/p'), '/p');
  });
});

describe('parseTestIdentifier', () => {
  it('parses target/class/method form', () => {
    assert.deepEqual(
      parseTestIdentifier('ArgoComponentTests/CUDMiniModuleSnapshotTests/testVariants()'),
      { className: 'CUDMiniModuleSnapshotTests', methodName: 'testVariants', preset: null },
    );
  });
  it('parses class/method form', () => {
    assert.deepEqual(
      parseTestIdentifier('CUDMiniModuleSnapshotTests/testVariants()'),
      { className: 'CUDMiniModuleSnapshotTests', methodName: 'testVariants', preset: null },
    );
  });
});

describe('findNewestXcresult', () => {
  it('returns the newest .xcresult bundle by mtime', () => {
    fs.mkdirSync(path.join(tmpRoot, 'a/Run-1.xcresult'), { recursive: true });
    fs.mkdirSync(path.join(tmpRoot, 'b/Run-2.xcresult'), { recursive: true });
    const newer = path.join(tmpRoot, 'b/Run-2.xcresult');
    const older = path.join(tmpRoot, 'a/Run-1.xcresult');
    fs.utimesSync(older, new Date(2020, 0, 1), new Date(2020, 0, 1));
    fs.utimesSync(newer, new Date(2024, 0, 1), new Date(2024, 0, 1));
    const found = findNewestXcresult(tmpRoot);
    assert.equal(found, newer);
  });

  it('returns null if no xcresult is found', () => {
    assert.equal(findNewestXcresult(tmpRoot), null);
  });
});

describe('locateXcresult', () => {
  it('honours project.xcresult_path absolute override', () => {
    const pinned = path.join(tmpRoot, 'pinned.xcresult');
    fs.mkdirSync(pinned, { recursive: true });
    const out = locateXcresult(tmpRoot, { xcresult_path: pinned });
    assert.equal(out, pinned);
  });

  it('honours project.xcresult_path relative override', () => {
    const rel = 'subdir/pinned.xcresult';
    fs.mkdirSync(path.join(tmpRoot, rel), { recursive: true });
    const out = locateXcresult(tmpRoot, { xcresult_path: rel });
    assert.equal(out, path.join(tmpRoot, rel));
  });

  it('returns the override path even if missing (xcrun surfaces the error)', () => {
    const out = locateXcresult(tmpRoot, { xcresult_path: '/no/such/path.xcresult' });
    assert.equal(out, '/no/such/path.xcresult');
  });

  it('falls back to newest *.xcresult under project root', () => {
    fs.mkdirSync(path.join(tmpRoot, 'a/found.xcresult'), { recursive: true });
    const out = locateXcresult(tmpRoot, null);
    assert.equal(out, path.join(tmpRoot, 'a/found.xcresult'));
  });
});

describe('bucketFailures', () => {
  function setupModule(method, goldens) {
    const snapDir = path.join(tmpRoot, 'Tests/M/__Snapshots__');
    const classDir = path.join(snapDir, 'GreetingTests');
    fs.mkdirSync(classDir, { recursive: true });
    for (const g of goldens) fs.writeFileSync(path.join(classDir, g), 'png');
    return [[snapDir, 'Tests/M', path.join(tmpRoot, 'Tests/M')]];
  }

  function makeFailure(method, paired) {
    return {
      testIdentifier: `GreetingTests/${method}()`,
      name: `${method}()`,
      paired,
    };
  }

  it('emits a row per failure with delta_kind=pixel-diff and pairs goldens by enumeration order', () => {
    const modules = setupModule('testFoo', ['testFoo.1.png', 'testFoo.2.png']);
    const failures = [makeFailure('testFoo', [
      { actualPath: '/c/a1', differencePath: '/c/d1', timestamp: 100 },
      { actualPath: '/c/a2', differencePath: '/c/d2', timestamp: 100 },
    ])];
    const byModule = bucketFailures(failures, modules, 0);
    const rows = byModule.get('Tests/M');
    assert.equal(rows.length, 2);
    assert.equal(rows[0].delta_kind, 'pixel-diff');
    assert.equal(rows[0].golden_path, path.join(tmpRoot, 'Tests/M/__Snapshots__/GreetingTests/testFoo.1.png'));
    assert.equal(rows[1].golden_path, path.join(tmpRoot, 'Tests/M/__Snapshots__/GreetingTests/testFoo.2.png'));
    assert.equal(rows[0].has_golden, true);
    assert.equal(rows[1].has_golden, true);
  });

  it('marks rows missing a golden when failures outnumber recorded snapshots', () => {
    const modules = setupModule('testFoo', ['testFoo.1.png']);
    const failures = [makeFailure('testFoo', [
      { actualPath: '/c/a1', differencePath: '/c/d1' },
      { actualPath: '/c/a2', differencePath: '/c/d2' },
    ])];
    const rows = bucketFailures(failures, modules, 0).get('Tests/M');
    assert.equal(rows[0].has_golden, true);
    assert.equal(rows[1].has_golden, false);
    assert.equal(rows[1].golden_path, null);
  });

  it('buckets failures whose class is not on disk under :unknown with no golden', () => {
    const modules = setupModule('testFoo', ['testFoo.1.png']);
    const failures = [{
      testIdentifier: 'StrayTests/testBar()',
      name: 'testBar()',
      paired: [{ actualPath: '/c/a', differencePath: '/c/d' }],
    }];
    const byModule = bucketFailures(failures, modules, 0);
    const rows = byModule.get(':unknown');
    assert.equal(rows.length, 1);
    assert.equal(rows[0].has_golden, false);
    assert.equal(rows[0].class_name, 'StrayTests');
  });
});

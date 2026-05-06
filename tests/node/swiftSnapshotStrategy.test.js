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
  locateXcresults,
  bucketFailures,
} = require('../../src/strategies/swift-snapshot');
const { findRecentXcresults } = require('../../src/xcresultParser');

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

describe('locateXcresults', () => {
  it('honours project.xcresult_path absolute override', () => {
    const pinned = path.join(tmpRoot, 'pinned.xcresult');
    fs.mkdirSync(pinned, { recursive: true });
    assert.deepEqual(locateXcresults(tmpRoot, { xcresult_path: pinned }), [pinned]);
  });

  it('honours project.xcresult_path relative override', () => {
    const rel = 'subdir/pinned.xcresult';
    fs.mkdirSync(path.join(tmpRoot, rel), { recursive: true });
    assert.deepEqual(
      locateXcresults(tmpRoot, { xcresult_path: rel }),
      [path.join(tmpRoot, rel)],
    );
  });

  it('returns the override path even if missing (xcrun surfaces the error)', () => {
    assert.deepEqual(
      locateXcresults(tmpRoot, { xcresult_path: '/no/such/path.xcresult' }),
      ['/no/such/path.xcresult'],
    );
  });

  it('falls back to recent *.xcresult bundles under project root', () => {
    fs.mkdirSync(path.join(tmpRoot, 'a/found.xcresult'), { recursive: true });
    fs.mkdirSync(path.join(tmpRoot, 'b/also-found.xcresult'), { recursive: true });
    // /tmp is also walked shallowly so the result may include unrelated
    // bundles from the host — assert by subset rather than equality.
    const out = locateXcresults(tmpRoot, null);
    assert.ok(out.includes(path.join(tmpRoot, 'a/found.xcresult')));
    assert.ok(out.includes(path.join(tmpRoot, 'b/also-found.xcresult')));
  });
});

describe('findRecentXcresults', () => {
  it('returns bundles newer than the cutoff sorted newest first', () => {
    const a = path.join(tmpRoot, 'a/Run-1.xcresult');
    const b = path.join(tmpRoot, 'b/Run-2.xcresult');
    fs.mkdirSync(a, { recursive: true });
    fs.mkdirSync(b, { recursive: true });
    const now = Date.now();
    fs.utimesSync(a, new Date(now - 60_000), new Date(now - 60_000));
    fs.utimesSync(b, new Date(now - 1_000), new Date(now - 1_000));
    const out = findRecentXcresults({ projectRoots: [tmpRoot], shallowRoots: [] });
    assert.deepEqual(out, [b, a]);
  });

  it('drops bundles older than maxAgeMs', () => {
    const old = path.join(tmpRoot, 'old.xcresult');
    fs.mkdirSync(old, { recursive: true });
    fs.utimesSync(old, new Date(2020, 0, 1), new Date(2020, 0, 1));
    assert.deepEqual(
      findRecentXcresults({ projectRoots: [tmpRoot], shallowRoots: [], maxAgeMs: 60_000 }),
      [],
    );
  });

  it('walks shallowRoots only at depth 1', () => {
    const shallowRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'papastud-shallow-'));
    try {
      const top = path.join(shallowRoot, 'top.xcresult');
      const nested = path.join(shallowRoot, 'sub/nested.xcresult');
      fs.mkdirSync(top, { recursive: true });
      fs.mkdirSync(nested, { recursive: true });
      const out = findRecentXcresults({ shallowRoots: [shallowRoot] });
      assert.deepEqual(out, [top]);
    } finally {
      fs.rmSync(shallowRoot, { recursive: true, force: true });
    }
  });

  it('deduplicates a bundle that appears under both deep and shallow roots', () => {
    const bundle = path.join(tmpRoot, 'shared.xcresult');
    fs.mkdirSync(bundle, { recursive: true });
    const out = findRecentXcresults({
      projectRoots: [tmpRoot],
      shallowRoots: [tmpRoot],
    });
    assert.deepEqual(out, [bundle]);
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
    assert.equal(rows[0].filename, 'GreetingTests/testFoo.1.png');
    assert.equal(rows[0].snapshot_name, 'testFoo.1');
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
    assert.equal(rows[1].filename, 'GreetingTests/testFoo.png');
    assert.equal(rows[1].snapshot_name, 'testFoo');
  });

  it('prefers pair.goldenPath (mined from SnapshotTesting description) over enum fallback', () => {
    const modules = setupModule('testFoo', ['testFoo.alpha.png', 'testFoo.beta.png']);
    const betaPath = path.join(tmpRoot, 'Tests/M/__Snapshots__/GreetingTests/testFoo.beta.png');
    const failures = [makeFailure('testFoo', [
      { actualPath: '/c/a', differencePath: '/c/d', goldenPath: betaPath },
    ])];
    const rows = bucketFailures(failures, modules, 0).get('Tests/M');
    assert.equal(rows[0].golden_path, betaPath);
    assert.equal(rows[0].snapshot_name, 'testFoo.beta');
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

/**
 * Strategy for Apple/Xcode projects using `pointfreeco/swift-snapshot-testing`.
 * Goldens live next to tests in `__Snapshots__/<TestClass>/<testMethod>.<preset>.png`;
 * failures are extracted from `.xcresult` bundles via xcresultParser.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { parseXcresult, findRecentXcresults, BASE_PRUNE } = require('../xcresultParser');

// `__Snapshots__/` never lives inside DerivedData, so prune it here even though
// xcresultParser keeps it walkable (xcresult bundles do live under it).
const PRUNE = new Set([...BASE_PRUNE, 'DerivedData']);

function* discoverModules(root) {
  function* walk(dir, parts) {
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (!e.isDirectory()) continue;
      if (PRUNE.has(e.name)) continue;
      if (e.name.endsWith('.xcresult')) continue;
      const full = path.join(dir, e.name);
      if (e.name === '__Snapshots__') {
        const moduleName = parts.length ? parts.join('/') : ':root';
        const modulePath = parts.length ? path.join(root, ...parts) : root;
        yield [full, moduleName, modulePath];
        continue;
      }
      yield* walk(full, [...parts, e.name]);
    }
  }
  yield* walk(root, []);
}

function getWatchDirs(modulePath, profiles) {
  const dirs = new Set();
  dirs.add(path.join(modulePath, '__Snapshots__'));
  if (profiles) {
    for (const p of profiles) {
      if (p.golden_dir) dirs.add(path.join(modulePath, p.golden_dir));
    }
  }
  return dirs;
}

function resolveModulePath(moduleName, projectRoot) {
  if (!moduleName || moduleName === ':root') return projectRoot;
  return path.join(projectRoot, ...moduleName.split('/'));
}

function locateXcresults(projectRoot, project) {
  if (project && project.xcresult_path) {
    const p = path.isAbsolute(project.xcresult_path)
      ? project.xcresult_path
      : path.join(projectRoot, project.xcresult_path);
    return [p];
  }
  return findRecentXcresults({ projectRoots: [projectRoot] });
}

// Identifiers come as `Target/Class/method()` or `Class/method()`; we recover
// just the class + method here. Preset (the snapshot variant) is only known
// from the on-disk filename, not the testId.
function parseTestIdentifier(testId, fallbackName) {
  const id = testId || fallbackName || '';
  const parts = id.split('/').filter(Boolean);
  if (parts.length === 0) return { className: null, methodName: null, preset: null };
  const last = parts[parts.length - 1].replace(/\(\)$/, '');
  const className = parts.length >= 2 ? parts[parts.length - 2] : parts[0];
  return { className, methodName: last, preset: null };
}

// Pair parsed xcresult failures with on-disk goldens.
function bucketFailures(failures, modules, mtime) {
  // Build className → module bucket once. Multiple modules with the same class
  // name (rare) — first match wins.
  const classToModule = new Map();
  for (const [snapDir, moduleName, modulePath] of modules) {
    let classDirs;
    try { classDirs = fs.readdirSync(snapDir, { withFileTypes: true }); } catch { continue; }
    for (const d of classDirs) {
      if (d.isDirectory() && !classToModule.has(d.name)) {
        classToModule.set(d.name, { snapDir, moduleName, modulePath });
      }
    }
  }

  // A single failed test method commonly fans out to dozens of preset
  // failures (one assertion per variant), so cache the dir listing.
  const classDirCache = new Map();
  function readClassDir(dir) {
    if (!classDirCache.has(dir)) classDirCache.set(dir, fs.readdirSync(dir));
    return classDirCache.get(dir);
  }

  const byModule = new Map();
  for (const failure of failures) {
    const { className, methodName } = parseTestIdentifier(failure.testIdentifier, failure.name);
    if (!className) continue;

    const bucket = classToModule.get(className);
    const moduleName = bucket ? bucket.moduleName : ':unknown';

    // The parser mines the canonical path off the SnapshotTesting error
    // description; this sorted list is the fallback when the description
    // is missing or unparseable.
    const classDir = bucket ? path.join(bucket.snapDir, className) : null;
    const goldenCandidates = classDir
      ? readClassDir(classDir).filter(f => f.endsWith('.png') && f.startsWith(`${methodName}.`)).sort()
      : [];

    failure.paired.forEach((pair, idx) => {
      let goldenPath = pair.goldenPath || null;
      if (!goldenPath && goldenCandidates[idx]) {
        goldenPath = path.join(classDir, goldenCandidates[idx]);
      }
      const goldenName = goldenPath ? path.basename(goldenPath) : null;
      const filename = goldenName
        ? `${className}/${goldenName}`
        : `${className}/${methodName}.png`;

      if (!byModule.has(moduleName)) byModule.set(moduleName, []);
      byModule.get(moduleName).push({
        module: moduleName,
        profile: 'swift-snapshot',
        filename,
        delta_path: pair.differencePath || null,
        // Roborazzi/Paparazzi composite expected/diff/actual into the delta;
        // swift-snapshot emits a raw pixel-XOR. The UI strips this kind into
        // a 3-panel layout client-side.
        delta_kind: 'pixel-diff',
        actual_path: pair.actualPath,
        golden_path: goldenPath,
        package: bucket ? bucket.moduleName : '',
        class_name: className,
        method: methodName,
        snapshot_name: goldenName ? goldenName.replace(/\.png$/, '') : methodName,
        status: 'pending',
        diff_pct: null,
        has_golden: !!goldenPath,
        has_actual: !!pair.actualPath,
        mtime: pair.timestamp || mtime,
      });
    });
  }
  return byModule;
}

function parseProjectFailures(projectRoot, project, cacheDir) {
  const xcresultPaths = locateXcresults(projectRoot, project);
  if (xcresultPaths.length === 0) {
    return { stats: null, byModule: new Map(), modules: [], mtime: 0, xcresultPaths: [] };
  }
  const modules = [...discoverModules(projectRoot)];
  const stats = { passed: 0, failed: 0, skipped: 0, expectedFailure: 0 };
  const allFailures = [];
  let maxMtime = 0;
  for (const xcresultPath of xcresultPaths) {
    // Per-bundle subdir keyed by absolute path so re-exporting the same bundle
    // reuses its slot, and parallel bundles don't overwrite each other's manifest.
    const subCache = path.join(cacheDir, crypto.createHash('sha1').update(xcresultPath).digest('hex').slice(0, 12));
    fs.mkdirSync(subCache, { recursive: true });
    const r = parseXcresult(xcresultPath, subCache);
    if (r.stats) {
      stats.passed += r.stats.passed;
      stats.failed += r.stats.failed;
      stats.skipped += r.stats.skipped;
      stats.expectedFailure += r.stats.expectedFailure;
    }
    allFailures.push(...r.failures);
    if (r.mtime > maxMtime) maxMtime = r.mtime;
  }
  const byModule = bucketFailures(allFailures, modules, maxMtime);
  // Same `(module, filename)` from two bundles → keep the newer row.
  for (const [moduleName, rows] of byModule) {
    const newest = new Map();
    for (const row of rows) {
      const prev = newest.get(row.filename);
      if (!prev || (row.mtime || 0) > (prev.mtime || 0)) newest.set(row.filename, row);
    }
    byModule.set(moduleName, [...newest.values()]);
  }
  return { stats, byModule, modules, mtime: maxMtime, xcresultPaths };
}

const usesJunit = false;

module.exports = {
  discoverModules,
  getWatchDirs,
  resolveModulePath,
  parseProjectFailures,
  bucketFailures,
  locateXcresults,
  parseTestIdentifier,
  usesJunit,
};

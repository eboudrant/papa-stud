/**
 * Strategy for Apple/Xcode projects using `pointfreeco/swift-snapshot-testing`.
 * Goldens live next to tests in `__Snapshots__/<TestClass>/<testMethod>.<preset>.png`;
 * failures are extracted from `.xcresult` bundles via xcresultParser.
 */

const fs = require('fs');
const path = require('path');
const { parseXcresult, findNewestXcresult, BASE_PRUNE } = require('../xcresultParser');

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

function locateXcresult(projectRoot, project) {
  if (project && project.xcresult_path) {
    return path.isAbsolute(project.xcresult_path)
      ? project.xcresult_path
      : path.join(projectRoot, project.xcresult_path);
  }
  return findNewestXcresult(projectRoot);
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

// Pure: pair parsed xcresult failures with on-disk goldens. Extracted so tests
// can drive the bucketing without spawning xcrun.
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

  const byModule = new Map();
  for (const failure of failures) {
    const { className, methodName } = parseTestIdentifier(failure.testIdentifier, failure.name);
    if (!className) continue;

    const bucket = classToModule.get(className);
    const moduleName = bucket ? bucket.moduleName : ':unknown';

    // Goldens on disk: `<method>.<N>.png` (per-call counter from 1), or
    // `<method>.<preset>.<N>.png`. The xcresult doesn't say which call failed,
    // so we pair failure i → sorted golden i.
    const classDir = bucket ? path.join(bucket.snapDir, className) : null;
    const goldenCandidates = classDir
      ? fs.readdirSync(classDir).filter(f => f.endsWith('.png') && f.startsWith(`${methodName}.`)).sort()
      : [];

    failure.paired.forEach((pair, idx) => {
      const goldenName = goldenCandidates[idx] || null;
      const goldenPath = goldenName ? path.join(classDir, goldenName) : null;
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
  const xcresultPath = locateXcresult(projectRoot, project);
  if (!xcresultPath) {
    return { stats: null, byModule: new Map(), modules: [], mtime: 0, xcresultPath: null };
  }
  const { stats, failures, mtime } = parseXcresult(xcresultPath, cacheDir);
  const modules = [...discoverModules(projectRoot)];
  const byModule = bucketFailures(failures, modules, mtime);
  return { stats, byModule, modules, mtime, xcresultPath };
}

const usesJunit = false;

module.exports = {
  discoverModules,
  getWatchDirs,
  resolveModulePath,
  parseProjectFailures,
  bucketFailures,
  locateXcresult,
  parseTestIdentifier,
  usesJunit,
};

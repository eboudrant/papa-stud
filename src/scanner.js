/**
 * Scan Gradle projects for Paparazzi/Roborazzi screenshot failures.
 *
 * Finds modules with build/paparazzi/ or build/outputs/roborazzi/,
 * detects current vs stale failures using mtime clustering,
 * matches golden images, and parses JUnit XML for test statistics.
 */

const fs = require('fs');
const path = require('path');
const fg = require('fast-glob');
const { parseFilename } = require('./filenameParser');
const { parseJunitXml, parseDiffPercentages } = require('./junitParser');

const DEBUG = process.env.PAPASTUD_DEBUG === '1';
const log = (...args) => { if (DEBUG) console.log(...args); };

const MTIME_CLUSTER_TOLERANCE = 60.0;

const BUILD_ALLOWED = new Set(['paparazzi', 'test-results', 'outputs']);
const OUTPUT_ALLOWED = new Set(['roborazzi', 'screenshotTest-results']);

function deriveModule(relParts, buildIdx, root) {
  const moduleParts = relParts.slice(0, buildIdx);
  const moduleName = moduleParts.length ? ':' + moduleParts.join(':') : ':root';
  const modulePath = moduleParts.length ? path.join(root, ...moduleParts) : root;
  return [moduleName, modulePath];
}

const PRUNE_DIRS = new Set([
  '.git', '.gradle', '.idea', 'node_modules', '.cxx', '.transforms', 'src', '.kotlin',
]);

function scanProject(projectPath) {
  const result = { modules: [], failures: [] };
  for (const [phase, data] of scanProjectIncrementalSync(projectPath)) {
    if (phase === 'complete') return data;
  }
  return result;
}

function* scanProjectIncrementalSync(projectPath, cancelFn, profiles) {
  const root = projectPath;

  const discovered = [];
  for (const moduleInfo of discoverPaparazziModules(root, profiles)) {
    discovered.push(moduleInfo);
    yield ['discovering', { found: discovered.length, current_dir: moduleInfo[1] }];
  }
  yield ['discovered', { total: discovered.length }];

  const modules = [];
  const failures = [];
  for (let i = 0; i < discovered.length; i++) {
    if (cancelFn && cancelFn()) {
      yield ['cancelled', {}];
      return;
    }

    const [failuresDir, moduleName, modulePath] = discovered[i];
    const [moduleData, moduleFailures] = processSingleModule(failuresDir, moduleName, modulePath, profiles);
    modules.push(moduleData);
    if (moduleFailures.length) failures.push(...moduleFailures);

    yield ['progress', {
      scanned: i + 1,
      current_module: moduleName,
      failures_so_far: failures.length,
    }];
  }

  yield ['complete', { modules, failures }];
}

function processSingleModule(failuresDir, moduleName, modulePath, profiles) {
  const needsJunit = !profiles || !profiles.length || profiles.some(p => (p.result_source || 'junit') === 'junit');
  const [testStats, xmlMtime] = needsJunit ? parseJunitXml(modulePath) : [null, 0];
  const diffPcts = needsJunit ? parseDiffPercentages(modulePath) : {};
  const moduleFailures = [];
  const profileCounts = {};
  let totalSnapshots = 0;

  if (profiles && profiles.length) {
    for (const profile of profiles) {
      const pname = profile.name;
      const fDir = path.join(modulePath, profile.failures_dir);
      const gp = buildGoldenPatterns(profile);
      const useJunit = (profile.result_source || 'junit') === 'junit';
      const pf = processProfile(
        fDir, modulePath, moduleName, pname,
        useJunit ? testStats : null, useJunit ? xmlMtime : 0, gp, useJunit ? diffPcts : {},
        profile.delta_prefix !== undefined ? profile.delta_prefix : 'delta-',
        profile.delta_suffix || '',
        profile.actual_suffix || '',
      );
      moduleFailures.push(...pf);
      profileCounts[pname] = pf.length;
      const gDirStr = profile.golden_dir || '';
      if (gDirStr) {
        const gDir = path.join(modulePath, gDirStr);
        totalSnapshots += countPngsRecursive(gDir);
      }
    }
  } else {
    const defaultGp = ['src/test/snapshots/images/{name}.png'];
    const pf = processProfile(
      failuresDir, modulePath, moduleName, 'baseline',
      testStats, xmlMtime, defaultGp, diffPcts,
    );
    moduleFailures.push(...pf);
    profileCounts.baseline = pf.length;
    const goldenDir = path.join(modulePath, 'src', 'test', 'snapshots', 'images');
    totalSnapshots = countPngsRecursive(goldenDir);
  }

  const moduleData = {
    name: moduleName,
    failures_path: failuresDir || null,
    golden_path: path.join(modulePath, 'src', 'test', 'snapshots', 'images'),
    failure_count: moduleFailures.length,
    snapshot_count: totalSnapshots,
    profile_counts: profileCounts,
    test_stats: testStats,
  };
  return [moduleData, moduleFailures];
}

function buildGoldenPatterns(profile) {
  if (profile.golden_patterns) return profile.golden_patterns;
  const gDir = profile.golden_dir || '';
  const suffix = profile.golden_suffix || '';
  const patterns = [];
  if (suffix) patterns.push(`${gDir}/{name}${suffix}.png`);
  patterns.push(`${gDir}/{name}.png`);
  return patterns;
}

function resolveGolden(modulePath, goldenPatterns, snapshotName) {
  const name = snapshotName.endsWith('.png') ? snapshotName.slice(0, -4) : snapshotName;
  for (const pattern of goldenPatterns) {
    const resolved = pattern.replace('{name}', name);
    if (resolved.includes('**')) {
      const matches = fg.sync(resolved, { cwd: modulePath, absolute: true });
      if (matches.length) return matches[0];
    } else {
      const candidate = path.join(modulePath, resolved);
      if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return candidate;
    }
  }
  return null;
}

function processProfile(
  failuresDir, modulePath, moduleName, profileName,
  testStats, xmlMtime, goldenPatterns = [], diffPcts = {},
  deltaPrefix = 'delta-', deltaSuffix = '', actualSuffix = '',
) {
  const results = [];
  if (!failuresDir || !fs.existsSync(failuresDir) || !fs.statSync(failuresDir).isDirectory()) {
    return results;
  }

  let current = detectCurrentFailures(failuresDir, deltaPrefix, deltaSuffix);
  log(`[scan] ${profileName} in ${failuresDir}: ${current.length} candidates, xmlMtime=${xmlMtime}, testStats.failed=${testStats?.failed}`);
  // If JUnit XML reports 0 failures, all deltas are stale leftovers
  if (testStats && testStats.failed === 0 && xmlMtime > 0) {
    if (current.length) log(`[scan] all tests pass — filtering all ${current.length} stale deltas`);
    current = [];
  } else if (xmlMtime > 0 && current.length) {
    // Filter out delta files older than the latest JUnit XML run
    const before = current.length;
    current = current.filter(f => fs.statSync(f).mtimeMs / 1000 > xmlMtime - MTIME_CLUSTER_TOLERANCE);
    if (current.length < before) log(`[scan] filtered ${before - current.length} stale deltas (older than xmlMtime ${xmlMtime})`);
  }

  const goldenCache = {};
  for (const f of current) {
    const base = deltaToBase(path.basename(f), deltaPrefix, deltaSuffix);
    goldenCache[path.basename(f)] = resolveGolden(modulePath, goldenPatterns, base);
  }

  const noDeltaConvention = !deltaPrefix && !deltaSuffix;

  for (const candidatePath of current) {
    const base = deltaToBase(path.basename(candidatePath), deltaPrefix, deltaSuffix);
    const parsed = parseFilename(base);
    const goldenPath = goldenCache[path.basename(candidatePath)];

    let actualPath, deltaFilePath;
    if (noDeltaConvention) {
      // Compare mode: the file IS the actual, there's no separate delta
      actualPath = candidatePath;
      deltaFilePath = null;
      // Skip if golden exists and files are identical (not a failure)
      if (goldenPath) {
        try {
          const aStat = fs.statSync(candidatePath);
          const gStat = fs.statSync(goldenPath);
          if (aStat.size === gStat.size) {
            const actualBuf = fs.readFileSync(candidatePath);
            const goldenBuf = fs.readFileSync(goldenPath);
            if (actualBuf.equals(goldenBuf)) continue;
          }
        } catch {}
      }
    } else {
      // Delta mode: separate delta file, actual may have a suffix
      deltaFilePath = candidatePath;
      let actualName;
      if (actualSuffix) {
        const stem = base.endsWith('.png') ? base.slice(0, -4) : base;
        actualName = `${stem}${actualSuffix}.png`;
      } else {
        actualName = base;
      }
      actualPath = path.join(failuresDir, actualName);
      try { if (!fs.statSync(actualPath).isFile()) actualPath = null; }
      catch { actualPath = null; }
    }

    const stat = fs.statSync(candidatePath);
    results.push({
      module: moduleName,
      profile: profileName,
      filename: base,
      delta_path: deltaFilePath,
      actual_path: actualPath,
      golden_path: goldenPath || null,
      package: parsed.package,
      class_name: parsed.class_name,
      method: parsed.method,
      snapshot_name: parsed.snapshot_name,
      status: 'pending',
      diff_pct: (diffPcts || {})[base] || null,
      has_golden: goldenPath !== null,
      has_actual: actualPath !== null,
      mtime: stat.mtimeMs / 1000,
    });
  }
  return results;
}

function deltaToBase(filename, deltaPrefix, deltaSuffix) {
  let name = filename;
  if (deltaPrefix && name.startsWith(deltaPrefix)) {
    name = name.slice(deltaPrefix.length);
  }
  if (deltaSuffix) {
    let stem = name.endsWith('.png') ? name.slice(0, -4) : name;
    if (stem.endsWith(deltaSuffix)) {
      stem = stem.slice(0, -deltaSuffix.length);
      name = stem + '.png';
    }
  }
  return name;
}

function* discoverPaparazziModules(root) {
  yield* walkWithPruning(root, root);
}

function* walkWithPruning(dir, root, relParts = []) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }

  const subdirs = entries.filter(e => e.isDirectory()).map(e => e.name);
  const pruned = subdirs.filter(d => !PRUNE_DIRS.has(d));

  if (relParts.includes('build')) {
    const idx = relParts.indexOf('build');
    const depth = relParts.length - idx;

    if (depth === 1) {
      for (const d of pruned.filter(d => BUILD_ALLOWED.has(d))) {
        yield* walkWithPruning(path.join(dir, d), root, [...relParts, d]);
      }
    } else if (depth === 2 && relParts[relParts.length - 1] === 'outputs') {
      for (const d of pruned.filter(d => OUTPUT_ALLOWED.has(d))) {
        yield* walkWithPruning(path.join(dir, d), root, [...relParts, d]);
      }
    } else if (depth === 3 && relParts[idx + 1] === 'outputs' && relParts[idx + 2] === 'screenshotTest-results') {
      const [moduleName, modulePath] = deriveModule(relParts, idx, root);
      yield [null, moduleName, modulePath];
    } else if (depth === 3 && relParts[idx + 1] === 'outputs' && relParts[idx + 2] === 'roborazzi') {
      const [moduleName, modulePath] = deriveModule(relParts, idx, root);
      yield [dir, moduleName, modulePath];
    } else if (depth === 2 && relParts[relParts.length - 1] === 'paparazzi') {
      const [moduleName, modulePath] = deriveModule(relParts, idx, root);
      const failuresDir = path.join(dir, 'failures');
      try {
        const fStat = fs.statSync(failuresDir);
        yield [fStat.isDirectory() ? failuresDir : null, moduleName, modulePath];
      } catch {
        yield [null, moduleName, modulePath];
      }
    } else if (depth === 2 && relParts[relParts.length - 1] === 'test-results') {
      // Allow traversal for JUnit XML discovery but don't yield modules
    } else {
      return; // Stop deeper traversal
    }
    return;
  }

  for (const d of pruned) {
    yield* walkWithPruning(path.join(dir, d), root, [...relParts, d]);
  }
}

function detectCurrentFailures(failuresDir, deltaPrefix = 'delta-', deltaSuffix = '') {
  const deltaFiles = [];
  const noDeltaConvention = !deltaPrefix && !deltaSuffix;

  function scanDir(dir) {
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.isDirectory() && noDeltaConvention) {
        scanDir(path.join(dir, entry.name)); // recurse for nested packages
        continue;
      }
      if (!entry.isFile() || !entry.name.endsWith('.png')) continue;
      let isCandidate = noDeltaConvention;
      if (deltaPrefix && entry.name.startsWith(deltaPrefix)) isCandidate = true;
      if (deltaSuffix) {
        const stem = entry.name.slice(0, -4);
        if (stem.endsWith(deltaSuffix)) isCandidate = true;
      }
      if (isCandidate) {
        const fullPath = path.join(dir, entry.name);
        const mtime = fs.statSync(fullPath).mtimeMs / 1000;
        deltaFiles.push([fullPath, mtime]);
      }
    }
  }
  scanDir(failuresDir);

  if (!deltaFiles.length) return [];

  deltaFiles.sort((a, b) => b[1] - a[1]);
  const latestMtime = deltaFiles[0][1];
  const current = [];
  for (const [f, mtime] of deltaFiles) {
    if (latestMtime - mtime <= MTIME_CLUSTER_TOLERANCE) {
      current.push(f);
    } else {
      break;
    }
  }
  return current;
}

// --- Compare mode (Compose Screenshot Testing) ---

function countPngsRecursive(dir) {
  let count = 0;
  try {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        count += countPngsRecursive(path.join(dir, entry.name));
      } else if (entry.name.endsWith('.png')) {
        count++;
      }
    }
  } catch {}
  return count;
}

module.exports = {
  scanProject,
  scanProjectIncrementalSync,
  processSingleModule,
  discoverPaparazziModules,
  deltaToBase,
  resolveGolden,
  detectCurrentFailures,
};

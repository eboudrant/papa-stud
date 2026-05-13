/**
 * Scan a project for screenshot test failures.
 *
 * Module discovery and watch dirs are delegated to the strategy (e.g., gradle).
 * Detects current vs stale failures using mtime clustering,
 * matches golden images, and (for strategies that support JUnit) parses XML.
 */

const fs = require('fs');
const path = require('path');
const fg = require('fast-glob');
const { parseFilename } = require('./filenameParser');
const { parseJunitXml, parseDiffPercentages } = require('./junitParser');

const DEBUG = process.env.PAPASTUD_DEBUG === '1';
const log = (...args) => { if (DEBUG) console.log(...args); };

const MTIME_CLUSTER_TOLERANCE = 60.0;

const { getStrategy } = require('./strategies');

function scanProject(projectPath, strategyName, opts = {}) {
  const result = { modules: [], failures: [] };
  for (const [phase, data] of scanProjectIncrementalSync(projectPath, null, null, strategyName, opts)) {
    if (phase === 'complete') return data;
  }
  return result;
}

function* scanProjectIncrementalSync(projectPath, cancelFn, profiles, strategyName, opts = {}) {
  const root = projectPath;
  const strategy = getStrategy(strategyName);

  // Strategy-driven path: one global parse (e.g. xcresult) returns failures
  // pre-bucketed by module, plus the module list — so we skip a second
  // discoverModules walk.
  let precomputed = null;
  if (typeof strategy.parseProjectFailures === 'function' && opts.cacheDir) {
    yield ['parsing', { source: 'strategy' }];
    precomputed = strategy.parseProjectFailures(root, opts.project || null, opts.cacheDir);
  }

  const moduleIter = precomputed && precomputed.modules
    ? precomputed.modules
    : strategy.discoverModules(root);

  const discovered = [];
  for (const moduleInfo of moduleIter) {
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
    const [moduleData, moduleFailures] = precomputed
      ? processModuleFromPrecomputed(moduleName, modulePath, profiles, precomputed, failuresDir)
      : processSingleModule(failuresDir, moduleName, modulePath, profiles, strategyName);
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

function processModuleFromPrecomputed(moduleName, modulePath, profiles, precomputed, failuresDir) {
  const moduleFailures = precomputed.byModule.get(moduleName) || [];
  const profileCounts = {};
  for (const f of moduleFailures) {
    profileCounts[f.profile] = (profileCounts[f.profile] || 0) + 1;
  }

  let totalSnapshots = 0;
  let goldenPath = modulePath;
  if (profiles && profiles.length) {
    for (const p of profiles) {
      for (const d of effectiveGoldenDirs(modulePath, p.golden_dir)) {
        totalSnapshots += countPngsRecursive(d);
      }
    }
    const primary = effectiveGoldenDirs(modulePath, profiles[0].golden_dir)[0];
    if (primary) goldenPath = primary;
  }

  const moduleData = {
    name: moduleName,
    failures_path: failuresDir || null,
    golden_path: goldenPath,
    failure_count: moduleFailures.length,
    snapshot_count: totalSnapshots,
    profile_counts: profileCounts,
    test_stats: precomputed.stats,
  };
  return [moduleData, moduleFailures];
}

// Return the on-disk golden directories worth inspecting for a module. The
// legacy AGP <9 `src/test/snapshots/*` path and its AGP-9 sibling
// `src/androidHostTest/snapshots/*` are both considered, in whichever order
// places the existing one first (so callers using only the first entry get
// a useful report). When neither exists, fall back to whatever the profile
// said.
function effectiveGoldenDirs(modulePath, goldenDir) {
  if (!goldenDir) return [];
  const primary = path.join(modulePath, goldenDir);
  const agp9 = goldenDir.includes('src/test/snapshots/')
    ? path.join(modulePath, goldenDir.replace('src/test/snapshots/', 'src/androidHostTest/snapshots/'))
    : null;
  const existing = [primary, agp9].filter(d => d && safeIsDir(d));
  if (existing.length) return existing;
  return [primary];
}

function safeIsDir(p) {
  try { return fs.statSync(p).isDirectory(); } catch { return false; }
}

function processSingleModule(failuresDir, moduleName, modulePath, profiles, strategyName) {
  const strategy = getStrategy(strategyName);
  const useJunit = strategy.usesJunit !== false;
  const [testStats, xmlMtime] = useJunit ? parseJunitXml(modulePath) : [null, 0];
  const diffPcts = useJunit ? parseDiffPercentages(modulePath) : {};
  const moduleFailures = [];
  const profileCounts = {};
  let totalSnapshots = 0;

  if (profiles && profiles.length) {
    for (const profile of profiles) {
      const pname = profile.name;
      const fDir = path.join(modulePath, profile.failures_dir);
      const gp = buildGoldenPatterns(profile);
      const pf = processProfile(
        fDir, modulePath, moduleName, pname,
        testStats, xmlMtime, gp, diffPcts,
        profile.delta_prefix !== undefined ? profile.delta_prefix : 'delta-',
        profile.delta_suffix || '',
        profile.actual_suffix || '',
      );
      moduleFailures.push(...pf);
      profileCounts[pname] = pf.length;
      for (const d of effectiveGoldenDirs(modulePath, profile.golden_dir)) {
        totalSnapshots += countPngsRecursive(d);
      }
    }
  } else {
    const defaultGp = withAgp9Fallback(['src/test/snapshots/images/{name}.png']);
    const pf = processProfile(
      failuresDir, modulePath, moduleName, 'baseline',
      testStats, xmlMtime, defaultGp, diffPcts,
    );
    moduleFailures.push(...pf);
    profileCounts.baseline = pf.length;
    for (const d of effectiveGoldenDirs(modulePath, 'src/test/snapshots/images')) {
      totalSnapshots += countPngsRecursive(d);
    }
  }

  const reportedGolden = profiles && profiles.length
    ? (effectiveGoldenDirs(modulePath, profiles[0].golden_dir)[0]
       || path.join(modulePath, profiles[0].golden_dir || 'src/test/snapshots/images'))
    : effectiveGoldenDirs(modulePath, 'src/test/snapshots/images')[0];

  const moduleData = {
    name: moduleName,
    failures_path: failuresDir || null,
    golden_path: reportedGolden,
    failure_count: moduleFailures.length,
    snapshot_count: totalSnapshots,
    profile_counts: profileCounts,
    test_stats: testStats,
  };
  return [moduleData, moduleFailures];
}

function buildGoldenPatterns(profile) {
  const raw = profile.golden_patterns
    ? [...profile.golden_patterns]
    : (() => {
        const gDir = profile.golden_dir || '';
        const suffix = profile.golden_suffix || '';
        const p = [];
        if (suffix) p.push(`${gDir}/{name}${suffix}.png`);
        p.push(`${gDir}/{name}.png`);
        return p;
      })();
  return withAgp9Fallback(raw);
}

// Paparazzi moved the goldens from `src/test/snapshots/...` (legacy AGP <9)
// to `src/androidHostTest/snapshots/...` (AGP 9 / KMP). Profiles that still
// hold the legacy pattern would resolve to null on a migrated module — add
// the AGP-9 sibling so both layouts work without forcing every project to
// rewrite its persisted profile.
function withAgp9Fallback(patterns) {
  const out = [];
  const seen = new Set();
  for (const p of patterns) {
    if (!seen.has(p)) { out.push(p); seen.add(p); }
    if (p.includes('src/test/snapshots/')) {
      const agp9 = p.replace('src/test/snapshots/', 'src/androidHostTest/snapshots/');
      if (!seen.has(agp9)) { out.push(agp9); seen.add(agp9); }
    }
  }
  return out;
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
      try { if (fs.statSync(candidate).isFile()) return candidate; } catch {}
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
  if (!failuresDir) return results;
  try { if (!fs.statSync(failuresDir).isDirectory()) return results; } catch { return results; }

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

  const goldenCache = new Map();
  for (const f of current) {
    const base = deltaToBase(path.basename(f), deltaPrefix, deltaSuffix);
    // Key by full path so subdirs with same basename don't collide in compare mode
    goldenCache.set(f, resolveGolden(modulePath, goldenPatterns, base));
  }

  const noDeltaConvention = !deltaPrefix && !deltaSuffix;

  for (const candidatePath of current) {
    const base = deltaToBase(path.basename(candidatePath), deltaPrefix, deltaSuffix);
    const parsed = parseFilename(base);
    const goldenPath = goldenCache.get(candidatePath);

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
  processModuleFromPrecomputed,
  deltaToBase,
  resolveGolden,
  buildGoldenPatterns,
  withAgp9Fallback,
  effectiveGoldenDirs,
  detectCurrentFailures,
};

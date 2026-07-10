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
const { agp9Sibling } = require('./paparazziPaths');

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
    let primaryDirs = null;
    for (const p of profiles) {
      const dirs = effectiveGoldenDirs(modulePath, p.golden_dir);
      if (primaryDirs === null) primaryDirs = dirs;
      for (const d of dirs) totalSnapshots += countPngsRecursive(d);
    }
    if (primaryDirs && primaryDirs[0]) goldenPath = primaryDirs[0];
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

// On-disk golden directories worth inspecting for a module. Returns the
// configured directory plus its AGP-9 sibling when both exist, only the
// existing one when one exists, or `[configured]` as a fallback for
// empty/missing modules so callers using the first entry always get a
// reportable path.
function effectiveGoldenDirs(modulePath, goldenDir) {
  if (!goldenDir) return [];
  const primary = path.join(modulePath, goldenDir);
  const sibling = agp9Sibling(goldenDir);
  const agp9 = sibling ? path.join(modulePath, sibling) : null;
  const existing = [primary, agp9].filter(d => d && safeIsDir(d));
  return existing.length ? existing : [primary];
}

function safeIsDir(p) {
  try { return fs.statSync(p).isDirectory(); } catch { return false; }
}

// Sum the PNG counts across every effective golden dir for the module.
function totalGoldenPngs(modulePath, goldenDir) {
  return effectiveGoldenDirs(modulePath, goldenDir)
    .reduce((n, d) => n + countPngsRecursive(d), 0);
}

function processSingleModule(failuresDir, moduleName, modulePath, profiles, strategyName) {
  const strategy = getStrategy(strategyName);
  const useJunit = strategy.usesJunit !== false;
  const [testStats, xmlMtime] = useJunit ? parseJunitXml(modulePath) : [null, 0];
  const diffPcts = useJunit ? parseDiffPercentages(modulePath) : {};
  const moduleFailures = [];
  const profileCounts = {};
  let totalSnapshots = 0;
  let primaryGoldenDir = null;

  const hasProfiles = profiles && profiles.length;
  const goldenDirForReport = hasProfiles
    ? profiles[0].golden_dir
    : 'src/test/snapshots/images';

  if (hasProfiles) {
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
      const dirs = effectiveGoldenDirs(modulePath, profile.golden_dir);
      if (primaryGoldenDir === null) primaryGoldenDir = dirs[0] || null;
      for (const d of dirs) totalSnapshots += countPngsRecursive(d);
    }
  } else {
    const defaultGp = withAgp9Fallback(['src/test/snapshots/images/{name}.png']);
    const pf = processProfile(
      failuresDir, modulePath, moduleName, 'baseline',
      testStats, xmlMtime, defaultGp, diffPcts,
    );
    moduleFailures.push(...pf);
    profileCounts.baseline = pf.length;
    const dirs = effectiveGoldenDirs(modulePath, goldenDirForReport);
    primaryGoldenDir = dirs[0] || null;
    for (const d of dirs) totalSnapshots += countPngsRecursive(d);
  }

  const reportedGolden = primaryGoldenDir
    || path.join(modulePath, goldenDirForReport || 'src/test/snapshots/images');

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
  if (profile.golden_patterns) return withAgp9Fallback([...profile.golden_patterns]);
  const gDir = profile.golden_dir || '';
  const suffix = profile.golden_suffix || '';
  const raw = [];
  if (suffix) raw.push(`${gDir}/{name}${suffix}.png`);
  raw.push(`${gDir}/{name}.png`);
  return withAgp9Fallback(raw);
}

// Pair every legacy Paparazzi pattern with its AGP-9 sibling so a profile
// persisted with only the old `src/test/snapshots/` path still resolves
// against a migrated module.
function withAgp9Fallback(patterns) {
  const out = [];
  const seen = new Set();
  for (const p of patterns) {
    if (!seen.has(p)) { out.push(p); seen.add(p); }
    const sibling = agp9Sibling(p);
    if (sibling && !seen.has(sibling)) { out.push(sibling); seen.add(sibling); }
  }
  return out;
}

// Candidate golden basenames to try, in preference order. Some tools (notably
// Roborazzi) URL-encode spaces in the emitted compare/delta filename while
// recording the golden with a literal space — e.g. delta
// `complete%20pause ad layout.….png` vs golden `complete pause ad layout.….png`.
// We try the name verbatim first, then variants that toggle `%20`↔space and a
// safely percent-decoded form, so the pair still matches either direction.
function goldenNameCandidates(name) {
  const out = [name];
  const add = (n) => { if (n && !out.includes(n)) out.push(n); };
  add(name.replace(/%20/gi, ' ')); // encoded space -> literal
  add(name.replace(/ /g, '%20'));  // literal space -> encoded
  try { add(decodeURIComponent(name)); } catch { /* malformed % — skip */ }
  return out;
}

function resolveGolden(modulePath, goldenPatterns, snapshotName) {
  const raw = snapshotName.endsWith('.png') ? snapshotName.slice(0, -4) : snapshotName;
  const names = goldenNameCandidates(raw);
  for (const pattern of goldenPatterns) {
    for (const name of names) {
      const resolved = pattern.replace('{name}', name);
      if (resolved.includes('**')) {
        const matches = fg.sync(resolved, { cwd: modulePath, absolute: true });
        if (matches.length) return matches[0];
      } else {
        const candidate = path.join(modulePath, resolved);
        try { if (fs.statSync(candidate).isFile()) return candidate; } catch {}
      }
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
  if (!failuresDir || !safeIsDir(failuresDir)) return results;

  let current = detectCurrentFailures(failuresDir, deltaPrefix, deltaSuffix);
  log(`[scan] ${profileName} in ${failuresDir}: ${current.length} candidates, xmlMtime=${xmlMtime}, testStats.failed=${testStats?.failed}`);
  // If JUnit XML reports 0 failures, all deltas are stale leftovers
  if (testStats && testStats.failed === 0 && xmlMtime > 0) {
    if (current.length) log(`[scan] all tests pass — filtering all ${current.length} stale deltas`);
    current = [];
  } else if (xmlMtime > 0 && current.length) {
    // Filter out delta files older than the latest JUnit XML run
    const before = current.length;
    current = current.filter(c => c.mtime > xmlMtime - MTIME_CLUSTER_TOLERANCE);
    if (current.length < before) log(`[scan] filtered ${before - current.length} stale deltas (older than xmlMtime ${xmlMtime})`);
  }

  const goldenCache = new Map();
  for (const c of current) {
    const base = deltaToBase(path.basename(c.path), deltaPrefix, deltaSuffix);
    // Key by full path so subdirs with same basename don't collide in compare mode
    goldenCache.set(c.path, resolveGolden(modulePath, goldenPatterns, base));
  }

  const noDeltaConvention = !deltaPrefix && !deltaSuffix;

  for (const c of current) {
    const candidatePath = c.path;
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
      // Delta mode: separate delta file, actual may have a suffix.
      // Look for the actual alongside the delta — AGP 9 / KMP puts both in
      // `failures/androidMain/`, legacy puts both at the root of `failures/`.
      deltaFilePath = candidatePath;
      let actualName;
      if (actualSuffix) {
        const stem = base.endsWith('.png') ? base.slice(0, -4) : base;
        actualName = `${stem}${actualSuffix}.png`;
      } else {
        actualName = base;
      }
      actualPath = path.join(path.dirname(candidatePath), actualName);
      try { if (!fs.statSync(actualPath).isFile()) actualPath = null; }
      catch { actualPath = null; }
    }

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
      mtime: c.mtime,
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

  // Recurse into subdirs always: Paparazzi on AGP 9 / KMP writes failures under
  // `failures/androidMain/`, while the legacy layout puts them at the top of
  // `failures/`. A project can hold both side by side; mtime clustering then
  // picks the newest run.
  function scanDir(dir) {
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.isDirectory()) {
        scanDir(path.join(dir, entry.name));
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
      current.push({ path: f, mtime });
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

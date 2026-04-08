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
const { XMLParser } = require('fast-xml-parser');
const { parseFilename } = require('./filenameParser');

const xmlParser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_' });

const MTIME_CLUSTER_TOLERANCE = 60.0;

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
  const [testStats, xmlMtime] = parseJunitXml(modulePath);
  const diffPcts = parseDiffPercentages(modulePath);
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
      const gDirStr = profile.golden_dir || '';
      if (gDirStr) {
        const gDir = path.join(modulePath, gDirStr);
        if (fs.existsSync(gDir) && fs.statSync(gDir).isDirectory()) {
          totalSnapshots += fs.readdirSync(gDir).filter(f => f.endsWith('.png')).length;
        }
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
    if (fs.existsSync(goldenDir) && fs.statSync(goldenDir).isDirectory()) {
      totalSnapshots = fs.readdirSync(goldenDir).filter(f => f.endsWith('.png')).length;
    }
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
  if (xmlMtime > 0 && current.length && testStats && testStats.failed === 0) {
    current = current.filter(f => fs.statSync(f).mtimeMs / 1000 > xmlMtime);
  }

  const goldenCache = {};
  for (const f of current) {
    const base = deltaToBase(path.basename(f), deltaPrefix, deltaSuffix);
    goldenCache[path.basename(f)] = resolveGolden(modulePath, goldenPatterns, base);
  }

  for (const deltaPath of current) {
    const base = deltaToBase(path.basename(deltaPath), deltaPrefix, deltaSuffix);
    const parsed = parseFilename(base);
    let actualName;
    if (actualSuffix) {
      const stem = base.endsWith('.png') ? base.slice(0, -4) : base;
      actualName = `${stem}${actualSuffix}.png`;
    } else {
      actualName = base;
    }
    const actualPath = path.join(failuresDir, actualName);
    const goldenPath = goldenCache[path.basename(deltaPath)];
    const actualExists = fs.existsSync(actualPath) && fs.statSync(actualPath).isFile();
    const stat = fs.statSync(deltaPath);

    results.push({
      module: moduleName,
      profile: profileName,
      filename: base,
      delta_path: deltaPath,
      actual_path: actualExists ? actualPath : null,
      golden_path: goldenPath || null,
      package: parsed.package,
      class_name: parsed.class_name,
      method: parsed.method,
      snapshot_name: parsed.snapshot_name,
      status: 'pending',
      diff_pct: (diffPcts || {})[base] || null,
      has_golden: goldenPath !== null,
      has_actual: actualExists,
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
      const allowed = new Set(['paparazzi', 'test-results', 'outputs']);
      for (const d of pruned.filter(d => allowed.has(d))) {
        yield* walkWithPruning(path.join(dir, d), root, [...relParts, d]);
      }
    } else if (depth === 2 && relParts[relParts.length - 1] === 'outputs') {
      for (const d of pruned.filter(d => d === 'roborazzi')) {
        yield* walkWithPruning(path.join(dir, d), root, [...relParts, d]);
      }
    } else if (depth === 3 && relParts.slice(-2).join('/') === 'outputs/roborazzi') {
      const moduleParts = relParts.slice(0, idx);
      const moduleName = moduleParts.length ? ':' + moduleParts.join(':') : ':root';
      const modulePath = moduleParts.length ? path.join(root, ...moduleParts) : root;
      yield [dir, moduleName, modulePath];
    } else if (depth === 2 && relParts[relParts.length - 1] === 'paparazzi') {
      const moduleParts = relParts.slice(0, idx);
      const moduleName = moduleParts.length ? ':' + moduleParts.join(':') : ':root';
      const modulePath = moduleParts.length ? path.join(root, ...moduleParts) : root;
      const failuresDir = path.join(dir, 'failures');
      const fDirExists = fs.existsSync(failuresDir) && fs.statSync(failuresDir).isDirectory();
      yield [fDirExists ? failuresDir : null, moduleName, modulePath];
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
  let entries;
  try {
    entries = fs.readdirSync(failuresDir, { withFileTypes: true });
  } catch {
    return [];
  }

  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.png')) continue;
    let isDelta = false;
    if (deltaPrefix && entry.name.startsWith(deltaPrefix)) isDelta = true;
    if (deltaSuffix) {
      const stem = entry.name.slice(0, -4);
      if (stem.endsWith(deltaSuffix)) isDelta = true;
    }
    if (isDelta) {
      const fullPath = path.join(failuresDir, entry.name);
      const mtime = fs.statSync(fullPath).mtimeMs / 1000;
      deltaFiles.push([fullPath, mtime]);
    }
  }

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

function parseDiffPercentages(modulePath) {
  const result = {};
  for (const variant of ['testDebugUnitTest', 'testReleaseUnitTest']) {
    const resultsDir = path.join(modulePath, 'build', 'test-results', variant);
    if (!fs.existsSync(resultsDir)) continue;
    const xmlFiles = fs.readdirSync(resultsDir).filter(f => f.startsWith('TEST-') && f.endsWith('.xml'));
    for (const xmlFile of xmlFiles) {
      try {
        const content = fs.readFileSync(path.join(resultsDir, xmlFile), 'utf8');
        const parser = xmlParser;
        const parsed = parser.parse(content);
        const suite = parsed.testsuite;
        if (!suite) continue;
        const testcases = Array.isArray(suite.testcase) ? suite.testcase : (suite.testcase ? [suite.testcase] : []);
        for (const tc of testcases) {
          const failure = tc.failure;
          if (!failure) continue;
          const msg = typeof failure === 'string' ? failure : (failure['@_message'] || '');
          const pctMatch = msg.match(/differ \(by ([\d.]+)%\)/);
          const deltaMatch = msg.match(/delta-([^\s]+\.png)/);
          if (pctMatch && deltaMatch) {
            const fname = deltaMatch[1].split('/').pop();
            result[fname] = parseFloat(pctMatch[1]);
          }
        }
      } catch {
        // Skip unparseable XML
      }
    }
  }
  return result;
}

function parseJunitXml(modulePath) {
  const stats = { tests: 0, passed: 0, failed: 0, skipped: 0, errors: 0, time: 0 };
  let found = false;
  let newestMtime = 0;

  for (const variant of ['testDebugUnitTest', 'testReleaseUnitTest']) {
    const resultsDir = path.join(modulePath, 'build', 'test-results', variant);
    if (!fs.existsSync(resultsDir)) continue;
    const xmlFiles = fs.readdirSync(resultsDir).filter(f => f.startsWith('TEST-') && f.endsWith('.xml'));
    for (const xmlFile of xmlFiles) {
      const fullPath = path.join(resultsDir, xmlFile);
      const parsed = parseSingleJunitXml(fullPath);
      if (parsed) {
        found = true;
        stats.tests += parsed.tests;
        stats.failed += parsed.failed;
        stats.skipped += parsed.skipped;
        stats.errors += parsed.errors;
        stats.time += parsed.time;
        const mtime = fs.statSync(fullPath).mtimeMs / 1000;
        if (mtime > newestMtime) newestMtime = mtime;
      }
    }
  }

  if (!found) return [null, 0];
  stats.passed = stats.tests - stats.failed - stats.skipped - stats.errors;
  stats.time = Math.round(stats.time * 100) / 100;
  return [stats, newestMtime];
}

function parseSingleJunitXml(xmlPath) {
  try {
    const content = fs.readFileSync(xmlPath, 'utf8');
    const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_' });
    const parsed = parser.parse(content);
    const root = parsed.testsuite;
    if (!root) return null;
    return {
      tests: parseInt(root['@_tests'] || '0'),
      failed: parseInt(root['@_failures'] || '0'),
      skipped: parseInt(root['@_skipped'] || '0'),
      errors: parseInt(root['@_errors'] || '0'),
      time: parseFloat(root['@_time'] || '0'),
    };
  } catch {
    return null;
  }
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

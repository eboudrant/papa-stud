/**
 * Gradle project strategy for Paparazzi, Roborazzi, and Compose Screenshot Testing.
 * Handles module discovery, watch directory resolution, and module path mapping.
 */

const fs = require('fs');
const path = require('path');

const BUILD_ALLOWED = new Set(['paparazzi', 'test-results', 'outputs']);
const OUTPUT_ALLOWED = new Set(['roborazzi', 'screenshotTest-results']);
const PRUNE_DIRS = new Set([
  '.git', '.gradle', '.idea', 'node_modules', '.cxx', '.transforms', 'src', '.kotlin',
]);

function deriveModule(relParts, buildIdx, root) {
  const moduleParts = relParts.slice(0, buildIdx);
  const moduleName = moduleParts.length ? ':' + moduleParts.join(':') : ':root';
  const modulePath = moduleParts.length ? path.join(root, ...moduleParts) : root;
  return [moduleName, modulePath];
}

/**
 * Discover Gradle modules that have screenshot test build artifacts.
 * Yields [failuresDir, moduleName, modulePath] for each module found.
 */
function* discoverModules(root) {
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
      return;
    }
    return;
  }

  for (const d of pruned) {
    yield* walkWithPruning(path.join(dir, d), root, [...relParts, d]);
  }
}

/**
 * Get directories to watch for file changes in a Gradle module.
 */
function getWatchDirs(modulePath, profiles) {
  const dirs = new Set();
  dirs.add(path.join(modulePath, 'build', 'paparazzi'));
  dirs.add(path.join(modulePath, 'build', 'test-results'));
  if (profiles) {
    for (const p of profiles) {
      dirs.add(path.join(modulePath, p.failures_dir));
      if (p.golden_dir) {
        dirs.add(path.join(modulePath, p.golden_dir));
        // Watch the AGP-9 sibling too — same module can hold either layout.
        if (p.golden_dir.includes('src/test/snapshots/')) {
          dirs.add(path.join(modulePath, p.golden_dir.replace('src/test/snapshots/', 'src/androidHostTest/snapshots/')));
        }
      }
    }
  } else {
    dirs.add(path.join(modulePath, 'src', 'test', 'snapshots', 'images'));
    dirs.add(path.join(modulePath, 'src', 'androidHostTest', 'snapshots', 'images'));
  }
  return dirs;
}

/**
 * Resolve a Gradle module name (e.g., ":libraries:ui:login") to a filesystem path.
 */
function resolveModulePath(moduleName, projectRoot) {
  const parts = moduleName.replace(/^:/, '').split(':');
  return parts[0] !== 'root' ? path.join(projectRoot, ...parts) : projectRoot;
}

const usesJunit = true;

module.exports = { discoverModules, getWatchDirs, resolveModulePath, usesJunit };

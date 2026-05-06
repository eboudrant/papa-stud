/**
 * Wraps `xcrun xcresulttool` (Xcode 16+ API) to extract failed snapshot tests
 * and their attachments from an `.xcresult` bundle.
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { readJson } = require('./jsonStore');

const DEBUG = process.env.PAPASTUD_DEBUG === '1';
const log = (...args) => { if (DEBUG) console.log('[xcresult]', ...args); };

// Directories that never contain `.xcresult` bundles or `__Snapshots__` and
// blow up the walk on monorepos. Note: `DerivedData` is intentionally NOT
// pruned here because Xcode places `.xcresult` bundles under it.
const BASE_PRUNE = new Set(['.git', 'node_modules', '.build', '.swiftpm', 'Pods', '.checkout']);

function runXcrun(args) {
  const r = spawnSync('xcrun', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (r.status !== 0) {
    const tail = (r.stderr || '').slice(-500);
    throw new Error(`xcrun ${args.join(' ')} failed (status ${r.status}): ${tail}`);
  }
  return r.stdout;
}

function walkTestNodes(testNodes) {
  const stats = { passed: 0, failed: 0, skipped: 0, expectedFailure: 0 };
  const failures = [];

  function visit(node) {
    if (!node) return;
    if (node.nodeType === 'Test Case') {
      switch (node.result) {
        case 'Passed': stats.passed++; break;
        case 'Failed': stats.failed++; break;
        case 'Skipped': stats.skipped++; break;
        case 'Expected Failure': stats.expectedFailure++; break;
        default: break;
      }
      if (node.result === 'Failed') {
        failures.push({
          testIdentifier: node.nodeIdentifier,
          testIdentifierURL: node.nodeIdentifierURL || null,
          name: node.name,
        });
      }
    }
    if (Array.isArray(node.children)) {
      for (const c of node.children) visit(c);
    }
  }

  for (const root of testNodes || []) visit(root);
  return { stats, failures };
}

// swift-snapshot-testing wraps each assertion in an XCTContext activity with
// three image attachments (reference, failure, difference). Xcode flattens
// them as `<role>_<positional-index>_<activity-uuid>.png` — the UUID groups
// the triplet, and multiple failed assertions in one test method get
// distinct UUIDs. The text "Complete Issue Description.txt" carries the
// SnapshotTesting error message, which we mine for the on-disk golden path.
function classifyAttachment(humanName) {
  const noExt = (humanName || '').replace(/\.[^.]+$/, '');
  const m = /^(reference|failure|difference)_\d+_(.+)$/.exec(noExt);
  if (m) return { role: m[1].toLowerCase(), groupKey: m[2] };
  if ((humanName || '').startsWith('Complete Issue Description')) {
    return { role: 'description', groupKey: null };
  }
  return { role: 'other', groupKey: null };
}

// SnapshotTesting writes failure messages like:
//   @−
//   "file:///path/to/golden.png"
//   @+
//   "file:///path/to/actual.png"
// The minus is U+2212, but we accept ASCII '-' too for tooling robustness.
function extractGoldenPathFromDescription(content) {
  const m = /@[−-]\s*\n\s*"file:\/\/([^"]+)"/.exec(content || '');
  return m ? m[1] : null;
}

// xcresulttool exports attachments as bare UUIDs; rename so /api/images sees
// a file extension. Idempotent: a second pass finds the renamed file and the
// rename throws ENOENT, which we ignore.
function ensureExtension(originalPath, humanName) {
  const ext = path.extname(humanName || '');
  if (!ext || originalPath.endsWith(ext)) return originalPath;
  const renamed = originalPath + ext;
  try { fs.renameSync(originalPath, renamed); } catch {}
  return renamed;
}

function groupManifestByTest(manifest, attachmentsDir) {
  const byTest = new Map();
  for (const entry of manifest || []) {
    const items = (entry.attachments || []).map(a => {
      const cls = classifyAttachment(a.suggestedHumanReadableName);
      const raw = path.join(attachmentsDir, a.exportedFileName);
      const item = {
        exportedFile: ensureExtension(raw, a.suggestedHumanReadableName),
        role: cls.role,
        groupKey: cls.groupKey,
        timestamp: a.timestamp || 0,
      };
      if (cls.role === 'description') {
        try {
          item.goldenPath = extractGoldenPathFromDescription(fs.readFileSync(item.exportedFile, 'utf8'));
        } catch { item.goldenPath = null; }
      }
      return item;
    });
    byTest.set(entry.testIdentifier, items);
  }
  return byTest;
}

function pairAttachmentsForTest(items) {
  const byGroup = new Map();
  const descriptionPaths = [];
  for (const it of items) {
    if (it.role === 'description') {
      descriptionPaths.push(it.goldenPath || null);
      continue;
    }
    if (it.role === 'other') continue;
    if (!byGroup.has(it.groupKey)) byGroup.set(it.groupKey, {});
    byGroup.get(it.groupKey)[it.role] = it;
  }
  const paired = [];
  for (const triple of byGroup.values()) {
    if (!triple.failure) continue;
    paired.push({
      actualPath: triple.failure.exportedFile,
      differencePath: triple.difference?.exportedFile || null,
      timestamp: triple.failure.timestamp,
    });
  }
  // XCTest emits image triplets in REVERSE test-execution order, while the
  // SnapshotTesting descriptions are in forward order — reverse-zip them
  // so each triplet picks up its canonical on-disk golden path.
  if (descriptionPaths.length === paired.length) {
    for (let i = 0; i < paired.length; i++) {
      paired[i].goldenPath = descriptionPaths[paired.length - 1 - i];
    }
  }
  return paired;
}

function parseXcresult(xcresultPath, cacheDir) {
  log('parsing', xcresultPath, '→', cacheDir);

  const testsJson = runXcrun(['xcresulttool', 'get', 'test-results', 'tests', '--path', xcresultPath, '--compact']);
  const tests = JSON.parse(testsJson);
  const { stats, failures: failedNodes } = walkTestNodes(tests.testNodes);
  log('test stats:', stats, 'failures:', failedNodes.length);

  const mtime = fs.statSync(xcresultPath).mtimeMs / 1000;
  if (failedNodes.length === 0) {
    return { stats, failures: [], mtime };
  }

  // `--only-failures` is too aggressive: Xcode tags swift-snapshot-testing's
  // image attachments as `isAssociatedWithFailure: false` (only the issue
  // description text is true), so the flag would strip the reference / failure
  // / difference PNGs. Export everything; we filter to failed tests below.
  runXcrun([
    'xcresulttool', 'export', 'attachments',
    '--path', xcresultPath,
    '--output-path', cacheDir,
  ]);

  // Manifest may be missing if the run had failed tests but no attachments.
  const manifest = readJson(path.join(cacheDir, 'manifest.json')) || [];
  const attachmentsByTest = groupManifestByTest(manifest, cacheDir);

  const failures = failedNodes.map(node => ({
    testIdentifier: node.testIdentifier,
    testIdentifierURL: node.testIdentifierURL,
    name: node.name,
    paired: pairAttachmentsForTest(attachmentsByTest.get(node.testIdentifier) || []),
  }));

  return { stats, failures, mtime };
}

// projectRoots walked recursively; shallowRoots inspected only at depth 1
// (default `/tmp` covers headless test scripts that drop bundles there).
// Bundles older than `maxAgeMs` (default 24h) are dropped. Sorted newest first.
const DEFAULT_SHALLOW_ROOTS = ['/tmp'];
const DEFAULT_MAX_AGE_MS = 24 * 60 * 60 * 1000;

function findRecentXcresults({
  projectRoots = [],
  shallowRoots = DEFAULT_SHALLOW_ROOTS,
  maxAgeMs = DEFAULT_MAX_AGE_MS,
} = {}) {
  const cutoff = Date.now() - maxAgeMs;
  const found = new Map();
  function scan(dir, depth) {
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (!e.isDirectory()) continue;
      if (BASE_PRUNE.has(e.name)) continue;
      const full = path.join(dir, e.name);
      if (e.name.endsWith('.xcresult')) {
        if (found.has(full)) continue;
        try {
          const m = fs.statSync(full).mtimeMs;
          if (m >= cutoff) found.set(full, m);
        } catch {}
        continue;
      }
      if (depth > 0) scan(full, depth - 1);
    }
  }
  for (const r of projectRoots) scan(r, Infinity);
  for (const r of shallowRoots) scan(r, 0);
  return [...found.entries()].sort((a, b) => b[1] - a[1]).map(([p]) => p);
}

module.exports = {
  BASE_PRUNE,
  parseXcresult,
  findRecentXcresults,
  walkTestNodes,
  classifyAttachment,
  ensureExtension,
  groupManifestByTest,
  pairAttachmentsForTest,
  extractGoldenPathFromDescription,
};

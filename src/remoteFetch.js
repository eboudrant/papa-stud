/**
 * Download a CI screenshot-test result tarball and overlay its build outputs
 * onto a local project directory.
 *
 * CI (e.g. Jenkins) publishes the workspace build outputs as a tarball whose
 * entries are repo-relative (`<module>/build/paparazzi/failures/delta-*.png`,
 * `<module>/build/test-results/**`). We download it, keep only entries that
 * live under a `build/` directory, and extract those into the user's existing
 * project dir. The local working copy supplies the goldens; the tarball
 * supplies the failure deltas + JUnit. We never extract anything outside a
 * `build/` segment, so source and goldens are never clobbered.
 *
 * No new npm deps: we shell out to the system `tar` (present on macOS, Linux,
 * and Windows 10+). `tar -tf`/`-xf` auto-detect gzip, so plain `.tar` and
 * `.tar.gz` both work.
 */

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');
const { Readable } = require('stream');
const { pipeline } = require('stream/promises');

// Stream a remote tarball to a temp file. Returns the temp file path.
// Throws on a non-http(s) URL or a non-2xx response.
async function downloadToTemp(url) {
  let parsed;
  try { parsed = new URL(url); } catch { throw new Error('invalid URL'); }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('only http(s) URLs are supported');
  }

  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok) throw new Error(`download failed: HTTP ${res.status}`);
  if (!res.body) throw new Error('download failed: empty response body');

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'papastud-fetch-'));
  const tarFile = path.join(dir, 'result.tar');
  await pipeline(Readable.fromWeb(res.body), fs.createWriteStream(tarFile));
  return tarFile;
}

// An entry is unsafe if it is absolute or escapes the extraction root.
function isUnsafeMember(name) {
  if (!name) return true;
  if (path.isAbsolute(name)) return true;
  // Normalize with POSIX semantics (tar entries use forward slashes) and reject
  // any `..` traversal.
  const normalized = path.posix.normalize(name);
  return normalized.startsWith('../') || normalized === '..' || normalized.includes('/../');
}

// True when the entry lives under a `build/` directory segment.
function isBuildMember(name) {
  return /(^|\/)build\//.test(name);
}

// List archive members that live under a `build/` dir and are safe to extract.
// Throws if `tar -tf` fails or if any candidate member is a path-traversal.
function listBuildMembers(tarFile) {
  const r = spawnSync('tar', ['-tf', tarFile], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (r.status !== 0) {
    throw new Error(`could not read archive: ${(r.stderr || '').slice(-300) || 'tar -tf failed'}`);
  }
  const all = r.stdout.split('\n').map(s => s.trim()).filter(Boolean);
  const members = [];
  for (const name of all) {
    if (!isBuildMember(name)) continue;
    if (isUnsafeMember(name)) throw new Error(`unsafe path in archive: ${name}`);
    // Skip directory entries; tar recreates parents for files automatically.
    if (name.endsWith('/')) continue;
    members.push(name);
  }
  return members;
}

// Derive the module-relative root of a member by stripping at `/build/...`.
// `libraries/x/build/paparazzi/failures/delta-y.png` -> `libraries/x`.
function moduleRootOf(member) {
  // Match the first `build/` that sits on a path-segment boundary (mirrors
  // isBuildMember), so `prebuild/...` doesn't get mistaken for a build dir.
  const m = member.match(/(?:^|\/)build\//);
  if (!m) return '';
  if (m.index === 0) return ''; // `build/...` at root -> module root is the project root
  return member.slice(0, m.index); // text before the matched `/build/`
}

// Which module roots from the tarball exist as directories under projectRoot.
// `compatible` is false only when nothing lines up (extracting would be useless).
function checkCompat(members, projectRoot) {
  const roots = new Set();
  for (const m of members) roots.add(moduleRootOf(m));
  const modules = [...roots].sort();
  const matched = [];
  const unmatched = [];
  for (const rel of modules) {
    const abs = rel ? path.join(projectRoot, rel) : projectRoot;
    let ok = false;
    try { ok = fs.statSync(abs).isDirectory(); } catch {}
    (ok ? matched : unmatched).push(rel);
  }
  return { modules, matched, unmatched, compatible: matched.length > 0 };
}

// The `<moduleRoot>/build` directory a member lives under, e.g.
// `libraries/x/build/paparazzi/failures/d.png` -> `libraries/x/build`.
function buildDirOf(member) {
  const root = moduleRootOf(member);
  return root ? `${root}/build` : 'build';
}

// Distinct `build` directories covering the given members.
function buildDirsOf(members) {
  const dirs = new Set();
  for (const m of members) dirs.add(buildDirOf(m));
  return [...dirs].sort();
}

// Extract the build outputs for the given members into projectRoot.
//
// We extract whole `<module>/build` *directories* rather than individual files:
// Paparazzi parameterized snapshot names contain `[...]` brackets, which bsdtar
// interprets as glob character-classes when matching members — so a per-file
// `-T` list silently matches nothing ("Not found in archive"). Module/build
// directory paths have no glob metacharacters, so they match literally and tar
// recreates the subtree recursively. `src/` (and anything outside a build dir)
// is never named, so goldens/source are never touched. The directory list goes
// through `-T <listfile>` so a monorepo with many modules can't hit the arg limit.
function extractBuildMembers(tarFile, members, projectRoot) {
  if (!members.length) return 0;
  const dirs = buildDirsOf(members);
  const listFile = path.join(path.dirname(tarFile), `builddirs-${crypto.randomBytes(4).toString('hex')}.txt`);
  fs.writeFileSync(listFile, dirs.join('\n') + '\n');
  try {
    const r = spawnSync('tar', ['-xf', tarFile, '-C', projectRoot, '-T', listFile], {
      encoding: 'utf8', maxBuffer: 64 * 1024 * 1024,
    });
    if (r.status !== 0) {
      throw new Error(`extract failed: ${(r.stderr || '').slice(-300) || 'tar -xf failed'}`);
    }
  } finally {
    try { fs.unlinkSync(listFile); } catch {}
  }
  return dirs.length;
}

// Remove a downloaded tarball and its temp dir.
function cleanupTemp(tarFile) {
  if (!tarFile) return;
  try { fs.rmSync(path.dirname(tarFile), { recursive: true, force: true }); } catch {}
}

module.exports = {
  downloadToTemp,
  listBuildMembers,
  checkCompat,
  extractBuildMembers,
  cleanupTemp,
  // exported for tests
  isUnsafeMember,
  isBuildMember,
  moduleRootOf,
  buildDirOf,
  buildDirsOf,
};

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
const { Readable, Transform } = require('stream');
const { pipeline } = require('stream/promises');

// Hard cap on a scan-from-url download. CI screenshot tarballs are tens of
// megabytes; anything past this is a mistake (or abuse) and we bail before
// filling the disk.
const MAX_DOWNLOAD_BYTES = 2 * 1024 * 1024 * 1024; // 2 GB

// Parse and validate a fetch URL. Returns the URL object; throws on a
// malformed or non-http(s) URL. Shared by the route handler (fail fast with a
// 400) and downloadToTemp (the security boundary).
function validateFetchUrl(url) {
  let parsed;
  try { parsed = new URL(url); } catch { throw new Error('invalid URL'); }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('only http(s) URLs are supported');
  }
  return parsed;
}

// Counts bytes flowing through and errors once the cap is exceeded, so
// chunked responses without a content-length header are capped too.
function byteCapTransform(limit) {
  let seen = 0;
  return new Transform({
    transform(chunk, _enc, cb) {
      seen += chunk.length;
      if (seen > limit) {
        cb(new Error(`download too large (exceeds ${limit} bytes)`));
        return;
      }
      cb(null, chunk);
    },
  });
}

// Stream a remote tarball to a temp file. Returns the temp file path.
// Throws on a non-http(s) URL, a non-2xx response, a download exceeding
// MAX_DOWNLOAD_BYTES, or an abort via opts.signal (as 'download cancelled').
// On any failure the temp dir is removed before rethrowing.
async function downloadToTemp(url, opts = {}) {
  validateFetchUrl(url);
  const { signal } = opts;
  let res = null;
  let tarFile = null;
  try {
    res = await fetch(url, { redirect: 'follow', signal });
    if (!res.ok) throw new Error(`download failed: HTTP ${res.status}`);
    if (!res.body) throw new Error('download failed: empty response body');
    const contentLength = Number(res.headers.get('content-length'));
    if (Number.isFinite(contentLength) && contentLength > MAX_DOWNLOAD_BYTES) {
      throw new Error(`download too large (${contentLength} bytes, cap is ${MAX_DOWNLOAD_BYTES})`);
    }

    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'papastud-fetch-'));
    tarFile = path.join(dir, 'result.tar');
    await pipeline(
      Readable.fromWeb(res.body),
      byteCapTransform(MAX_DOWNLOAD_BYTES),
      fs.createWriteStream(tarFile),
      { signal }
    );
    return tarFile;
  } catch (e) {
    cleanupTemp(tarFile); // never leak a partial download
    // Drop the connection if the body wasn't fully consumed (e.g. size-cap bail).
    try { res?.body?.cancel()?.catch(() => {}); } catch {}
    if (signal?.aborted) throw new Error('download cancelled');
    throw e;
  }
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

// The `<moduleRoot>/build` directories for a set of module roots (as returned
// by checkCompat). Deriving from the distinct roots avoids re-walking every
// archive member a second time just to recompute the same prefixes.
function buildDirsForModules(moduleRoots) {
  return moduleRoots.map(root => (root ? `${root}/build` : 'build')).sort();
}

// Extract the `<module>/build` directories into projectRoot.
//
// We extract whole `build` *directories* rather than individual files:
// Paparazzi parameterized snapshot names contain `[...]` brackets, which bsdtar
// interprets as glob character-classes when matching members — so a per-file
// `-T` list silently matches nothing ("Not found in archive"). Module/build
// directory paths have no glob metacharacters, so they match literally and tar
// recreates the subtree recursively. `src/` (and anything outside a build dir)
// is never named, so goldens/source are never touched. The directory list goes
// through `-T <listfile>` so a monorepo with many modules can't hit the arg limit.
function extractBuildDirs(tarFile, moduleRoots, projectRoot) {
  if (!moduleRoots.length) return 0;
  const dirs = buildDirsForModules(moduleRoots);
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
  MAX_DOWNLOAD_BYTES,
  validateFetchUrl,
  downloadToTemp,
  listBuildMembers,
  checkCompat,
  extractBuildDirs,
  cleanupTemp,
  // exported for tests
  isUnsafeMember,
  isBuildMember,
  moduleRootOf,
  buildDirsForModules,
};

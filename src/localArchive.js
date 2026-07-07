/**
 * Merge locally-uploaded screenshot-test result archives and overlay their
 * build outputs onto a project directory.
 *
 * This is the file-upload sibling of `remoteFetch.js` (scan-from-URL). Where
 * that module downloads a single `.tar` and extracts selected `build/` dirs
 * straight out of the tar, this one accepts *several* archives (`.zip` or
 * `.tar`/`.tar.gz`), extracts each fully into its own staging dir, and then:
 *
 *   1. collects the safe `build/` members of every stage,
 *   2. hashes them to detect cross-archive conflicts (same path, different
 *      bytes) — which abort the whole operation, and
 *   3. copies the `<module>/build` subtrees into the project (identical
 *      duplicates across archives are harmless overwrites).
 *
 * Full extraction (rather than tar member-selection) is deliberate: we need
 * file contents on disk to hash for conflict detection, it unifies zip + tar
 * handling behind one pipeline, and it sidesteps the `[bracket]` glob problem
 * that Paparazzi parameterized snapshot names cause with `tar -T` member lists.
 *
 * No new npm deps: we shell out to the system `unzip` (zip) and `tar` (tar,
 * gzip auto-detected). Both are present on macOS and Linux CI runners.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');
const remoteFetch = require('./remoteFetch');

// Same 2 GB ceiling as a scan-from-url download, applied per uploaded file.
const MAX_UPLOAD_BYTES = remoteFetch.MAX_DOWNLOAD_BYTES;

// Cap on how many archives a single merge can combine. Well past any real
// sharded-CI run; a backstop against a pathological request.
const MAX_UPLOAD_FILES = 32;

const SPAWN_OPTS = { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 };

// Detect the archive format from its magic bytes rather than the filename.
// Zip local-file/central-dir/end-of-central-dir headers all start `PK`.
// Everything else is treated as tar (system `tar` auto-detects gzip, so plain
// `.tar` and `.tar.gz` both extract; a genuinely bad file surfaces as a real
// `tar -xf` error rather than being guessed here).
function sniffFormat(filePath) {
  const fd = fs.openSync(filePath, 'r');
  try {
    const buf = Buffer.alloc(4);
    const n = fs.readSync(fd, buf, 0, 4, 0);
    if (n >= 2 && buf[0] === 0x50 && buf[1] === 0x4b) return 'zip'; // "PK"
    return 'tar';
  } finally {
    fs.closeSync(fd);
  }
}

// Extract one archive fully into stageDir (created if needed). Throws with the
// tail of the extractor's stderr on failure.
function extractArchive(filePath, stageDir) {
  fs.mkdirSync(stageDir, { recursive: true });
  const format = sniffFormat(filePath);
  const r = format === 'zip'
    ? spawnSync('unzip', ['-o', '-q', filePath, '-d', stageDir], SPAWN_OPTS)
    : spawnSync('tar', ['-xf', filePath, '-C', stageDir], SPAWN_OPTS);
  if (r.status !== 0) {
    const detail = (r.stderr || '').slice(-300) || `${format} extract failed`;
    throw new Error(`could not extract archive: ${detail}`);
  }
}

// Walk a staged archive and return its safe `build/` members as
// { relPath (POSIX), absPath }. Directories and symlinks are skipped;
// a member whose path escapes the stage root throws (defence-in-depth against
// zip-slip on top of the extractor's own guards).
function collectBuildMembers(stageDir) {
  const members = [];
  const walk = (dir) => {
    for (const dirent of fs.readdirSync(dir, { withFileTypes: true })) {
      const abs = path.join(dir, dirent.name);
      if (dirent.isSymbolicLink()) continue;
      if (dirent.isDirectory()) { walk(abs); continue; }
      if (!dirent.isFile()) continue;
      const relPath = path.relative(stageDir, abs).split(path.sep).join('/');
      if (!remoteFetch.isBuildMember(relPath)) continue;
      if (remoteFetch.isUnsafeMember(relPath)) {
        throw new Error(`unsafe path in archive: ${relPath}`);
      }
      members.push({ relPath, absPath: abs });
    }
  };
  walk(stageDir);
  return members;
}

function hashFile(absPath) {
  return crypto.createHash('sha256').update(fs.readFileSync(absPath)).digest('hex');
}

// Merge the build members of several staged archives, detecting conflicts.
// `stages` is [{ name, dir }] (name = original filename, for reporting).
//
// Returns { members, moduleRoots, conflicts }:
//  - members: one winning { relPath, absPath } per unique path.
//  - moduleRoots: distinct module roots across all members (sorted).
//  - conflicts: [{ path, archives }] — a path present in >1 archive with
//    differing bytes. Empty when the merge is clean. Identical-content
//    duplicates are merged silently (no conflict).
function mergeStages(stages) {
  const seen = new Map();       // relPath -> { hash, absPath, archives:Set }
  const conflicts = new Map();  // relPath -> Set of archive names
  for (const stage of stages) {
    for (const { relPath, absPath } of collectBuildMembers(stage.dir)) {
      const prior = seen.get(relPath);
      if (!prior) {
        seen.set(relPath, { hash: hashFile(absPath), absPath, archives: new Set([stage.name]) });
        continue;
      }
      const hash = hashFile(absPath);
      if (hash === prior.hash) {
        prior.archives.add(stage.name); // identical duplicate — fine
        continue;
      }
      let names = conflicts.get(relPath);
      if (!names) { names = new Set(prior.archives); conflicts.set(relPath, names); }
      names.add(stage.name);
    }
  }
  const members = [...seen.entries()].map(([relPath, v]) => ({ relPath, absPath: v.absPath }));
  const roots = new Set(members.map(m => remoteFetch.moduleRootOf(m.relPath)));
  return {
    members,
    moduleRoots: [...roots].sort(),
    conflicts: [...conflicts.entries()]
      .map(([p, names]) => ({ path: p, archives: [...names].sort() }))
      .sort((a, b) => a.path.localeCompare(b.path)),
  };
}

// Copy the `<moduleRoot>/build` subtrees from every stage into projectRoot.
// Only `build/` dirs are ever written, so source and goldens are never
// clobbered. When no conflict was detected, cross-stage overwrites of a shared
// path are byte-identical and therefore safe. Returns the number of build dirs
// copied.
function overlayBuildDirs(stages, moduleRoots, projectRoot) {
  let copied = 0;
  for (const stage of stages) {
    for (const root of moduleRoots) {
      const src = root ? path.join(stage.dir, root, 'build') : path.join(stage.dir, 'build');
      let isDir = false;
      try { isDir = fs.statSync(src).isDirectory(); } catch {}
      if (!isDir) continue;
      const dest = root ? path.join(projectRoot, root, 'build') : path.join(projectRoot, 'build');
      fs.cpSync(src, dest, { recursive: true, force: true, dereference: false });
      copied++;
    }
  }
  return copied;
}

function cleanupStage(dir) {
  if (!dir) return;
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
}

function cleanupStages(stages) {
  if (!stages) return;
  for (const s of stages) cleanupStage(s.dir);
}

// Remove a raw upload's temp dir (each upload lives in its own mkdtemp dir).
function cleanupUpload(uploadPath) {
  if (!uploadPath) return;
  try { fs.rmSync(path.dirname(uploadPath), { recursive: true, force: true }); } catch {}
}

module.exports = {
  MAX_UPLOAD_BYTES,
  MAX_UPLOAD_FILES,
  sniffFormat,
  extractArchive,
  collectBuildMembers,
  hashFile,
  mergeStages,
  overlayBuildDirs,
  cleanupStage,
  cleanupStages,
  cleanupUpload,
};

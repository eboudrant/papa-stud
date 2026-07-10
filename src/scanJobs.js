/**
 * Background scan job manager.
 * Runs scans asynchronously with progress tracking and cancellation.
 */

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const projects = require('./projects');
const { scanProjectIncrementalSync, processSingleModule } = require('./scanner');
const { createWatcher } = require('./watcher');
const { getStrategy } = require('./strategies');
const remoteFetch = require('./remoteFetch');
const localArchive = require('./localArchive');

function projectCacheDir(projectId) {
  return path.join(projects.getDataDir(), 'cache', 'xcresult', projectId);
}

function resetCacheDir(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
}

const DEBUG = process.env.PAPASTUD_DEBUG === '1';
const log = (...args) => { if (DEBUG) console.log(...args); };

const jobs = new Map();
const watchers = new Map(); // scanId -> watcher
const JOB_TTL = 300_000; // 5 minutes in ms

// --- Upload registry (raw file uploads awaiting a scan-from-uploads call) ---
//
// A raw upload streams to a temp file and gets an opaque id; the client later
// names those ids in scan-from-uploads. Kept here (not in handler.js) so the
// existing cleanupOldJobs interval can also reap uploads that were streamed but
// never consumed. Entries are removed on takeUploads (ownership passes to the
// job) or TTL-reaped if abandoned.
const uploads = new Map(); // uploadId -> { path, filename, dir, created_at }

function registerUpload({ path: uploadPath, filename, dir }) {
  const uploadId = crypto.randomBytes(8).toString('hex');
  uploads.set(uploadId, { path: uploadPath, filename, dir, created_at: Date.now() });
  return uploadId;
}

// Resolve ids to their temp files and remove them from the registry so the
// caller (a scan job) owns cleanup. Returns null if any id is unknown, without
// consuming the others (they will TTL-reap).
function takeUploads(ids) {
  const out = [];
  for (const id of ids) {
    const u = uploads.get(id);
    if (!u) return null;
    out.push({ uploadId: id, path: u.path, filename: u.filename });
  }
  for (const id of ids) uploads.delete(id);
  return out;
}

// Build and register a job with the shared progress shape. `extra` carries
// status-specific fields (e.g. the fetch job's tarball bookkeeping).
function makeJob(project, status, extra = {}) {
  const jobId = crypto.randomBytes(4).toString('hex');
  let cancelled = false;
  const job = {
    id: jobId,
    projectId: project.id,
    projectName: project.name,
    status,
    total_modules: 0,
    scanned_modules: 0,
    modules_found: 0,
    current_module: '',
    failures_found: 0,
    scan_id: null,
    error: null,
    _cancelFn: () => cancelled,
    _cancel: () => { cancelled = true; },
    _abort: null, // AbortController while a download is in flight
    _finished_at: null,
    ...extra,
  };
  jobs.set(jobId, job);
  return job;
}

// Move a job to a terminal state, releasing any downloaded tarball exactly
// once. Every terminal transition (cancel, timeout, failure) goes through here
// so the temp file can't be leaked.
function finishJob(job, status, error = null, conflicts = null) {
  remoteFetch.cleanupTemp(job._tarFile);
  job._tarFile = null;
  if (job._stageDirs) { localArchive.cleanupStages(job._stageDirs); job._stageDirs = null; }
  if (job._uploadPaths) {
    for (const u of job._uploadPaths) localArchive.cleanupUpload(u.path);
    job._uploadPaths = null;
  }
  job.status = status;
  if (error !== null) job.error = error;
  if (conflicts !== null) job.conflicts = conflicts;
  job._finished_at = Date.now();
}

function startScan(project) {
  cleanupOldJobs();
  const { name, path: projectPath, profiles, strategy: strategyName } = project;
  log(`[scan] starting scan for "${name}" at ${projectPath} (${profiles?.length || 0} profiles, strategy: ${strategyName || 'gradle'})`);
  const job = makeJob(project, 'discovering');
  // Run scan asynchronously via setImmediate chunks
  setImmediate(() => runScan(job.id, project));
  return job.id;
}

function getJob(jobId) {
  const job = jobs.get(jobId);
  if (!job) return null;
  return {
    id: job.id,
    projectId: job.projectId,
    projectName: job.projectName,
    status: job.status,
    totalModules: job.total_modules,
    scannedModules: job.scanned_modules,
    modulesFound: job.modules_found,
    currentModule: job.current_module,
    failuresFound: job.failures_found,
    scanId: job.scan_id,
    error: job.error,
    compat: job.compat || null,
    conflicts: job.conflicts || null,
  };
}

function cancelJob(jobId) {
  const job = jobs.get(jobId);
  if (!job) return false;
  job._cancel();
  // Abort an in-flight download immediately instead of letting it stream to
  // completion before the cancel flag is even checked.
  if (job._abort) job._abort.abort();
  // A job parked awaiting the compat-mismatch confirmation will never resume,
  // so finalize it and drop its downloaded tarball now.
  if (job.status === 'needs_confirmation') finishJob(job, 'cancelled');
  return true;
}

function cleanupOldJobs() {
  const now = Date.now();
  // Reap raw uploads that were streamed but never consumed by a scan.
  for (const [id, u] of uploads) {
    if (now - u.created_at > JOB_TTL) {
      localArchive.cleanupUpload(u.path);
      uploads.delete(id);
    }
  }
  for (const [id, job] of jobs) {
    // Drop a tarball left parked on an un-confirmed fetch job that's gone stale.
    if (job.status === 'needs_confirmation' && job._parked_at && now - job._parked_at > JOB_TTL) {
      finishJob(job, 'failed', 'confirmation timed out');
    }
    if (job._finished_at && now - job._finished_at > JOB_TTL) {
      jobs.delete(id);
    }
  }
}

// Periodic cleanup so completed jobs don't accumulate in long-running servers
setInterval(cleanupOldJobs, JOB_TTL).unref();

function runScan(jobId, project) {
  const job = jobs.get(jobId);
  if (!job) return;
  const { id: projectId, name, path: projectPath, profiles, strategy: strategyName } = project;
  const strategy = getStrategy(strategyName);
  const opts = {};
  if (typeof strategy.parseProjectFailures === 'function') {
    const cacheDir = projectCacheDir(projectId);
    resetCacheDir(cacheDir);
    opts.cacheDir = cacheDir;
    opts.project = project;
  }
  const gen = scanProjectIncrementalSync(projectPath, job._cancelFn, profiles, strategyName, opts);
  const processNext = () => {
    try {
      const { value, done } = gen.next();
      if (done) {
        job.status = 'completed';
        job._finished_at = Date.now();
        return;
      }
      const [phase, data] = value;
      if (phase === 'parsing') {
        job.status = 'parsing';
      } else if (phase === 'discovering') {
        job.modules_found = data.found;
        job.current_module = data.current_dir;
      } else if (phase === 'discovered') {
        job.status = 'scanning';
        job.total_modules = data.total;
      } else if (phase === 'progress') {
        job.scanned_modules = data.scanned;
        job.current_module = data.current_module;
        job.failures_found = data.failures_so_far;
      } else if (phase === 'cancelled') {
        job.status = 'cancelled';
        job._finished_at = Date.now();
        return;
      } else if (phase === 'complete') {
        const scan = projects.createScanFromResults(
          projectId, name, projectPath, data.modules, data.failures
        );
        job.scan_id = scan.id;
        job.status = 'completed';
        job.failures_found = scan.stats.total;
        job._finished_at = Date.now();
        return;
      }
      // Yield to event loop between phases
      setImmediate(processNext);
    } catch (e) {
      job.status = 'failed';
      job.error = e.message;
      job._finished_at = Date.now();
    }
  };
  processNext();
}

// --- Scan from URL (download a CI result tarball, overlay it, then scan) ---

// Kick off a download + extract + scan against an existing project. The
// tarball's `build/` artifacts are overlaid onto the project dir so the scan
// pairs CI's failure deltas with the project's local goldens.
function startScanFromUrl(project, url) {
  cleanupOldJobs();
  log(`[fetch] scan-from-url for "${project.name}" <- ${url}`);
  const job = makeJob(project, 'downloading', {
    _project: project, _tarFile: null, _modules: null, _parked_at: null,
  });
  setImmediate(() => runFetch(job.id, project, url));
  return job.id;
}

async function runFetch(jobId, project, url) {
  const job = jobs.get(jobId);
  if (!job) return;
  const ac = new AbortController();
  job._abort = ac;
  try {
    const tarFile = await remoteFetch.downloadToTemp(url, { signal: ac.signal });
    job._abort = null;
    job._tarFile = tarFile;
    if (job._cancelFn()) return finishJob(job, 'cancelled');
    job.status = 'extracting';
    const members = remoteFetch.listBuildMembers(tarFile);
    if (!members.length) throw new Error('no build/ artifacts found in archive');
    const compat = remoteFetch.checkCompat(members, project.path);
    job._modules = compat.modules;
    if (!compat.compatible) {
      // Park: nothing in the tarball maps onto this project. Wait for the user
      // to confirm (or cancel) before writing into their working copy.
      job.compat = compat;
      job.status = 'needs_confirmation';
      job._parked_at = Date.now();
      return;
    }
    doExtractAndScan(jobId, project, tarFile, compat.modules);
  } catch (e) {
    job._abort = null;
    // A cancel-triggered abort is not a failure — surface it as 'cancelled'.
    if (job._cancelFn() && ac.signal.aborted) return finishJob(job, 'cancelled');
    finishJob(job, 'failed', e.message);
  }
}

// Resume a job parked on a compat-mismatch confirmation. Kind-aware: the URL
// flow re-extracts from its tarball, the uploads flow overlays its stage dirs.
// Both mirror their happy path's confirm semantics — overlay *all* module roots
// present in the archive(s), since the user confirmed writing despite the
// mismatch (creating new <root>/build dirs in the project as needed).
function confirmScanJob(jobId) {
  const job = jobs.get(jobId);
  if (!job || job.status !== 'needs_confirmation') return false;
  job.status = 'extracting';
  // Defer the (blocking) extract off the request so /confirm returns immediately.
  if (job._kind === 'uploads') {
    const { _project, _stageDirs, compat } = job;
    setImmediate(() => doOverlayAndScan(jobId, _project, _stageDirs, compat.modules));
  } else {
    const { _project, _tarFile, _modules } = job;
    setImmediate(() => doExtractAndScan(jobId, _project, _tarFile, _modules));
  }
  return true;
}

function doExtractAndScan(jobId, project, tarFile, moduleRoots) {
  const job = jobs.get(jobId);
  if (!job) { remoteFetch.cleanupTemp(tarFile); return; }
  try {
    remoteFetch.extractBuildDirs(tarFile, moduleRoots, project.path);
  } catch (e) {
    finishJob(job, 'failed', e.message);
    return;
  }
  remoteFetch.cleanupTemp(tarFile);
  job._tarFile = null;
  // Hand off to the normal scan flow against the now-overlaid project dir.
  job.status = 'discovering';
  runScan(jobId, project);
}

// --- Scan from uploaded files (merge several local archives, overlay, scan) ---

// Kick off an extract + merge + conflict-check + overlay + scan against an
// existing project. `uploads` is [{ uploadId, path, filename }]; ownership of
// the temp files passes to the job (freed on any terminal transition).
function startScanFromUploads(project, uploadList) {
  cleanupOldJobs();
  log(`[uploads] scan-from-uploads for "${project.name}" <- ${uploadList.length} file(s)`);
  const job = makeJob(project, 'extracting', {
    _kind: 'uploads',
    _project: project,
    _uploadPaths: uploadList.map(u => ({ path: u.path, filename: u.filename })),
    _stageDirs: null,
    _modules: null,
    _parked_at: null,
    conflicts: null,
  });
  setImmediate(() => runUploads(job.id, project, uploadList));
  return job.id;
}

function runUploads(jobId, project, uploadList) {
  const job = jobs.get(jobId);
  if (!job) return;
  try {
    job.status = 'extracting';
    // 1. Extract every archive fully into its own stage dir.
    const stageDirs = [];
    job._stageDirs = stageDirs;
    for (const u of uploadList) {
      if (job._cancelFn()) return finishJob(job, 'cancelled');
      const stageDir = fs.mkdtempSync(path.join(os.tmpdir(), 'papastud-stage-'));
      localArchive.extractArchive(u.path, stageDir);
      stageDirs.push({ name: u.filename, dir: stageDir });
    }
    if (job._cancelFn()) return finishJob(job, 'cancelled');

    // 2. Merge + detect cross-archive content conflicts.
    const { members, conflicts } = localArchive.mergeStages(stageDirs);
    if (conflicts.length) {
      // Abort before touching the project — the deltas disagree and we can't
      // know which is authoritative.
      return finishJob(job, 'failed', 'conflicting files across archives', conflicts);
    }
    if (!members.length) throw new Error('no build/ artifacts found in archives');

    // 3. Which modules line up with this project's layout? checkCompat works on
    // member-name strings, so hand it the relative paths.
    const compat = remoteFetch.checkCompat(members.map(m => m.relPath), project.path);
    if (!compat.compatible) {
      job.compat = compat;
      job.status = 'needs_confirmation';
      job._parked_at = Date.now();
      return;
    }
    // Overlay all module roots present in the archives (matching the URL flow's
    // doExtractAndScan, which passes compat.modules) so a partially-matching
    // upload doesn't silently drop the unmatched modules' results.
    doOverlayAndScan(jobId, project, stageDirs, compat.modules);
  } catch (e) {
    finishJob(job, 'failed', e.message);
  }
}

function doOverlayAndScan(jobId, project, stageDirs, moduleRoots) {
  const job = jobs.get(jobId);
  if (!job) { localArchive.cleanupStages(stageDirs); return; }
  // A cancel that landed after the last check in runUploads shouldn't still
  // write into the project.
  if (job._cancelFn()) return finishJob(job, 'cancelled');
  try {
    localArchive.overlayBuildDirs(stageDirs, moduleRoots, project.path);
  } catch (e) {
    finishJob(job, 'failed', e.message);
    return;
  }
  // Free the stage dirs and raw uploads now that build outputs are overlaid.
  localArchive.cleanupStages(stageDirs);
  job._stageDirs = null;
  for (const u of job._uploadPaths || []) localArchive.cleanupUpload(u.path);
  job._uploadPaths = null;
  // Hand off to the normal scan flow against the now-overlaid project dir.
  job.status = 'discovering';
  runScan(jobId, project);
}

// --- Watcher management ---

// Whether Watch mode is meaningful for a scan's strategy. Returns null when the
// scan doesn't exist. Watch drives per-module file-convention rescans through
// processSingleModule; strategies that derive failures from a single global
// parse (xcresult / swift-snapshot via parseProjectFailures) don't fit that
// model — a per-module rescan finds ~zero failures and would wipe the real,
// parse-derived results, so Watch is unsupported for them.
function watchSupported(scanId) {
  const scan = projects.getScan(scanId, { page: 0, size: 0 });
  if (!scan) return null;
  const project = projects.getProject(scan.projectId || '');
  const strategy = getStrategy(project?.strategy || 'gradle');
  return typeof strategy.parseProjectFailures !== 'function';
}

function startWatching(scanId) {
  stopWatching(scanId);
  const scan = projects.getScan(scanId, { page: 0, size: 0 });
  if (!scan) return false;

  const projectPath = scan.projectPath || '';
  const project = projects.getProject(scan.projectId || '');
  const scanProfiles = project ? project.profiles : null;
  const strategyName = project?.strategy || 'gradle';
  const strategy = getStrategy(strategyName);

  // Guard before the initial rescan: for xcresult-driven strategies the
  // per-module rescan below would overwrite the parse-derived failures (and the
  // user's accept/reject decisions) with an empty list. Refuse rather than
  // destroy data. See watchSupported().
  if (typeof strategy.parseProjectFailures === 'function') return false;

  const onModuleChange = (moduleName, modulePath) => {
    log(`[watch] rescanning module ${moduleName} at ${modulePath}`);
    const [moduleData, moduleFailures] = processSingleModule(
      null, moduleName, modulePath, scanProfiles, strategyName
    );
    log(`[watch] module ${moduleName}: ${moduleFailures.length} failures (profiles: ${Object.entries(moduleData.profile_counts).map(([k,v]) => `${k}=${v}`).join(', ')})`);
    projects.updateScanModule(scanId, moduleName, moduleData, moduleFailures);
  };

  // Rescan all modules immediately to pick up any changes since last scan
  log(`[watch] start watching scan ${scanId} — rescanning ${(scan.modules || []).length} modules`);
  for (const mod of scan.modules || []) {
    const modulePath = strategy.resolveModulePath(mod.name, projectPath);
    onModuleChange(mod.name, modulePath);
  }
  log(`[watch] initial rescan complete, starting file watcher`);

  const watcher = createWatcher(scan.modules, projectPath, onModuleChange, scanProfiles, strategy);
  watcher.start();
  watchers.set(scanId, watcher);
  return true;
}

function stopWatching(scanId) {
  const watcher = watchers.get(scanId);
  if (watcher) {
    watcher.stop();
    watchers.delete(scanId);
  }
}

function stopAllWatching() {
  for (const watcher of watchers.values()) {
    watcher.stop();
  }
  watchers.clear();
}

function isWatching(scanId) {
  return watchers.has(scanId);
}

module.exports = {
  startScan, startScanFromUrl, confirmScanJob,
  startScanFromUploads, registerUpload, takeUploads,
  getJob, cancelJob,
  startWatching, stopWatching, stopAllWatching, isWatching, watchSupported,
};

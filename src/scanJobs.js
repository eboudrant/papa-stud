/**
 * Background scan job manager.
 * Runs scans asynchronously with progress tracking and cancellation.
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const projects = require('./projects');
const { scanProjectIncrementalSync, processSingleModule } = require('./scanner');
const { createWatcher } = require('./watcher');
const { getStrategy } = require('./strategies');
const remoteFetch = require('./remoteFetch');

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
function finishJob(job, status, error = null) {
  remoteFetch.cleanupTemp(job._tarFile);
  job._tarFile = null;
  job.status = status;
  if (error !== null) job.error = error;
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

// Resume a job parked on a compat-mismatch confirmation.
function confirmScanFromUrl(jobId) {
  const job = jobs.get(jobId);
  if (!job || job.status !== 'needs_confirmation') return false;
  job.status = 'extracting';
  // Defer the (blocking) extract off the request so /confirm returns immediately.
  const { _project, _tarFile, _modules } = job;
  setImmediate(() => doExtractAndScan(jobId, _project, _tarFile, _modules));
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
  startScan, startScanFromUrl, confirmScanFromUrl,
  getJob, cancelJob,
  startWatching, stopWatching, stopAllWatching, isWatching, watchSupported,
};

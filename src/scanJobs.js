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

function startScan(project) {
  cleanupOldJobs();
  const { id: projectId, name, path: projectPath, profiles, strategy: strategyName } = project;
  log(`[scan] starting scan for "${name}" at ${projectPath} (${profiles?.length || 0} profiles, strategy: ${strategyName || 'gradle'})`);
  const jobId = crypto.randomBytes(4).toString('hex');
  let cancelled = false;
  const job = {
    id: jobId,
    projectId,
    projectName: name,
    status: 'discovering',
    total_modules: 0,
    scanned_modules: 0,
    modules_found: 0,
    current_module: '',
    failures_found: 0,
    scan_id: null,
    error: null,
    _cancelFn: () => cancelled,
    _cancel: () => { cancelled = true; },
    _finished_at: null,
  };
  jobs.set(jobId, job);

  // Run scan asynchronously via setImmediate chunks
  setImmediate(() => runScan(jobId, project));
  return jobId;
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
  // A job parked awaiting the compat-mismatch confirmation will never resume,
  // so finalize it and drop its downloaded tarball now.
  if (job.status === 'needs_confirmation') {
    remoteFetch.cleanupTemp(job._tarFile);
    job._tarFile = null;
    job.status = 'cancelled';
    job._finished_at = Date.now();
  }
  return true;
}

function cleanupOldJobs() {
  const now = Date.now();
  for (const [id, job] of jobs) {
    // Drop a tarball left parked on an un-confirmed fetch job that's gone stale.
    if (job.status === 'needs_confirmation' && job._parked_at && now - job._parked_at > JOB_TTL) {
      remoteFetch.cleanupTemp(job._tarFile);
      job._tarFile = null;
      job.status = 'failed';
      job.error = 'confirmation timed out';
      job._finished_at = now;
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
  const { id: projectId, name } = project;
  log(`[fetch] scan-from-url for "${name}" <- ${url}`);
  const jobId = crypto.randomBytes(4).toString('hex');
  let cancelled = false;
  const job = {
    id: jobId,
    projectId,
    projectName: name,
    status: 'downloading',
    total_modules: 0,
    scanned_modules: 0,
    modules_found: 0,
    current_module: '',
    failures_found: 0,
    scan_id: null,
    error: null,
    compat: null,
    _cancelFn: () => cancelled,
    _cancel: () => { cancelled = true; },
    _finished_at: null,
    _project: project,
    _tarFile: null,
    _members: null,
    _parked_at: null,
  };
  jobs.set(jobId, job);
  setImmediate(() => runFetch(jobId, project, url));
  return jobId;
}

function failJob(job, message) {
  job.status = 'failed';
  job.error = message;
  job._finished_at = Date.now();
}

async function runFetch(jobId, project, url) {
  const job = jobs.get(jobId);
  if (!job) return;
  try {
    const tarFile = await remoteFetch.downloadToTemp(url);
    if (job._cancelFn()) {
      remoteFetch.cleanupTemp(tarFile);
      job.status = 'cancelled';
      job._finished_at = Date.now();
      return;
    }
    job._tarFile = tarFile;
    job.status = 'extracting';
    const members = remoteFetch.listBuildMembers(tarFile);
    if (!members.length) throw new Error('no build/ artifacts found in archive');
    job._members = members;
    const compat = remoteFetch.checkCompat(members, project.path);
    if (!compat.compatible) {
      // Park: nothing in the tarball maps onto this project. Wait for the user
      // to confirm (or cancel) before writing into their working copy.
      job.compat = compat;
      job.status = 'needs_confirmation';
      job._parked_at = Date.now();
      return;
    }
    doExtractAndScan(jobId, project, tarFile, members);
  } catch (e) {
    failJob(job, e.message);
    remoteFetch.cleanupTemp(job._tarFile);
    job._tarFile = null;
  }
}

// Resume a job parked on a compat-mismatch confirmation.
function confirmScanFromUrl(jobId) {
  const job = jobs.get(jobId);
  if (!job || job.status !== 'needs_confirmation') return false;
  job.status = 'extracting';
  // Defer the (blocking) extract off the request so /confirm returns immediately.
  const { _project, _tarFile, _members } = job;
  setImmediate(() => doExtractAndScan(jobId, _project, _tarFile, _members));
  return true;
}

function doExtractAndScan(jobId, project, tarFile, members) {
  const job = jobs.get(jobId);
  if (!job) { remoteFetch.cleanupTemp(tarFile); return; }
  try {
    remoteFetch.extractBuildMembers(tarFile, members, project.path);
  } catch (e) {
    failJob(job, e.message);
    remoteFetch.cleanupTemp(tarFile);
    job._tarFile = null;
    return;
  }
  remoteFetch.cleanupTemp(tarFile);
  job._tarFile = null;
  // Hand off to the normal scan flow against the now-overlaid project dir.
  job.status = 'discovering';
  runScan(jobId, project);
}

// --- Watcher management ---

function startWatching(scanId) {
  stopWatching(scanId);
  const scan = projects.getScan(scanId, { page: 0, size: 0 });
  if (!scan) return false;

  const projectPath = scan.projectPath || '';
  const project = projects.getProject(scan.projectId || '');
  const scanProfiles = project ? project.profiles : null;
  const strategyName = project?.strategy || 'gradle';
  const strategy = getStrategy(strategyName);

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

function isWatching(scanId) {
  return watchers.has(scanId);
}

module.exports = {
  startScan, startScanFromUrl, confirmScanFromUrl,
  getJob, cancelJob,
  startWatching, stopWatching, isWatching,
};

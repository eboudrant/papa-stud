/**
 * Background scan job manager.
 * Runs scans asynchronously with progress tracking and cancellation.
 */

const crypto = require('crypto');
const projects = require('./projects');
const { scanProjectIncrementalSync, processSingleModule } = require('./scanner');
const { createWatcher } = require('./watcher');

const jobs = new Map();
const watchers = new Map(); // scanId -> watcher
const JOB_TTL = 300_000; // 5 minutes in ms

function startScan(projectId, name, projectPath, profiles) {
  cleanupOldJobs();
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
  setImmediate(() => runScan(jobId, projectId, name, projectPath, profiles));
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
  };
}

function cancelJob(jobId) {
  const job = jobs.get(jobId);
  if (!job) return false;
  job._cancel();
  return true;
}

function cleanupOldJobs() {
  const now = Date.now();
  for (const [id, job] of jobs) {
    if (job._finished_at && now - job._finished_at > JOB_TTL) {
      jobs.delete(id);
    }
  }
}

function runScan(jobId, projectId, name, projectPath, profiles) {
  const job = jobs.get(jobId);
  if (!job) return;
  const gen = scanProjectIncrementalSync(projectPath, job._cancelFn, profiles);
  const processNext = () => {
    try {
      const { value, done } = gen.next();
      if (done) {
        job.status = 'completed';
        job._finished_at = Date.now();
        return;
      }
      const [phase, data] = value;
      if (phase === 'discovering') {
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

// --- Watcher management ---

function startWatching(scanId) {
  stopWatching(scanId);
  const scan = projects.getScan(scanId, { page: 0, size: 0 });
  if (!scan) return false;

  const projectPath = scan.projectPath || '';
  const project = projects.getProject(scan.projectId || '');
  const scanProfiles = project ? project.profiles : null;

  const onModuleChange = (moduleName, modulePath) => {
    const [moduleData, moduleFailures] = processSingleModule(
      null, moduleName, modulePath, scanProfiles
    );
    projects.updateScanModule(scanId, moduleName, moduleData, moduleFailures);
  };

  const watcher = createWatcher(scan.modules, projectPath, onModuleChange, scanProfiles);
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

module.exports = { startScan, getJob, cancelJob, startWatching, stopWatching, isWatching };

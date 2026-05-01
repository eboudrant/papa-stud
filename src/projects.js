/**
 * Project and scan management.
 * Handles project CRUD, scan creation, failure status updates.
 * All data persisted as JSON files under DATA_DIR.
 * Uses an index file for fast scan listing.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const templates = require('./templates');
const { readJson, writeJson } = require('./jsonStore');

function expandHome(p) {
  if (typeof p !== 'string' || !p) return p;
  if (p === '~') return os.homedir();
  if (p.startsWith('~/') || p.startsWith('~\\')) return path.join(os.homedir(), p.slice(2));
  return p;
}

let DATA_DIR = path.join(process.cwd(), 'data');

function setDataDir(dir) {
  DATA_DIR = dir;
  _scansDirCreated = false;
  templates.setDataDir(dir);
}

function projectsPath() { return path.join(DATA_DIR, 'projects.json'); }
let _scansDirCreated = false;
function scansDir() {
  const d = path.join(DATA_DIR, 'scans');
  if (!_scansDirCreated) {
    fs.mkdirSync(d, { recursive: true });
    _scansDirCreated = true;
  }
  return d;
}
function sanitizeId(id) {
  return String(id).replace(/[^a-zA-Z0-9._-]/g, '');
}

function scanPath(scanId) { return path.join(scansDir(), `${sanitizeId(scanId)}.json`); }
function indexPath() { return path.join(scansDir(), 'index.json'); }

// --- Default profiles ---

let _defaultProfiles = null;

function defaultProfiles() {
  if (_defaultProfiles) return _defaultProfiles;
  const t = templates.getTemplate('paparazzi');
  if (t) {
    _defaultProfiles = [templates.templateToProfile(t)];
  } else {
    _defaultProfiles = [{
      name: 'Paparazzi',
      failures_dir: 'build/paparazzi/failures',
      golden_patterns: ['src/test/snapshots/images/{name}.png'],
    }];
  }
  return _defaultProfiles;
}

// --- Projects ---

function listProjects() {
  const list = readJson(projectsPath()) || [];
  return list.map(p => (p && typeof p.path === 'string' ? { ...p, path: expandHome(p.path) } : p));
}

function addProject(name, projectPath, templateIds, strategy) {
  projectPath = expandHome(projectPath);
  let profiles;
  if (templateIds && templateIds.length) {
    profiles = [];
    for (const tid of templateIds) {
      const t = templates.getTemplate(tid);
      if (t) profiles.push(templates.templateToProfile(t));
    }
  } else {
    profiles = JSON.parse(JSON.stringify(defaultProfiles()));
  }

  const projects = readJson(projectsPath()) || [];
  const project = {
    id: crypto.randomBytes(4).toString('hex'),
    name,
    path: projectPath,
    added: new Date().toISOString(),
    strategy: strategy || 'gradle',
    profiles,
  };
  projects.push(project);
  writeJson(projectsPath(), projects);
  return project;
}

function getProject(projectId) {
  return listProjects().find(p => p.id === projectId) || null;
}

function updateProjectProfiles(projectId, profiles) {
  const projects = readJson(projectsPath()) || [];
  for (const p of projects) {
    if (p.id === projectId) {
      p.profiles = profiles;
      break;
    }
  }
  writeJson(projectsPath(), projects);
  return getProject(projectId);
}

function deleteProject(projectId) {
  const projects = readJson(projectsPath()) || [];
  writeJson(projectsPath(), projects.filter(p => p.id !== projectId));
}

// --- Scan Index ---

function scanSummary(scan) {
  return {
    id: scan.id,
    projectId: scan.projectId,
    projectName: scan.projectName || '',
    created: scan.created,
    modules: scan.modules,
    stats: scan.stats,
  };
}

function readIndex() {
  const idx = readJson(indexPath());
  if (idx !== null) return idx;
  return rebuildIndex();
}

function rebuildIndex() {
  const dir = scansDir();
  const files = fs.readdirSync(dir).filter(f => f.endsWith('.json') && f !== 'index.json').sort().reverse();
  const index = [];
  for (const f of files) {
    const data = readJson(path.join(dir, f));
    if (data) index.push(scanSummary(data));
  }
  writeJson(indexPath(), index);
  return index;
}

function updateIndex(summary) {
  const index = readIndex();
  index.unshift(summary);
  writeJson(indexPath(), index);
}

function removeFromIndex(scanId) {
  const index = readIndex();
  writeJson(indexPath(), index.filter(s => s.id !== scanId));
}

// --- Scans ---

function createScanFromResults(projectId, projectName, projectPath, modules, failures) {
  const now = new Date();
  const ts = now.toISOString().replace(/[-:T]/g, '').slice(0, 14).replace(/^(\d{8})(\d{6})/, '$1-$2');
  const scanId = ts + '-' + crypto.randomBytes(2).toString('hex');
  const scan = {
    id: scanId,
    projectId,
    projectName,
    projectPath,
    created: now.toISOString(),
    modules,
    failures,
    stats: computeStats(failures),
  };

  // One scan per project: remove old scans atomically
  const index = readIndex();
  const oldIds = index.filter(s => s.projectId === projectId).map(s => s.id);
  for (const oldId of oldIds) {
    const p = scanPath(oldId);
    if (fs.existsSync(p)) fs.unlinkSync(p);
  }
  const cleanIndex = index.filter(s => !oldIds.includes(s.id));

  writeJson(scanPath(scanId), scan);
  cleanIndex.unshift(scanSummary(scan));
  writeJson(indexPath(), cleanIndex);

  return scan;
}

function listScans() {
  return readIndex();
}

function getScan(scanId, { page = 0, size = 50, status, query, module: mod, profile, sort } = {}) {
  const scan = readJson(scanPath(scanId));
  if (!scan) return null;

  let failures = scan.failures;

  if (status && status !== 'all') {
    failures = failures.filter(f => f.status === status);
  }
  if (mod) {
    failures = failures.filter(f => f.module === mod);
  }
  if (profile) {
    failures = failures.filter(f => f.profile === profile);
  }
  if (query) {
    const q = query.toLowerCase();
    failures = failures.filter(f =>
      f.filename.toLowerCase().includes(q) ||
      f.package.toLowerCase().includes(q) ||
      f.class_name.toLowerCase().includes(q) ||
      f.method.toLowerCase().includes(q)
    );
  }

  if (sort === 'name') {
    failures.sort((a, b) => (a.filename || '').toLowerCase().localeCompare((b.filename || '').toLowerCase()));
  } else if (sort === 'module') {
    failures.sort((a, b) => (a.module || '').localeCompare(b.module || '') || (a.filename || '').toLowerCase().localeCompare((b.filename || '').toLowerCase()));
  } else if (sort === 'profile') {
    failures.sort((a, b) => (a.profile || '').localeCompare(b.profile || '') || (a.filename || '').toLowerCase().localeCompare((b.filename || '').toLowerCase()));
  } else if (sort === 'diff') {
    failures.sort((a, b) => (b.diff_pct || 0) - (a.diff_pct || 0));
  }

  const totalFiltered = failures.length;
  const start = page * size;
  const pageFailures = failures.slice(start, start + size);

  return {
    id: scan.id,
    projectId: scan.projectId,
    projectName: scan.projectName || '',
    projectPath: scan.projectPath || '',
    created: scan.created,
    modules: scan.modules,
    stats: scan.stats,
    failures: pageFailures,
    totalFiltered,
    page,
    pageSize: size,
  };
}

function deleteScan(scanId) {
  const p = scanPath(scanId);
  if (fs.existsSync(p)) fs.unlinkSync(p);
  removeFromIndex(scanId);
}

function updateScanModule(scanId, moduleName, moduleData, moduleFailures) {
  const scan = readJson(scanPath(scanId));
  if (!scan) return null;

  let found = false;
  for (let i = 0; i < scan.modules.length; i++) {
    if (scan.modules[i].name === moduleName) {
      scan.modules[i] = moduleData;
      found = true;
      break;
    }
  }
  if (!found) scan.modules.push(moduleData);

  // Preserve accept/reject decisions across rescans: a re-detected failure with
  // the same filename keeps the user's prior status until it actually goes away.
  const priorStatus = new Map();
  for (const f of scan.failures) {
    if (f.module === moduleName && (f.status === 'accepted' || f.status === 'rejected')) {
      priorStatus.set(f.filename, f.status);
    }
  }
  for (const f of moduleFailures) {
    const prior = priorStatus.get(f.filename);
    if (prior) f.status = prior;
  }

  scan.failures = scan.failures.filter(f => f.module !== moduleName).concat(moduleFailures);
  scan.stats = computeStats(scan.failures);
  writeJson(scanPath(scanId), scan);

  const idx = readIndex();
  for (let i = 0; i < idx.length; i++) {
    if (idx[i].id === scanId) {
      idx[i] = scanSummary(scan);
      break;
    }
  }
  writeJson(indexPath(), idx);

  return scan.stats;
}

function updateFailureStatus(scanId, filename, status) {
  const scan = readJson(scanPath(scanId));
  if (!scan) return null;
  for (const f of scan.failures) {
    if (f.filename === filename) {
      f.status = status;
      break;
    }
  }
  scan.stats = computeStats(scan.failures);
  writeJson(scanPath(scanId), scan);
  return scan.stats;
}

function batchUpdateStatus(scanId, filenames, status) {
  const scan = readJson(scanPath(scanId));
  if (!scan) return null;
  const target = new Set(filenames);
  for (const f of scan.failures) {
    if (target.has(f.filename)) f.status = status;
  }
  scan.stats = computeStats(scan.failures);
  writeJson(scanPath(scanId), scan);
  return scan.stats;
}

// Returns null on success, error string on failure.
function _copyActualToGolden(failure, rootPrefix) {
  if (!failure.actual_path) return 'no actual image to accept';
  if (!failure.golden_path) return 'no golden path resolved; check profile patterns';

  let actualReal;
  try { actualReal = fs.realpathSync(failure.actual_path); } catch { return 'actual image missing'; }

  // Create parent dir first so we can realpath it (golden file itself may not exist yet)
  let goldenResolved;
  try {
    fs.mkdirSync(path.dirname(failure.golden_path), { recursive: true });
    goldenResolved = path.join(fs.realpathSync(path.dirname(failure.golden_path)), path.basename(failure.golden_path));
  } catch (e) { return 'golden path invalid: ' + e.message; }

  if (!actualReal.startsWith(rootPrefix)) return 'actual outside project';
  if (!goldenResolved.startsWith(rootPrefix)) return 'golden outside project';

  try { fs.copyFileSync(actualReal, goldenResolved); }
  catch (e) { return 'copy failed: ' + e.message; }
  return null;
}

function _getScanAndRoot(scanId) {
  const scan = readJson(scanPath(scanId));
  if (!scan) return { scan: null };
  const project = getProject(scan.projectId);
  if (!project) return { scan, error: 'project not found' };
  let root;
  try { root = fs.realpathSync(project.path); } catch { return { scan, error: 'project path invalid' }; }
  return { scan, rootPrefix: root + path.sep };
}

function acceptBaseline(scanId, filename) {
  const { scan, rootPrefix, error } = _getScanAndRoot(scanId);
  if (!scan) return null;
  if (error) return { error };
  const failure = scan.failures.find(f => f.filename === filename);
  if (!failure) return null;

  const err = _copyActualToGolden(failure, rootPrefix);
  if (err) return { error: err };

  failure.status = 'accepted';
  scan.stats = computeStats(scan.failures);
  writeJson(scanPath(scanId), scan);
  return { stats: scan.stats };
}

function acceptAllBaselines(scanId) {
  const { scan, rootPrefix, error } = _getScanAndRoot(scanId);
  if (!scan) return null;
  if (error) return { error };

  let accepted = 0;
  const errors = [];
  for (const failure of scan.failures) {
    if (failure.status === 'accepted') continue;
    const err = _copyActualToGolden(failure, rootPrefix);
    if (err) {
      errors.push({ filename: failure.filename, error: err });
    } else {
      failure.status = 'accepted';
      accepted++;
    }
  }

  scan.stats = computeStats(scan.failures);
  writeJson(scanPath(scanId), scan);
  return { stats: scan.stats, accepted, errors };
}

function isPathUnderProject(filePath) {
  const allProjects = listProjects();
  const resolved = path.resolve(filePath);
  return allProjects.some(p => {
    const projectRoot = path.resolve(p.path) + path.sep;
    return resolved.startsWith(projectRoot) || resolved === path.resolve(p.path);
  });
}

function computeStats(failures) {
  const stats = { total: failures.length, pending: 0, accepted: 0, rejected: 0 };
  for (const f of failures) {
    const s = f.status || 'pending';
    if (s in stats) stats[s]++;
  }
  return stats;
}

function getDataDir() { return DATA_DIR; }

function importProjects(incoming) {
  const existing = readJson(projectsPath()) || [];
  const byId = new Map(existing.map(p => [p.id, p]));
  for (const p of incoming) {
    byId.set(p.id, p);
  }
  writeJson(projectsPath(), [...byId.values()]);
}

function resetProjects() {
  writeJson(projectsPath(), []);
}

module.exports = {
  expandHome,
  setDataDir,
  getDataDir,
  listProjects,
  addProject,
  getProject,
  updateProjectProfiles,
  deleteProject,
  importProjects,
  resetProjects,
  listScans,
  getScan,
  createScanFromResults,
  deleteScan,
  updateScanModule,
  updateFailureStatus,
  batchUpdateStatus,
  acceptBaseline,
  acceptAllBaselines,
  scanPath,
};

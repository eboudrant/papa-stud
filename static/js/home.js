// @ts-check

async function showHome() {
  const content = document.getElementById('content');
  content.innerHTML = `
    <div class="home">
      <section class="section">
        <div class="section-header">
          <h2>Projects</h2>
          <button class="btn btn-primary" onclick="_showAddProject()">Add Project</button>
        </div>
        <div id="add-project-form" class="add-form" style="display:none">
          <input type="text" id="project-name" placeholder="Project name (optional)" class="input">
          <input type="text" id="project-path" placeholder="/path/to/gradle/project" class="input input-wide">
          <button class="btn btn-primary" onclick="_addProject()">Add</button>
          <button class="btn" onclick="_hideAddProject()">Cancel</button>
        </div>
        <div id="projects-list" class="card-list"></div>
      </section>
      <section class="section">
        <h2>Recent Scans</h2>
        <div id="scans-list" class="card-list"></div>
      </section>
    </div>
  `;
  await _loadHome();

  return () => {
    for (const id of Object.keys(_pollTimers)) _stopPolling(id);
  };
}

async function _loadHome() {
  const [projectsList, scansList] = await Promise.all([
    apiGet('/api/projects'),
    apiGet('/api/scans'),
  ]);
  _renderProjects(projectsList);
  _renderScans(scansList);
}

function _renderProjects(projectsList) {
  const el = document.getElementById('projects-list');
  if (!projectsList.length) {
    el.innerHTML = '<div class="empty-state">No projects configured. Add a Gradle project to get started.</div>';
    return;
  }
  el.innerHTML = projectsList.map(p => {
    const profiles = p.profiles || [];
    const profileTags = profiles.map(pr => `<span class="profile-tag">${escHtml(pr.name)}</span>`).join('');
    return `
    <div class="card" id="project-${p.id}">
      <div class="card-body">
        <div class="card-title">${escHtml(p.name)}</div>
        <div class="card-subtitle">${escHtml(p.path)}</div>
        <div class="card-profiles">${profileTags}</div>
      </div>
      <div class="card-actions" id="actions-${p.id}">
        <button class="btn btn-sm" onclick="_showProfiles('${p.id}')">Profiles</button>
        <button class="btn btn-primary" onclick="_scanProject('${p.id}')">Scan</button>
        <button class="btn btn-danger-text" onclick="_deleteProject('${p.id}')">Remove</button>
      </div>
    </div>
    <div class="profiles-form" id="profiles-${p.id}" style="display:none">
      <div class="profiles-list" id="profiles-list-${p.id}"></div>
      <div class="profiles-actions">
        <button class="btn btn-sm" onclick="_addProfile('${p.id}')">Add Profile</button>
        <button class="btn btn-sm btn-primary" onclick="_saveProfiles('${p.id}')">Save</button>
        <button class="btn btn-sm" onclick="_hideProfiles('${p.id}')">Cancel</button>
      </div>
    </div>`;
  }).join('');
}

function _renderScans(scansList) {
  const el = document.getElementById('scans-list');
  if (!scansList.length) {
    el.innerHTML = '<div class="empty-state">No scans yet. Scan a project to find failures.</div>';
    return;
  }
  el.innerHTML = scansList.map(s => {
    const isClean = s.stats.total === 0;
    const moduleCount = (s.modules || []).length;
    const snapStats = _aggregateSnapshotStats(s.modules || []);
    return `
      <div class="card ${isClean ? 'scan-clean' : ''}">
        <a class="card-body card-link" href="#/scans/${s.id}">
          <div class="card-title">
            ${escHtml(s.projectName)}
            <span class="card-date" title="${_formatDate(s.created)}">${_relativeTime(s.created)} &middot; ${_formatDate(s.created)}</span>
            ${isClean ? '<span class="label-clean">clean</span>' : `<span class="label-failed">${s.stats.total} failed</span>`}
          </div>
          <div class="card-subtitle">
            ${isClean ? 'No screenshot failures' : s.stats.total + ' screenshot failures'} across ${moduleCount} module(s)
            ${snapStats ? ` &middot; ${snapStats.snapshots} snapshots` : ''}
          </div>
          ${snapStats ? snapshotBar(snapStats.snapshots, snapStats.failures, 'scan-test-bar') : ''}
        </a>
        <div class="card-actions">
          <button class="btn btn-sm btn-danger-text" onclick="_deleteScan('${s.id}')">Delete</button>
        </div>
      </div>
    `;
  }).join('');
}

// --- Profile management ---

let _editingProfiles = {}; // projectId -> profiles array being edited

function _showProfiles(projectId) {
  const el = document.getElementById(`profiles-${projectId}`);
  if (!el) return;
  el.style.display = 'block';
  // Load current profiles from the rendered data
  apiGet('/api/projects').then(projects => {
    const p = projects.find(x => x.id === projectId);
    _editingProfiles[projectId] = JSON.parse(JSON.stringify(p?.profiles || []));
    _renderProfilesList(projectId);
  });
}

function _hideProfiles(projectId) {
  const el = document.getElementById(`profiles-${projectId}`);
  if (el) el.style.display = 'none';
  delete _editingProfiles[projectId];
}

function _renderProfilesList(projectId) {
  const el = document.getElementById(`profiles-list-${projectId}`);
  const profiles = _editingProfiles[projectId] || [];
  el.innerHTML = profiles.map((pr, i) => {
    const gp = pr.golden_patterns || [];
    const gpText = gp.join('\n');
    return `
    <div class="profile-row">
      <input class="input input-sm" value="${escAttr(pr.name)}" placeholder="name" style="width:80px" onchange="_editingProfiles['${projectId}'][${i}].name=this.value">
      <input class="input input-sm input-wide" value="${escAttr(pr.failures_dir)}" placeholder="failures dir (relative)" onchange="_editingProfiles['${projectId}'][${i}].failures_dir=this.value">
      <textarea class="input input-sm input-wide" rows="${Math.max(1, gp.length)}" placeholder="golden patterns (one per line, use {name})" onchange="_editingProfiles['${projectId}'][${i}].golden_patterns=this.value.split('\\n').filter(Boolean)">${escHtml(gpText)}</textarea>
      ${pr.name !== 'baseline' ? `<button class="btn btn-sm btn-danger-text" onclick="_removeProfile('${projectId}', ${i})">X</button>` : ''}
    </div>`;
  }).join('');
}

function _addProfile(projectId) {
  _editingProfiles[projectId] = _editingProfiles[projectId] || [];
  _editingProfiles[projectId].push({ name: '', failures_dir: 'build/paparazzi/', golden_patterns: [] });
  _renderProfilesList(projectId);
}

function _removeProfile(projectId, index) {
  _editingProfiles[projectId].splice(index, 1);
  _renderProfilesList(projectId);
}

async function _saveProfiles(projectId) {
  const profiles = _editingProfiles[projectId].filter(p => p.name && p.failures_dir);
  await apiPut(`/api/projects/${projectId}/profiles`, { profiles });
  _hideProfiles(projectId);
  await _loadHome();
}

function _aggregateSnapshotStats(modules) {
  let snapshots = 0;
  let failures = 0;
  for (const m of modules) {
    snapshots += m.snapshot_count || 0;
    failures += m.failure_count ?? 0;
  }
  return snapshots > 0 ? { snapshots, failures } : null;
}

function _showAddProject() {
  document.getElementById('add-project-form').style.display = 'flex';
}

function _hideAddProject() {
  document.getElementById('add-project-form').style.display = 'none';
}

async function _addProject() {
  const name = document.getElementById('project-name').value.trim();
  const path = document.getElementById('project-path').value.trim();
  if (!path) return;
  await apiPost('/api/projects', { name: name || undefined, path });
  _hideAddProject();
  await _loadHome();
}

async function _deleteProject(id) {
  await apiDelete(`/api/projects/${id}`);
  await _loadHome();
}

async function _deleteScan(id) {
  await apiDelete(`/api/scans/${id}`);
  await _loadHome();
}

// --- Async scan with progress ---

let _pollTimers = {};

async function _scanProject(id) {
  const resp = await apiPost(`/api/projects/${id}/scan`, {});
  const jobId = resp.jobId;

  const actionsEl = document.getElementById(`actions-${id}`);
  if (actionsEl) {
    actionsEl.innerHTML = `
      <div class="scan-progress">
        <div class="progress-bar-wrap">
          <div class="progress-fill" id="fill-${jobId}" style="width:0%"></div>
        </div>
        <span class="progress-text" id="text-${jobId}">Discovering modules...</span>
        <button class="btn btn-sm btn-danger-text" onclick="_cancelScan('${jobId}', '${id}')">Cancel</button>
      </div>
    `;
  }

  _pollScanJob(jobId, id);
}

function _pollScanJob(jobId, projectId) {
  _pollTimers[jobId] = setInterval(async () => {
    const job = await apiGet(`/api/scan-jobs/${jobId}`);
    if (!job) {
      _stopPolling(jobId);
      _restoreScanButton(projectId);
      return;
    }

    const fill = document.getElementById(`fill-${jobId}`);
    const text = document.getElementById(`text-${jobId}`);

    if (job.status === 'discovering') {
      if (fill) fill.classList.add('progress-pulse');
      if (text) text.textContent = `Discovering ${escHtml(job.currentModule)}...`;
    } else if (job.status === 'scanning') {
      if (fill) fill.classList.remove('progress-pulse');
      const pct = job.totalModules > 0 ? Math.round((job.scannedModules / job.totalModules) * 100) : 0;
      if (fill) fill.style.width = pct + '%';
      if (text) text.textContent = `${escHtml(job.currentModule)} (${job.scannedModules}/${job.totalModules})`;
    } else if (job.status === 'completed') {
      _stopPolling(jobId);
      if (job.scanId && job.failuresFound > 0) {
        navigate(`/scans/${job.scanId}`);
      } else {
        showToast(`Scan complete — no failures found.`, 'success');
        _restoreScanButton(projectId);
        await _loadHome();
      }
    } else if (job.status === 'cancelled') {
      _stopPolling(jobId);
      showToast('Scan cancelled.', 'info');
      _restoreScanButton(projectId);
    } else if (job.status === 'failed') {
      _stopPolling(jobId);
      showToast(`Scan failed: ${escHtml(job.error || 'unknown error')}`, 'error');
      _restoreScanButton(projectId);
    }
  }, 1500);
}

function _stopPolling(jobId) {
  if (_pollTimers[jobId]) {
    clearInterval(_pollTimers[jobId]);
    delete _pollTimers[jobId];
  }
}

async function _cancelScan(jobId, projectId) {
  await apiPost(`/api/scan-jobs/${jobId}/cancel`, {});
}

function _restoreScanButton(projectId) {
  const actionsEl = document.getElementById(`actions-${projectId}`);
  if (actionsEl) {
    actionsEl.innerHTML = `
      <button class="btn btn-sm" onclick="_showProfiles('${projectId}')">Profiles</button>
      <button class="btn btn-primary" onclick="_scanProject('${projectId}')">Scan</button>
      <button class="btn btn-danger-text" onclick="_deleteProject('${projectId}')">Remove</button>
    `;
  }
}



function _relativeTime(iso) {
  const now = Date.now();
  const then = new Date(iso).getTime();
  const diff = Math.floor((now - then) / 1000);
  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  if (diff < 604800) return `${Math.floor(diff / 86400)}d ago`;
  return new Date(iso).toLocaleDateString();
}

function _formatDate(iso) {
  const d = new Date(iso);
  return d.toLocaleDateString() + ' ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

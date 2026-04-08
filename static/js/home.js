// @ts-check

async function showHome() {
  const content = document.getElementById('content');
  content.innerHTML = `
    <div class="home">
      <section class="section">
        <div class="section-header">
          <h2>Projects</h2>
          <button class="btn" onclick="_showAddProject()">Add Project</button>
        </div>
        <div id="add-project-form" class="add-form" style="display:none">
          <div class="add-form-row">
            <input type="text" id="project-name" placeholder="Project name (optional)" class="input">
            <input type="text" id="project-path" placeholder="/path/to/gradle/project" class="input input-wide">
          </div>
          <div id="template-selector" class="template-selector"></div>
          <div class="add-form-row">
            <button class="btn btn-primary btn-lg" onclick="_addProject()">Add Project</button>
            <button class="btn" onclick="_hideAddProject()">Cancel</button>
          </div>
        </div>
        <div id="projects-list" class="card-list"></div>
      </section>
      <section class="section">
        <div class="section-header">
          <h2>Templates</h2>
          <button class="btn" onclick="_showCreateTemplate()">Create Template</button>
        </div>
        <div id="create-template-form" style="display:none"></div>
        <div id="templates-list" class="template-list"></div>
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
    _editingProfiles = {};
    _profileEditing = -1;
  };
}

async function _loadHome() {
  const [projectsList, scansList, templatesList] = await Promise.all([
    apiGet('/api/projects'),
    apiGet('/api/scans'),
    apiGet('/api/templates'),
  ]);
  _renderProjects(projectsList);
  _renderTemplates(templatesList);
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
        <button class="btn btn-sm" onclick="_addProfileFromTemplate('${p.id}')">Add from Template</button>
        <button class="btn btn-sm" onclick="_addCustomProfile('${p.id}')">Add Custom</button>
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

// --- Templates ---

function _renderTemplates(templatesList) {
  const el = document.getElementById('templates-list');
  if (!templatesList.length) {
    el.innerHTML = '<div class="empty-state">No templates. Built-in templates are always available.</div>';
    return;
  }
  el.innerHTML = templatesList.map(t => `
    <div class="template-list-card">
      <div class="template-list-info">
        <span class="template-name">${escHtml(t.name)}</span>
        <span class="template-tool">${escHtml(t.tool)}</span>
        ${t.builtin ? '<span class="template-badge">built-in</span>' : ''}
      </div>
      <div class="template-list-detail">${escHtml(t.description)}</div>
      <div class="template-list-paths">
        <span>failures: <code>${escHtml(t.failures_dir)}</code></span>
        ${t.delta_suffix ? `<span>delta suffix: <code>${escHtml(t.delta_suffix)}</code></span>` : ''}
        ${t.actual_suffix ? `<span>actual suffix: <code>${escHtml(t.actual_suffix)}</code></span>` : ''}
      </div>
      ${!t.builtin ? `<div class="template-list-actions"><button class="btn btn-sm" onclick="_editTemplate('${escAttr(t.id)}')">Edit</button><button class="btn btn-sm btn-danger-text" onclick="_deleteTemplate('${escAttr(t.id)}')">Delete</button></div>` : ''}
    </div>
  `).join('');
}

function _showCreateTemplate() {
  const el = document.getElementById('create-template-form');
  el.style.display = 'block';
  el.innerHTML = `
    <div class="add-form">
      <div class="add-form-row">
        <input class="input input-sm" id="tmpl-name" placeholder="Template name">
        <input class="input input-sm" id="tmpl-tool" placeholder="Tool (e.g., paparazzi)" value="paparazzi">
      </div>
      <div class="add-form-row">
        <input class="input input-sm input-wide" id="tmpl-desc" placeholder="Description">
      </div>
      <div class="add-form-row">
        <input class="input input-sm input-wide" id="tmpl-failures" placeholder="Failures dir (e.g., build/paparazzi/failures)">
      </div>
      <div class="add-form-row">
        <input class="input input-sm" id="tmpl-delta-prefix" placeholder="Delta prefix" value="delta-" style="width:100px">
        <input class="input input-sm" id="tmpl-delta-suffix" placeholder="Delta suffix" style="width:100px">
        <input class="input input-sm" id="tmpl-actual-suffix" placeholder="Actual suffix" style="width:100px">
      </div>
      <div class="add-form-row">
        <textarea class="input input-sm input-wide" id="tmpl-patterns" rows="3" placeholder="Golden patterns (one per line, use {name})"></textarea>
      </div>
      <div class="add-form-row">
        <button class="btn btn-primary btn-sm" onclick="_createTemplate()">Create</button>
        <button class="btn btn-sm" onclick="document.getElementById('create-template-form').style.display='none'">Cancel</button>
      </div>
    </div>
  `;
}

async function _createTemplate() {
  const name = document.getElementById('tmpl-name').value.trim();
  const tool = document.getElementById('tmpl-tool').value.trim();
  if (!name) return;
  await apiPost('/api/templates', {
    name,
    tool: tool || 'custom',
    description: document.getElementById('tmpl-desc').value.trim(),
    failures_dir: document.getElementById('tmpl-failures').value.trim(),
    golden_patterns: document.getElementById('tmpl-patterns').value.split('\n').filter(Boolean),
    delta_prefix: document.getElementById('tmpl-delta-prefix').value,
    delta_suffix: document.getElementById('tmpl-delta-suffix').value,
    actual_suffix: document.getElementById('tmpl-actual-suffix').value,
  });
  document.getElementById('create-template-form').style.display = 'none';
  await _loadHome();
}

async function _editTemplate(id) {
  const tmps = await apiGet('/api/templates');
  const t = tmps.find(x => x.id === id);
  if (!t) return;
  const el = document.getElementById('create-template-form');
  el.style.display = 'block';
  el.innerHTML = `
    <div class="add-form">
      <div class="add-form-row">
        <input class="input input-sm" id="tmpl-name" placeholder="Template name" value="${escAttr(t.name)}">
        <input class="input input-sm" id="tmpl-tool" placeholder="Tool" value="${escAttr(t.tool)}">
      </div>
      <div class="add-form-row">
        <input class="input input-sm input-wide" id="tmpl-desc" placeholder="Description" value="${escAttr(t.description)}">
      </div>
      <div class="add-form-row">
        <input class="input input-sm input-wide" id="tmpl-failures" placeholder="Failures dir" value="${escAttr(t.failures_dir)}">
      </div>
      <div class="add-form-row">
        <input class="input input-sm" id="tmpl-delta-prefix" placeholder="Delta prefix" value="${escAttr(t.delta_prefix || 'delta-')}" style="width:100px">
        <input class="input input-sm" id="tmpl-delta-suffix" placeholder="Delta suffix" value="${escAttr(t.delta_suffix || '')}" style="width:100px">
        <input class="input input-sm" id="tmpl-actual-suffix" placeholder="Actual suffix" value="${escAttr(t.actual_suffix || '')}" style="width:100px">
      </div>
      <div class="add-form-row">
        <textarea class="input input-sm input-wide" id="tmpl-patterns" rows="3" placeholder="Golden patterns">${escHtml((t.golden_patterns || []).join('\n'))}</textarea>
      </div>
      <div class="add-form-row">
        <button class="btn btn-primary btn-sm" onclick="_updateTemplate('${escAttr(id)}')">Save</button>
        <button class="btn btn-sm" onclick="document.getElementById('create-template-form').style.display='none'">Cancel</button>
      </div>
    </div>
  `;
}

async function _updateTemplate(id) {
  await apiPost('/api/templates', {
    id,
    name: document.getElementById('tmpl-name').value.trim(),
    tool: document.getElementById('tmpl-tool').value.trim() || 'custom',
    description: document.getElementById('tmpl-desc').value.trim(),
    failures_dir: document.getElementById('tmpl-failures').value.trim(),
    golden_patterns: document.getElementById('tmpl-patterns').value.split('\n').filter(Boolean),
    delta_prefix: document.getElementById('tmpl-delta-prefix').value,
    delta_suffix: document.getElementById('tmpl-delta-suffix').value,
    actual_suffix: document.getElementById('tmpl-actual-suffix').value,
  });
  document.getElementById('create-template-form').style.display = 'none';
  await _loadHome();
}

async function _deleteTemplate(id) {
  await apiDelete(`/api/templates/${id}`);
  await _loadHome();
}

// --- Profile management ---

let _editingProfiles = {}; // projectId -> profiles array being edited

async function _showProfiles(projectId) {
  const el = document.getElementById(`profiles-${projectId}`);
  if (!el) return;
  el.style.display = 'block';
  const projects = await apiGet('/api/projects');
  const p = projects.find(x => x.id === projectId);
  _editingProfiles[projectId] = JSON.parse(JSON.stringify(p?.profiles || []));
  _renderProfilesList(projectId);
}

function _hideProfiles(projectId) {
  const el = document.getElementById(`profiles-${projectId}`);
  if (el) el.style.display = 'none';
  delete _editingProfiles[projectId];
}

function _renderProfilesList(projectId) {
  const el = document.getElementById(`profiles-list-${projectId}`);
  const profiles = _editingProfiles[projectId] || [];
  el.innerHTML = profiles.map((pr, i) => `
    <div class="profile-card ${_profileEditing === i ? 'profile-editing' : ''}">
      <div class="profile-card-header">
        <span class="profile-card-name">${escHtml(pr.name)}</span>
        <span class="profile-card-dir">${escHtml(pr.failures_dir)}</span>
        <div class="profile-card-actions">
          <button class="btn btn-sm" onclick="_editProfile('${projectId}', ${i})">${_profileEditing === i ? 'Close' : 'Edit'}</button>
          <button class="btn btn-sm btn-danger-text" onclick="_removeProfile('${projectId}', ${i})">Remove</button>
        </div>
      </div>
      ${_profileEditing === i ? _renderProfileEditor(projectId, i, pr) : ''}
    </div>
  `).join('');
}

let _profileEditing = -1;

function _renderProfileEditor(projectId, index, pr) {
  const gp = pr.golden_patterns || [];
  return `
    <div class="profile-editor">
      <div class="profile-editor-row">
        <label>Name</label>
        <input class="input input-sm" value="${escAttr(pr.name)}" onchange="_editingProfiles['${projectId}'][${index}].name=this.value">
      </div>
      <div class="profile-editor-row">
        <label>Failures dir</label>
        <input class="input input-sm" value="${escAttr(pr.failures_dir)}" onchange="_editingProfiles['${projectId}'][${index}].failures_dir=this.value">
      </div>
      <div class="profile-editor-row">
        <label>Delta prefix</label>
        <input class="input input-sm" value="${escAttr(pr.delta_prefix || 'delta-')}" style="width:100px" onchange="_editingProfiles['${projectId}'][${index}].delta_prefix=this.value">
        <label>Delta suffix</label>
        <input class="input input-sm" value="${escAttr(pr.delta_suffix || '')}" style="width:100px" onchange="_editingProfiles['${projectId}'][${index}].delta_suffix=this.value">
        <label>Actual suffix</label>
        <input class="input input-sm" value="${escAttr(pr.actual_suffix || '')}" style="width:100px" onchange="_editingProfiles['${projectId}'][${index}].actual_suffix=this.value">
      </div>
      <div class="profile-editor-row">
        <label>Golden patterns (one per line, use {name})</label>
        <textarea class="input input-sm" rows="${Math.max(2, gp.length)}" onchange="_editingProfiles['${projectId}'][${index}].golden_patterns=this.value.split('\\n').filter(Boolean)">${escHtml(gp.join('\n'))}</textarea>
      </div>
    </div>
  `;
}

function _editProfile(projectId, index) {
  _profileEditing = _profileEditing === index ? -1 : index;
  _renderProfilesList(projectId);
}

function _removeProfile(projectId, index) {
  _editingProfiles[projectId].splice(index, 1);
  _profileEditing = -1;
  _renderProfilesList(projectId);
}

async function _addProfileFromTemplate(projectId) {
  const tmps = await apiGet('/api/templates');
  const existing = (_editingProfiles[projectId] || []).map(p => p.template_id);
  // Show templates not already added
  const available = tmps.filter(t => !existing.includes(t.id));
  if (!available.length) {
    showToast('All templates already added', 'info');
    return;
  }
  // Add first available as a quick action, or show picker
  const pick = prompt('Add template:\\n' + available.map((t, i) => `${i + 1}. ${t.name} (${t.tool})`).join('\\n') + '\\n\\nEnter number:');
  if (!pick) return;
  const idx = parseInt(pick) - 1;
  if (idx >= 0 && idx < available.length) {
    const t = available[idx];
    _editingProfiles[projectId].push({
      name: t.name,
      failures_dir: t.failures_dir,
      golden_dir: t.golden_dir || '',
      golden_patterns: t.golden_patterns || [],
      delta_prefix: t.delta_prefix || 'delta-',
      delta_suffix: t.delta_suffix || '',
      actual_suffix: t.actual_suffix || '',
      template_id: t.id,
    });
    _renderProfilesList(projectId);
  }
}

function _addCustomProfile(projectId) {
  _editingProfiles[projectId] = _editingProfiles[projectId] || [];
  _editingProfiles[projectId].push({
    name: '', failures_dir: '', golden_patterns: [],
    delta_prefix: 'delta-', delta_suffix: '', actual_suffix: '',
  });
  _profileEditing = _editingProfiles[projectId].length - 1;
  _renderProfilesList(projectId);
}

async function _saveProfiles(projectId) {
  const profiles = _editingProfiles[projectId].filter(p => p.name && p.failures_dir);
  await apiPut(`/api/projects/${projectId}/profiles`, { profiles });
  _profileEditing = -1;
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

async function _showAddProject() {
  document.getElementById('add-project-form').style.display = 'block';
  const sel = document.getElementById('template-selector');
  const tmps = await apiGet('/api/templates');
  sel.innerHTML = tmps.map(t => `
    <label class="template-card">
      <input type="checkbox" value="${escAttr(t.id)}" ${t.id === 'paparazzi' ? 'checked' : ''}>
      <div class="template-info">
        <span class="template-name">${escHtml(t.name)}</span>
        <span class="template-tool">${escHtml(t.tool)}</span>
        <span class="template-desc">${escHtml(t.description)}</span>
      </div>
    </label>
  `).join('');
}

function _hideAddProject() {
  document.getElementById('add-project-form').style.display = 'none';
}

async function _addProject() {
  const name = document.getElementById('project-name').value.trim();
  const path = document.getElementById('project-path').value.trim();
  if (!path) return;
  const checkboxes = document.querySelectorAll('#template-selector input:checked');
  const template_ids = Array.from(checkboxes).map(cb => cb.value);
  await apiPost('/api/projects', { name: name || undefined, path, template_ids: template_ids.length ? template_ids : undefined });
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

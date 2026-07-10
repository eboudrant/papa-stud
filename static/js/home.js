// @ts-check

async function showHome() {
  const content = document.getElementById('content');
  content.innerHTML = `
    <div class="home">
      <div id="update-banner" style="display:none"></div>
      <section class="section" id="scans-section" style="display:none">
        <h2>Scans</h2>
        <div id="scans-list" class="card-list"></div>
      </section>
      <section class="section">
        <div class="section-header">
          <h2>Projects</h2>
          <button class="btn" onclick="_showAddProject()">Add Project</button>
        </div>
        <div id="add-project-form" class="add-form" style="display:none">
          <div class="add-form-row">
            <input type="text" id="project-name" placeholder="Project name (optional)" class="input">
            <input type="text" id="project-path" placeholder="/path/to/project" class="input input-wide">
          </div>
          <div class="add-form-row">
            <select id="project-strategy" class="input" onchange="_onStrategyChange()">
              <option value="gradle">Gradle (Paparazzi / Roborazzi / Compose Screenshot)</option>
              <option value="swift-snapshot">swift-snapshot-testing (iOS / Xcode)</option>
            </select>
            <input type="text" id="project-xcresult-path" placeholder="Optional: path to .xcresult (auto-detect if empty)" class="input input-wide" style="display:none">
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
  // Scans only make sense once a project exists — keep the section hidden
  // until then so a fresh install reads as "add a project" without noise.
  const scansSection = document.getElementById('scans-section');
  if (scansSection) scansSection.style.display = projectsList.length > 0 ? '' : 'none';
  _renderScans(scansList);
  _checkForUpdateOnce();
}

// Homebrew 6.0+ (June 2026) requires third-party taps to be trusted before it
// will load their casks; `brew trust` is idempotent and a no-op once trusted,
// so chaining it keeps the copy-paste command working across upgrades.
const UPDATE_CMD = 'brew trust eboudrant/tap && brew upgrade --cask papastudio';
const UPDATE_DISMISSED_KEY = 'papastud_update_dismissed';
let _updateChecked = false;

async function _checkForUpdateOnce() {
  if (_updateChecked) return;
  _updateChecked = true;
  const info = await apiGet('/api/update-check').catch(() => ({ available: false }));
  _renderUpdateBanner(info);
}

function _renderUpdateBanner(info) {
  const el = document.getElementById('update-banner');
  if (!el || !info || !info.available) return;
  if (localStorage.getItem(UPDATE_DISMISSED_KEY) === info.latest) return;
  el.style.display = '';
  el.className = 'update-banner';
  el.innerHTML = `
    <span class="update-dot"></span>
    <span class="update-text">New version available: <strong>v${escHtml(info.latest)}</strong> (you have v${escHtml(info.current)}). Run <code>${UPDATE_CMD}</code><button class="update-copy" title="Copy command" onclick="copyToClipboard('${UPDATE_CMD}', 'Command copied')" aria-label="Copy command">
      <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="4" y="3" width="9" height="11" rx="1.5"/><path d="M3 11V3a1 1 0 0 1 1-1h7"/></svg>
    </button></span>
    <a href="${escAttr(info.url)}" target="_blank" rel="noopener" class="update-link">Release notes</a>
    <button class="update-dismiss" title="Dismiss" onclick="_dismissUpdate('${escAttr(info.latest)}')">&times;</button>
  `;
}

function _dismissUpdate(latest) {
  localStorage.setItem(UPDATE_DISMISSED_KEY, latest);
  const el = document.getElementById('update-banner');
  if (el) el.style.display = 'none';
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
      <div class="card-actions" id="actions-${p.id}">${_projectActionsHtml(p.id)}</div>
    </div>
    <div class="url-form" id="url-form-${p.id}" style="display:none">
      <div class="add-form-row">
        <input type="url" id="url-input-${p.id}" placeholder="https://ci.example.com/.../?tarball=1" class="input input-wide">
        <button class="btn btn-sm btn-primary" onclick="_scanFromUrl('${escAttr(p.id)}')">Download &amp; Scan</button>
        <button class="btn btn-sm" onclick="_hideScanFromUrl('${escAttr(p.id)}')">Cancel</button>
      </div>
      <div class="url-form-hint">Downloads the tarball and overlays its <code>build/</code> outputs onto this project, then scans against your local goldens.</div>
      <div class="url-form-or">or upload archive files</div>
      <div class="add-form-row">
        <input type="file" id="file-input-${p.id}" class="input input-wide" multiple accept=".zip,.tar,.gz,.tgz">
        <button class="btn btn-sm btn-primary" onclick="_scanFromFiles('${escAttr(p.id)}')">Upload &amp; Scan</button>
      </div>
      <div class="url-form-hint">Select one or more <code>.zip</code> / <code>.tar</code> / <code>.tar.gz</code> archives. They're merged and overlaid onto this project. If two archives contain the same file with different content, the scan is aborted and the conflicts are listed.</div>
    </div>
    <div class="profiles-form" id="profiles-${p.id}" style="display:none">
      <div class="profiles-list" id="profiles-list-${p.id}"></div>
      <div class="profiles-actions">
        <button class="btn btn-sm" onclick="_addProfileFromTemplate('${escAttr(p.id)}')">Add from Template</button>
        <button class="btn btn-sm" onclick="_addCustomProfile('${escAttr(p.id)}')">Add Custom</button>
        <button class="btn btn-sm btn-primary" onclick="_saveProfiles('${escAttr(p.id)}')">Save</button>
        <button class="btn btn-sm" onclick="_hideProfiles('${escAttr(p.id)}')">Cancel</button>
      </div>
    </div>`;
  }).join('');
}

function _renderScans(scansList) {
  const el = document.getElementById('scans-list');
  if (!scansList.length) {
    el.innerHTML = '<div class="empty-state">No scans yet. Add a project and scan it to find failures.</div>';
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
          <button class="btn btn-sm btn-danger-text" onclick="_deleteScan('${escAttr(s.id)}')">Delete</button>
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
        ${t.beta ? '<span class="template-badge template-badge-beta">beta</span>' : ''}
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
  try {
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
  } catch (err) {
    showToast(err.message || 'Failed to save template', 'error');
    return;
  }
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
  try {
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
  } catch (err) {
    showToast(err.message || 'Failed to save template', 'error');
    return;
  }
  document.getElementById('create-template-form').style.display = 'none';
  await _loadHome();
}

async function _deleteTemplate(id) {
  if (!confirm('Delete this template?')) return;
  await apiDelete(`/api/templates/${id}`);
  await _loadHome();
}

// --- Profile management ---

let _editingProfiles = {}; // projectId -> profiles array being edited
let _templateCache = null; // cached templates for profile editor

async function _showProfiles(projectId) {
  const el = document.getElementById(`profiles-${projectId}`);
  if (!el) return;
  el.style.display = 'block';
  const [projects, templates] = await Promise.all([
    apiGet('/api/projects'),
    apiGet('/api/templates'),
  ]);
  _templateCache = templates;
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
  el.innerHTML = profiles.map((pr, i) => {
    const tmpl = _getTemplateForProfile(pr);
    const hasOverride = tmpl && _profileEditing === i && ['failures_dir', 'delta_prefix', 'delta_suffix', 'actual_suffix', 'golden_patterns']
      .some(f => _isFieldModified(pr, tmpl, f, f === 'delta_prefix' ? 'delta-' : ''));
    return `
    <div class="profile-card ${_profileEditing === i ? 'profile-editing' : ''}">
      <div class="profile-card-header">
        <span class="profile-card-name">${escHtml(pr.name)}</span>
        <span class="profile-card-dir">${escHtml(pr.failures_dir)}</span>
        <div class="profile-card-actions">
          ${hasOverride ? `<button class="btn btn-sm btn-reset-all" onclick="_resetProfileToDefaults('${projectId}', ${i})">Reset to Defaults</button>` : ''}
          <button class="btn btn-sm" onclick="_editProfile('${projectId}', ${i})">${_profileEditing === i ? 'Close' : 'Edit'}</button>
          <button class="btn btn-sm btn-danger-text" onclick="_removeProfile('${projectId}', ${i})">Remove</button>
        </div>
      </div>
      ${_profileEditing === i ? _renderProfileEditor(projectId, i, pr) : ''}
    </div>`;
  }).join('');
}

let _profileEditing = -1;

function _getTemplateForProfile(pr) {
  if (!pr.template_id || !_templateCache) return null;
  return _templateCache.find(t => t.id === pr.template_id) || null;
}

function _isFieldModified(pr, tmpl, field, defaultVal) {
  if (!tmpl) return false;
  const current = field === 'golden_patterns'
    ? (pr.golden_patterns || []).join('\n')
    : (pr[field] ?? defaultVal);
  const original = field === 'golden_patterns'
    ? (tmpl.golden_patterns || []).join('\n')
    : (tmpl[field] ?? defaultVal);
  return current !== original;
}

function _resetProfileField(projectId, index, field) {
  const pr = _editingProfiles[projectId][index];
  const tmpl = _getTemplateForProfile(pr);
  if (!tmpl) return;
  if (field === 'golden_patterns') {
    pr.golden_patterns = [...(tmpl.golden_patterns || [])];
  } else {
    pr[field] = tmpl[field];
  }
  _renderProfilesList(projectId);
}

function _resetProfileToDefaults(projectId, index) {
  const pr = _editingProfiles[projectId][index];
  const tmpl = _getTemplateForProfile(pr);
  if (!tmpl) return;
  pr.failures_dir = tmpl.failures_dir;
  pr.golden_patterns = [...(tmpl.golden_patterns || [])];
  pr.delta_prefix = tmpl.delta_prefix;
  pr.delta_suffix = tmpl.delta_suffix;
  pr.actual_suffix = tmpl.actual_suffix;
  _renderProfilesList(projectId);
}

function _renderProfileEditor(projectId, index, pr) {
  const gp = pr.golden_patterns || [];
  const tmpl = _getTemplateForProfile(pr);

  function fieldRow(label, field, value, defaultVal, attrs) {
    const modified = _isFieldModified(pr, tmpl, field, defaultVal);
    const resetBtn = modified
      ? `<button class="btn-reset" onclick="_resetProfileField('${projectId}', ${index}, '${field}')" title="Reset to template default">&circlearrowleft;</button>`
      : '';
    const fid = `pf-${projectId}-${index}-${field}`;
    return `
      <div class="profile-editor-row ${modified ? 'profile-field-modified' : ''}" id="${fid}-row">
        <label>${label}</label>
        <span class="input-reset-wrap" id="${fid}-wrap">
          <input class="input input-sm ${modified ? 'input-has-reset' : ''}" value="${escAttr(value)}" ${attrs || ''} oninput="_onProfileInput('${projectId}', ${index}, '${field}', this.value, '${escAttr(defaultVal)}')">
          ${resetBtn}
        </span>
      </div>`;
  }

  const gpModified = _isFieldModified(pr, tmpl, 'golden_patterns', '');
  const gpResetBtn = gpModified
    ? `<button class="btn-reset" onclick="_resetProfileField('${projectId}', ${index}, 'golden_patterns')" title="Reset to template default">&circlearrowleft;</button>`
    : '';
  const gpFid = `pf-${projectId}-${index}-golden_patterns`;

  return `
    <div class="profile-editor">
      <div class="profile-editor-row">
        <label>Name</label>
        <input class="input input-sm" value="${escAttr(pr.name)}" oninput="_editingProfiles['${projectId}'][${index}].name=this.value">
      </div>
      ${fieldRow('Failures dir', 'failures_dir', pr.failures_dir, '')}
      <div class="profile-editor-row">
        ${_inlineField(projectId, index, pr, tmpl, 'Delta prefix', 'delta_prefix', pr.delta_prefix !== undefined ? pr.delta_prefix : 'delta-', 'delta-', 'style="width:100px"')}
        ${_inlineField(projectId, index, pr, tmpl, 'Delta suffix', 'delta_suffix', pr.delta_suffix || '', '', 'style="width:100px"')}
        ${_inlineField(projectId, index, pr, tmpl, 'Actual suffix', 'actual_suffix', pr.actual_suffix || '', '', 'style="width:100px"')}
      </div>
      <div class="profile-editor-row ${gpModified ? 'profile-field-modified' : ''}" id="${gpFid}-row">
        <label>Golden patterns (one per line, use {name})</label>
        <span class="input-reset-wrap" id="${gpFid}-wrap">
          <textarea class="input input-sm ${gpModified ? 'input-has-reset' : ''}" rows="${Math.max(2, gp.length)}" oninput="_onProfileInput('${projectId}', ${index}, 'golden_patterns', this.value, '')">${escHtml(gp.join('\n'))}</textarea>
          ${gpResetBtn}
        </span>
      </div>
    </div>
  `;
}

function _inlineField(projectId, index, pr, tmpl, label, field, value, defaultVal, attrs) {
  const modified = _isFieldModified(pr, tmpl, field, defaultVal);
  const resetBtn = modified
    ? `<button class="btn-reset" onclick="_resetProfileField('${projectId}', ${index}, '${field}')" title="Reset to template default">&circlearrowleft;</button>`
    : '';
  const fid = `pf-${projectId}-${index}-${field}`;
  return `
    <label>${label}</label>
    <span class="input-reset-wrap input-reset-wrap-inline" id="${fid}-wrap">
      <input class="input input-sm ${modified ? 'input-has-reset' : ''}" value="${escAttr(value)}" ${attrs || ''} oninput="_onProfileInput('${projectId}', ${index}, '${field}', this.value, '${escAttr(defaultVal)}')">
      ${resetBtn}
    </span>`;
}

function _onProfileInput(projectId, index, field, value, defaultVal) {
  const pr = _editingProfiles[projectId][index];
  if (field === 'golden_patterns') {
    pr.golden_patterns = value.split('\n').filter(Boolean);
  } else {
    pr[field] = value;
  }
  // Update reset button visibility without re-rendering (preserves focus)
  const tmpl = _getTemplateForProfile(pr);
  const modified = _isFieldModified(pr, tmpl, field, defaultVal);
  const fid = `pf-${projectId}-${index}-${field}`;
  const wrap = document.getElementById(`${fid}-wrap`);
  const row = document.getElementById(`${fid}-row`);
  if (!wrap) return;
  const input = wrap.querySelector('input, textarea');
  const existing = wrap.querySelector('.btn-reset');
  if (modified && !existing) {
    const btn = document.createElement('button');
    btn.className = 'btn-reset';
    btn.title = 'Reset to template default';
    btn.innerHTML = '&circlearrowleft;';
    btn.onclick = () => _resetProfileField(projectId, index, field);
    wrap.appendChild(btn);
    if (input) input.classList.add('input-has-reset');
    if (row) row.classList.add('profile-field-modified');
  } else if (!modified && existing) {
    existing.remove();
    if (input) input.classList.remove('input-has-reset');
    if (row) row.classList.remove('profile-field-modified');
  }
  // Update "Reset to Defaults" button in header
  _updateResetAllButton(projectId, index);
}

function _updateResetAllButton(projectId, index) {
  const pr = _editingProfiles[projectId][index];
  const tmpl = _getTemplateForProfile(pr);
  const hasOverride = tmpl && ['failures_dir', 'delta_prefix', 'delta_suffix', 'actual_suffix', 'golden_patterns']
    .some(f => _isFieldModified(pr, tmpl, f, f === 'delta_prefix' ? 'delta-' : ''));
  const actions = document.querySelector(`#profiles-list-${projectId} .profile-editing .profile-card-actions`);
  if (!actions) return;
  const existing = actions.querySelector('.btn-reset-all');
  if (hasOverride && !existing) {
    const btn = document.createElement('button');
    btn.className = 'btn btn-sm btn-reset-all';
    btn.textContent = 'Reset to Defaults';
    btn.onclick = () => _resetProfileToDefaults(projectId, index);
    actions.insertBefore(btn, actions.firstChild);
  } else if (!hasOverride && existing) {
    existing.remove();
  }
  // Update header subtitle
  const header = actions.closest('.profile-card-header');
  if (header) {
    const dir = header.querySelector('.profile-card-dir');
    if (dir) dir.textContent = pr.failures_dir;
  }
}

function _editProfile(projectId, index) {
  _profileEditing = _profileEditing === index ? -1 : index;
  _renderProfilesList(projectId);
}

function _removeProfile(projectId, index) {
  if (!confirm('Remove this profile?')) return;
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
  const pick = prompt('Add template:\n' + available.map((t, i) => `${i + 1}. ${t.name} (${t.tool})`).join('\n') + '\n\nEnter number:');
  if (!pick) return;
  const idx = parseInt(pick) - 1;
  if (idx >= 0 && idx < available.length) {
    const t = available[idx];
    _editingProfiles[projectId].push({
      name: t.name,
      failures_dir: t.failures_dir,
      golden_dir: t.golden_dir || '',
      golden_patterns: t.golden_patterns || [],
      delta_prefix: t.delta_prefix !== undefined ? t.delta_prefix : 'delta-',
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
  document.getElementById('project-strategy').value = 'gradle';
  document.getElementById('project-xcresult-path').value = '';
  document.getElementById('project-xcresult-path').style.display = 'none';
  const tmps = await apiGet('/api/templates');
  _addProjectTemplates = tmps;
  _renderTemplateSelector('gradle');
}

let _addProjectTemplates = [];

function _renderTemplateSelector(strategy) {
  const sel = document.getElementById('template-selector');
  const filtered = _addProjectTemplates.filter(t => {
    if (strategy === 'swift-snapshot') return t.tool === 'swift-snapshot';
    return t.tool !== 'swift-snapshot';
  });
  const defaultId = strategy === 'swift-snapshot' ? 'swift-snapshot' : 'paparazzi';
  sel.innerHTML = filtered.map(t => `
    <label class="template-card">
      <input type="checkbox" value="${escAttr(t.id)}" ${t.id === defaultId ? 'checked' : ''}>
      <div class="template-info">
        <span class="template-name">${escHtml(t.name)}${t.beta ? ' <span class="template-badge template-badge-beta">beta</span>' : ''}</span>
        <span class="template-tool">${escHtml(t.tool)}</span>
        <span class="template-desc">${escHtml(t.description)}</span>
      </div>
    </label>
  `).join('');
}

function _onStrategyChange() {
  const strategy = document.getElementById('project-strategy').value;
  document.getElementById('project-xcresult-path').style.display = strategy === 'swift-snapshot' ? '' : 'none';
  _renderTemplateSelector(strategy);
}

function _hideAddProject() {
  document.getElementById('add-project-form').style.display = 'none';
}

async function _addProject() {
  const name = document.getElementById('project-name').value.trim();
  const path = document.getElementById('project-path').value.trim();
  const strategy = document.getElementById('project-strategy').value;
  const xcresultPath = document.getElementById('project-xcresult-path').value.trim();
  if (!path) return;
  const checkboxes = document.querySelectorAll('#template-selector input:checked');
  const template_ids = Array.from(checkboxes).map(cb => cb.value);
  try {
    await apiPost('/api/projects', {
      name: name || undefined,
      path,
      strategy,
      xcresult_path: xcresultPath || undefined,
      template_ids: template_ids.length ? template_ids : undefined,
    });
  } catch (err) {
    showToast(err.message || 'Failed to add project', 'error');
    return;
  }
  _hideAddProject();
  await _loadHome();
}

async function _deleteProject(id) {
  if (!confirm('Remove this project?')) return;
  await apiDelete(`/api/projects/${id}`);
  await _loadHome();
}

async function _deleteScan(id) {
  if (!confirm('Delete this scan?')) return;
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
    try {
      const job = await apiGet(`/api/scan-jobs/${jobId}`);
      if (!job) {
        _stopPolling(jobId);
        _restoreScanButton(projectId);
        return;
      }

      const fill = document.getElementById(`fill-${jobId}`);
      const text = document.getElementById(`text-${jobId}`);

      const FETCH_LABELS = { downloading: 'Downloading tarball...', extracting: 'Extracting build outputs...' };
      if (FETCH_LABELS[job.status]) {
        if (fill) { fill.classList.add('progress-pulse'); fill.style.width = '100%'; }
        if (text) text.textContent = FETCH_LABELS[job.status];
      } else if (job.status === 'needs_confirmation') {
        _stopPolling(jobId);
        _handleCompatConfirm(jobId, projectId, job.compat, text);
      } else if (job.status === 'discovering') {
        if (fill) fill.classList.add('progress-pulse');
        if (text) text.textContent = `Discovering ${job.currentModule}...`;
      } else if (job.status === 'scanning') {
        if (fill) fill.classList.remove('progress-pulse');
        const pct = job.totalModules > 0 ? Math.round((job.scannedModules / job.totalModules) * 100) : 0;
        if (fill) fill.style.width = pct + '%';
        if (text) text.textContent = `${job.currentModule} (${job.scannedModules}/${job.totalModules})`;
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
        if (job.conflicts && job.conflicts.length) {
          _showConflictDialog(job.conflicts);
        } else {
          showToast(`Scan failed: ${job.error || 'unknown error'}`, 'error');
        }
        _restoreScanButton(projectId);
      }
    } catch (e) {
      // apiGet throws on any non-2xx (e.g. job TTL expiry -> 404), so
      // without this the interval would reject unhandled forever.
      _stopPolling(jobId);
      _restoreScanButton(projectId);
      console.error('[scan-poll] stopped:', e);
      return;
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

// --- Scan from URL ---

function _showScanFromUrl(projectId) {
  const form = document.getElementById(`url-form-${projectId}`);
  if (form) form.style.display = 'block';
  const input = document.getElementById(`url-input-${projectId}`);
  if (input) input.focus();
}

function _hideScanFromUrl(projectId) {
  const form = document.getElementById(`url-form-${projectId}`);
  if (form) form.style.display = 'none';
}

async function _scanFromUrl(projectId) {
  const input = document.getElementById(`url-input-${projectId}`);
  const url = (input && input.value || '').trim();
  if (!url) return;
  _hideScanFromUrl(projectId);

  let resp;
  try {
    resp = await apiPost(`/api/projects/${projectId}/scan-from-url`, { url });
  } catch (err) {
    showToast(err.message || 'Failed to start download', 'error');
    return;
  }
  const jobId = resp.jobId;

  const actionsEl = document.getElementById(`actions-${projectId}`);
  if (actionsEl) {
    actionsEl.innerHTML = `
      <div class="scan-progress">
        <div class="progress-bar-wrap">
          <div class="progress-fill progress-pulse" id="fill-${jobId}" style="width:100%"></div>
        </div>
        <span class="progress-text" id="text-${jobId}">Downloading tarball...</span>
        <button class="btn btn-sm btn-danger-text" onclick="_cancelScan('${jobId}', '${projectId}')">Cancel</button>
      </div>
    `;
  }

  _pollScanJob(jobId, projectId);
}

// Upload one or more local archives, merge them onto the project, then scan.
async function _scanFromFiles(projectId) {
  const input = document.getElementById(`file-input-${projectId}`);
  const files = input && input.files ? Array.from(input.files) : [];
  if (!files.length) return;
  _hideScanFromUrl(projectId);

  // Show an indeterminate upload progress (no cancel until the scan job exists).
  const actionsEl = document.getElementById(`actions-${projectId}`);
  const setProgress = (msg) => {
    if (!actionsEl) return;
    actionsEl.innerHTML = `
      <div class="scan-progress">
        <div class="progress-bar-wrap">
          <div class="progress-fill progress-pulse" style="width:100%"></div>
        </div>
        <span class="progress-text">${escHtml(msg)}</span>
      </div>
    `;
  };

  const uploadIds = [];
  try {
    for (let i = 0; i < files.length; i++) {
      setProgress(`Uploading ${files.length > 1 ? `(${i + 1}/${files.length}) ` : ''}${files[i].name}...`);
      const res = await fetch(`/api/uploads?filename=${encodeURIComponent(files[i].name)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/octet-stream' },
        body: files[i],
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || `upload failed (HTTP ${res.status})`);
      }
      uploadIds.push((await res.json()).uploadId);
    }
  } catch (err) {
    showToast(err.message || 'Upload failed', 'error');
    _restoreScanButton(projectId);
    return;
  }

  let resp;
  try {
    resp = await apiPost(`/api/projects/${projectId}/scan-from-uploads`, { uploadIds });
  } catch (err) {
    showToast(err.message || 'Failed to start scan', 'error');
    _restoreScanButton(projectId);
    return;
  }
  const jobId = resp.jobId;

  if (actionsEl) {
    actionsEl.innerHTML = `
      <div class="scan-progress">
        <div class="progress-bar-wrap">
          <div class="progress-fill progress-pulse" id="fill-${jobId}" style="width:100%"></div>
        </div>
        <span class="progress-text" id="text-${jobId}">Extracting build outputs...</span>
        <button class="btn btn-sm btn-danger-text" onclick="_cancelScan('${jobId}', '${projectId}')">Cancel</button>
      </div>
    `;
  }

  _pollScanJob(jobId, projectId);
}

// Two or more uploaded archives contained the same file with differing content,
// so the merge was aborted. List the conflicts (truncated) for the user.
function _showConflictDialog(conflicts) {
  const sample = conflicts.slice(0, 8)
    .map(c => `  ${c.path}\n    (in ${(c.archives || []).join(', ')})`)
    .join('\n');
  const more = conflicts.length > 8 ? `\n  …and ${conflicts.length - 8} more` : '';
  window.alert(
    `Scan aborted: the selected archives disagree on ${conflicts.length} file` +
    `${conflicts.length === 1 ? '' : 's'}.\n\n` +
    `Same path, different content:\n${sample}${more}\n\n` +
    `Nothing was written to the project. Re-select archives from a single run, ` +
    `or remove the conflicting ones.`
  );
}

// The tarball's module layout didn't line up with the project. Ask the user
// whether to overlay it anyway, then resume (confirm) or abandon (cancel).
async function _handleCompatConfirm(jobId, projectId, compat, textEl) {
  const unmatched = (compat && compat.unmatched) || [];
  const sample = unmatched.slice(0, 8).map(m => m || '(project root)').join('\n  ');
  const more = unmatched.length > 8 ? `\n  …and ${unmatched.length - 8} more` : '';
  const msg =
    `None of the tarball's modules match this project's directory layout.\n\n` +
    `Modules in the tarball not found locally:\n  ${sample}${more}\n\n` +
    `Extract anyway? Build outputs will be written into the project directory.`;
  if (window.confirm(msg)) {
    if (textEl) textEl.textContent = 'Extracting build outputs...';
    try {
      await apiPost(`/api/scan-jobs/${jobId}/confirm`, {});
    } catch (err) {
      showToast(err.message || 'Failed to confirm', 'error');
      _restoreScanButton(projectId);
      return;
    }
    _pollScanJob(jobId, projectId);
  } else {
    await apiPost(`/api/scan-jobs/${jobId}/cancel`, {}).catch(() => {});
    showToast('Scan from URL cancelled.', 'info');
    _restoreScanButton(projectId);
  }
}

// Project card action buttons. Shared by the initial render and the post-scan
// restore so the button set (and the Scan-from-URL icon) can't drift.
function _projectActionsHtml(projectId) {
  const id = escAttr(projectId);
  return `
      <button class="btn btn-sm" onclick="_showProfiles('${id}')">Profiles</button>
      <button class="btn btn-primary" onclick="_scanProject('${id}')">Scan</button>
      <button class="btn btn-icon" title="Scan from URL (download a CI result tarball)" onclick="_showScanFromUrl('${id}')"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg></button>
      <button class="btn btn-danger-text" onclick="_deleteProject('${id}')">Remove</button>
    `;
}

function _restoreScanButton(projectId) {
  const actionsEl = document.getElementById(`actions-${projectId}`);
  if (actionsEl) actionsEl.innerHTML = _projectActionsHtml(projectId);
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

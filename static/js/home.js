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
  el.innerHTML = projectsList.map(p => `
    <div class="card">
      <div class="card-body">
        <div class="card-title">${_esc(p.name)}</div>
        <div class="card-subtitle">${_esc(p.path)}</div>
      </div>
      <div class="card-actions">
        <button class="btn btn-primary" onclick="_scanProject('${p.id}', this)">Scan</button>
        <button class="btn btn-danger-text" onclick="_deleteProject('${p.id}')">Remove</button>
      </div>
    </div>
  `).join('');
}

function _renderScans(scansList) {
  const el = document.getElementById('scans-list');
  if (!scansList.length) {
    el.innerHTML = '<div class="empty-state">No scans yet. Scan a project to find failures.</div>';
    return;
  }
  el.innerHTML = scansList.map(s => {
    return `
      <a class="card card-link" href="#/scans/${s.id}">
        <div class="card-body">
          <div class="card-title">${_esc(s.projectName)} <span class="card-date">${_formatDate(s.created)}</span></div>
          <div class="card-subtitle">${s.stats.total} failures across ${s.modules.length} module(s)</div>
        </div>
      </a>
    `;
  }).join('');
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

async function _scanProject(id, btn) {
  btn.disabled = true;
  btn.textContent = 'Scanning...';
  const scan = await apiPost(`/api/projects/${id}/scan`, {});
  if (scan && scan.stats.total > 0) {
    navigate(`/scans/${scan.id}`);
  } else {
    btn.disabled = false;
    btn.textContent = 'Scan';
    await _loadHome();
    if (scan && scan.stats.total === 0) {
      alert('No current failures found.');
    }
  }
}

function _esc(str) {
  const d = document.createElement('div');
  d.textContent = str || '';
  return d.innerHTML;
}

function _formatDate(iso) {
  const d = new Date(iso);
  return d.toLocaleDateString() + ' ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

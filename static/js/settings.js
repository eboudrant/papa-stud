// @ts-check

async function showSettings() {
  setNavContext({});
  const content = document.getElementById('content');
  content.innerHTML = `
    <div class="settings">
      <h2>Settings</h2>

      <section class="settings-section">
        <h3>Appearance</h3>
        <div class="settings-row">
          <div class="theme-picker" id="theme-picker"></div>
        </div>
      </section>

      <section class="settings-section">
        <h3>Data Location</h3>
        <p class="settings-hint">Configuration and scan data are stored here.</p>
        <div class="settings-info" id="settings-info">Loading...</div>
      </section>

      <section class="settings-section">
        <h3>Export</h3>
        <p class="settings-hint">Download your configuration to back up or transfer to another machine.</p>
        <div class="settings-row">
          <button class="btn btn-primary" onclick="_exportAll()">Export All Config</button>
        </div>
        <div id="export-individual" class="settings-individual"></div>
      </section>

      <section class="settings-section">
        <h3>Import</h3>
        <p class="settings-hint">Restore configuration from a previously exported file. Existing items with matching IDs will be updated; new items will be added.</p>
        <div class="settings-row">
          <button class="btn" onclick="_triggerImport()">Import Config File</button>
          <input type="file" id="import-file" accept=".json" style="display:none" onchange="_handleImport(this)">
        </div>
      </section>

      <section class="settings-section settings-danger">
        <h3>Danger Zone</h3>
        <div class="settings-row">
          <button class="btn btn-danger-text" onclick="_resetAllConfig()">Reset All Config</button>
          <span class="settings-hint">Removes all projects and custom templates. Built-in templates are not affected.</span>
        </div>
      </section>
    </div>
  `;
  _renderThemePicker();
  await _loadSettingsInfo();
}

async function _loadSettingsInfo() {
  const [info, projects, customTemplates] = await Promise.all([
    apiGet('/api/config/info'),
    apiGet('/api/projects'),
    apiGet('/api/templates').then(ts => ts.filter(t => !t.builtin)),
  ]);

  const infoEl = document.getElementById('settings-info');
  infoEl.innerHTML = `
    <code>${escHtml(info.dataDir)}</code>
    <div class="settings-stats">
      ${info.projectCount} project(s), ${info.templateCount} custom template(s)
    </div>
  `;

  // Render individual export buttons
  const el = document.getElementById('export-individual');
  let html = '';
  if (projects.length) {
    html += '<div class="settings-group"><h4>Projects</h4>';
    html += projects.map(p => `
      <div class="settings-item">
        <span class="settings-item-name">${escHtml(p.name)}</span>
        <span class="settings-item-detail">${escHtml(p.path)}</span>
        <button class="btn btn-sm" onclick="_exportProject('${escAttr(p.id)}')">Export</button>
      </div>
    `).join('');
    html += '</div>';
  }
  if (customTemplates.length) {
    html += '<div class="settings-group"><h4>Custom Templates</h4>';
    html += customTemplates.map(t => `
      <div class="settings-item">
        <span class="settings-item-name">${escHtml(t.name)}</span>
        <span class="settings-item-detail">${escHtml(t.tool)}</span>
        <button class="btn btn-sm" onclick="_exportTemplate('${escAttr(t.id)}')">Export</button>
      </div>
    `).join('');
    html += '</div>';
  }
  el.innerHTML = html;
}

function _exportAll() {
  _downloadUrl('/api/config/export');
}

function _exportProject(id) {
  _downloadUrl(`/api/config/export/project/${id}`);
}

function _exportTemplate(id) {
  _downloadUrl(`/api/config/export/template/${id}`);
}

function _downloadUrl(url) {
  const a = document.createElement('a');
  a.href = url;
  a.download = '';
  document.body.appendChild(a);
  a.click();
  a.remove();
}

function _triggerImport() {
  document.getElementById('import-file').click();
}

async function _handleImport(input) {
  const file = input.files[0];
  if (!file) return;
  try {
    const text = await file.text();
    const data = JSON.parse(text);
    if (!data.version) {
      showToast('Invalid config file: missing version', 'error');
      return;
    }
    const result = await apiPost('/api/config/import', data);
    showToast(`Imported ${result.projects} project(s), ${result.templates} template(s)`, 'success');
    await _loadSettingsInfo();
  } catch (e) {
    showToast('Failed to import: ' + e.message, 'error');
  }
  input.value = '';
}

function _renderThemePicker() {
  const el = document.getElementById('theme-picker');
  if (!el) return;
  const current = localStorage.getItem('papastud_theme') || 'system';
  const options = [
    { value: 'system', label: 'System' },
    { value: 'light', label: 'Light' },
    { value: 'dark', label: 'Dark' },
  ];
  el.innerHTML = options.map(o => `
    <button class="theme-option ${current === o.value ? 'active' : ''}" onclick="_selectTheme('${o.value}')">${o.label}</button>
  `).join('');
}

function _selectTheme(value) {
  _setTheme(value);
  _renderThemePicker();
}

async function _resetAllConfig() {
  if (!confirm('This will remove all projects and custom templates. Are you sure?')) return;
  if (!confirm('This cannot be undone. Really reset?')) return;
  await apiPost('/api/config/reset', {});
  showToast('All config reset', 'success');
  await _loadSettingsInfo();
}

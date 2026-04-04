// @ts-check

/** @type {object|null} */
let _scanData = null;
let _currentPage = 0;
let _loading = false;
let _hasMore = true;
let _allFailures = [];
let _observer = null;
let _activeFilter = 'all';
let _activeModule = null;
let _searchQuery = '';

function showReview(scanId) {
  const content = document.getElementById('content');
  content.innerHTML = `
    <div class="review-layout">
      <aside class="sidebar" id="sidebar"></aside>
      <div class="review-main">
        <div class="review-toolbar">
          <input type="text" class="input search-input" placeholder="Search tests..." oninput="_onSearch(this.value)">
          <div class="toolbar-actions">
            <span id="review-counter" class="counter"></span>
          </div>
        </div>
        <div class="thumbnail-grid" id="thumbnail-grid"></div>
        <div id="scroll-sentinel" style="height:1px"></div>
      </div>
    </div>
  `;

  _scanData = null;
  _currentPage = 0;
  _loading = false;
  _hasMore = true;
  _allFailures = [];
  _activeFilter = 'all';
  _activeModule = null;
  _searchQuery = '';

  _loadReviewPage(scanId);

  // Infinite scroll
  const sentinel = document.getElementById('scroll-sentinel');
  _observer = new IntersectionObserver((entries) => {
    if (entries[0].isIntersecting && _hasMore && !_loading) {
      _loadMoreFailures(scanId);
    }
  });
  _observer.observe(sentinel);

  // Return cleanup
  return () => {
    if (_observer) _observer.disconnect();
  };
}

async function _loadReviewPage(scanId) {
  _loading = true;
  const params = new URLSearchParams({ page: '0', size: '50' });
  if (_activeFilter !== 'all') params.set('status', _activeFilter);
  if (_activeModule) params.set('module', _activeModule);
  if (_searchQuery) params.set('q', _searchQuery);

  _scanData = await apiGet(`/api/scans/${scanId}?${params}`);
  _currentPage = 0;
  _allFailures = _scanData.failures;
  _hasMore = _allFailures.length < _scanData.totalFiltered;

  _renderSidebar(_scanData);
  _renderGrid();
  _updateCounter();
  _loading = false;
}

async function _loadMoreFailures(scanId) {
  _loading = true;
  _currentPage++;
  const params = new URLSearchParams({ page: String(_currentPage), size: '50' });
  if (_activeFilter !== 'all') params.set('status', _activeFilter);
  if (_activeModule) params.set('module', _activeModule);
  if (_searchQuery) params.set('q', _searchQuery);

  const data = await apiGet(`/api/scans/${scanId}?${params}`);
  _scanData.stats = data.stats;
  _allFailures = _allFailures.concat(data.failures);
  _hasMore = _allFailures.length < data.totalFiltered;

  _appendGrid(data.failures);
  _updateCounter();
  _loading = false;
}

function _renderSidebar(data) {
  const sidebar = document.getElementById('sidebar');
  // Build tree: module > package > class
  const tree = {};
  // Use full scan stats, not just current page
  // We need to request all failures for tree building — use modules for now
  for (const mod of data.modules) {
    tree[mod.name] = { count: mod.failure_count || mod.failureCount, packages: {} };
  }
  // Build from current failures for package/class breakdown
  for (const f of _allFailures) {
    if (!tree[f.module]) tree[f.module] = { count: 0, packages: {} };
    const pkg = f.package || '(default)';
    if (!tree[f.module].packages[pkg]) tree[f.module].packages[pkg] = { count: 0, classes: {} };
    tree[f.module].packages[pkg].count++;
    const cls = f.class_name || '(unknown)';
    if (!tree[f.module].packages[pkg].classes[cls]) tree[f.module].packages[pkg].classes[cls] = 0;
    tree[f.module].packages[pkg].classes[cls]++;
  }

  let html = `<div class="sidebar-title">Modules</div>`;
  html += `<div class="tree-item ${!_activeModule ? 'active' : ''}" onclick="_filterModule(null)">All (${data.stats.total})</div>`;

  for (const [mod, mdata] of Object.entries(tree)) {
    html += `<div class="tree-item tree-module ${_activeModule === mod ? 'active' : ''}" onclick="_filterModule('${_escAttr(mod)}')">${_escHtml(mod)} (${mdata.count})</div>`;
    if (_activeModule === mod) {
      for (const [pkg, pdata] of Object.entries(mdata.packages)) {
        html += `<div class="tree-item tree-package">${_escHtml(pkg)} (${pdata.count})</div>`;
        for (const [cls, count] of Object.entries(pdata.classes)) {
          html += `<div class="tree-item tree-class">${_escHtml(cls)} (${count})</div>`;
        }
      }
    }
  }

  sidebar.innerHTML = html;
}

function _renderGrid() {
  const grid = document.getElementById('thumbnail-grid');
  grid.innerHTML = '';
  _appendGrid(_allFailures);
}

function _appendGrid(failures) {
  const grid = document.getElementById('thumbnail-grid');
  const scanId = _scanData.id;

  for (const f of failures) {
    const card = document.createElement('a');
    card.className = 'thumb-card';
    card.href = `#/scans/${scanId}/review/${encodeURIComponent(f.filename)}`;

    const imgSrc = f.delta_path ? `/api/images?path=${encodeURIComponent(f.delta_path)}` : '';
    card.innerHTML = `
      <div class="thumb-img-wrap">
        ${imgSrc ? `<img loading="lazy" src="${imgSrc}" alt="${_escAttr(f.filename)}" width="280" height="180">` : '<div class="thumb-placeholder">No delta</div>'}
      </div>
      <div class="thumb-info">
        <span class="thumb-name" title="${_escAttr(f.filename)}">${_escHtml(f.class_name || f.filename)}</span>
        <span class="thumb-method">${_escHtml(f.method || '')}</span>
      </div>
    `;
    grid.appendChild(card);
  }
}

function _updateCounter() {
  const el = document.getElementById('review-counter');
  if (!_scanData) return;
  el.textContent = `${_scanData.stats.total} failures`;
}

function _filterModule(mod) {
  _activeModule = mod;
  _resetAndReload();
}

let _searchTimeout = null;
function _onSearch(value) {
  clearTimeout(_searchTimeout);
  _searchTimeout = setTimeout(() => {
    _searchQuery = value.trim();
    _resetAndReload();
  }, 300);
}

function _resetAndReload() {
  _currentPage = 0;
  _allFailures = [];
  _hasMore = true;
  const scanId = _scanData?.id;
  if (scanId) _loadReviewPage(scanId);
}


function _escHtml(str) {
  const d = document.createElement('div');
  d.textContent = str || '';
  return d.innerHTML;
}

function _escAttr(str) {
  return (str || '').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

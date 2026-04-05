// @ts-check

/** @type {object|null} */
let _scanData = null;
let _currentPage = 0;
let _loading = false;
let _hasMore = true;
let _allFailures = [];
let _observer = null;
let _activeModule = null;
let _searchQuery = '';
let _watching = false;
let _watchPollTimer = null;
let _lastStatsJson = '';

function showReview(scanId) {
  const content = document.getElementById('content');
  content.innerHTML = `
    <div class="review-layout">
      <aside class="sidebar" id="sidebar"></aside>
      <div class="review-main">
        <div class="review-toolbar">
          <input type="text" class="input search-input" placeholder="Search tests..." oninput="_onSearch(this.value)">
          <div class="toolbar-actions">
            <button class="btn btn-sm watch-btn" id="watch-toggle" onclick="_toggleWatch('${scanId}')">Watch</button>
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

  // Check initial watch state
  _checkWatchState(scanId);

  // Return cleanup
  return () => {
    if (_observer) _observer.disconnect();
    _stopWatchPoll();
  };
}

async function _loadReviewPage(scanId) {
  _loading = true;
  const params = new URLSearchParams({ page: '0', size: '50' });

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
  const tree = {};
  const moduleSnapshots = {};
  for (const mod of data.modules) {
    tree[mod.name] = { count: mod.failure_count ?? mod.failureCount ?? 0, packages: {} };
    moduleSnapshots[mod.name] = mod.snapshot_count || 0;
  }
  for (const f of _allFailures) {
    if (!tree[f.module]) tree[f.module] = { count: 0, packages: {} };
    const pkg = f.package || '(default)';
    if (!tree[f.module].packages[pkg]) tree[f.module].packages[pkg] = { count: 0, classes: {} };
    tree[f.module].packages[pkg].count++;
    const cls = f.class_name || '(unknown)';
    if (!tree[f.module].packages[pkg].classes[cls]) tree[f.module].packages[pkg].classes[cls] = 0;
    tree[f.module].packages[pkg].classes[cls]++;
  }

  const abbrevMap = _buildAbbrevMap(Object.keys(tree));
  // Sort: modules with failures first, then alphabetical
  const sorted = Object.entries(tree).sort((a, b) => {
    if (a[1].count > 0 && b[1].count === 0) return -1;
    if (a[1].count === 0 && b[1].count > 0) return 1;
    return a[0].localeCompare(b[0]);
  });

  let html = `<div class="sidebar-title">Modules</div>`;
  html += `<div class="tree-item ${!_activeModule ? 'active' : ''}" onclick="_filterModule(null)">All (${data.stats.total})</div>`;

  for (const [mod, mdata] of sorted) {
    const countLabel = mdata.count > 0 ? `<span class="tree-count">(${mdata.count})</span>` : '';
    const failClass = mdata.count > 0 ? ' tree-failed' : '';
    const sc = moduleSnapshots[mod];
    html += `<div class="tree-item tree-module${failClass} ${_activeModule === mod ? 'active' : ''}" onclick="_filterModule('${escAttr(mod)}')" title="${escAttr(mod)}"><div class="tree-top"><span class="tree-name">${escHtml(abbrevMap[mod] || mod)}</span>${countLabel}</div>${snapshotBar(sc, mdata.count)}</div>`;
    if (_activeModule === mod) {
      for (const [pkg, pdata] of Object.entries(mdata.packages)) {
        html += `<div class="tree-item tree-package">${escHtml(pkg)} (${pdata.count})</div>`;
        for (const [cls, count] of Object.entries(pdata.classes)) {
          html += `<div class="tree-item tree-class">${escHtml(cls)} (${count})</div>`;
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
        ${imgSrc ? `<img loading="lazy" src="${imgSrc}" alt="${escAttr(f.filename)}" width="280" height="180">` : '<div class="thumb-placeholder">No delta</div>'}
      </div>
      <div class="thumb-info">
        <span class="thumb-name" title="${escAttr(f.filename)}">${escHtml(f.class_name || f.filename)}</span>
        <span class="thumb-method">${escHtml(f.method || '')}</span>
      </div>
    `;
    grid.appendChild(card);
  }
}

function _updateCounter() {
  const el = document.getElementById('review-counter');
  if (!_scanData) return;
  el.textContent = `${_scanData.stats.total} failures`;

  const grid = document.getElementById('thumbnail-grid');
  if (_allFailures.length === 0 && grid) {
    if (_activeModule) {
      const mod = _scanData.modules.find(m => m.name === _activeModule);
      const sc = mod?.snapshot_count || 0;
      const statsText = sc > 0 ? `${sc} snapshots passing` : '';
      grid.innerHTML = `<div class="empty-state">No failures in ${escHtml(_activeModule)}. ${statsText}</div>`;
    } else if (_scanData.stats.total === 0) {
      grid.innerHTML = '<div class="empty-state">No current failures. All screenshot tests are passing.</div>';
    }
  }
}

function _filterModule(mod) {
  _activeModule = mod;
  _resetAndReload();
}

function _buildAbbrevMap(moduleNames) {
  // Find common prefixes (2+ segments) shared by 3+ modules, abbreviate to initials
  // e.g. :libraries:starcourt: -> :l:s:
  const prefixCount = {};
  for (const name of moduleNames) {
    const parts = name.split(':').filter(Boolean);
    for (let len = 2; len < parts.length; len++) {
      const prefix = ':' + parts.slice(0, len).join(':') + ':';
      prefixCount[prefix] = (prefixCount[prefix] || 0) + 1;
    }
  }
  // Keep prefixes shared by 3+ modules, pick the longest matching per module
  const commonPrefixes = Object.entries(prefixCount)
    .filter(([, c]) => c >= 3)
    .map(([p]) => p)
    .sort((a, b) => b.length - a.length);

  const abbrevMap = {};
  for (const name of moduleNames) {
    let best = null;
    for (const prefix of commonPrefixes) {
      if (name.startsWith(prefix)) { best = prefix; break; }
    }
    if (best) {
      const abbrev = ':' + best.split(':').filter(Boolean).map(s => s[0]).join(':') + ':';
      abbrevMap[name] = abbrev + name.slice(best.length);
    }
  }
  return abbrevMap;
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

// --- Watch mode ---

async function _checkWatchState(scanId) {
  const resp = await apiGet(`/api/scans/${scanId}/watch`);
  _watching = resp?.watching || false;
  _updateWatchUI();
  if (_watching) _startWatchPoll(scanId);
}

async function _toggleWatch(scanId) {
  if (_watching) {
    await apiDelete(`/api/scans/${scanId}/watch`);
    _watching = false;
    _stopWatchPoll();
  } else {
    await apiPost(`/api/scans/${scanId}/watch`, {});
    _watching = true;
    _lastStatsJson = JSON.stringify(_scanData?.stats);
    _startWatchPoll(scanId);
  }
  _updateWatchUI();
}

function _updateWatchUI() {
  const btn = document.getElementById('watch-toggle');
  if (!btn) return;
  btn.textContent = _watching ? 'Watching' : 'Watch';
  btn.classList.toggle('watch-active', _watching);
}

function _startWatchPoll(scanId) {
  _stopWatchPoll();
  _lastStatsJson = JSON.stringify(_scanData?.stats);
  _watchPollTimer = setInterval(async () => {
    // Light check: only fetch stats via size=0 to detect changes
    const check = await apiGet(`/api/scans/${scanId}?page=0&size=0`);
    if (!check) return;
    const newStats = JSON.stringify(check.stats);
    if (newStats !== _lastStatsJson) {
      _lastStatsJson = newStats;
      // Stats changed — reload the current view
      _resetAndReload();
    }
  }, 2000);
}

function _stopWatchPoll() {
  if (_watchPollTimer) {
    clearInterval(_watchPollTimer);
    _watchPollTimer = null;
  }
}

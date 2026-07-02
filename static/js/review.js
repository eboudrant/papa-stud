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
let _activeProfile = null; // null = all profiles
let _activeSort = localStorage.getItem('papastud_sort') || null;
let _watching = false;
let _watchPollTimer = null;
let _lastStatsJson = '';
let _rescanPollTimer = null;

function showReview(scanId) {
  const content = document.getElementById('content');
  content.innerHTML = `
    <div class="review-layout">
      <aside class="sidebar" id="sidebar"></aside>
      <div class="review-main">
        <div class="review-toolbar">
          <div class="filter-pills" id="profile-pills"></div>
          <input type="text" class="input search-input" placeholder="Search tests..." oninput="_onSearch(this.value)">
          <select class="input input-sm" id="sort-select" onchange="_setSort(this.value)">
            <option value="">Sort: default</option>
            <option value="name">Sort: name</option>
            <option value="module">Sort: module</option>
            <option value="profile">Sort: profile</option>
            <option value="diff">Sort: % diff</option>
          </select>
          <div class="toolbar-actions">
            <button class="btn btn-sm btn-success" id="accept-all-btn" onclick="_acceptAll('${escAttr(scanId)}')" title="Copy every actual image over its golden (rejected are skipped)" style="display:none">&check; Accept All</button>
            <button class="btn btn-sm" id="export-video-btn" onclick="_exportVideo('${scanId}')">Export Video</button>
            <button class="btn btn-sm" onclick="_rescanFromReview('${escAttr(scanId)}')">Re-scan</button>
            <button class="btn btn-sm watch-btn" id="watch-toggle" onclick="_toggleWatch('${escAttr(scanId)}')" title="Re-scan modules automatically as test outputs change">Watch</button>
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
  _activeProfile = null;
  _activeSort = localStorage.getItem('papastud_sort') || null;
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

  const _keyHandler = (e) => {
    if (e.target.tagName === 'INPUT') return;
    if (e.key === 'Escape') navigate('/');
  };
  document.addEventListener('keydown', _keyHandler);

  // Return cleanup
  return () => {
    if (_observer) _observer.disconnect();
    _stopWatchPoll();
    if (_rescanPollTimer) { clearInterval(_rescanPollTimer); _rescanPollTimer = null; }
    clearTimeout(_searchTimeout);
    document.removeEventListener('keydown', _keyHandler);
  };
}

async function _loadReviewPage(scanId) {
  _loading = true;
  const params = new URLSearchParams({ page: '0', size: '50' });

  if (_activeModule) params.set('module', _activeModule);
  if (_activeProfile) params.set('profile', _activeProfile);
  if (_activeSort) params.set('sort', _activeSort);
  if (_searchQuery) params.set('q', _searchQuery);

  try {
    _scanData = await apiGet(`/api/scans/${scanId}?${params}`);
    setNavContext({ projectName: _scanData.projectName });
    _currentPage = 0;
    _allFailures = _scanData.failures;
    _hasMore = _allFailures.length < _scanData.totalFiltered;

    _renderProfilePills(_scanData);
    const sortEl = document.getElementById('sort-select');
    if (sortEl && _activeSort) sortEl.value = _activeSort;
    _renderSidebar(_scanData);
    _renderGrid();
    _updateCounter();
  } catch (err) {
    // Without this catch the UI would silently half-render: the toolbar
    // and nav stay (rendered synchronously in showReview), but the sidebar
    // and grid never populate and no error reaches the user. Common
    // triggers: scan deleted/replaced under us (404 from a stale link),
    // server crash mid-write, or a renderer throwing on a malformed row.
    _renderReviewError(scanId, err);
  } finally {
    _loading = false;
  }
}

function _renderReviewError(scanId, err) {
  const msg = (err && err.message) || String(err);
  const grid = document.getElementById('thumbnail-grid');
  if (grid) {
    grid.innerHTML = `
      <div class="empty-state">
        <div>Couldn't load this scan.</div>
        <div class="error-detail">${escHtml(msg)}</div>
        <div style="margin-top:12px"><button class="btn" onclick="_loadReviewPage('${escAttr(scanId)}')">Retry</button> <a class="btn" href="#/">Home</a></div>
      </div>`;
  }
  const sidebar = document.getElementById('sidebar');
  if (sidebar) sidebar.innerHTML = '';
  console.error('[review] load failed:', err);
}

async function _loadMoreFailures(scanId) {
  _loading = true;
  _currentPage++;
  const params = new URLSearchParams({ page: String(_currentPage), size: '50' });

  if (_activeModule) params.set('module', _activeModule);
  if (_activeProfile) params.set('profile', _activeProfile);
  if (_activeSort) params.set('sort', _activeSort);
  if (_searchQuery) params.set('q', _searchQuery);

  try {
    const data = await apiGet(`/api/scans/${scanId}?${params}`);
    _scanData.stats = data.stats;
    _allFailures = _allFailures.concat(data.failures);
    _hasMore = _allFailures.length < data.totalFiltered;

    _appendGrid(data.failures);
    _updateCounter();
  } catch (err) {
    // Stop the infinite scroll from hammering a failing endpoint.
    _hasMore = false;
    console.error('[review] page load failed:', err);
  } finally {
    _loading = false;
  }
}

function _renderSidebar(data) {
  const sidebar = document.getElementById('sidebar');
  const tree = {};
  const moduleSnapshots = {};
  for (const mod of data.modules) {
    tree[mod.name] = { count: mod.failure_count ?? 0, packages: {} };
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
    card.className = 'thumb-card' + (f.status === 'accepted' ? ' thumb-accepted' : '');
    card.href = `#/scans/${scanId}/review/${encodeURIComponent(f.filename)}`;

    const thumbPath = f.delta_path || f.actual_path;
    const imgSrc = thumbPath ? `/api/images?path=${encodeURIComponent(thumbPath)}` : '';
    card.innerHTML = `
      <div class="thumb-img-wrap">
        ${imgSrc ? `<img loading="lazy" src="${imgSrc}" alt="${escAttr(f.filename)}" width="280" height="180">` : '<div class="thumb-placeholder">No image</div>'}
        ${f.status === 'accepted' ? '<div class="thumb-accepted-badge" title="Accepted">&check;</div>' : ''}
      </div>
      <div class="thumb-info">
        <span class="thumb-name" title="${escAttr(f.filename)}">${escHtml(f.class_name || f.filename)}</span>
        <span class="thumb-method">${escHtml(f.method || '')}</span>
        ${f.diff_pct != null ? `<span class="diff-pct">${f.diff_pct.toFixed(3)}%</span>` : ''}
        ${f.profile && f.profile !== 'baseline' ? `<span class="profile-tag">${escHtml(f.profile)}</span>` : ''}
      </div>
    `;
    grid.appendChild(card);
  }
}

function _updateCounter() {
  const el = document.getElementById('review-counter');
  if (!_scanData) return;
  el.textContent = `${_scanData.stats.total} failures`;

  const acceptBtn = document.getElementById('accept-all-btn');
  if (acceptBtn) {
    const pending = _scanData.stats.total - (_scanData.stats.accepted || 0);
    acceptBtn.style.display = pending > 0 ? '' : 'none';
  }

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

function _renderProfilePills(data) {
  const el = document.getElementById('profile-pills');
  if (!el) return;
  // Collect unique profiles from all failures (need a full scan load for this)
  // Use module profile_counts as source
  const profiles = new Set();
  for (const m of data.modules || []) {
    for (const p of Object.keys(m.profile_counts || {})) {
      profiles.add(p);
    }
  }
  if (profiles.size <= 1) {
    el.innerHTML = '';
    return;
  }
  let html = `<button class="pill ${!_activeProfile ? 'active' : ''}" onclick="_filterProfile(null)">All</button>`;
  for (const p of profiles) {
    html += `<button class="pill ${_activeProfile === p ? 'active' : ''}" onclick="_filterProfile('${escAttr(p)}')">${escHtml(p)}</button>`;
  }
  el.innerHTML = html;
}

function _setSort(value) {
  _activeSort = value || null;
  if (_activeSort) localStorage.setItem('papastud_sort', _activeSort);
  else localStorage.removeItem('papastud_sort');
  _resetAndReload();
}

function _filterProfile(profile) {
  _activeProfile = profile;
  _resetAndReload();
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

// --- Export video ---

async function _exportVideo(scanId) {
  const btn = document.getElementById('export-video-btn');
  if (!btn || !_scanData) return;

  const health = await apiGet('/api/health');
  if (!health.ffmpeg) {
    alert('Video export requires ffmpeg.\n\nInstall it:\n  macOS: brew install ffmpeg\n  Linux: apt install ffmpeg');
    return;
  }

  // Pass current filters to video endpoint
  const params = new URLSearchParams();
  if (_activeModule) params.set('module', _activeModule);
  if (_activeProfile) params.set('profile', _activeProfile);
  if (_searchQuery) params.set('q', _searchQuery);
  const qs = params.toString();
  const filterLabel = _activeProfile || _activeModule || '';
  const failureCount = _allFailures.length;
  btn.disabled = true;
  btn.textContent = 'Generating...';
  showToast(`Generating video (${failureCount} frames${filterLabel ? ' — ' + filterLabel : ''})...`);

  try {
    const res = await fetch(`/api/scans/${scanId}/video${qs ? '?' + qs : ''}`, { method: 'POST' });
    if (!res.ok) {
      const err = await res.json();
      showToast(err.error || 'Export failed', 'error', 6000);
      return;
    }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `papa-stud-${scanId}.mp4`;
    a.click();
    URL.revokeObjectURL(url);
    showToast('Video saved to Downloads.');
  } catch (e) {
    showToast('Export failed: ' + e.message, 'error', 6000);
  } finally {
    btn.disabled = false;
    btn.textContent = 'Export Video';
  }
}


// --- Accept All ---

async function _acceptAll(scanId) {
  const btn = document.getElementById('accept-all-btn');
  const originalLabel = btn?.innerHTML;
  if (btn) { btn.disabled = true; btn.innerHTML = 'Accepting...'; }
  try {
    const result = await apiPost(`/api/scans/${scanId}/accept-all`, {});
    if (result?.error) {
      showToast('Failed: ' + result.error, 'error');
    } else {
      let msg = result.errors?.length
        ? `Accepted ${result.accepted} (${result.errors.length} failed)`
        : `Accepted ${result.accepted} baseline(s)`;
      if (result.skippedRejected > 0) msg += ` (${result.skippedRejected} rejected skipped)`;
      showToast(msg, result.errors?.length ? 'error' : 'success');
      const failed = new Set((result.errors || []).map(e => e.filename));
      for (const f of _allFailures) {
        if (f.status === 'rejected') continue;
        if (!failed.has(f.filename)) f.status = 'accepted';
      }
      if (_scanData) _scanData.stats = result.stats;
      _updateCounter();
      _renderGrid();
    }
  } catch (e) {
    showToast('Failed: ' + e.message, 'error');
  } finally {
    if (btn && originalLabel !== undefined) { btn.disabled = false; btn.innerHTML = originalLabel; }
  }
}

// --- Re-scan ---

async function _rescanFromReview(scanId) {
  const scan = await apiGet(`/api/scans/${scanId}?page=0&size=0`);
  if (!scan) return;
  const btn = document.querySelector('[onclick*="rescanFromReview"]');
  if (btn) { btn.textContent = 'Scanning...'; btn.disabled = true; }
  const resp = await apiPost(`/api/projects/${scan.projectId}/scan`, {});
  if (resp?.jobId) {
    // Poll until complete then navigate to the new scan
    _rescanPollTimer = setInterval(async () => {
      try {
        const job = await apiGet(`/api/scan-jobs/${resp.jobId}`);
        if (!job || job.status === 'completed' || job.status === 'failed' || job.status === 'cancelled') {
          clearInterval(_rescanPollTimer);
          _rescanPollTimer = null;
          // Only act if the review page for this scan is still active.
          if (_scanData && _scanData.id === scanId) {
            if (job?.scanId) navigate(`/scans/${job.scanId}`);
            else _resetAndReload();
          }
        }
      } catch (e) {
        // apiGet throws on any non-2xx (e.g. job TTL expiry -> 404), so
        // without this the interval would reject unhandled forever.
        clearInterval(_rescanPollTimer);
        _rescanPollTimer = null;
        const errBtn = document.querySelector('[onclick*="rescanFromReview"]');
        if (errBtn) { errBtn.textContent = 'Re-scan'; errBtn.disabled = false; }
        console.error('[rescan-poll] stopped:', e);
      }
    }, 1500);
  }
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
    try {
      await apiPost(`/api/scans/${scanId}/watch`, {});
    } catch (e) {
      // e.g. 400 for xcresult-driven projects where per-module watch rescans
      // would wipe the parse-derived failures. Surface it instead of throwing.
      showToast(e.message || 'Watch is not available for this project', 'error');
      return;
    }
    _watching = true;
    // Rescan happened server-side, reload to show updated results
    _resetAndReload();
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
    try {
      // Light check: only fetch stats via size=0 to detect changes
      const check = await apiGet(`/api/scans/${scanId}?page=0&size=0`);
      if (!check) return;
      const newStats = JSON.stringify(check.stats);
      if (newStats !== _lastStatsJson) {
        _lastStatsJson = newStats;
        // Stats changed — reload the current view
        _resetAndReload();
      }
    } catch (e) {
      // apiGet throws on any non-2xx (e.g. scan deleted -> 404), so
      // without this the interval would reject unhandled forever.
      _stopWatchPoll();
      console.error('[watch-poll] stopped:', e);
    }
  }, 2000);
}

function _stopWatchPoll() {
  if (_watchPollTimer) {
    clearInterval(_watchPollTimer);
    _watchPollTimer = null;
  }
}

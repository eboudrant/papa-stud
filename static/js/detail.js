// @ts-check

/** @type {object|null} */
let _detailScan = null;
let _detailFailure = null;
let _detailFailures = [];
let _detailIndex = -1;
let _viewMode = 'delta'; // 'delta' | 'toggle' | 'slider'
let _toggleShowing = 'golden'; // 'golden' | 'actual'

function showDetail(scanId, filename) {
  const content = document.getElementById('content');
  content.innerHTML = '<div class="detail-loading">Loading...</div>';

  // Preserve view mode when navigating between failures
  if (!_viewMode) _viewMode = 'delta';
  if (!_toggleShowing) _toggleShowing = 'golden';
  _loadDetail(scanId, filename);

  const _heldKeys = new Set();
  let _moveLoop = null;

  function _startMoveLoop() {
    if (_moveLoop) return;
    let last = performance.now();
    function tick(now) {
      const dt = (now - last) / 1000;
      last = now;
      const speed = 400 * dt; // pixels per second
      const zoomSpeed = 1 + 1.5 * dt; // zoom factor per second
      let dx = 0, dy = 0, zf = 1;
      if (_heldKeys.has('panLeft')) dx += speed;
      if (_heldKeys.has('panRight')) dx -= speed;
      if (_heldKeys.has('zoomIn')) zf = zoomSpeed;
      if (_heldKeys.has('zoomOut')) zf = 1 / zoomSpeed;
      if (dx !== 0 || dy !== 0) {
        _panZoom.ox += dx;
        _panZoom.oy += dy;
      }
      if (zf !== 1) {
        const { x: cx, y: cy } = _getZoomCenter();
        const newScale = Math.max(_fitScale, Math.min(_panZoom.scale * zf, 20));
        const ratio = newScale / _panZoom.scale;
        _panZoom.ox = cx - (cx - _panZoom.ox) * ratio;
        _panZoom.oy = cy - (cy - _panZoom.oy) * ratio;
        _panZoom.scale = newScale;
      }
      if (dx !== 0 || dy !== 0 || zf !== 1) _applyPanZoom();
      if (_heldKeys.size > 0) _moveLoop = requestAnimationFrame(tick);
      else _moveLoop = null;
    }
    _moveLoop = requestAnimationFrame(tick);
  }

  function _mapMoveKey(key) {
    switch (key) {
      case 'a': case 'A': case 'j': case 'J': return 'panLeft';
      case 'd': case 'D': case 'l': case 'L': return 'panRight';
      case 'w': case 'W': case 'i': case 'I': case '+': case '=': return 'zoomIn';
      case 's': case 'S': case 'k': case 'K': case '-': return 'zoomOut';
      default: return null;
    }
  }

  const _keyDown = (e) => {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
    const move = _mapMoveKey(e.key);
    if (move) {
      e.preventDefault();
      _heldKeys.add(move);
      _startMoveLoop();
      return;
    }
    switch (e.key) {
      case 'ArrowRight': _detailNext(scanId); break;
      case 'ArrowLeft': _detailPrev(scanId); break;
      case 'Escape': navigate(`/scans/${scanId}`); break;
      case '1': _setViewMode(_detailFailure?.delta_path ? 'delta' : 'toggle', scanId); break;
      case '2': _setViewMode(_detailFailure?.delta_path ? 'toggle' : 'slider', scanId); break;
      case '3': _setViewMode('slider', scanId); break;
      case 'e': case 'E': _cycleViewMode(scanId); break;
      case '0': case 'r': case 'R': _zoomReset(); break;
      case 'Enter':
        if (_detailFailure?.has_actual && _detailFailure.status !== 'accepted') {
          _acceptBaseline(scanId, _detailFailure.filename);
        }
        break;
      case 't': case 'T':
        if (_viewMode !== 'toggle') {
          _setViewMode('toggle', scanId);
        } else {
          const saved = { ..._panZoom };
          const savedFit = _fitScale;
          _toggleShowing = _toggleShowing === 'golden' ? 'actual' : 'golden';
          _renderDetail(scanId);
          _panZoom = saved;
          _fitScale = savedFit;
          _applyPanZoom();
          _initPanZoom(true);
        }
        break;
    }
  };
  const _keyUp = (e) => {
    const move = _mapMoveKey(e.key);
    if (move) _heldKeys.delete(move);
  };
  document.addEventListener('keydown', _keyDown);
  document.addEventListener('keyup', _keyUp);

  return () => {
    document.removeEventListener('keydown', _keyDown);
    document.removeEventListener('keyup', _keyUp);
    document.removeEventListener('mousemove', _onPanMove);
    document.removeEventListener('mouseup', _onPanUp);
    _heldKeys.clear();
    if (_moveLoop) { cancelAnimationFrame(_moveLoop); _moveLoop = null; }
    if (_animFrame) { cancelAnimationFrame(_animFrame); _animFrame = null; }
    _panDrag = null;
    // Clean up any active slider drag listeners
    if (_sliderCleanup) { _sliderCleanup(); _sliderCleanup = null; }
  };
}

async function _loadDetail(scanId, filename) {
  const data = await apiGet(`/api/scans/${scanId}?page=0&size=10000`);
  _detailScan = data;
  _detailFailures = data.failures;
  _detailIndex = _detailFailures.findIndex(f => f.filename === filename);
  _detailFailure = _detailIndex >= 0 ? _detailFailures[_detailIndex] : null;
  setNavContext({
    projectName: data.projectName,
    className: _detailFailure?.class_name || '',
    methodName: _detailFailure?.method || '',
  });

  if (!_detailFailure) {
    document.getElementById('content').innerHTML = '<div class="empty-state">Failure not found</div>';
    return;
  }

  _renderDetail(scanId);
  if (_viewMode === 'slider') {
    _initSliderDrag();
  } else {
    _initPanZoom();
  }
}

function _renderDetail(scanId) {
  const f = _detailFailure;
  const content = document.getElementById('content');

  const goldenSrc = f.golden_path ? `/api/images?path=${encodeURIComponent(f.golden_path)}` : '';
  const deltaSrc = f.delta_path ? `/api/images?path=${encodeURIComponent(f.delta_path)}` : '';
  const actualSrc = f.actual_path ? `/api/images?path=${encodeURIComponent(f.actual_path)}` : '';
  // When actual is missing (e.g., figma handler only writes delta), use delta as fallback
  const effectiveActual = actualSrc || deltaSrc;
  const hasDelta = !!deltaSrc;
  const canAccept = f.has_actual && f.status !== 'accepted';

  // Auto-switch to toggle if no delta available
  if (!hasDelta && _viewMode === 'delta') _viewMode = 'toggle';

  let viewContent = '';

  const zoomBar = `
    <div class="zoom-controls">
      <button onclick="_zoomOut()">-</button>
      <span id="zoom-level">Fit</span>
      <button onclick="_zoomIn()">+</button>
      <button onclick="_zoomReset()">R</button>
      <span id="size-warning" class="size-warning" style="display:none"></span>
    </div>`;

  // Check image size mismatch after render (for toggle/slider)
  if (goldenSrc && effectiveActual && _viewMode !== 'delta') {
    const gImg = new Image();
    const aImg = new Image();
    let loaded = 0;
    const checkSizes = () => {
      if (++loaded < 2) return;
      const warn = document.getElementById('size-warning');
      if (gImg.naturalWidth !== aImg.naturalWidth || gImg.naturalHeight !== aImg.naturalHeight) {
        if (warn) {
          warn.textContent = `Size mismatch: golden ${gImg.naturalWidth}x${gImg.naturalHeight} vs actual ${aImg.naturalWidth}x${aImg.naturalHeight}`;
          warn.style.display = '';
        }
      }
    };
    gImg.onload = checkSizes;
    aImg.onload = checkSizes;
    gImg.src = goldenSrc;
    aImg.src = effectiveActual;
  }

  if (_viewMode === 'delta') {
    // For tools whose delta is a raw pixel-diff (swift-snapshot), compose the
    // 3-panel strip client-side so reviewers see expected/diff/actual at once,
    // matching Roborazzi/Paparazzi's already-composited delta.
    const stripDelta = f.delta_kind === 'pixel-diff' && goldenSrc && deltaSrc;
    if (stripDelta) {
      viewContent = `<div class="detail-fullview">
          <div class="delta-strip">
            <div class="delta-strip-cell"><div class="delta-strip-label">Expected</div><img src="${goldenSrc}"></div>
            <div class="delta-strip-cell"><div class="delta-strip-label">Diff</div><img src="${deltaSrc}"></div>
            <div class="delta-strip-cell"><div class="delta-strip-label">Actual</div><img src="${actualSrc}"></div>
          </div>
        </div>`;
    } else {
      viewContent = deltaSrc
        ? `<div class="detail-fullview">
            <div class="detail-view-area" id="view-area"><img src="${deltaSrc}" id="detail-img"></div>
            ${zoomBar}
          </div>`
        : '<div class="pane-empty">No delta image</div>';
    }
  } else if (_viewMode === 'toggle') {
    const src = _toggleShowing === 'golden' ? goldenSrc : effectiveActual;
    const title = _toggleShowing === 'golden' ? 'Expected (Golden)' : (actualSrc ? 'Actual' : 'Delta');
    viewContent = src
      ? `<div class="detail-fullview">
          <div class="detail-view-area" id="view-area">
            <div class="toggle-label">${title} <span class="label-hint">press T to toggle</span></div>
            <img src="${src}" id="detail-img">
          </div>
          ${zoomBar}
        </div>`
      : `<div class="pane-empty">No ${_toggleShowing} image</div>`;
  } else if (_viewMode === 'slider') {
    viewContent = (goldenSrc && actualSrc)
      ? `<div class="detail-fullview">
          <div class="slider-viewport" id="slider-viewport">
            <img src="${actualSrc}" class="slider-base" id="slider-actual">
            <img src="${goldenSrc}" class="slider-base" id="slider-golden">
            <div class="slider-handle" id="slider-handle" style="left:50%"></div>
          </div>
          <div class="slider-labels">
            <span>Expected (Golden)</span>
            <span>Actual</span>
          </div>
          ${zoomBar}
        </div>`
      : '<div class="pane-empty">Slider requires a separate actual image. Use Delta or Toggle mode.</div>';
  }

  content.innerHTML = `
    <div class="detail">
      <div class="detail-header">
        <div class="detail-meta">
          <span class="detail-title">${escHtml(f.class_name || f.filename)}</span>
          <span class="detail-subtitle">${f.method ? escHtml(f.method) : ''}${f.snapshot_name ? ' / ' + escHtml(f.snapshot_name) : ''}</span>
        </div>
        <div class="detail-mode-tabs">
          ${hasDelta ? `<button class="pill ${_viewMode === 'delta' ? 'active' : ''}" onclick="_setViewMode('delta', '${scanId}')">Delta (1)</button>` : ''}
          <button class="pill ${_viewMode === 'toggle' ? 'active' : ''}" onclick="_setViewMode('toggle', '${scanId}')">Toggle (${hasDelta ? '2' : '1'})</button>
          <button class="pill ${_viewMode === 'slider' ? 'active' : ''}" onclick="_setViewMode('slider', '${scanId}')">Slider (${hasDelta ? '3' : '2'})</button>
        </div>
        ${f.diff_pct != null ? `<span class="detail-diff-pct" style="color:${_diffColor(f.diff_pct)}">${f.diff_pct.toFixed(3)}%</span>` : ''}
        ${!f.has_actual ? '' : canAccept
          ? `<button class="btn btn-sm btn-success" title="Accept as baseline (Enter)" onclick="_acceptBaseline('${scanId}', '${escAttr(f.filename)}')">&check; Accept</button>`
          : `<span class="accept-badge" title="Accepted">&check; Accepted</span>`}
        <div class="detail-nav">
          <button class="btn" onclick="_detailPrev('${scanId}')" ${_detailIndex <= 0 ? 'disabled' : ''}>&larr; Prev</button>
          <span class="counter">${_detailIndex + 1} / ${_detailFailures.length}</span>
          <button class="btn" onclick="_detailNext('${scanId}')" ${_detailIndex >= _detailFailures.length - 1 ? 'disabled' : ''}>Next &rarr;</button>
        </div>
      </div>
      ${viewContent}
      <div class="detail-filename">
        ${escHtml(f.filename)}
        <button class="btn-copy" onclick="_copyPath('${escAttr(f.delta_path || '')}', this)" title="Copy absolute path">copy</button>
      </div>
      <div class="detail-shortcuts">E=cycle mode  ${_viewMode === 'toggle' ? 'T=toggle  ' : ''}WASD/IJKL=navigate  R=reset  &larr;=prev  &rarr;=next  ${canAccept ? 'Enter=accept  ' : ''}esc=back</div>
    </div>
  `;
  if (window.papastudApng) window.papastudApng.enhanceAll(content);
}

function _diffColor(pct) {
  if (pct < 1) return '#f59e0b';    // amber — trivial
  if (pct < 5) return '#f97316';    // orange — minor
  if (pct < 10) return '#ef4444';   // red — moderate
  if (pct < 30) return '#dc2626';   // dark red — major
  return '#7c3aed';                  // purple — severe
}

function _copyPath(path, btn) {
  navigator.clipboard.writeText(path).then(() => {
    btn.textContent = 'copied';
    setTimeout(() => { btn.textContent = 'copy'; }, 1500);
  });
}

function _cycleViewMode(scanId) {
  const hasDelta = !!_detailFailure?.delta_path;
  const modes = hasDelta ? ['delta', 'toggle', 'slider'] : ['toggle', 'slider'];
  const next = modes[(modes.indexOf(_viewMode) + 1) % modes.length];
  _setViewMode(next, scanId);
}

function _setViewMode(mode, scanId) {
  _viewMode = mode;
  _panZoom = { ox: 0, oy: 0, scale: 1 };
  _sliderDragging = false;
  if (mode === 'toggle') _toggleShowing = 'golden';
  _renderDetail(scanId);
  if (mode === 'slider') _initSliderDrag();
  else _initPanZoom();
}

let _sliderDragging = false;
let _sliderPct = 50;
let _sliderCleanup = null;

function _initSliderDrag() {
  const handle = document.getElementById('slider-handle');
  const viewport = document.getElementById('slider-viewport');
  if (!handle || !viewport) return;
  _sliderPct = 50;

  // Wait for both images to load, then size the viewport and set initial clip
  const actual = document.getElementById('slider-actual');
  const golden = document.getElementById('slider-golden');
  let loaded = 0;
  const onLoad = () => {
    if (++loaded < 2) return;
    // Use the max dimensions so both images fit in the same space
    const w = Math.max(actual.naturalWidth, golden.naturalWidth);
    const h = Math.max(actual.naturalHeight, golden.naturalHeight);
    viewport.style.aspectRatio = `${w} / ${h}`;
    _updateSliderClip();
  };
  if (actual.complete) loaded++;
  else actual.onload = onLoad;
  if (golden.complete) loaded++;
  else golden.onload = onLoad;
  if (loaded >= 2) onLoad();
  _updateSliderClip();

  const onMove = (e) => {
    e.preventDefault();
    const x = e.touches ? e.touches[0].clientX : e.clientX;
    const rect = viewport.getBoundingClientRect();
    _sliderPct = Math.max(0, Math.min(100, ((x - rect.left) / rect.width) * 100));
    handle.style.left = _sliderPct + '%';
    _updateSliderClip();
  };
  const onUp = () => {
    _sliderDragging = false;
    document.removeEventListener('mousemove', onMove);
    document.removeEventListener('mouseup', onUp);
    document.removeEventListener('touchmove', onMove);
    document.removeEventListener('touchend', onUp);
  };

  handle.addEventListener('mousedown', (e) => {
    e.preventDefault();
    e.stopPropagation();
    _sliderDragging = true;
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  });
  handle.addEventListener('touchstart', (e) => {
    e.stopPropagation();
    _sliderDragging = true;
    document.addEventListener('touchmove', onMove, { passive: false });
    document.addEventListener('touchend', onUp);
  });

  _sliderCleanup = onUp;
}

function _updateSliderClip() {
  const golden = document.getElementById('slider-golden');
  if (!golden) return;
  golden.style.clipPath = `inset(0 ${100 - _sliderPct}% 0 0)`;
}

function _detailNext(scanId) {
  if (_detailIndex < _detailFailures.length - 1) {
    _detailIndex++;
    _detailFailure = _detailFailures[_detailIndex];

    navigateReplace(`/scans/${scanId}/review/${encodeURIComponent(_detailFailure.filename)}`);
  }
}

async function _acceptBaseline(scanId, filename) {
  try {
    const result = await apiPost(`/api/scans/${scanId}/failures/${encodeURIComponent(filename)}/accept`, {});
    if (result && result.error) {
      showToast('Failed: ' + result.error, 'error');
      return;
    }
    if (_detailFailure) _detailFailure.status = 'accepted';
    showToast('Baseline accepted', 'success');
    if (_detailIndex < _detailFailures.length - 1) {
      _detailNext(scanId);
    } else {
      _renderDetail(scanId);
    }
  } catch (e) {
    showToast('Failed: ' + e.message, 'error');
  }
}

function _detailPrev(scanId) {
  if (_detailIndex > 0) {
    _detailIndex--;
    _detailFailure = _detailFailures[_detailIndex];

    navigateReplace(`/scans/${scanId}/review/${encodeURIComponent(_detailFailure.filename)}`);
  }
}

// Google Maps-style zoom/pan.
// ox,oy = top-left of image in area coordinates. scale = zoom level.
// At fit: image is centered, scale = fitScale.
let _panZoom = { ox: 0, oy: 0, scale: 1 };
let _fitScale = 1;
let _panDrag = null;

function _initPanZoom(skipReset) {
  const area = document.getElementById('view-area');
  const img = document.getElementById('detail-img');
  if (!area || !img) return;

  if (!skipReset) {
    const setup = () => {
      _fitScale = _computeFitScale();
      _panZoom.scale = _fitScale;
      _centerImage();
      _applyPanZoom();
    };

    if (img.naturalWidth) setup();
    else img.addEventListener('load', setup, { once: true });
  }

  area.addEventListener('wheel', _onWheel, { passive: false });
  area.addEventListener('mousedown', _onDragStart);
  area.addEventListener('dblclick', _onDblClick);
  area.addEventListener('mousemove', _onTrackCursor);
  // Remove previous document listeners before adding new ones to prevent accumulation
  document.removeEventListener('mousemove', _onPanMove);
  document.removeEventListener('mouseup', _onPanUp);
  document.addEventListener('mousemove', _onPanMove);
  document.addEventListener('mouseup', _onPanUp);
}

function _computeFitScale() {
  const img = document.getElementById('detail-img');
  const area = document.getElementById('view-area');
  if (!img || !area || !img.naturalWidth) return 1;
  return Math.min(area.clientWidth / img.naturalWidth, area.clientHeight / img.naturalHeight, 1);
}

function _centerImage() {
  const img = document.getElementById('detail-img');
  const area = document.getElementById('view-area');
  if (!img || !area || !img.naturalWidth) return;
  const w = img.naturalWidth * _panZoom.scale;
  const h = img.naturalHeight * _panZoom.scale;
  _panZoom.ox = (area.clientWidth - w) / 2;
  _panZoom.oy = (area.clientHeight - h) / 2;
}

let _cursorInArea = false;
let _cursorX = 0;
let _cursorY = 0;

function _onTrackCursor(e) {
  const area = document.getElementById('view-area');
  if (!area) return;
  const rect = area.getBoundingClientRect();
  _cursorX = e.clientX - rect.left;
  _cursorY = e.clientY - rect.top;
  _cursorInArea = e.clientX >= rect.left && e.clientX <= rect.right &&
                  e.clientY >= rect.top && e.clientY <= rect.bottom;
}

function _getZoomCenter() {
  const area = document.getElementById('view-area');
  if (!area) return { x: 0, y: 0 };
  if (_cursorInArea) return { x: _cursorX, y: _cursorY };
  return { x: area.clientWidth / 2, y: area.clientHeight / 2 };
}

let _animFrame = null;
function _animateTo(targetOx, targetOy, targetScale) {
  if (_animFrame) cancelAnimationFrame(_animFrame);
  const startOx = _panZoom.ox, startOy = _panZoom.oy, startScale = _panZoom.scale;
  const start = performance.now();
  const duration = 200;
  function step(now) {
    const t = Math.min((now - start) / duration, 1);
    const ease = t * (2 - t); // ease-out
    _panZoom.ox = startOx + (targetOx - startOx) * ease;
    _panZoom.oy = startOy + (targetOy - startOy) * ease;
    _panZoom.scale = startScale + (targetScale - startScale) * ease;
    _applyPanZoom();
    if (t < 1) _animFrame = requestAnimationFrame(step);
    else _animFrame = null;
  }
  _animFrame = requestAnimationFrame(step);
}

function _zoomAtPoint(newScale, px, py) {
  // px,py = point in area coordinates that should stay fixed
  // Before zoom: image point = (px - ox) / oldScale
  // After zoom: same image point at same screen position
  // px = ox_new + imagePoint * newScale
  // ox_new = px - (px - ox) * (newScale / oldScale)
  const ratio = newScale / _panZoom.scale;
  _panZoom.ox = px - (px - _panZoom.ox) * ratio;
  _panZoom.oy = py - (py - _panZoom.oy) * ratio;
  _panZoom.scale = newScale;
}

function _onWheel(e) {
  e.preventDefault();
  const area = document.getElementById('view-area');
  if (!area) return;
  const rect = area.getBoundingClientRect();
  const px = e.clientX - rect.left;
  const py = e.clientY - rect.top;

  const factor = e.deltaY < 0 ? 1.02 : 1 / 1.02;
  const newScale = Math.max(_fitScale, Math.min(_panZoom.scale * factor, 20));
  _zoomAtPoint(newScale, px, py);
  _applyPanZoom();
}

function _onDblClick(e) {
  const area = document.getElementById('view-area');
  if (!area) return;
  const rect = area.getBoundingClientRect();
  const px = e.clientX - rect.left;
  const py = e.clientY - rect.top;
  const newScale = Math.min(_panZoom.scale * 2, 20);
  _zoomAtPoint(newScale, px, py);
  _applyPanZoom();
}

function _onDragStart(e) {
  if (e.button !== 0 || _sliderDragging) return;
  e.preventDefault();
  _panDrag = { startX: e.clientX, startY: e.clientY, startOx: _panZoom.ox, startOy: _panZoom.oy };
  const area = document.getElementById('view-area');
  if (area) area.style.cursor = 'grabbing';
}

function _onPanMove(e) {
  if (!_panDrag) return;
  _panZoom.ox = _panDrag.startOx + (e.clientX - _panDrag.startX);
  _panZoom.oy = _panDrag.startOy + (e.clientY - _panDrag.startY);
  _applyPanZoom();
}

function _onPanUp() {
  if (!_panDrag) return;
  _panDrag = null;
  const area = document.getElementById('view-area');
  if (area) area.style.cursor = '';
}

function _zoomIn() {
  const { x: cx, y: cy } = _getZoomCenter();
  const newScale = Math.min(_panZoom.scale * 1.5, 20);
  const ratio = newScale / _panZoom.scale;
  _animateTo(
    cx - (cx - _panZoom.ox) * ratio,
    cy - (cy - _panZoom.oy) * ratio,
    newScale
  );
}

function _zoomOut() {
  const { x: cx, y: cy } = _getZoomCenter();
  const newScale = Math.max(_fitScale, _panZoom.scale / 1.5);
  const ratio = newScale / _panZoom.scale;
  _animateTo(
    cx - (cx - _panZoom.ox) * ratio,
    cy - (cy - _panZoom.oy) * ratio,
    newScale
  );
}

function _zoomReset() {
  _fitScale = _computeFitScale();
  const img = document.getElementById('detail-img');
  const area = document.getElementById('view-area');
  if (!img || !area || !img.naturalWidth) return;
  const w = img.naturalWidth * _fitScale;
  const h = img.naturalHeight * _fitScale;
  _animateTo((area.clientWidth - w) / 2, (area.clientHeight - h) / 2, _fitScale);
}

function _applyPanZoom() {
  const img = document.getElementById('detail-img');
  const label = document.getElementById('zoom-level');
  if (!img) return;
  const t = `translate(${_panZoom.ox}px, ${_panZoom.oy}px) scale(${_panZoom.scale})`;
  img.style.transform = t;
  // In slider mode, apply same transform to golden image
  const golden = document.getElementById('slider-golden');
  if (golden) golden.style.transform = t;
  const pct = Math.round(_panZoom.scale * 100);
  const fitPct = Math.round(_fitScale * 100);
  if (label) label.textContent = pct === fitPct ? 'Fit' : pct + '%';
}



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

  _viewMode = 'delta';
  _toggleShowing = 'golden';
  _loadDetail(scanId, filename);

  const _keyHandler = (e) => {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
    switch (e.key) {
      case 'ArrowRight': case 'j': _detailNext(scanId); break;
      case 'ArrowLeft': case 'k': _detailPrev(scanId); break;
      case 'Escape': navigate(`/scans/${scanId}`); break;
      case '1': _setViewMode('delta', scanId); break;
      case '2': _setViewMode('toggle', scanId); break;
      case '3': _setViewMode('slider', scanId); break;
      case '+': case '=': _zoomIn(); break;
      case '-': _zoomOut(); break;
      case '0': case 'r': case 'R': _zoomReset(); break;
      case 't': case 'T':
        if (_viewMode === 'toggle') {
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
  document.addEventListener('keydown', _keyHandler);

  return () => {
    document.removeEventListener('keydown', _keyHandler);
    document.removeEventListener('mousemove', _onPanMove);
    document.removeEventListener('mouseup', _onPanUp);
    _panDrag = null;
  };
}

async function _loadDetail(scanId, filename) {
  const data = await apiGet(`/api/scans/${scanId}?page=0&size=10000`);
  _detailScan = data;
  _detailFailures = data.failures;
  _detailIndex = _detailFailures.findIndex(f => f.filename === filename);
  _detailFailure = _detailIndex >= 0 ? _detailFailures[_detailIndex] : null;

  if (!_detailFailure) {
    document.getElementById('content').innerHTML = '<div class="empty-state">Failure not found</div>';
    return;
  }

  _renderDetail(scanId);
  _initPanZoom();
  if (_viewMode === 'slider') _initSliderDrag();
}

function _renderDetail(scanId) {
  const f = _detailFailure;
  const content = document.getElementById('content');

  const goldenSrc = f.golden_path ? `/api/images?path=${encodeURIComponent(f.golden_path)}` : '';
  const deltaSrc = f.delta_path ? `/api/images?path=${encodeURIComponent(f.delta_path)}` : '';
  const actualSrc = f.actual_path ? `/api/images?path=${encodeURIComponent(f.actual_path)}` : '';

  let viewContent = '';

  const zoomBar = `
    <div class="zoom-controls">
      <button onclick="_zoomOut()">-</button>
      <span id="zoom-level">Fit</span>
      <button onclick="_zoomIn()">+</button>
      <button onclick="_zoomReset()">R</button>
    </div>`;

  if (_viewMode === 'delta') {
    viewContent = deltaSrc
      ? `<div class="detail-fullview">
          <div class="detail-view-area" id="view-area"><img src="${deltaSrc}" id="detail-img"></div>
          ${zoomBar}
        </div>`
      : '<div class="pane-empty">No delta image</div>';
  } else if (_viewMode === 'toggle') {
    const src = _toggleShowing === 'golden' ? goldenSrc : actualSrc;
    const label = _toggleShowing === 'golden' ? 'Expected (Golden)' : 'Actual';
    viewContent = src
      ? `<div class="detail-fullview">
          <div class="detail-view-area" id="view-area">
            <div class="toggle-label">${label} <span class="label-hint">press T to toggle</span></div>
            <img src="${src}" id="detail-img">
          </div>
          ${zoomBar}
        </div>`
      : `<div class="pane-empty">No ${_toggleShowing} image</div>`;
  } else if (_viewMode === 'slider') {
    viewContent = (goldenSrc && actualSrc)
      ? `<div class="detail-fullview">
          <div class="detail-view-area" id="view-area">
            <img src="${actualSrc}" id="detail-img">
            <img src="${goldenSrc}" id="slider-golden">
            <div class="slider-handle" id="slider-handle" style="left:50%"></div>
          </div>
          <div class="slider-labels">
            <span>Expected (Golden)</span>
            <span>Actual</span>
          </div>
          ${zoomBar}
        </div>`
      : '<div class="pane-empty">Both golden and actual images required for slider</div>';
  }

  content.innerHTML = `
    <div class="detail">
      <div class="detail-header">
        <a class="btn" href="#/scans/${scanId}">Back</a>
        <div class="detail-meta">
          <span class="detail-title">${escHtml(f.class_name || f.filename)}</span>
          <span class="detail-subtitle">${escHtml(f.package)}${f.method ? '.' + escHtml(f.method) : ''}${f.snapshot_name ? ' / ' + escHtml(f.snapshot_name) : ''}</span>
        </div>
        <div class="detail-mode-tabs">
          <button class="pill ${_viewMode === 'delta' ? 'active' : ''}" onclick="_setViewMode('delta', '${scanId}')">Delta (1)</button>
          <button class="pill ${_viewMode === 'toggle' ? 'active' : ''}" onclick="_setViewMode('toggle', '${scanId}')">Toggle (2)</button>
          <button class="pill ${_viewMode === 'slider' ? 'active' : ''}" onclick="_setViewMode('slider', '${scanId}')">Slider (3)</button>
        </div>
        <div class="detail-nav">
          <button class="btn" onclick="_detailPrev('${scanId}')" ${_detailIndex <= 0 ? 'disabled' : ''}>&larr; Prev</button>
          <span class="counter">${_detailIndex + 1} / ${_detailFailures.length}</span>
          <button class="btn" onclick="_detailNext('${scanId}')" ${_detailIndex >= _detailFailures.length - 1 ? 'disabled' : ''}>Next &rarr;</button>
        </div>
      </div>
      ${viewContent}
      <div class="detail-filename">${escHtml(f.filename)}</div>
      <div class="detail-shortcuts">1/2/3=mode  ${_viewMode === 'toggle' ? 'T=toggle  ' : ''}scroll=zoom  drag=pan  R=reset  j/&rarr;=next  k/&larr;=prev  esc=back</div>
    </div>
  `;
}

function _setViewMode(mode, scanId) {
  _viewMode = mode;
  _panZoom = { ox: 0, oy: 0, scale: 1 };
  _sliderDragging = false;
  if (mode === 'toggle') _toggleShowing = 'golden';
  _renderDetail(scanId);
  _initPanZoom();
  if (mode === 'slider') _initSliderDrag();
}

let _sliderDragging = false;
let _sliderPct = 50;

function _initSliderDrag() {
  const handle = document.getElementById('slider-handle');
  const area = document.getElementById('view-area');
  if (!handle || !area) return;
  _sliderPct = 50;
  _updateSliderClip();

  const onMove = (e) => {
    e.preventDefault();
    const x = e.touches ? e.touches[0].clientX : e.clientX;
    const rect = area.getBoundingClientRect();
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
}

function _updateSliderClip() {
  const golden = document.getElementById('slider-golden');
  const area = document.getElementById('view-area');
  const img = document.getElementById('detail-img');
  if (!golden || !area || !img) return;

  // Convert container-space handle X to image-space clip
  const handleX = (area.clientWidth * _sliderPct) / 100;
  // Image-space X = (containerX - ox) / scale
  const imgClipRight = (handleX - _panZoom.ox) / _panZoom.scale;
  const imgW = img.naturalWidth;
  // clip-path inset: top right bottom left (in px from each edge)
  const rightInset = Math.max(0, imgW - imgClipRight);
  golden.style.clipPath = `inset(0 ${rightInset}px 0 0)`;
}

function _detailNext(scanId) {
  if (_detailIndex < _detailFailures.length - 1) {
    _detailIndex++;
    _detailFailure = _detailFailures[_detailIndex];
    navigate(`/scans/${scanId}/review/${encodeURIComponent(_detailFailure.filename)}`);
  }
}

function _detailPrev(scanId) {
  if (_detailIndex > 0) {
    _detailIndex--;
    _detailFailure = _detailFailures[_detailIndex];
    navigate(`/scans/${scanId}/review/${encodeURIComponent(_detailFailure.filename)}`);
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
  const area = document.getElementById('view-area');
  if (!area) return;
  const newScale = Math.min(_panZoom.scale * 1.3, 20);
  _zoomAtPoint(newScale, area.clientWidth / 2, area.clientHeight / 2);
  _applyPanZoom();
}

function _zoomOut() {
  const area = document.getElementById('view-area');
  if (!area) return;
  const newScale = Math.max(_fitScale, _panZoom.scale / 1.3);
  _zoomAtPoint(newScale, area.clientWidth / 2, area.clientHeight / 2);
  _applyPanZoom();
}

function _zoomReset() {
  _fitScale = _computeFitScale();
  _panZoom.scale = _fitScale;
  _centerImage();
  _applyPanZoom();
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
  if (_viewMode === 'slider') _updateSliderClip();
}



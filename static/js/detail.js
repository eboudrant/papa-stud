// @ts-check

/** @type {object|null} */
let _detailScan = null;
let _detailFailure = null;
let _detailFailures = [];
let _detailIndex = -1;

function showDetail(scanId, filename) {
  const content = document.getElementById('content');
  content.innerHTML = '<div class="detail-loading">Loading...</div>';

  _loadDetail(scanId, filename);

  const _keyHandler = (e) => {
    if (e.target.tagName === 'INPUT') return;
    switch (e.key) {
      case 'ArrowRight': case 'j': _detailNext(scanId); break;
      case 'ArrowLeft': case 'k': _detailPrev(scanId); break;
      case 'Escape': navigate(`/scans/${scanId}`); break;
    }
  };
  document.addEventListener('keydown', _keyHandler);

  return () => {
    document.removeEventListener('keydown', _keyHandler);
  };
}

async function _loadDetail(scanId, filename) {
  // Load all failures to enable navigation
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
}

function _renderDetail(scanId) {
  const f = _detailFailure;
  const content = document.getElementById('content');

  const goldenSrc = f.golden_path ? `/api/images?path=${encodeURIComponent(f.golden_path)}` : '';
  const deltaSrc = f.delta_path ? `/api/images?path=${encodeURIComponent(f.delta_path)}` : '';
  const actualSrc = f.actual_path ? `/api/images?path=${encodeURIComponent(f.actual_path)}` : '';

  content.innerHTML = `
    <div class="detail">
      <div class="detail-header">
        <a class="btn" href="#/scans/${scanId}">Back</a>
        <div class="detail-meta">
          <span class="detail-title">${_dEsc(f.class_name || f.filename)}</span>
          <span class="detail-subtitle">${_dEsc(f.package)}${f.method ? '.' + _dEsc(f.method) : ''}${f.snapshot_name ? ' / ' + _dEsc(f.snapshot_name) : ''}</span>
        </div>
        <div class="detail-nav">
          <button class="btn" onclick="_detailPrev('${scanId}')" ${_detailIndex <= 0 ? 'disabled' : ''}>&larr; Prev</button>
          <span class="counter">${_detailIndex + 1} / ${_detailFailures.length}</span>
          <button class="btn" onclick="_detailNext('${scanId}')" ${_detailIndex >= _detailFailures.length - 1 ? 'disabled' : ''}>Next &rarr;</button>
        </div>
      </div>
      <div class="detail-images">
        <div class="detail-pane">
          <div class="pane-label">Expected (Golden)</div>
          ${goldenSrc ? `<img src="${goldenSrc}" onclick="_toggleZoom(this)">` : '<div class="pane-empty">No golden image</div>'}
        </div>
        <div class="detail-pane">
          <div class="pane-label">Delta (Diff)</div>
          ${deltaSrc ? `<img src="${deltaSrc}" onclick="_toggleZoom(this)">` : '<div class="pane-empty">No delta</div>'}
        </div>
        <div class="detail-pane">
          <div class="pane-label">Actual</div>
          ${actualSrc ? `<img src="${actualSrc}" onclick="_toggleZoom(this)">` : '<div class="pane-empty">No actual image</div>'}
        </div>
      </div>
      <div class="detail-filename">${_dEsc(f.filename)}</div>
      <div class="detail-shortcuts">Keyboard: j/&rarr;=next  k/&larr;=prev  esc=back</div>
    </div>
  `;
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

function _toggleZoom(img) {
  img.classList.toggle('zoomed');
}

function _dEsc(str) {
  const d = document.createElement('div');
  d.textContent = str || '';
  return d.innerHTML;
}

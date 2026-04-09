// @ts-check

/** @type {Array<{pattern: RegExp, handler: function}>} */
const routes = [];

/** @type {function|null} */
let cleanupFn = null;

function addRoute(pattern, handler) {
  routes.push({ pattern, handler });
}

function navigate(hash) {
  window.location.hash = hash;
}

function start() {
  window.addEventListener('hashchange', _onHashChange);
  _onHashChange();
}

function _onHashChange() {
  const hash = window.location.hash.slice(1) || '/';

  // Cleanup previous page
  if (cleanupFn) {
    cleanupFn();
    cleanupFn = null;
  }

  _updateNav(hash);

  for (const route of routes) {
    const match = hash.match(route.pattern);
    if (match) {
      const result = route.handler(match);
      if (typeof result === 'function') {
        cleanupFn = result;
      }
      return;
    }
  }

  // Fallback
  document.getElementById('content').innerHTML = '<div class="empty-state">Page not found</div>';
}

const _isElectron = new URLSearchParams(window.location.search).has('electron');
if (_isElectron) document.body.classList.add('electron');

/** Update nav breadcrumbs. Call setNavContext() from pages to add scan/project info. */
let _navContext = {};

function setNavContext(ctx) {
  _navContext = ctx || {};
  _updateNav(window.location.hash.slice(1) || '/');
}

function _updateNav(hash) {
  const nav = document.getElementById('nav-bar');
  if (!nav || !_isElectron) return;

  const scanMatch = hash.match(/^\/scans\/([^/]+)$/);
  const detailMatch = hash.match(/^\/scans\/([^/]+)\/review\/(.+)$/);
  const projectName = _navContext.projectName || '';

  if (detailMatch) {
    const scanId = detailMatch[1];
    const filename = decodeURIComponent(detailMatch[2]);
    const shortName = filename.replace(/\.png$/, '').split('_').pop() || filename;
    nav.innerHTML = `
      <span class="nav-sep">/</span>
      <a class="nav-link" href="#/scans/${escHtml(scanId)}">${escHtml(projectName || 'Review')}</a>
      <span class="nav-sep">/</span>
      <span class="nav-link active">${escHtml(shortName)}</span>
    `;
  } else if (scanMatch) {
    nav.innerHTML = `
      <span class="nav-sep">/</span>
      <span class="nav-link active">${escHtml(projectName || 'Review')}</span>
    `;
  } else {
    nav.innerHTML = '';
  }
}

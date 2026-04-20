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

function navigateReplace(hash) {
  history.replaceState(null, '', '#' + hash);
  _onHashChange();
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

// --- Back navigation ---
// Track forward navigations so we know if history.back() is safe.
// history.back() on hashchange also fires hashchange, but we only count
// forward navigations (navigate/link clicks), not back navigations.
let _historyDepth = 0;
let _isGoingBack = false;

window.addEventListener('hashchange', () => {
  if (_isGoingBack) {
    _isGoingBack = false;
    _historyDepth = Math.max(0, _historyDepth - 1);
  } else {
    _historyDepth++;
  }
});

function _goHome() {
  _historyDepth = 0;
  _isGoingBack = false;
  window.location.hash = '/';
}

function _navGoBack() {
  if (_historyDepth > 0) {
    _isGoingBack = true;
    history.back();
  } else {
    navigate('/');
  }
}

// --- Nav breadcrumbs ---

let _navContext = {};

function setNavContext(ctx) {
  _navContext = ctx || {};
  _updateNav(window.location.hash.slice(1) || '/');
}

const _backArrowSvg = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m15 18-6-6 6-6"/></svg>';

function _buildNavItems(hash) {
  const detailMatch = hash.match(/^\/scans\/([^/]+)\/review\/(.+)$/);
  const scanMatch = hash.match(/^\/scans\/([^/]+)$/);
  const settingsMatch = hash.match(/^\/settings$/);
  const projectName = _navContext.projectName || '';

  if (detailMatch) {
    const className = _navContext.className || '';
    const methodName = _navContext.methodName || '';
    let testLabel;
    if (className && methodName) {
      testLabel = escHtml(className + '.' + methodName);
    } else if (className) {
      testLabel = escHtml(className);
    } else {
      const filename = decodeURIComponent(detailMatch[2]);
      testLabel = escHtml(filename.replace(/\.png$/, '').replace(/^delta-/, '').replace(/_compare$/, '').replace(/_actual$/, ''));
    }
    return [
      { key: 'back', tag: 'button', cls: 'nav-back', content: _backArrowSvg },
      { key: 'project', tag: 'span', cls: 'nav-label', content: escHtml(projectName || 'Review') },
      { key: 'sep1', tag: 'span', cls: 'nav-sep', content: '/' },
      { key: 'test', tag: 'span', cls: 'nav-link active nav-ellipsis', content: testLabel },
    ];
  } else if (scanMatch) {
    return [
      { key: 'back', tag: 'button', cls: 'nav-back', content: _backArrowSvg },
      { key: 'project', tag: 'span', cls: 'nav-label', content: escHtml(projectName || 'Review') },
    ];
  } else if (settingsMatch) {
    return [
      { key: 'back', tag: 'button', cls: 'nav-back', content: _backArrowSvg },
      { key: 'settings', tag: 'span', cls: 'nav-label', content: 'Settings' },
    ];
  }
  return [];
}

function _createNavEl(item) {
  const el = document.createElement(item.tag);
  el.className = item.cls;
  el.dataset.navKey = item.key;
  if (item.key === 'back') {
    el.title = 'Back';
    el.addEventListener('click', _navGoBack);
  }
  el.innerHTML = item.content;
  return el;
}

function _updateNav(hash) {
  const nav = document.getElementById('nav-bar');
  if (!nav) return;

  const newItems = _buildNavItems(hash);
  const newKeys = newItems.map(i => i.key);
  const oldKeys = [...nav.querySelectorAll('[data-nav-key]')].map(el => el.dataset.navKey);

  // Same structure — update content in place
  if (newKeys.length === oldKeys.length && newKeys.every((k, i) => k === oldKeys[i])) {
    for (const item of newItems) {
      const el = nav.querySelector(`[data-nav-key="${item.key}"]`);
      if (el) el.innerHTML = item.content;
    }
    return;
  }

  // Different structure — rebuild immediately (no animation to avoid stale state)
  nav.innerHTML = '';
  for (const item of newItems) {
    nav.appendChild(_createNavEl(item));
  }
}

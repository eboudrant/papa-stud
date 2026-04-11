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

let _navDepth = 0;
window.addEventListener('hashchange', () => { _navDepth++; });

function _navGoBack() {
  if (_navDepth > 0) {
    history.back();
  } else {
    navigate('/');
  }
}

/** Update nav breadcrumbs. Call setNavContext() from pages to add scan/project info. */
let _navContext = {};

function setNavContext(ctx) {
  _navContext = ctx || {};
  _updateNav(window.location.hash.slice(1) || '/');
}

const _backArrowSvg = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m15 18-6-6 6-6"/></svg>';

let _navKeys = []; // previous nav item keys for diffing

function _buildNavItems(hash) {
  const detailMatch = hash.match(/^\/scans\/([^/]+)\/review\/(.+)$/);
  const scanMatch = hash.match(/^\/scans\/([^/]+)$/);
  const settingsMatch = hash.match(/^\/settings$/);
  const projectName = _navContext.projectName || '';

  if (detailMatch) {
    const scanId = detailMatch[1];
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

function _createNavEl(item, animate) {
  const el = document.createElement(item.tag);
  el.className = item.cls + (animate ? ' nav-enter' : '');
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
  const oldKeys = [..._navKeys];
  const newKeys = newItems.map(i => i.key);

  const removing = oldKeys.filter(k => !newKeys.includes(k));
  const adding = newKeys.filter(k => !oldKeys.includes(k));

  // Same keys, just update content in place (no animation reset)
  if (removing.length === 0 && adding.length === 0) {
    for (const item of newItems) {
      const el = nav.querySelector(`[data-nav-key="${item.key}"]`);
      if (el) {
        el.innerHTML = item.content;
      }
    }
    _navKeys = newKeys;
    return;
  }

  _navKeys = newKeys;

  // Fade out removed items, then rebuild
  if (removing.length > 0) {
    let pending = 0;
    nav.querySelectorAll('[data-nav-key]').forEach(el => {
      if (removing.includes(el.dataset.navKey)) {
        el.classList.add('nav-exit');
        pending++;
        el.addEventListener('animationend', () => {
          if (--pending === 0) _rebuildNav(nav, newItems, adding);
        }, { once: true });
      }
    });
  } else {
    _rebuildNav(nav, newItems, adding);
  }
}

function _rebuildNav(nav, items, adding) {
  nav.innerHTML = '';
  for (const item of items) {
    nav.appendChild(_createNavEl(item, adding.includes(item.key)));
  }
}

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

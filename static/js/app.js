// @ts-check

// Print any error that would otherwise vanish into a half-rendered UI.
// Renderer errors (DOM, JSON shape mismatches, async promise rejections)
// previously left pages stuck on their initial skeleton. The handlers below
// don't unstick the UI — try/catch in the route loaders does that — but they
// guarantee a stack trace in the console so the next half-render is diagnosable.
window.addEventListener('error', (e) => {
  console.error('[uncaught]', e.message, e.error || '', 'at', e.filename + ':' + e.lineno + ':' + e.colno);
});
window.addEventListener('unhandledrejection', (e) => {
  console.error('[unhandled-rejection]', e.reason);
});

// Register routes and start the app
addRoute(/^\/$/, showHome);
addRoute(/^\/settings$/, showSettings);
addRoute(/^\/scans\/([^/]+)$/, (m) => showReview(m[1]));
addRoute(/^\/scans\/([^/]+)\/review\/(.+)$/, (m) => showDetail(m[1], decodeURIComponent(m[2])));

start();

// @ts-check

// Register routes and start the app
addRoute(/^\/$/, showHome);
addRoute(/^\/settings$/, showSettings);
addRoute(/^\/scans\/([^/]+)$/, (m) => showReview(m[1]));
addRoute(/^\/scans\/([^/]+)\/review\/(.+)$/, (m) => showDetail(m[1], decodeURIComponent(m[2])));

start();

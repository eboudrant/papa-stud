# feat: re-enable Watch with a polling watcher

**Date:** 2026-04-20
**Type:** Feature

## Intent

The Watch button was disabled in an earlier fix because chokidar opens a file descriptor per watched directory, and Gradle monorepos (hundreds of modules × several watch dirs) blew past the macOS FD limit with EMFILE. Re-enable it using a polling approach that consumes zero descriptors and scales predictably.

Also fixes a bug where accepting a baseline, then triggering a rescan (via Watch or Re-scan), reset the failure's status from `accepted` back to `pending`.

### Prompts summary

1. We disabled the watch realtime because of CPU issues — re-enable it without using too much resource
2. User reports: accepted baseline, re-ran gradle, failure didn't disappear (diagnosed as two separate issues — gradle incremental cache + stale grandchild mtime detection)

## Changes

### `src/watcher.js`
Rewrote from `ChokidarWatcher` to `PollingWatcher`:
- Stats each watched dir + its first-level subdirs every 5s. Tracks one max-mtime per module.
- Handles the JUnit XML case: `build/test-results/testDebugUnitTest/TEST-*.xml` lives one level deeper than the watched root, so watching only the parent would miss XML rewrites. First-level subdir recursion catches it.
- Comparison is `!==` (not `>`) so dir deletion also triggers a rescan.
- Module discovery runs every 6 ticks (~30s) instead of every tick.
- Resource profile: ~4 stats × 500 modules = 2k stats per 5s. Zero FDs.

### `src/projects.js`
In `updateScanModule`, preserve `accepted`/`rejected` status across rescans. Before: a Watch-triggered rescan would rebuild the module's failures from disk and wipe any `accepted` status the user had set. Now: prior non-pending statuses are re-applied to re-detected failures by filename.

### `static/js/review.js`
Un-commented the Watch button.

### `package.json` / `package-lock.json`
Removed the `chokidar` dependency (no longer imported anywhere).

### `tests/node/watcher.test.js` (new)
Four tests covering: no-fire on start, fire on dir-mtime bump, fire on grandchild-subdir mtime bump (the JUnit case), no-fire on same mtime, no-throw on missing dir.

### `tests/screenshots/review-grid*.png` / `review-sidebar.png`
Regenerated baselines — the Watch button is back in the toolbar.

## Files modified

| File | Change |
|------|--------|
| `src/watcher.js` | Chokidar → polling watcher |
| `src/projects.js` | Preserve accepted/rejected status across rescans |
| `static/js/review.js` | Re-enabled Watch button |
| `package.json` + `package-lock.json` | Drop chokidar dep |
| `tests/node/watcher.test.js` | New unit tests |
| `tests/screenshots/review-*.png` | Regenerated baselines |

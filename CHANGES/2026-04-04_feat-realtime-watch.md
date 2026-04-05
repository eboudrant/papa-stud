# feat: realtime file watching for live scan updates

**Date:** 2026-04-04
**Type:** Feature

## Intent

Enable realtime mode after a scan so that running `verifyPaparazzi` or `recordPaparazzi` instantly updates the failure view without manual re-scanning. Uses watchdog for OS-native filesystem notifications with debounced per-module re-processing.

### Prompts summary

1. Add realtime watch mode — toggle after scan, watch for any build output changes
2. In-place scan updates (same scan ID, failures refreshed live)
3. Use watchdog library for instant file change detection
4. Debounce per module (500ms) to handle multi-file writes during test runs

## Changes

### `server/watcher.py` (NEW)
- `ScanWatcher` class using watchdog `Observer` + custom `FileSystemEventHandler`
- Watches per-module: `build/paparazzi/failures/`, `build/test-results/`, `src/test/snapshots/images/`
- Path-to-module mapping for instant event routing
- Per-module debounce with `threading.Timer` (500ms) to batch file events
- Single Observer thread per watcher

### `server/scanner.py` (MODIFIED)
- Extracted `process_single_module()` from incremental scan loop
- Reused by both initial scan and watcher's on_change callback
- Same stale detection logic (JUnit XML, golden file timestamps)

### `server/projects.py` (MODIFIED)
- Added `update_scan_module()` for in-place module updates
- Replaces failures for a single module, recomputes stats, updates index

### `server/scan_jobs.py` (MODIFIED)
- Added `start_watching(scan_id)`, `stop_watching(scan_id)`, `is_watching(scan_id)`
- Watcher management with cleanup on scan delete

### `server/handler.py` (MODIFIED)
- `POST /api/scans/{id}/watch` — start watching
- `DELETE /api/scans/{id}/watch` — stop watching
- `GET /api/scans/{id}/watch` — query watch state
- Scan delete also stops any active watcher

### `static/js/review.js` (MODIFIED)
- Watch toggle button in toolbar ("Watch" / "Watching" with pulse animation)
- Polls scan data every 2s while watching, refreshes grid/sidebar on changes
- Change detection via stats JSON comparison (avoids unnecessary re-renders)
- Cleanup on page navigation

### `static/css/app.css` (MODIFIED)
- Watch button styles with pulse animation when active

### Infrastructure
- Added `requirements.txt` with `watchdog>=4.0`
- Updated `Dockerfile` and `Dockerfile.test` to install watchdog
- Updated `CLAUDE.md` with watchdog dependency note

## Files modified

| File | Change |
|------|--------|
| `server/watcher.py` | Realtime file watcher with watchdog |
| `server/scanner.py` | Extracted `process_single_module()` |
| `server/projects.py` | In-place module update |
| `server/scan_jobs.py` | Watcher management |
| `server/handler.py` | Watch API endpoints |
| `static/js/review.js` | Watch toggle + auto-refresh |
| `static/css/app.css` | Watch button styles |
| `requirements.txt` | watchdog dependency |
| `Dockerfile` | Install requirements.txt |
| `Dockerfile.test` | Install requirements.txt |
| `CLAUDE.md` | Updated stack description |

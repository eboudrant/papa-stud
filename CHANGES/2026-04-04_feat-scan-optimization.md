# feat: optimize scanning and improve scan UI

**Date:** 2026-04-04
**Type:** Feature

## Intent

Scanning 700+ module Gradle monorepos was slow and blocking. This change makes scanning async with real-time progress, adds smarter stale delta detection, parses JUnit XML for test context, counts golden snapshots, and improves the scan management UI.

### Prompts summary

1. Optimize scanning for 700+ modules, 1000+ failures
2. Background scan with progress bar and cancel support
3. Parse JUnit XML for test stats, show pass/fail/skip bars
4. Detect stale delta files using XML timestamps and golden file timestamps
5. Show all Paparazzi modules (including 100% passing) in sidebar
6. Snapshot-based progress bars (red = screenshot failures, green = passing snapshots)
7. Abbreviated module names in sidebar (:libraries:starcourt: -> :l:s:)
8. FPS-style WASD/IJKL keyboard navigation for pan/zoom
9. E key to cycle view modes

## Changes

### `server/scan_jobs.py` (NEW)
- Background scan job manager with threading, progress tracking, cancellation
- Jobs cleaned up after 5-minute TTL to prevent memory leaks
- Status flow: discovering -> scanning -> completed | failed | cancelled

### `server/scanner.py` (MODIFIED)
- Replaced `rglob` with `os.walk` + aggressive pruning (27s -> 0.4s for discovery)
- Prunes `.git`, `.gradle`, `src`, `node_modules`, `.kotlin`, `.cxx`, `.transforms`
- Inside `build/`, only descends into `paparazzi/` and `test-results/`
- New `scan_project_incremental()` generator yielding progress per module
- Discovers ALL modules with `build/paparazzi/` (not just those with failures)
- JUnit XML parsing for test stats (tests/passed/failed/skipped/time)
- Stale delta detection: filters deltas when XML reports 0 failures and is newer
- Stale delta detection: filters deltas when golden image is newer (recordPaparazzi after verify)
- Counts golden snapshots per module for accurate progress bars

### `server/projects.py` (MODIFIED)
- Scan index (`data/scans/index.json`) for fast listing without loading full scan files
- `create_scan_from_results()` for background job integration
- Scan IDs now include random suffix to prevent collisions
- Index auto-rebuilds from existing scan files on migration

### `server/handler.py` (MODIFIED)
- `POST /api/projects/{id}/scan` now returns `{"jobId": "..."}` with 202 (async)
- `GET /api/scan-jobs/{id}` for polling progress
- `POST /api/scan-jobs/{id}/cancel` for cancellation

### `static/js/home.js` (MODIFIED)
- Async scan with polling progress bar, module name display, cancel button
- Discovery phase shows pulsing bar with "Discovering :module:name..."
- Toast notifications for 0-failure scans, cancellations, errors
- Scan list with delete buttons, relative timestamps, full dates
- Snapshot-based progress bars (green/red only, no JUnit stats in bars)
- Cleanup function for poll timers on navigation

### `static/js/review.js` (MODIFIED)
- Sidebar shows ALL Paparazzi modules (failing first, then alphabetical)
- Abbreviated common prefixes (:libraries:starcourt: -> :l:s:)
- Snapshot count bars per module (green = passing, red = failures)
- Failing modules in bold, count always visible (not truncated with name)
- Clicking passing module shows "No failures, N snapshots passing"

### `static/js/detail.js` (MODIFIED)
- WASD/IJKL keyboard navigation: W/I zoom in, S/K zoom out, A/J pan right, D/L pan left
- Smooth continuous motion at 60fps while keys are held (velocity-based, not per-keypress)
- E key cycles view modes (delta -> toggle -> slider)
- Zoom centers on cursor when cursor is over the image
- Keyboard zoom/reset animated with ease-out

### `static/js/api.js` (MODIFIED)
- Shared `snapshotBar()` function for rendering pass/fail bars

### `static/css/app.css` (MODIFIED)
- Scan progress bar, pulsing animation for discovery phase
- Toast notifications (success/info/error)
- Snapshot bar styles (sidebar + home page)
- Tree item layout: name truncates, count stays visible

## Files modified

| File | Change |
|------|--------|
| `server/scan_jobs.py` | Background scan job manager |
| `server/scanner.py` | Incremental scanner, pruning, JUnit, stale detection |
| `server/projects.py` | Scan index, async scan support |
| `server/handler.py` | Async scan API endpoints |
| `static/js/home.js` | Progress UI, scan delete, better list |
| `static/js/review.js` | All modules sidebar, snapshot bars, abbreviations |
| `static/js/detail.js` | WASD/IJKL navigation, E cycle, cursor zoom |
| `static/js/api.js` | Shared snapshotBar() |
| `static/css/app.css` | Progress, toast, bar, tree styles |
| `tests/test_scanner.py` | Stale golden detection, snapshot count tests |

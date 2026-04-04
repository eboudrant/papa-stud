# feat: Paparazzi screenshot failure reviewer

**Date:** 2026-04-03
**Type:** Feature

## Intent

Build a system to visualize Paparazzi screenshot test failures at scale. Supports thousands of failures with efficient grid browsing, three view modes for comparing golden vs actual images, Google Maps-style zoom/pan, and smart stale failure detection via mtime clustering.

### Prompts summary

1. Build a system to visualize paparazzi screenshot failures, make it efficient with nice UI
2. Add directory scanning for Gradle project root, detect current vs stale failures via mtime clustering
3. Group failures by module in sidebar tree
4. Detail view with 3 modes: Delta full-screen, Toggle (T to swap golden/actual), Slider (drag handle)
5. Google Maps-style zoom (scroll toward cursor) and drag-to-pan, min zoom is fit-center
6. Remove accept/reject UI (viewer only for now)
7. Stick figure test fixture images for realistic screenshot tests

## Changes

### `server/filename_parser.py` (NEW)
- Parses Paparazzi filenames (`{package}_{class}_{method}[_{snapshot}].png`) into structured components
- Heuristic: segments with dots are package, first uppercase segment is class, next is method
- Fallback to raw filename when parsing is ambiguous

### `server/scanner.py` (NEW)
- Scans Gradle project for `build/paparazzi/failures/` directories across all modules
- Detects current vs stale failures by clustering delta file mtimes (60s tolerance)
- Matches golden images from `src/test/snapshots/images/`

### `server/projects.py` (NEW)
- Project CRUD: add/list/delete projects with JSON persistence in `data/projects.json`
- Scan creation: orchestrates scanner, stores results in `data/scans/{id}.json`
- Paginated failure queries (by module, search text)
- Thread-safe read-modify-write with `threading.Lock`

### `server/handler.py` (MODIFIED)
- Added `do_POST`, `do_PUT`, `do_DELETE` methods
- Full REST API: projects CRUD, scan creation, image serving
- Image serving from project directories with path validation (only registered project paths)
- Cache-Control: no-cache for development

### `static/index.html` (MODIFIED)
- Converted to SPA shell: header + content div + script/CSS loading

### `static/css/app.css` (NEW)
- Light theme with CSS variables (`--bg-inset` for image backgrounds)
- Grid layout, sidebar tree, detail view with fit-to-viewport flex layout
- Pan/zoom support: absolute positioning with transform-origin, grab cursor
- Slider mode: clip-path based golden overlay with draggable handle

### `static/js/api.js` (NEW)
- Fetch wrappers for GET/POST/PUT/DELETE
- Shared `escHtml()` and `escAttr()` utilities

### `static/js/router.js` (NEW)
- Hash-based SPA router with cleanup support

### `static/js/home.js` (NEW)
- Project list with add/remove, scan button, recent scans list

### `static/js/review.js` (NEW)
- Thumbnail grid with CSS Grid, lazy-loaded images
- Search input, module sidebar tree with counts
- Infinite scroll via IntersectionObserver

### `static/js/detail.js` (NEW)
- Three view modes: Delta (1), Toggle (2), Slider (3) — switchable via keyboard or pills
- Google Maps-style zoom/pan: scroll-wheel zooms toward cursor, drag to pan, double-click zoom
- Min zoom is fit-center, R key resets
- Toggle mode: T key swaps golden/actual, preserves zoom/pan state
- Slider mode: draggable handle clips golden image, zoom/pan works behind the handle
- Keyboard: j/k or arrows for prev/next, Escape back to grid

### `static/js/app.js` (NEW)
- Route registration and app initialization

### `.dockerignore` (NEW)
- Excludes data/, node_modules/, test artifacts, .git from Docker builds

### Tests
- 16 Python unit tests: filename parser (10 cases) + scanner (6 cases: stale filtering, module discovery)
- 6 Playwright screenshot tests: home empty/add-project, review grid, detail delta/toggle/slider
- Stick figure fixture images (golden with arms out, actual with arms raised, delta with red diff)

## Files modified

| File | Change |
|------|--------|
| `server/filename_parser.py` | Paparazzi filename parser |
| `server/scanner.py` | Filesystem scanner with stale detection |
| `server/projects.py` | Project/scan CRUD |
| `server/handler.py` | Full REST API routing + image serving |
| `static/index.html` | SPA shell |
| `static/css/app.css` | Complete styling with zoom/pan support |
| `static/js/api.js` | API client + shared escape utilities |
| `static/js/router.js` | Hash-based SPA router |
| `static/js/home.js` | Home page |
| `static/js/review.js` | Review grid with sidebar and infinite scroll |
| `static/js/detail.js` | Detail view with 3 modes + Google Maps zoom/pan |
| `static/js/app.js` | App entry point |
| `.dockerignore` | Docker build exclusions |
| `.github/workflows/ci.yml` | Added unit tests to CI |
| `tests/test_filename_parser.py` | Filename parser unit tests |
| `tests/test_scanner.py` | Scanner unit tests |
| `tests/screenshots/review.spec.js` | Detail + grid screenshot tests |
| `tests/screenshots/fixtures.js` | Mock API with stick figure images |
| `tests/screenshots/fixtures/` | Golden, actual, delta PNG fixtures |

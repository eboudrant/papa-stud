# feat: Paparazzi screenshot failure reviewer

**Date:** 2026-04-03
**Type:** Feature

## Intent

Build a system to visualize and review Paparazzi screenshot test failures at scale. Supports thousands of failures with efficient grid browsing, three-pane comparison (golden/delta/actual), keyboard-driven accept/reject workflow, and smart stale failure detection.

### Prompts summary

1. Build a system to visualize paparazzi screenshot failures, make it efficient with nice UI
2. Add directory scanning for Gradle project root, detect current vs stale failures via mtime clustering
3. Review workflow: track accept/reject status only (user runs recordPaparazzi themselves)
4. Group failures by module in sidebar tree

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
- Failure status management: individual and batch accept/reject updates
- Paginated, filtered failure queries (by status, module, search text)
- Thread-safe read-modify-write with `threading.Lock`

### `server/handler.py` (MODIFIED)
- Added `do_POST`, `do_PUT`, `do_DELETE` methods
- Full REST API: projects CRUD, scan creation, failure status updates, batch operations
- Image serving from project directories with path validation (only registered project paths)

### `static/index.html` (MODIFIED)
- Converted to SPA shell: header + content div + script/CSS loading

### `static/css/app.css` (NEW)
- Complete styling: light theme with CSS variables, grid layout, sidebar tree, status badges, detail view, progress bars

### `static/js/api.js` (NEW)
- Fetch wrappers for GET/POST/PUT/DELETE

### `static/js/router.js` (NEW)
- Hash-based SPA router with cleanup support

### `static/js/home.js` (NEW)
- Project list with add/remove, scan button, recent scans with progress bars

### `static/js/review.js` (NEW)
- Thumbnail grid with CSS Grid, lazy-loaded images, colored status borders
- Filter pills (All/Pending/Accepted/Rejected), search input, module sidebar tree
- Infinite scroll via IntersectionObserver, batch accept all visible
- Shift+A keyboard shortcut for bulk accept

### `static/js/detail.js` (NEW)
- Three-pane comparison: Expected (golden), Delta (diff), Actual
- Keyboard navigation: a=accept, x=reject, j/arrows=next, k/arrows=prev, esc=back
- Click-to-zoom on images, status badge updates in-place

### `static/js/app.js` (NEW)
- Route registration and app initialization

### `.dockerignore` (NEW)
- Excludes data/, node_modules/, test artifacts, .git from Docker builds

### `tests/screenshots/hello.spec.js` (MODIFIED)
- Updated tests for new home page: empty state and add project form toggle

## Files modified

| File | Change |
|------|--------|
| `server/filename_parser.py` | Paparazzi filename parser |
| `server/scanner.py` | Filesystem scanner with stale detection |
| `server/projects.py` | Project/scan CRUD and status management |
| `server/handler.py` | Full REST API routing |
| `static/index.html` | SPA shell |
| `static/css/app.css` | Complete styling |
| `static/js/api.js` | API client |
| `static/js/router.js` | Hash-based SPA router |
| `static/js/home.js` | Home page |
| `static/js/review.js` | Review grid page |
| `static/js/detail.js` | Detail comparison page |
| `static/js/app.js` | App entry point |
| `.dockerignore` | Docker build exclusions |
| `tests/screenshots/hello.spec.js` | Updated screenshot tests |
| `tests/screenshots/home-empty.png` | New baseline |
| `tests/screenshots/home-add-project.png` | New baseline |

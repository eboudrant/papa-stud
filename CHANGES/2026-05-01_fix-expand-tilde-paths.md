# fix: expand ~ in project paths and warn on invalid paths

**Date:** 2026-05-01
**Type:** Fix

## Intent
Two related project-add bugs:

1. Paths starting with `~` (e.g. `~/projects/foo`) were stored verbatim and then handed to `fs.realpathSync` / `path.resolve`, neither of which expand the home shortcut. Result: the project silently couldn't be scanned, served images for, or accept baselines from.
2. Pointing the form at a non-existent or non-directory path was accepted without complaint — the failure surfaced much later, far from the cause.

### Prompts summary
1. Make sure I'm on latest main, then fix the bug where paths based on home / `~` aren't working. Validate it works.
2. If I add a project on a dir that's not existing we should have a warning.
3. /simplify

## Changes

### `src/projects.js`
- Added `expandHome(p)` that maps `~` and `~/...` (and `~\...`) to `os.homedir()`; other paths untouched.
- `addProject` expands the incoming path before persisting.
- `listProjects` returns expanded copies (via `.map`, no in-place mutation) so legacy `~`-based entries still work without a migration step.
- `expandHome` exported so the handler can resolve once and stat without double work.

### `src/handler.js`
- `POST /api/projects` now expands `~`, then `fs.statSync` checks the directory exists and is a directory. Returns `400 { error }` otherwise. The error echoes both the user input and the expanded form when they differ, so `~/typo` produces a clear message.
- Passes the resolved path to `addProject` directly (no double expansion).

### `static/js/api.js`
- Extracted shared `_throwIfError(res, method, url)` helper. All four verbs (`apiGet`, `apiPost`, `apiPut`, `apiDelete`) now surface the server's `{ error }` message instead of a generic `STATUS code` string.

### `static/js/home.js`
- `_addProject` catches the apiPost error and shows it via `showToast(..., 'error')` so the user sees the validation message instead of a silent failure.

### `tests/node/projects.test.js`
- New `home directory expansion` suite covering: `~/sub/dir`, bare `~`, untouched absolute paths, untouched mid-path `~`, and legacy stored entries returned via `listProjects` / `getProject`.

### `tests/node/handler.test.js` (new)
- Boots `createApp()` on a random port and exercises `POST /api/projects` validation: rejects non-existent paths, rejects file (not directory), rejects `~/non-existent`, accepts a real directory, accepts bare `~`, rejects empty body.

## Files modified

| File | Change |
|------|--------|
| `src/projects.js` | Add `expandHome`, apply at write and read |
| `src/handler.js` | Validate path exists & is a directory; clearer error when `~` expanded |
| `static/js/api.js` | Unify server-error extraction across all four verbs |
| `static/js/home.js` | Show validation error as toast |
| `tests/node/projects.test.js` | Tilde expansion tests |
| `tests/node/handler.test.js` | New: HTTP-level validation tests |

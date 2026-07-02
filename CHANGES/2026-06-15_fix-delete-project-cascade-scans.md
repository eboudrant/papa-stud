# fix: cascade-delete scans on project delete / reset

**Date:** 2026-06-15
**Type:** Fix

## Intent

Deleting a project removed the project entry and its xcresult cache but left the
project's scans behind (scan JSON files and entries in `scans/index.json`). The
orphaned scans still showed on the home page and re-scanning from them 404'd
because the project was gone. `POST /api/config/reset` had the same gap, and any
watcher running on those scans kept polling. Closes #128.

### Prompts summary
1. Implement GitHub issue #128: cascade-delete a project's scans on project delete and on config reset, and stop watchers on those scans.

## Changes

### `src/projects.js`
- Added `deleteScansForProject(projectId)`: reads the scan index, unlinks every scan file belonging to the project (guarded by `existsSync`), rewrites the index without those entries, and returns the deleted scan ids.
- `deleteProject` now calls `deleteScansForProject` in addition to removing the project entry and the xcresult cache.
- Added `deleteAllScans()`: unlinks every scan file and writes an empty index; used by the config reset handler.
- Exported both new functions. `scanJobs` requires `projects`, so the scan-file cascade lives here and watcher-stopping stays in the route handlers to avoid a require cycle.

### `src/handler.js`
- `DELETE /api/projects/:id` stops watchers for the project's scans (via `projects.listScans()` filtered by `projectId`) before calling `projects.deleteProject`.
- `POST /api/config/reset` now calls `scanJobs.stopAllWatching()` and `projects.deleteAllScans()` after resetting projects and templates.

### `src/scanJobs.js`
- Added and exported `stopAllWatching()`: stops every active watcher and clears the internal `watchers` map.

### `tests/node/projects.test.js`
- New tests: `deleteProject` removes the project's scan file and index entry while leaving other projects' scans intact; `deleteAllScans` removes every scan file and empties the index.

## Files modified

| File | Change |
|------|--------|
| `src/projects.js` | Add `deleteScansForProject` / `deleteAllScans`; cascade in `deleteProject` |
| `src/handler.js` | Stop watchers on project delete; stop all watchers + delete all scans on reset |
| `src/scanJobs.js` | Add `stopAllWatching()` |
| `tests/node/projects.test.js` | Unit tests for the cascade delete and full reset |

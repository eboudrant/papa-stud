# fix: don't let Watch wipe xcresult-derived failures

**Date:** 2026-06-15
**Type:** Fix

## Intent
Toggling Watch on a swift-snapshot (xcresult) scan destroyed its results. Watch
drives per-module rescans through `processSingleModule` — the file-convention
path — but xcresult strategies derive failures from a single global parse
(`parseProjectFailures`). The per-module rescan finds ~zero failures and
`updateScanModule` then replaces the real, parse-derived failures (and the
user's accept/reject decisions) with an empty list, immediately on the initial
rescan. This violated "rescans preserve user decisions" in
`.claude/rules/scanning.md`. Watch genuinely doesn't fit the global-parse model,
so it is now refused for those strategies rather than silently corrupting data.
Closes #127.

### Prompts summary
1. Code review finding #5 / issue #127.
2. "address them by priority… if they make sense."

## Changes

### `src/scanJobs.js`
- Added `watchSupported(scanId)` — `false` for strategies that define
  `parseProjectFailures` (xcresult/swift-snapshot), `true` for gradle, `null`
  when the scan is missing.
- `startWatching` now returns `false` for those strategies **before** the
  destructive initial rescan, so no failures are overwritten.

### `src/handler.js`
- `POST /api/scans/:id/watch` returns `400 watch is not supported for this
  project type` (distinct from `404` for a missing scan).
- `GET /api/scans/:id/watch` now also reports `supported`.

### `static/js/review.js`
- `_toggleWatch` wraps the start call in try/catch and shows the error as a
  toast instead of throwing (JS-logic only; no markup/CSS change).

### `tests/node/scanJobs.test.js` (new)
- Verifies `watchSupported` per strategy and that `startWatching` on a
  swift-snapshot scan is refused and leaves the failures/accepted status intact.

## Files modified

| File | Change |
|------|--------|
| `src/scanJobs.js` | `watchSupported()`; refuse Watch for xcresult strategies before rescan |
| `src/handler.js` | 400 for unsupported watch; expose `supported` on GET |
| `static/js/review.js` | `_toggleWatch` surfaces the error via toast |
| `tests/node/scanJobs.test.js` | New tests for the guard |

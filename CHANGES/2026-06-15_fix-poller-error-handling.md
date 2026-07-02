# fix: stop frontend pollers when a job/scan 404s

**Date:** 2026-06-15
**Type:** Fix

## Intent
`apiGet` throws on any non-2xx response, so the `if (!job)` / `if (!check)` null-guards inside the setInterval poll callbacks were dead code. When a scan job expired (TTL) or a scan was deleted, the poll request 404'd, the interval callback rejected unhandled, and the timer kept firing forever — the UI stayed stuck showing progress/"Scanning..." with a console full of unhandled rejections. Wrap each poller's callback in try/catch so any error stops the timer and restores the UI. Closes #130.

### Prompts summary
1. Fix issue #130: pollers never stop on 404 because apiGet throws and the null-guards are dead code; stop timers and restore UI on any error, logic-only (no markup/CSS changes).

## Changes

### `static/js/home.js`
- `_pollScanJob(jobId, projectId)`: wrapped the entire async interval callback body in try/catch. On any error (e.g. job TTL expiry -> 404) the catch calls `_stopPolling(jobId)`, `_restoreScanButton(projectId)`, and logs `[scan-poll] stopped:`. Existing logic unchanged inside the try.

### `static/js/review.js`
- Added module-level `let _rescanPollTimer = null;` next to the other module state so the re-scan poll timer is tracked and can be cleaned up.
- `_rescanFromReview(scanId)`: the poll timer is now assigned to `_rescanPollTimer` instead of a local `const poll` (which was never cleaned up on navigation). All `clearInterval` sites also null the variable. The callback body is wrapped in try/catch; on error the timer is cleared, the Re-scan button is restored, and `[rescan-poll] stopped:` is logged. Navigation to the new scan is now guarded with `if (_scanData && _scanData.id === scanId)` so a stale poll can't yank the user off a different page.
- `showReview`'s returned cleanup function also clears `_rescanPollTimer` if set.
- `_startWatchPoll(scanId)`: wrapped the interval callback body in try/catch that calls `_stopWatchPoll()` and logs `[watch-poll] stopped:` on error (e.g. scan deleted -> 404).

## Files modified

| File | Change |
|------|--------|
| `static/js/home.js` | try/catch around `_pollScanJob` interval callback; stop timer + restore Scan button on error |
| `static/js/review.js` | Track re-scan poll timer at module level, try/catch in re-scan and watch pollers, guard navigation, clean up timer in `showReview` cleanup |
